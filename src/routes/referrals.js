const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const crypto = require('crypto');
const { sendSMS } = require('../services/sms');

router.get('/stats', auth, async (req, res) => {
  try {
    const user    = await db('users').where({ id: req.user.id }).select('referral_code').first();
    const invited = await db('users').where({ referred_by: req.user.id }).count('id as count').first();
    const coupons = await db('coupons').where({ user_id: req.user.id, used: false }).count('id as count').first();
    res.json({
      referral_code:  user.referral_code,
      referral_link:  `${process.env.FRONTEND_URL || ''}/ref/${user.referral_code}`,
      invited_count:  Number(invited.count),
      available_coupons: Number(coupons.count),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/claim', auth, async (req, res) => {
  try {
    const { referral_code } = req.body;
    if (!referral_code) return res.status(400).json({ message: 'Referral code required' });

    const referrer = await db('users').where({ referral_code: referral_code.toUpperCase() }).first();
    if (!referrer) return res.status(404).json({ message: 'Invalid referral code' });
    if (String(referrer.id) === String(req.user.id))
      return res.status(400).json({ message: 'You cannot use your own referral code' });

    const me = await db('users').where({ id: req.user.id }).first();
    if (me.referred_by) return res.status(400).json({ message: 'You have already used a referral code' });

    await db('users').where({ id: req.user.id }).update({ referred_by: referrer.id });

    // Award coupon to referrer — _internal_points never shown to user
    const refCode = 'REF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    await db('coupons').insert({
      user_id:          referrer.id,
      code:             refCode,
      source:           'Referral Reward',
      used:             false,
      _internal_points: 500,
    });

    // Award coupon to new user
    const newCode = 'WELCOME-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const [newCoupon] = await db('coupons').insert({
      user_id:          req.user.id,
      code:             newCode,
      source:           'Referral Signup Bonus',
      used:             false,
      _internal_points: 200,
    }).returning(['id','code','source','used','created_at']);

    await sendSMS(referrer.phone,
      `NanePay: ${me.name} joined using your referral! A reward coupon has been added to your wallet.`
    );
    await sendSMS(me.phone,
      `NanePay: Referral bonus! A welcome reward coupon has been added to your wallet.`
    );

    res.json({ message: 'Referral applied! A reward coupon is now in your wallet.', coupon: newCoupon });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
