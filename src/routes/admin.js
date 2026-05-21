// src/routes/admin.js  ← NEW FILE
const express = require('express')
const { v4: uuid } = require('uuid')
const db      = require('../db')
const { authenticate, requireRole } = require('../middleware/auth')

const router = express.Router()
const adminOnly = [authenticate, requireRole('admin')]

// ── GET /api/admin/dashboard ─────────────────────────────────────
router.get('/dashboard', ...adminOnly, async (req, res) => {
  const [
    users, merchants, transactions, revenue,
    pendingWithdrawals, activeSessions
  ] = await Promise.all([
    db('users').count('id as count').first(),
    db('merchants').where({ status: 'approved' }).count('id as count').first(),
    db('transactions').where({ status: 'completed' }).sum('amount as total').first(),
    db('platform_revenue').sum('amount as total').first(),
    db('withdrawals').where({ status: 'pending' }).count('id as count').first(),
    db('wifi_sessions').where({ status: 'active' }).count('id as count').first(),
  ])

  return res.json({
    stats: {
      totalUsers:          parseInt(users?.count || 0),
      approvedMerchants:   parseInt(merchants?.count || 0),
      totalTransactions:   parseFloat(transactions?.total || 0),
      platformRevenue:     parseFloat(revenue?.total || 0),
      pendingWithdrawals:  parseInt(pendingWithdrawals?.count || 0),
      activeWifiSessions:  parseInt(activeSessions?.count || 0),
    },
  })
})

// ── GET /api/admin/users ─────────────────────────────────────────
router.get('/users', ...adminOnly, async (req, res) => {
  const { page = 1, limit = 30, search } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  let q = db('users').select('id', 'name', 'email', 'phone', 'role', 'is_active', 'is_banned', 'created_at')
    .orderBy('created_at', 'desc').limit(parseInt(limit)).offset(offset)

  if (search) q = q.where(b => b.where('name', 'ilike', `%${search}%`).orWhere('email', 'ilike', `%${search}%`))

  const users = await q
  return res.json({ users })
})

// ── POST /api/admin/users/:id/ban ────────────────────────────────
router.post('/users/:id/ban', ...adminOnly, async (req, res) => {
  await db('users').where({ id: req.params.id }).update({ is_banned: true, updated_at: new Date() })
  await db('audit_logs').insert({
    id: uuid(), actor_id: req.user.id, action: 'user_banned',
    target_type: 'user', target_id: req.params.id,
    description: req.body.reason || 'Banned by admin', created_at: new Date(),
  })
  return res.json({ message: 'User banned' })
})

// ── POST /api/admin/merchants/:id/approve ───────────────────────
router.post('/merchants/:id/approve', ...adminOnly, async (req, res) => {
  const merchant = await db('merchants').where({ id: req.params.id }).first()
  if (!merchant) return res.status(404).json({ message: 'Not found' })

  await db.transaction(async trx => {
    await trx('merchants').where({ id: merchant.id }).update({ status: 'approved', updated_at: new Date() })

    // Create merchant wallet if not exists
    const existing = await trx('merchant_wallets').where({ merchant_id: merchant.id }).first()
    if (!existing) {
      await trx('merchant_wallets').insert({
        id: uuid(), merchant_id: merchant.id,
        balance: 0, total_earnings: 0, pending_withdrawal: 0, total_withdrawn: 0,
        created_at: new Date(), updated_at: new Date(),
      })
    }

    await trx('notifications').insert({
      id: uuid(), user_id: merchant.user_id,
      title: '🎉 Merchant Account Approved',
      body: 'Your merchant account has been approved. You can now create WiFi packages!',
      type: 'success', created_at: new Date(), updated_at: new Date(),
    })

    await trx('audit_logs').insert({
      id: uuid(), actor_id: req.user.id, action: 'merchant_approved',
      target_type: 'merchant', target_id: merchant.id,
      description: 'Merchant approved', created_at: new Date(),
    })
  })

  return res.json({ message: 'Merchant approved' })
})

// ── POST /api/admin/merchants/:id/reject ────────────────────────
router.post('/merchants/:id/reject', ...adminOnly, async (req, res) => {
  const { reason } = req.body
  const merchant   = await db('merchants').where({ id: req.params.id }).first()
  if (!merchant) return res.status(404).json({ message: 'Not found' })

  await db('merchants').where({ id: merchant.id }).update({ status: 'rejected', updated_at: new Date() })
  await db('notifications').insert({
    id: uuid(), user_id: merchant.user_id,
    title: 'Merchant Application Rejected',
    body: `Your merchant application was rejected. Reason: ${reason || 'Does not meet requirements.'}`,
    type: 'error', created_at: new Date(), updated_at: new Date(),
  })
  await db('audit_logs').insert({
    id: uuid(), actor_id: req.user.id, action: 'merchant_rejected',
    target_type: 'merchant', target_id: merchant.id,
    description: reason, created_at: new Date(),
  })

  return res.json({ message: 'Merchant rejected' })
})

// ── GET /api/admin/withdrawals ───────────────────────────────────
router.get('/withdrawals', ...adminOnly, async (req, res) => {
  const { status = 'pending' } = req.query
  const withdrawals = await db('withdrawals as w')
    .join('users as u', 'w.user_id', 'u.id')
    .where('w.status', status)
    .select('w.*', 'u.name as user_name', 'u.phone as user_phone', 'u.email as user_email')
    .orderBy('w.created_at', 'asc')
  return res.json({ withdrawals })
})

// ── GET /api/admin/revenue ───────────────────────────────────────
router.get('/revenue', ...adminOnly, async (req, res) => {
  const [total, bySource, last30Days] = await Promise.all([
    db('platform_revenue').sum('amount as total').first(),
    db('platform_revenue').groupBy('source').select('source').sum('amount as total'),
    db('platform_revenue')
      .where('created_at', '>=', new Date(Date.now() - 30 * 86400000))
      .sum('amount as total').first(),
  ])

  return res.json({
    totalRevenue:    parseFloat(total?.total || 0),
    bySource,
    last30DaysRevenue: parseFloat(last30Days?.total || 0),
  })
})

// ── GET /api/admin/audit-logs ────────────────────────────────────
router.get('/audit-logs', ...adminOnly, async (req, res) => {
  const logs = await db('audit_logs as a')
    .leftJoin('users as u', 'a.actor_id', 'u.id')
    .select('a.*', 'u.name as actor_name', 'u.email as actor_email')
    .orderBy('a.created_at', 'desc')
    .limit(200)
  return res.json({ logs })
})

module.exports = router
