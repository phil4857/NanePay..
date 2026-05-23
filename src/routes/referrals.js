const router = require('express').Router();
const auth = require('../middleware/auth');
const crypto = require('crypto');
const User = require('../models/User');
const Coupon = require('../models/Coupon');
const { sendSMS } = require('../services/sms');

// Get referral stats for logged-in user
router.get('/stats', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('referralCode');
    const invited = await User.countDocuments({ referredBy: req.user.id });
    const couponsEarned = await Coupon.countDocuments({ user: req.user.id, source: /referral/i });

    res.json({
      referralCode: user.referralCode,
      referralLink: `${process.env.FRONTEND_URL}/ref/${user.referralCode}`,
      invited,
      couponsEarned,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Claim a referral code (called when new user enters a friend's code)
router.post('/claim', auth, async (req, res) => {
  try {
    const { referralCode } = req.body;
    if (!referralCode) return res.status(400).json({ message: 'Referral code required' });

    const referrer = await User.findOne({ referralCode: referralCode.toUpperCase() });
    if (!referrer) return res.status(404).json({ message: 'Invalid referral code' });
    if (referrer._id.toString() === req.user.id) return res.status(400).json({ message: 'Cannot use your own referral code' });

    const claimingUser = await User.findById(req.user.id);
    if (claimingUser.referredBy) return res.status(400).json({ message: 'You have already used a referral code' });

    // Link the referral
    await User.findByIdAndUpdate(req.user.id, { referredBy: referrer._id });

    // Award coupon to referrer
    const refCode = 'REF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const referrerCoupon = await Coupon.create({
      user: referrer._id,
      code: refCode,
      source: 'Referral Reward',
      _internalPoints: 500,
    });

    // Award coupon to new user
    const newCode = 'WELCOME-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const newUserCoupon = await Coupon.create({
      user: req.user.id,
      code: newCode,
      source: 'Referral Signup Bonus',
      _internalPoints: 200,
    });

    await sendSMS(referrer.phone, `NanePay: ${claimingUser.name} joined using your referral code! A reward coupon has been added to your wallet.`);
    await sendSMS(claimingUser.phone, `NanePay: Referral bonus! A welcome reward coupon has been added to your wallet.`);

    res.json({
      message: 'Referral applied! A reward coupon has been added to your wallet.',
      coupon: newUserCoupon.toClientJSON(),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
