const router = require('express').Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { sendSMS } = require('../services/sms');
const { sendReceiptEmail } = require('../services/email');

const FEE_RATE = parseFloat(process.env.PLATFORM_FEE_RATE || '0.01');
const calcFee = (a) => Math.ceil(Number(a) * FEE_RATE * 100) / 100;

// Static rates (replace with a live forex API like exchangerate-api.com in production)
const RATES = [
  { from: 'USD', to: 'KES', rate: 129.45, change: +0.23 },
  { from: 'EUR', to: 'KES', rate: 141.10, change: -0.15 },
  { from: 'GBP', to: 'KES', rate: 164.75, change: +0.45 },
  { from: 'KES', to: 'USD', rate: 0.00773, change: -0.001 },
];

// Get current rates
router.get('/rates', (req, res) => res.json(RATES));

// Perform exchange
router.post('/exchange', auth, async (req, res) => {
  try {
    const { fromCurrency, toCurrency, amount, pin } = req.body;
    if (!amount || amount < 1) return res.status(400).json({ message: 'Enter a valid amount' });

    const user = await User.findById(req.user.id);
    const pinOk = await user.comparePIN(pin);
    if (!pinOk) return res.status(401).json({ message: 'Incorrect PIN' });

    const rateObj = RATES.find(r => r.from === fromCurrency && r.to === toCurrency);
    if (!rateObj) return res.status(400).json({ message: 'Exchange pair not supported' });

    const f = calcFee(amount);
    const totalDeduct = fromCurrency === 'KES' ? amount + f : amount;
    if (user.balance < totalDeduct) return res.status(400).json({ message: 'Insufficient balance' });

    const converted = (amount * rateObj.rate).toFixed(4);

    // Deduct source, credit if KES received
    if (fromCurrency === 'KES') {
      await User.findByIdAndUpdate(user._id, { $inc: { balance: -(amount + f) } });
    } else {
      await User.findByIdAndUpdate(user._id, { $inc: { balance: Number(converted) - f } });
    }

    const tx = await Transaction.create({
      user: user._id, type: 'forex',
      label: `${fromCurrency} → ${toCurrency}`,
      amount: fromCurrency === 'KES' ? -amount : Number(converted),
      fee: f, status: 'success',
      metadata: { fromCurrency, toCurrency, rate: rateObj.rate, converted },
    });

    await sendSMS(user.phone, `NanePay Forex: Exchanged ${fromCurrency} ${amount} → ${toCurrency} ${Number(converted).toFixed(2)}. Fee: KES ${f.toFixed(2)}. Ref: ${tx.ref}`);
    await sendReceiptEmail(user, tx);

    res.json({ transaction: tx, converted: Number(converted), fee: f });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
