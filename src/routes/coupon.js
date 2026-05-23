const router = require('express').Router();
const auth = require('../middleware/auth');
const Coupon = require('../models/Coupon');

// Get all coupons for logged-in user
// NOTE: _internalPoints is excluded via { select: false } on the schema
// It will NEVER appear in any response sent to the client
router.get('/', auth, async (req, res) => {
  try {
    const coupons = await Coupon.find({ user: req.user.id }).sort({ createdAt: -1 });
    // Map to safe client format — no internal fields exposed
    res.json(coupons.map(c => c.toClientJSON()));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Redeem a coupon
router.post('/:id/redeem', auth, async (req, res) => {
  try {
    const coupon = await Coupon.findOne({ _id: req.params.id, user: req.user.id });
    if (!coupon) return res.status(404).json({ message: 'Coupon not found' });
    if (coupon.used) return res.status(400).json({ message: 'Coupon already redeemed' });

    coupon.used = true;
    coupon.usedAt = new Date();
    await coupon.save();

    // Internal: _internalPoints recorded for accounting but never returned to client
    // You can use coupon._internalPoints here for your own revenue/analytics logic

    res.json({ message: 'Coupon redeemed successfully', coupon: coupon.toClientJSON() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin: create a coupon for a user (internal use)
router.post('/issue', auth, async (req, res) => {
  try {
    const { userId, code, source, internalPoints } = req.body;
    const crypto = require('crypto');
    const coupon = await Coupon.create({
      user: userId || req.user.id,
      code: code || 'NANE-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
      source: source || 'Manual Issue',
      _internalPoints: internalPoints || 0,
    });
    res.status(201).json(coupon.toClientJSON());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
