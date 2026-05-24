const router = require('express').Router();
const db     = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { generateRef, calcFee, totalWithFee } = require('../utils/helpers');
const { sendSMS }          = require('../services/sms');
const { sendReceiptEmail } = require('../services/email');

// Defensive import
const authMiddleware = require('../middleware/auth');
const auth = typeof authMiddleware === 'function' ? authMiddleware : authMiddleware.auth || authMiddleware.default;

// Register as a merchant
router.post('/register', auth, async (req, res) => {
  try {
    const { business_name } = req.body;
    if (!business_name)
      return res.status(400).json({ message: 'Business name is required' });

    const existing = await db('merchants').where({ user_id: req.user.id }).first();
    if (existing)
      return res.status(409).json({ message: 'Merchant account already exists', merchant: existing });

    const slug = business_name.toLowerCase().replace(/\s+/g, '-') +
                 '-' + crypto.randomBytes(3).toString('hex');

    const [merchant] = await db('merchants')
      .insert({ user_id: req.user.id, business_name, payment_slug: slug, status: 'active' })
      .returning('*');

    res.status(201).json({
      merchant,
      payment_link: `${process.env.FRONTEND_URL || 'https://nanepay.app'}/pay/${slug}`,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get merchant dashboard
router.get('/dashboard', auth, async (req, res) => {
  try {
    const merchant = await db('merchants').where({ user_id: req.user.id }).first();
    if (!merchant)
      return res.status(404).json({ message: 'No merchant account found. Register first.' });

    // Today stats
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayTxs   = await db('transactions')
      .where({ user_id: req.user.id, type: 'merchant_payment', status: 'success' })
      .where('created_at', '>=', todayStart);

    const todaySales = todayTxs.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    const todayFees  = todayTxs.reduce((s, t) => s + Number(t.fee || 0), 0);

    // All-time stats
    const [allTime] = await db('transactions')
      .where({ user_id: req.user.id, type: 'merchant_payment', status: 'success' })
      .sum({ total_sales: db.raw('ABS(amount)'), total_fees: 'fee' });

    res.json({
      merchant,
      payment_link:       `${process.env.FRONTEND_URL || 'https://nanepay.app'}/pay/${merchant.payment_slug}`,
      today_sales:        todaySales,
      today_fees:         todayFees,
      today_net:          todaySales - todayFees,
      today_txn_count:    todayTxs.length,
      all_time_sales:     Number(allTime.total_sales || 0),
      all_time_fees:      Number(allTime.total_fees  || 0),
      all_time_net:       Number(allTime.total_sales || 0) - Number(allTime.total_fees || 0),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get merchant analytics (last 7 days by day)
router.get('/analytics', auth, async (req, res) => {
  try {
    const merchant = await db('merchants').where({ user_id: req.user.id }).first();
    if (!merchant) return res.status(404).json({ message: 'No merchant account found.' });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const txs = await db('transactions')
      .where({ user_id: req.user.id, type: 'merchant_payment', status: 'success' })
      .where('created_at', '>=', sevenDaysAgo)
      .select(db.raw('DATE(created_at) as day'), db.raw('SUM(ABS(amount)) as sales'), db.raw('COUNT(*) as txn_count'))
      .groupBy(db.raw('DATE(created_at)'))
      .orderBy('day', 'asc');

    res.json(txs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Customer pays a merchant via payment link
// 1% platform fee charged — merchant receives amount minus fee
router.post('/pay/:slug', auth, async (req, res) => {
  try {
    const { amount, pin, note } = req.body;
    if (!amount || Number(amount) < 1)
      return res.status(400).json({ message: 'Invalid payment amount' });

    const merchant = await db('merchants')
      .where({ payment_slug: req.params.slug, status: 'active' }).first();
    if (!merchant) return res.status(404).json({ message: 'Merchant not found' });

    const payer   = await db('users').where({ id: req.user.id }).first();
    const pinOk   = await bcrypt.compare(String(pin), payer.pin_hash || '');
    if (!pinOk) return res.status(401).json({ message: 'Incorrect PIN' });

    const fee         = calcFee(amount);
    const totalDeduct = totalWithFee(amount);
    const merchantEarns = Number(amount) - fee;

    if (Number(payer.balance) < totalDeduct)
      return res.status(400).json({ message: 'Insufficient balance (amount + 1% fee)' });

    const merchantOwner = await db('users').where({ id: merchant.user_id }).first();
    if (!merchantOwner) return res.status(404).json({ message: 'Merchant owner not found' });

    const ref = generateRef();

    await db.transaction(async (trx) => {
      // Deduct from payer (amount + fee)
      await trx('users').where({ id: payer.id }).decrement('balance', totalDeduct);

      // Credit merchant (amount minus platform fee)
      await trx('users').where({ id: merchantOwner.id }).increment('balance', merchantEarns);

      // Update merchant totals
      await trx('merchants').where({ id: merchant.id }).update({
        total_sales:  db.raw('total_sales + ?',  [Number(amount)]),
        total_fees:   db.raw('total_fees + ?',   [fee]),
        txn_count:    db.raw('txn_count + 1'),
      });

      // Record transaction for payer
      await trx('transactions').insert({
        user_id:     payer.id,
        type:        'merchant_payment',
        description: `Payment to ${merchant.business_name}`,
        amount:      -Number(amount),
        fee,
        status:      'success',
        reference:   ref,
        metadata:    JSON.stringify({ merchant_slug: req.params.slug, merchant_name: merchant.business_name, note }),
      });

      // Record income transaction for merchant
      await trx('transactions').insert({
        user_id:     merchantOwner.id,
        type:        'merchant_payment',
        description: `Payment from ${payer.name || payer.phone}`,
        amount:      merchantEarns,
        fee:         0,
        status:      'success',
        reference:   ref + '-M',
        metadata:    JSON.stringify({ payer_id: payer.id, note }),
      });
    });

    await sendSMS(payer.phone,
      `NanePay: KES ${amount} paid to ${merchant.business_name}. Fee: KES ${fee.toFixed(2)}. Ref: ${ref}`
    );
    await sendSMS(merchantOwner.phone,
      `NanePay: KES ${merchantEarns.toFixed(2)} received from ${payer.name || payer.phone}. Ref: ${ref}`
    );

    res.json({ reference: ref, fee, merchant_earns: merchantEarns, message: 'Payment successful' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get merchant's own payment link
router.get('/link', auth, async (req, res) => {
  try {
    const merchant = await db('merchants').where({ user_id: req.user.id }).first();
    if (!merchant) return res.status(404).json({ message: 'No merchant account found.' });
    res.json({
      payment_link: `${process.env.FRONTEND_URL || 'https://nanepay.app'}/pay/${merchant.payment_slug}`,
      slug:         merchant.payment_slug,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
