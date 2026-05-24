const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const crypto = require('crypto');

// Safe fields returned to client — _internal_points is NEVER included
const SAFE_FIELDS = ['id','code','source','used','used_at','created_at'];

router.get('/', auth, async (req, res) => {
  try {
    const coupons = await db('coupons')
      .where({ user_id: req.user.id })
      .select(SAFE_FIELDS)
      .orderBy('created_at', 'desc');
    res.json(coupons);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/:id/redeem', auth, async (req, res) => {
  try {
    const coupon = await db('coupons')
      .where({ id: req.params.id, user_id: req.user.id })
      .first();
    if (!coupon)      return res.status(404).json({ message: 'Coupon not found' });
    if (coupon.used)  return res.status(400).json({ message: 'Coupon already redeemed' });

    const [updated] = await db('coupons')
      .where({ id: coupon.id })
      .update({ used: true, used_at: new Date() })
      .returning(SAFE_FIELDS);

    // _internal_points used internally for analytics — never returned
    res.json({ message: 'Coupon redeemed! Your exclusive reward has been applied.', coupon: updated });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Internal: issue a coupon to a user (called by referral/birthday jobs)
router.post('/issue', auth, async (req, res) => {
  try {
    const { user_id, source, internal_points } = req.body;
    const code = 'NANE-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const [coupon] = await db('coupons')
      .insert({
        user_id:          user_id || req.user.id,
        code,
        source:           source || 'Promotion',
        used:             false,
        _internal_points: internal_points || 0, // stored but never returned to client
      })
      .returning(SAFE_FIELDS);
    res.status(201).json(coupon);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
