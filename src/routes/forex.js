const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { calcFee, totalWithFee, generateRef } = require('../utils/helpers');
const { sendSMS } = require('../services/sms');

const RATES = [
  { from:'USD', to:'KES', rate:129.45, change:+0.23 },
  { from:'EUR', to:'KES', rate:141.10, change:-0.15 },
  { from:'GBP', to:'KES', rate:164.75, change:+0.45 },
  { from:'KES', to:'USD', rate:0.00773,change:-0.001 },
];

router.get('/rates', (req, res) => res.json(RATES));

router.post('/exchange', auth, async (req, res) => {
  try {
    const { from_currency, to_currency, amount, pin } = req.body;
    if (!amount || Number(amount) < 1)
      return res.status(400).json({ message: 'Enter a valid amount' });

    const rateObj = RATES.find(r => r.from === from_currency && r.to === to_currency);
    if (!rateObj) return res.status(400).json({ message: 'Unsupported currency pair' });

    const user  = await db('users').where({ id: req.user.id }).first();
    const pinOk = await bcrypt.compare(String(pin), user.pin_hash || '');
    if (!pinOk) return res.status(401).json({ message: 'Incorrect PIN' });

    const amt       = Number(amount);
    const fee       = calcFee(amt);
    const converted = (amt * rateObj.rate).toFixed(4);

    if (from_currency === 'KES' && Number(user.balance) < totalWithFee(amt))
      return res.status(400).json({ message: 'Insufficient balance (including 1% fee)' });

    const ref = generateRef();
    await db.transaction(async (trx) => {
      if (from_currency === 'KES') {
        await trx('users').where({ id: user.id }).decrement('balance', totalWithFee(amt));
      } else {
        await trx('users').where({ id: user.id }).increment('balance', Number(converted) - fee);
      }
      await trx('transactions').insert({
        user_id:     user.id,
        type:        'forex',
        description: `${from_currency} → ${to_currency}`,
        amount:      from_currency === 'KES' ? -amt : Number(converted),
        fee,
        status:      'success',
        reference:   ref,
        metadata:    JSON.stringify({ from_currency, to_currency, rate: rateObj.rate, converted }),
      });
    });

    await sendSMS(user.phone,
      `NanePay Forex: ${from_currency} ${amt} → ${to_currency} ${Number(converted).toFixed(2)}. Fee: KES ${fee.toFixed(2)}. Ref: ${ref}`
    );

    res.json({ converted: Number(converted), fee, reference: ref });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
