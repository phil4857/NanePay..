const router = require('express').Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { generateRef, calcFee, totalWithFee } = require('../utils/helpers');
const { sendSMS } = require('../services/sms');

const auth = (req, res, next) => {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer '))
    return res.status(401).json({ message: 'No token' });
  try { req.user = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ message: 'Invalid token' }); }
};

router.get('/balance', auth, async (req, res) => {
  try {
    const user = await db('users').where({ id: req.user.id }).select('balance').first();
    res.json({ balance: Number(user.balance) });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/deposit', auth, async (req, res) => {
  try {
    const { amount, phone } = req.body;
    if (!amount || Number(amount) < 10) return res.status(400).json({ message: 'Min KES 10' });
    const fee = calcFee(amount);
    const net = Number(amount) - fee;
    const ref = generateRef();
    await db.transaction(async (trx) => {
      await trx('users').where({ id: req.user.id }).increment('balance', net);
      await trx('transactions').insert({ user_id: req.user.id, type: 'deposit', description: 'M-Pesa Deposit', amount: Number(amount), fee, status: 'success', reference: ref, metadata: JSON.stringify({ phone }) });
    });
    const user = await db('users').where({ id: req.user.id }).first();
    await sendSMS(user.phone, `NanePay: KES ${net.toFixed(2)} deposited. Fee: KES ${fee.toFixed(2)}. Ref: ${ref}`);
    res.json({ balance: Number(user.balance), fee, net, reference: ref });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/transfer', auth, async (req, res) => {
  try {
    const { recipient_phone, amount, note, pin } = req.body;
    if (!recipient_phone || !amount || !pin) return res.status(400).json({ message: 'recipient_phone, amount and pin required' });
    if (Number(amount) < 10) return res.status(400).json({ message: 'Min KES 10' });
    const sender = await db('users').where({ id: req.user.id }).first();
    const pinOk = await bcrypt.compare(String(pin), sender.pin_hash || '');
    if (!pinOk) return res.status(401).json({ message: 'Incorrect PIN' });
    const fee = calcFee(amount);
    const total = totalWithFee(amount);
    if (Number(sender.balance) < total) return res.status(400).json({ message: 'Insufficient balance' });
    const norm = String(recipient_phone).replace(/^0/, '+254');
    const recipient = await db('users').where({ phone: norm }).orWhere({ phone: recipient_phone }).first();
    if (!recipient) return res.status(404).json({ message: 'Recipient not found' });
    const ref = generateRef();
    await db.transaction(async (trx) => {
      await trx('users').where({ id: sender.id }).decrement('balance', total);
      await trx('users').where({ id: recipient.id }).increment('balance', Number(amount));
      await trx('transactions').insert({ user_id: sender.id, type: 'transfer', description: `Transfer to ${recipient_phone}`, amount: -Number(amount), fee, status: 'success', reference: ref, metadata: JSON.stringify({ recipient_phone, note }) });
    });
    await sendSMS(sender.phone, `NanePay: KES ${amount} sent to ${recipient_phone}. Fee: KES ${fee.toFixed(2)}. Ref: ${ref}`);
    await sendSMS(recipient.phone, `NanePay: You received KES ${amount} from ${sender.phone}. Ref: ${ref}`);
    const updated = await db('users').where({ id: sender.id }).select('balance').first();
    res.json({ balance: Number(updated.balance), fee, reference: ref });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/withdraw', auth, async (req, res) => {
  try {
    const { amount, phone, pin } = req.body;
    if (!amount || !phone || !pin) return res.status(400).json({ message: 'amount, phone and pin required' });
    if (Number(amount) < 100) return res.status(400).json({ message: 'Min KES 100' });
    const user = await db('users').where({ id: req.user.id }).first();
    const pinOk = await bcrypt.compare(String(pin), user.pin_hash || '');
    if (!pinOk) return res.status(401).json({ message: 'Incorrect PIN' });
    const fee = calcFee(amount);
    const total = totalWithFee(amount);
    if (Number(user.balance) < total) return res.status(400).json({ message: 'Insufficient balance' });
    const ref = generateRef();
    await db.transaction(async (trx) => {
      await trx('users').where({ id: user.id }).decrement('balance', total);
      await trx('transactions').insert({ user_id: user.id, type: 'withdrawal', description: 'M-Pesa Withdrawal', amount: -Number(amount), fee, status: 'pending', reference: ref, metadata: JSON.stringify({ phone }) });
    });
    await sendSMS(user.phone, `NanePay: Withdrawal KES ${amount} to ${phone} initiated. Fee: KES ${fee.toFixed(2)}. Ref: ${ref}`);
    res.json({ reference: ref, fee, message: 'Withdrawal initiated' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
