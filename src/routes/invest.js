const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { calcFee, totalWithFee, generateRef } = require('../utils/helpers');
const { sendSMS }          = require('../services/sms');
const { sendReceiptEmail } = require('../services/email');

const PLANS = [
  { name:'Starter',  min:500,    max:4999,   roi:8,  days:30  },
  { name:'Silver',   min:5000,   max:19999,  roi:12, days:60  },
  { name:'Gold',     min:20000,  max:99999,  roi:18, days:90  },
  { name:'Platinum', min:100000, max:999999, roi:24, days:180 },
];

// Get all plans
router.get('/plans', (req, res) => res.json(PLANS));

// Get user's investments
router.get('/', auth, async (req, res) => {
  try {
    const investments = await db('investments')
      .where({ user_id: req.user.id })
      .orderBy('created_at', 'desc');
    res.json(investments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create investment
router.post('/', auth, async (req, res) => {
  try {
    const { plan_name, amount, pin } = req.body;
    const plan = PLANS.find(p => p.name === plan_name);
    if (!plan) return res.status(400).json({ message: 'Invalid investment plan' });

    const amt = Number(amount);
    if (amt < plan.min || amt > plan.max)
      return res.status(400).json({ message: `Amount must be KES ${plan.min}–${plan.max}` });

    const user = await db('users').where({ id: req.user.id }).first();
    const pinOk = await bcrypt.compare(String(pin), user.pin_hash || '');
    if (!pinOk) return res.status(401).json({ message: 'Incorrect PIN' });

    const fee   = calcFee(amt);
    const total = totalWithFee(amt);
    if (Number(user.balance) < total)
      return res.status(400).json({ message: 'Insufficient balance (including 1% fee)' });

    const maturesAt = new Date();
    maturesAt.setDate(maturesAt.getDate() + plan.days);
    const expectedReturn = amt * (1 + plan.roi / 100);
    const ref = generateRef();

    let investment;
    await db.transaction(async (trx) => {
      await trx('users').where({ id: user.id }).decrement('balance', total);
      const [inv] = await trx('investments').insert({
        user_id:         user.id,
        plan_name,
        amount:          amt,
        fee,
        roi:             plan.roi,
        duration_days:   plan.days,
        expected_return: expectedReturn,
        status:          'active',
        matures_at:      maturesAt,
      }).returning('*');
      investment = inv;

      await trx('transactions').insert({
        user_id:     user.id,
        type:        'investment',
        description: `Invest — ${plan_name} Plan`,
        amount:      -amt,
        fee,
        status:      'success',
        reference:   ref,
        metadata:    JSON.stringify({ plan_name, roi: plan.roi, days: plan.days }),
      });
    });

    await sendSMS(user.phone,
      `NanePay: KES ${amt} invested in ${plan_name} (${plan.roi}% ROI, ${plan.days} days). ` +
      `Expected return: KES ${expectedReturn.toFixed(2)}. Fee: KES ${fee.toFixed(2)}. Ref: ${ref}`
    );

    res.status(201).json({ investment, reference: ref, fee, expected_return: expectedReturn });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Withdraw matured investment
router.post('/:id/withdraw', auth, async (req, res) => {
  try {
    const inv = await db('investments')
      .where({ id: req.params.id, user_id: req.user.id })
      .first();
    if (!inv)                      return res.status(404).json({ message: 'Investment not found' });
    if (inv.status !== 'active')   return res.status(400).json({ message: 'Investment already withdrawn' });
    if (new Date() < new Date(inv.matures_at))
      return res.status(400).json({ message: `Investment matures on ${new Date(inv.matures_at).toLocaleDateString('en-KE')}` });

    const payout = Number(inv.expected_return);
    const ref    = generateRef();

    await db.transaction(async (trx) => {
      await trx('users').where({ id: req.user.id }).increment('balance', payout);
      await trx('investments').where({ id: inv.id }).update({ status: 'withdrawn' });
      await trx('transactions').insert({
        user_id:     req.user.id,
        type:        'investment',
        description: `${inv.plan_name} Investment Payout`,
        amount:      payout,
        fee:         0,
        status:      'success',
        reference:   ref,
      });
    });

    const user = await db('users').where({ id: req.user.id }).first();
    await sendSMS(user.phone,
      `NanePay: Your ${inv.plan_name} investment matured! KES ${payout.toFixed(2)} credited to your wallet.`
    );

    res.json({ payout, reference: ref });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
