const router = require('express').Router();
const auth = require('../middleware/auth');
const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { sendSMS } = require('../services/sms');
const { sendReceiptEmail } = require('../services/email');
const crypto = require('crypto');

const FEE_RATE = parseFloat(process.env.PLATFORM_FEE_RATE || '0.01');
const calcFee = (a) => Math.ceil(Number(a) * FEE_RATE * 100) / 100;

// Merchant profile schema
const merchantSchema = new mongoose.Schema({
  owner:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  businessName:{ type: String, required: true },
  paymentSlug: { type: String, unique: true },
  totalSales:  { type: Number, default: 0 },
  txnCount:    { type: Number, default: 0 },
  platformCut: { type: Number, default: 0 },
  status:      { type: String, enum: ['active','suspended'], default: 'active' },
}, { timestamps: true });

const Merchant = mongoose.models.Merchant || mongoose.model('Merchant', merchantSchema);

// Register as merchant
router.post('/register', auth, async (req, res) => {
  try {
    const { businessName } = req.body;
    if (!businessName) return res.status(400).json({ message: 'Business name required' });
    const existing = await Merchant.findOne({ owner: req.user.id });
    if (existing) return res.status(409).json({ message: 'Merchant account already exists', merchant: existing });
    const slug = businessName.toLowerCase().replace(/\s+/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
    const merchant = await Merchant.create({ owner: req.user.id, businessName, paymentSlug: slug });
    res.status(201).json(merchant);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get merchant dashboard
router.get('/dashboard', auth, async (req, res) => {
  try {
    const merchant = await Merchant.findOne({ owner: req.user.id });
    if (!merchant) return res.status(404).json({ message: 'No merchant account. Register first.' });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayTxs = await Transaction.find({
      user: req.user.id, type: { $in: ['transfer', 'deposit'] },
      createdAt: { $gte: today }, status: 'success',
    });

    const todaySales  = todayTxs.reduce((s, t) => s + Math.abs(t.amount), 0);
    const todayFees   = todayTxs.reduce((s, t) => s + (t.fee || 0), 0);

    res.json({
      merchant,
      paymentLink: `${process.env.FRONTEND_URL}/pay/${merchant.paymentSlug}`,
      todaySales,
      todayFees,
      todayNet:   todaySales - todayFees,
      todayTxns:  todayTxs.length,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Public payment endpoint — customer pays merchant via link
router.post('/pay/:slug', auth, async (req, res) => {
  try {
    const { amount, pin } = req.body;
    if (!amount || amount < 1) return res.status(400).json({ message: 'Invalid amount' });

    const merchant = await Merchant.findOne({ paymentSlug: req.params.slug, status: 'active' });
    if (!merchant) return res.status(404).json({ message: 'Merchant not found' });

    const payer = await User.findById(req.user.id);
    const pinOk = await payer.comparePIN(pin);
    if (!pinOk) return res.status(401).json({ message: 'Incorrect PIN' });

    const f = calcFee(amount);
    const totalDeduct = amount + f;
    if (payer.balance < totalDeduct) return res.status(400).json({ message: 'Insufficient balance' });

    await User.findByIdAndUpdate(payer._id, { $inc: { balance: -totalDeduct } });

    const merchantOwner = await User.findById(merchant.owner);
    const merchantEarns = amount - f;
    await User.findByIdAndUpdate(merchant.owner, { $inc: { balance: merchantEarns } });

    await Merchant.findByIdAndUpdate(merchant._id, {
      $inc: { totalSales: amount, txnCount: 1, platformCut: f },
    });

    const tx = await Transaction.create({
      user: payer._id, type: 'transfer',
      label: `Payment to ${merchant.businessName}`,
      amount: -amount, fee: f, status: 'success',
      recipient: merchant.owner,
      metadata: { merchantSlug: req.params.slug, merchantName: merchant.businessName },
    });

    await sendSMS(payer.phone, `NanePay: KES ${amount} paid to ${merchant.businessName}. Fee: KES ${f.toFixed(2)}. Ref: ${tx.ref}`);
    await sendSMS(merchantOwner.phone, `NanePay: KES ${merchantEarns.toFixed(2)} received from ${payer.name}. Ref: ${tx.ref}`);
    await sendReceiptEmail(payer, tx);

    res.json({ transaction: tx, fee: f });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
