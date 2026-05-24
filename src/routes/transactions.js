const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// Get paginated transactions for logged-in user
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = db('transactions').where({ user_id: req.user.id });
    if (type) query = query.andWhere({ type });

    const [{ count }] = await query.clone().count('id as count');
    const txs = await query
      .orderBy('created_at', 'desc')
      .limit(Number(limit))
      .offset(offset);

    res.json({
      transactions: txs,
      total:  Number(count),
      page:   Number(page),
      pages:  Math.ceil(Number(count) / Number(limit)),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single transaction by reference
router.get('/:ref', auth, async (req, res) => {
  try {
    const tx = await db('transactions')
      .where({ reference: req.params.ref, user_id: req.user.id })
      .first();
    if (!tx) return res.status(404).json({ message: 'Transaction not found' });
    res.json(tx);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
