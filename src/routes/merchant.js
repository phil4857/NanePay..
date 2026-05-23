const router = require('express').Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

// Simple admin check middleware
const adminOnly = async (req, res, next) => {
  const user = await User.findById(req.user.id).select('role');
  if (user?.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
  next();
};

// Platform overview stats
router.get('/stats', auth, adminOnly, async (req, res) => {
  try {
    const totalUsers       = await User.countDocuments();
    const activeUsers      = await User.countDocuments({ isActive: true });
    const totalTxs         = await Transaction.countDocuments();
    const feeAggregate     = await Transaction.aggregate([
      { $group: { _id: null, totalFees: { $sum: '$fee' }, totalVolume: { $sum: { $abs: '$amount' } } } }
    ]);
    const fees   = feeAggregate[0]?.totalFees  || 0;
    const volume = feeAggregate[0]?.totalVolume || 0;

    res.json({ totalUsers, activeUsers, totalTxs, platformFees: fees, transactionVolume: volume });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// List all users
router.get('/users', auth, adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const filter = search
      ? { $or: [{ name: new RegExp(search, 'i') }, { email: new RegExp(search, 'i') }, { phone: new RegExp(search, 'i') }] }
      : {};
    const users = await User.find(filter)
      .select('-passwordHash -pin')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });
    const total = await User.countDocuments(filter);
    res.json({ users, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// List all transactions with fee breakdown
router.get('/transactions', auth, adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 30, type } = req.query;
    const filter = type ? { type } : {};
    const txs = await Transaction.find(filter)
      .populate('user', 'name email phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Transaction.countDocuments(filter);
    res.json({ transactions: txs, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Suspend / activate a user
router.patch('/users/:id/status', auth, adminOnly, async (req, res) => {
  try {
    const { isActive } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { isActive }, { new: true }).select('-passwordHash -pin');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
