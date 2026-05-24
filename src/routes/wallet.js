const router  = require('express').Router();
const db      = require('../db');
const bcrypt  = require('bcryptjs');
const { generateRef, calcFee, totalWithFee } = require('../utils/helpers');
const { sendSMS }          = require('../services/sms');
const { sendReceiptEmail } = require('../services/email');

// Defensive import — handles both `module.exports = fn` and `module.exports = { auth: fn }`
const authMiddleware = require('../middleware/auth');
const auth = typeof authMiddleware === 'function' ? authMiddleware : authMiddleware.auth || authMiddleware.default;

// Get balance
router.get('/balance', auth, async (req, res) => {
  try {
    const user = await db('users').where({ id: req.user.id }).select('balance').first();
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ balance: Number(user.balance) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Deposit — called after M-Pesa STK push confirms payment
router.post('/deposit', auth, async (req, res) => {
  try {
    const { amount, phone } = req.body;
    if (!amount || Number(amount) < 10)
      return res.status(400).json({ message: 'Minimum deposit is KES 10' });

    const fee = calcFee(amount);
    const net = Number(amount) - fee;
    const ref = generateRef();

    await db.transaction(async (trx) => {
      await trx('users').where({ id: req.user.id }).increment('balance', net);
      await trx('transactions').insert({
        user_id:     req.user.id,
        type:        'deposit',
        description: 'M-Pesa Deposit',
        amount:      Number(amount),
        fee,
        status:      'success',
        reference:   ref,
        metadata:    JSON.stringify({ phone }),
      });
    });

    const user = await db('users').where({ id: req.user.id }).first();
    await sendSMS(user.phone,
      `NanePay: KES ${net.toFixed(2)} deposited. Fee: KES ${fee.toFixed(2)}. Balance: KES ${Number(user.balance).toFixed(2)}. Ref: ${ref}`
    );

    res.json({ balance: Number(user.balance), fee, net, reference: ref });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Transfer to another user by phone
router.post('/transfer', auth, async (req, res) => {
  try {
    const { recipient_phone, amount, note, pin } = req.body;
    if (!recipient_phone || !amount || !pin)
      return res.status(400).json({ message: 'recipient_phone, amount and pin are required' });
    if (Number(amount) < 10)
      return res.status(400).json({ message: 'Minimum transfer is KES 10' });

    const sender = await db('users').where({ id: req.user.id }).first();
    const pinOk  = await bcrypt.compare(String(pin), sender.pin_hash || '');
    if (!pinOk) return res.status(401).json({ message: 'Incorrect PIN' });

    const fee          = calcFee(amount);
    const totalDeduct  = totalWithFee(amount);

    if (Number(sender.balance) < totalDeduct)
      return res.status(400).json({ message: 'Insufficient balance (amount + 1% fee)' });

    // Normalise phone for lookup
    const normPhone = String(recipient_phone).replace(/^0/, '+254');
    const recipient = await db('users')
      .where({ phone: normPhone })
      .orWhere({ phone: recipient_phone })
      .first();
    if (!recipient) return res.status(404).json({ message: 'Recipient not found' });
    if (recipient.id === sender.id)
      return res.status(400).json({ message: 'Cannot transfer to yourself' });

    const ref = generateRef();

    await db.transaction(async (trx) => {
      await trx('users').where({ id: sender.id }).decrement('balance', totalDeduct);
      await trx('users').where({ id: recipient.id }).increment('balance', Number(amount));
      await trx('transactions').insert({
        user_id:     sender.id,
        type:        'transfer',
        description: `Transfer to ${recipient_phone}`,
        amount:      -Number(amount),
        fee,
        status:      'success',
        reference:   ref,
        metadata:    JSON.stringify({ recipient_phone, recipient_id: recipient.id, note }),
      });
    });

    await sendSMS(sender.phone,
      `NanePay: KES ${amount} sent to ${recipient_phone}. Fee: KES ${fee.toFixed(2)}. Ref: ${ref}`
    );
    await sendSMS(recipient.phone,
      `NanePay: You received KES ${amount} from ${sender.phone}. Ref: ${ref}`
    );

    const updated = await db('users').where({ id: sender.id }).select('balance').first();
    res.json({ balance: Number(updated.balance), fee, reference: ref });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Withdraw to M-Pesa
router.post('/withdraw', auth, async (req, res) => {
  try {
    const { amount, phone, pin } = req.body;
    if (!amount || !phone || !pin)
      return res.status(400).json({ message: 'amount, phone and pin are required' });
    if (Number(amount) < 100)
      return res.status(400).json({ message: 'Minimum withdrawal is KES 100' });

    const user   = await db('users').where({ id: req.user.id }).first();
    const pinOk  = await bcrypt.compare(String(pin), user.pin_hash || '');
    if (!pinOk) return res.status(401).json({ message: 'Incorrect PIN' });

    const fee         = calcFee(amount);
    const totalDeduct = totalWithFee(amount);

    if (Number(user.balance) < totalDeduct)
      return res.status(400).json({ message: 'Insufficient balance (amount + 1% fee)' });

    const ref = generateRef();

    await db.transaction(async (trx) => {
      await trx('users').where({ id: user.id }).decrement('balance', totalDeduct);
      await trx('transactions').insert({
        user_id:     user.id,
        type:        'withdrawal',
        description: 'M-Pesa Withdrawal',
        amount:      -Number(amount),
        fee,
        status:      'pending',
        reference:   ref,
        metadata:    JSON.stringify({ phone }),
      });
    });

    await sendSMS(user.phone,
      `NanePay: Withdrawal of KES ${amount} to ${phone} initiated. Fee: KES ${fee.toFixed(2)}. Ref: ${ref}`
    );

    res.json({ reference: ref, fee, message: 'Withdrawal initiated. Funds arriving shortly.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
