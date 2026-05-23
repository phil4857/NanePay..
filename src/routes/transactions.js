const router = require('express').Router();
const auth = require('../middleware/auth');
const Transaction = require('../models/Transaction');

// Get all transactions for logged-in user
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const filter = { user: req.user.id };
    if (type) filter.type = type;
    const txs = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Transaction.countDocuments(filter);
    res.json({ transactions: txs, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single transaction by ref
router.get('/:ref', auth, async (req, res) => {
  try {
    const tx = await Transaction.findOne({ ref: req.params.ref, user: req.user.id });
    if (!tx) return res.status(404).json({ message: 'Transaction not found' });
    res.json(tx);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
