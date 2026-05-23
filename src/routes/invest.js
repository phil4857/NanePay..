const router = require('express').Router();
const auth = require('../middleware/auth');
const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { sendSMS } = require('../services/sms');
const { sendReceiptEmail } = require('../services/email');

const FEE_RATE = parseFloat(process.env.PLATFORM_FEE_RATE || '0.01');
const calcFee = (a) => Math.ceil(Number(a) * FEE_RATE * 100) / 100;

// Investment schema inline (or move to models/Investment.js)
const investmentSchema = new mongoose.Schema({
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  planName:   { type: String, required: true },
  amount:     { type: Number, required: true },
  fee:        { type: Number, default: 0 },
  roi:        { type: Number, required: true },   // percentage e.g. 18
  durationDays: { type: Number, required: true },
  expectedReturn: { type: Number },
  status:     { type: String, enum: ['active','matured','withdrawn'], default: 'active' },
  startedAt:  { type: Date, default: Date.now },
  maturesAt:  { type: Date },
}, { timestamps: true });

investmentSchema.pre('save', function (next) {
  if (!this.maturesAt) {
    const d = new Date(this.startedAt);
    d.setDate(d.getDate() + this.durationDays);
    this.maturesAt = d;
  }
  if (!this.expectedReturn) {
    this.expectedReturn = this.amount * (1 + this.roi / 100);
  }
  next();
});

const Investment = mongoose.models.Investment || mongoose.model('Investment', investmentSchema);

const PLANS = [
  { name: 'Starter',  min: 500,    max: 4999,   roi: 8,  days: 30  },
  { name: 'Silver',   min: 5000,   max: 19999,  roi: 12, days: 60  },
  { name: 'Gold',     min: 20000,  max: 99999,  roi: 18, days: 90  },
  { name: 'Platinum', min: 100000, max: 999999, roi: 24, days: 180 },
];

// Get all plans
router.get('/plans', (req, res) => res.json(PLANS));

// Get user's investments
router.get('/', auth, async (req, res) => {
  try {
    const investments = await Investment.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(investments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create investment
router.post('/', auth, async (req, res) => {
  try {
    const { planName, amount, pin } = req.body;
    const plan = PLANS.find(p => p.name === planName);
    if (!plan) return res.status(400).json({ message: 'Invalid plan' });
    if (amount < plan.min || amount > plan.max)
      return res.status(400).json({ message: `Amount must be KES ${plan.min} – ${plan.max}` });

    const user = await User.findById(req.user.id);
    const pinOk = await user.comparePIN(pin);
    if (!pinOk) return res.status(401).json({ message: 'Incorrect PIN' });

    const f = calcFee(amount);
    const totalDeduct = amount + f;
    if (user.balance < totalDeduct) return res.status(400).json({ message: 'Insufficient balance' });

    await User.findByIdAndUpdate(user._id, { $inc: { balance: -totalDeduct } });

    const inv = await Investment.create({
      user: user._id, planName, amount, fee: f, roi: plan.roi, durationDays: plan.days,
    });

    const tx = await Transaction.create({
      user: user._id, type: 'investment', label: `Invest — ${planName} Plan`,
      amount: -amount, fee: f, status: 'success',
      metadata: { planName, roi: plan.roi, days: plan.days, investmentId: inv._id },
    });

    await sendSMS(user.phone, `NanePay: KES ${amount} invested in ${planName} plan (${plan.roi}% ROI). Matures in ${plan.days} days. Fee: KES ${f.toFixed(2)}. Ref: ${tx.ref}`);
    await sendReceiptEmail(user, tx);

    res.status(201).json({ investment: inv, transaction: tx });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Withdraw matured investment
router.post('/:id/withdraw', auth, async (req, res) => {
  try {
    const inv = await Investment.findOne({ _id: req.params.id, user: req.user.id });
    if (!inv) return res.status(404).json({ message: 'Investment not found' });
    if (inv.status !== 'active') return res.status(400).json({ message: 'Investment already withdrawn' });
    if (new Date() < inv.maturesAt) return res.status(400).json({ message: 'Investment has not matured yet' });

    const payout = inv.expectedReturn;
    await User.findByIdAndUpdate(req.user.id, { $inc: { balance: payout } });
    inv.status = 'withdrawn';
    await inv.save();

    const user = await User.findById(req.user.id);
    await sendSMS(user.phone, `NanePay: Your ${inv.planName} investment matured! KES ${payout.toFixed(2)} credited to your wallet.`);

    res.json({ payout, investment: inv });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
