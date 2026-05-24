const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

const adminOnly = async (req, res, next) => {
  const user = await db('users').where({ id: req.user.id }).select('role').first();
  if (user?.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
  next();
};

// Platform stats
router.get('/stats', auth, adminOnly, async (req, res) => {
  try {
    const [users]     = await db('users').count('id as count');
    const [txs]       = await db('transactions').count('id as count');
    const [fees]      = await db('transactions').sum('fee as total').where({ status: 'success' });
    const [volume]    = await db('transactions').sum(db.raw('ABS(amount) as total')).where({ status: 'success' });
    const [vendors]   = await db('hotspot_vendors').count('id as count').where({ status: 'active' });

    res.json({
      total_users:        Number(users.count),
      total_transactions: Number(txs.count),
      platform_fees:      Number(fees.total   || 0),
      transaction_volume: Number(volume.total || 0),
      active_vendors:     Number(vendors.count),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// List users
router.get('/users', auth, adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    let query = db('users').select('id','name','email','phone','balance','kyc_status','role','created_at');
    if (search) {
      query = query.where('name', 'ilike', `%${search}%`)
        .orWhere('email', 'ilike', `%${search}%`)
        .orWhere('phone', 'ilike', `%${search}%`);
    }
    const [{ count }] = await query.clone().count('id as count');
    const users = await query
      .orderBy('created_at', 'desc')
      .limit(Number(limit))
      .offset((Number(page) - 1) * Number(limit));
    res.json({ users, total: Number(count), page: Number(page), pages: Math.ceil(Number(count) / Number(limit)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// All transactions with fee breakdown
router.get('/transactions', auth, adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 30, type } = req.query;
    let query = db('transactions')
      .join('users', 'transactions.user_id', 'users.id')
      .select('transactions.*', 'users.name', 'users.email', 'users.phone');
    if (type) query = query.where('transactions.type', type);
    const [{ count }] = await query.clone().count('transactions.id as count');
    const txs = await query
      .orderBy('transactions.created_at', 'desc')
      .limit(Number(limit))
      .offset((Number(page) - 1) * Number(limit));
    res.json({ transactions: txs, total: Number(count) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Hotspot vendors list
router.get('/vendors', auth, adminOnly, async (req, res) => {
  try {
    const vendors = await db('hotspot_vendors')
      .orderBy('created_at', 'desc');
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Suspend / activate user
router.patch('/users/:id/status', auth, adminOnly, async (req, res) => {
  try {
    const { is_active } = req.body;
    await db('users').where({ id: req.params.id }).update({ is_active });
    res.json({ message: `User ${is_active ? 'activated' : 'suspended'}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Suspend / activate vendor
router.patch('/vendors/:id/status', auth, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    await db('hotspot_vendors').where({ id: req.params.id }).update({ status });
    res.json({ message: `Vendor status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
