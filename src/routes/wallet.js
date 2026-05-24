const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { sendSMS } = require('../services/sms');
const { sendReceiptEmail } = require('../services/email');
const { generateRef } = require('../utils/helpers');

const FEE_RATE = parseFloat(process.env.PLATFORM_FEE_RATE || '0.01');
const calcFee = (a) => Math.ceil(Number(a) * FEE_RATE * 100) / 100;

// Get balance
router.get('/balance', auth, async (req, res) => {
  try {
    const user = await db('users').where({ id: req.user.id }).select('balance').first();
    res.json({ balance: Number(user.balance) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Deposit (called after M-Pesa STK push confirms)
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
      `NanePay: KES ${net.toFixed(2)} deposited to your wallet. Fee: KES ${fee.toFixed(2)}. Balance: KES ${Number(user.balance).toFixed(2)}. Ref: ${ref}`
    );

    res.json({ balance: Number(user.balance), fee, net, reference: ref });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Transfer to another user
router.post('/transfer', auth, async (req, res) => {
  try {
    const { recipient_phone, amount, note, pin } = req.body;
    if (!amount || Number(amount) < 10)
      return res.status(400).json({ message: 'Minimum transfer is KES 10' });

    const sender = await db('users').where({ id: req.user.id }).first();
    const pinOk = await bcrypt.compare(String(pin), sender.pin_hash || sender.pin || '');
    if (!pinOk) return res.status(401).json({ message: 'Incorrect PIN' });

    const fee = calcFee(amount);
    const totalDeduct = Number(amount) + fee;

    if (Number(sender.balance) < totalDeduct)
      return res.status(400).json({ message: 'Insufficient balance (including 1% fee)' });

    const recipient = await db('users').where({ phone: recipient_phone }).first();
    if (!recipient) return res.status(404).json({ message: 'Recipient not found' });

    const ref = generateRef();

    await db.transaction(async (trx) => {
      await trx('users').where({ id: sender.id }).decrement('balance', totalDeduct);
      await trx('users').where({ id: recipient.id }).increment('balance', Number(amount));
      await trx('transactions').insert({
        user_id:      sender.id,
        type:         'transfer',
        description:  `Transfer to ${recipient_phone}`,
        amount:       -Number(amount),
        fee,
        status:       'success',
        reference:    ref,
        metadata:     JSON.stringify({ recipient_phone, recipient_id: recipient.id, note }),
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
    if (!amount || Number(amount) < 100)
      return res.status(400).json({ message: 'Minimum withdrawal is KES 100' });

    const user = await db('users').where({ id: req.user.id }).first();
    const pinOk = await bcrypt.compare(String(pin), user.pin_hash || user.pin || '');
    if (!pinOk) return res.status(401).json({ message: 'Incorrect PIN' });

    const fee = calcFee(amount);
    const totalDeduct = Number(amount) + fee;

    if (Number(user.balance) < totalDeduct)
      return res.status(400).json({ message: 'Insufficient balance (including 1% fee)' });

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
      `NanePay: Withdrawal of KES ${amount} initiated to ${phone}. Fee: KES ${fee.toFixed(2)}. Ref: ${ref}. Funds arrive shortly.`
    );

    res.json({ reference: ref, fee, message: 'Withdrawal initiated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
