const express = require('express')
const db      = require('../config/database')
const logger  = require('../config/logger')
const { authenticate, requireAdmin } = require('../middleware/auth')
const { auditLog }                   = require('../middleware/audit')
const { paginate }                   = require('../utils/helpers')

const router = express.Router()
router.use(authenticate, requireAdmin)

// ── GET /api/admin/stats ──────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [users]     = await db('users').count('id as count')
    const [merchants] = await db('merchant_profiles').count('id as count')
    const [txs]       = await db('transactions').where({ status: 'SUCCESSFUL' }).count('id as count')
    const [revenue]   = await db('fee_ledger').sum('amount as total')
    const [subs]      = await db('subscriptions').where({ status: 'ACTIVE' }).count('id as count')

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [today_txs]     = await db('transactions').where({ status: 'SUCCESSFUL' }).where('created_at', '>=', today).count('id as count')
    const [today_revenue] = await db('fee_ledger').where('created_at', '>=', today).sum('amount as total')

    res.json({
      total_users:     parseInt(users.count),
      total_merchants: parseInt(merchants.count),
      total_txs:       parseInt(txs.count),
      total_revenue:   parseFloat(revenue.total || 0),
      active_subs:     parseInt(subs.count),
      today_txs:       parseInt(today_txs.count),
      today_revenue:   parseFloat(today_revenue.total || 0),
    })
  } catch (err) {
    logger.error('Admin stats failed', { err: err.message })
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})

// ── GET /api/admin/users ──────────────────────────────────────
router.get('/users', async (req, res) => {
  const { page, limit, offset } = paginate(null, req.query.page, req.query.limit)
  const { search, role } = req.query
  try {
    let query = db('users')
      .select('id', 'name', 'email', 'phone', 'role', 'is_active', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)

    if (search) {
      query = query.where(function () {
        this.whereILike('name', `%${search}%`).orWhereILike('email', `%${search}%`)
      })
    }
    if (role) query = query.where({ role })

    const [users, [{ total }]] = await Promise.all([
      query,
      db('users').count('id as total'),
    ])

    const enriched = await Promise.all(users.map(async (u) => {
      const wallet = await db('wallets').where({ user_id: u.id }).select('balance').first()
      return { ...u, balance: parseFloat(wallet?.balance || 0) }
    }))

    res.json({ users: enriched, pagination: { page, limit, total: parseInt(total) } })
  } catch (err) {
    logger.error('Admin get users failed', { err: err.message })
    res.status(500).json({ error: 'Failed to fetch users' })
  }
})

// ── PATCH /api/admin/users/:id/suspend ───────────────────────
router.patch('/users/:id/suspend', async (req, res) => {
  try {
    const user = await db('users').where({ id: req.params.id }).first()
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.role === 'admin') return res.status(400).json({ error: 'Cannot suspend an admin' })

    const new_status = !user.is_active
    await db('users').where({ id: req.params.id }).update({ is_active: new_status })
    await auditLog(req, new_status ? 'USER_UNSUSPENDED' : 'USER_SUSPENDED', { target: req.params.id })

    res.json({ message: `User ${new_status ? 'unsuspended' : 'suspended'}`, is_active: new_status })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user' })
  }
})

// ── GET /api/admin/merchants ──────────────────────────────────
router.get('/merchants', async (req, res) => {
  const { page, limit, offset } = paginate(null, req.query.page, req.query.limit)
  const { status } = req.query
  try {
    let query = db('merchant_profiles as m')
      .join('users as u', 'm.user_id', 'u.id')
      .select('m.*', 'u.name', 'u.email', 'u.phone')
      .orderBy('m.created_at', 'desc')
      .limit(limit)
      .offset(offset)

    if (status) query = query.where({ 'm.status': status })

    const merchants = await query
    res.json({ merchants, pagination: { page, limit } })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch merchants' })
  }
})

// ── PATCH /api/admin/merchants/:id/approve ────────────────────
router.patch('/merchants/:id/approve', async (req, res) => {
  try {
    const { action, reason } = req.body

    if (!['approve', 'reject', 'suspend'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Use approve, reject or suspend.' })
    }

    const statusMap = {
      approve: 'APPROVED',
      reject:  'REJECTED',
      suspend: 'SUSPENDED',
    }

    await db('merchant_profiles')
      .where({ id: req.params.id })
      .update({
        status:           statusMap[action],
        rejection_reason: reason || null,
      })

    await auditLog(req, `MERCHANT_${action.toUpperCase()}`, { merchant_id: req.params.id })
    res.json({ message: `Merchant ${action}d successfully` })
  } catch (err) {
    logger.error('Merchant approve failed', { err: err.message })
    res.status(500).json({ error: 'Failed to update merchant' })
  }
})

// ── GET /api/admin/transactions ───────────────────────────────
router.get('/transactions', async (req, res) => {
  const { page, limit, offset } = paginate(null, req.query.page, req.query.limit)
  const { type, status } = req.query
  try {
    let query = db('transactions')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)

    if (type)   query = query.where({ type })
    if (status) query = query.where({ status })

    const [transactions, [{ total }]] = await Promise.all([
      query,
      db('transactions').count('id as total'),
    ])

    res.json({
      transactions: transactions.map(t => ({
        ...t,
        amount: parseFloat(t.amount),
        fee:    parseFloat(t.fee || 0),
      })),
      pagination: { page, limit, total: parseInt(total) },
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transactions' })
  }
})

// ── PATCH /api/admin/transactions/:id/reverse ─────────────────
router.patch('/transactions/:id/reverse', async (req, res) => {
  try {
    const tx = await db('transactions').where({ id: req.params.id }).first()
    if (!tx) return res.status(404).json({ error: 'Transaction not found' })
    if (tx.status !== 'SUCCESSFUL') return res.status(400).json({ error: 'Only successful transactions can be reversed' })
    if (tx.type !== 'TRANSFER')     return res.status(400).json({ error: 'Only transfers can be reversed' })

    await db.transaction(async (trx) => {
      await trx('transactions').where({ id: tx.id }).update({ status: 'REVERSED' })
      if (tx.sender_id)   await trx('wallets').where({ user_id: tx.sender_id }).increment('balance', tx.amount)
      if (tx.receiver_id) await trx('wallets').where({ user_id: tx.receiver_id }).decrement('balance', tx.net_amount)

      await trx('transactions').insert({
        sender_id:   tx.receiver_id,
        receiver_id: tx.sender_id,
        amount:      tx.amount,
        fee:         0,
        net_amount:  tx.amount,
        type:        'REVERSAL',
        status:      'SUCCESSFUL',
        reference:   'REV-' + tx.reference,
        description: `Reversal of ${tx.reference}`,
        created_at:  new Date(),
      })
    })

    await auditLog(req, 'TRANSACTION_REVERSED', { tx_id: tx.id })
    res.json({ message: 'Transaction reversed successfully' })
  } catch (err) {
    logger.error('Reversal failed', { err: err.message })
    res.status(500).json({ error: 'Reversal failed' })
  }
})

// ── GET /api/admin/withdrawals ────────────────────────────────
router.get('/withdrawals', async (req, res) => {
  const { page, limit, offset } = paginate(null, req.query.page, req.query.limit)
  try {
    const withdrawals = await db('withdrawals as w')
      .join('users as u', 'w.user_id', 'u.id')
      .select('w.*', 'u.name', 'u.phone as user_phone')
      .orderBy('w.created_at', 'desc')
      .limit(limit)
      .offset(offset)

    res.json({ withdrawals })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch withdrawals' })
  }
})

// ── GET /api/admin/subscriptions ──────────────────────────────
router.get('/subscriptions', async (req, res) => {
  const { page, limit, offset } = paginate(null, req.query.page, req.query.limit)
  try {
    const subs = await db('subscriptions as s')
      .join('users as u',            's.user_id',     'u.id')
      .join('packages as p',         's.package_id',  'p.id')
      .join('merchant_profiles as m','s.merchant_id', 'm.id')
      .select(
        's.*',
        'u.name as user_name',
        'u.phone as user_phone',
        'p.name as package_name',
        'm.business_name',
      )
      .orderBy('s.created_at', 'desc')
      .limit(limit)
      .offset(offset)

    res.json({ subscriptions: subs })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch subscriptions' })
  }
})

// ── GET /api/admin/reports/revenue ────────────────────────────
router.get('/reports/revenue', async (req, res) => {
  try {
    const [transfer_fees] = await db('fee_ledger').where({ type: 'TRANSFER_FEE' }).sum('amount as total').count('id as count')
    const [merchant_fees] = await db('fee_ledger').where({ type: 'MERCHANT_FEE' }).sum('amount as total').count('id as count')
    const [forex_margin]  = await db('fee_ledger').where({ type: 'FOREX_MARGIN' }).sum('amount as total').count('id as count')
    const [bill_fees]     = await db('fee_ledger').where({ type: 'BILL_FEE' }).sum('amount as total').count('id as count')
    const [total_volume]  = await db('transactions').where({ status: 'SUCCESSFUL' }).sum('amount as total')

    const daily = await db('fee_ledger')
      .select(db.raw('DATE(created_at) as date'), db.raw('SUM(amount) as revenue'))
      .where('created_at', '>=', db.raw("NOW() - INTERVAL '7 days'"))
      .groupByRaw('DATE(created_at)')
      .orderBy('date', 'asc')

    const grand_total = [transfer_fees, merchant_fees, forex_margin, bill_fees]
      .reduce((sum, f) => sum + parseFloat(f.total || 0), 0)

    res.json({
      revenue: {
        transfer_fees: { total: parseFloat(transfer_fees.total || 0), count: parseInt(transfer_fees.count) },
        merchant_fees: { total: parseFloat(merchant_fees.total || 0), count: parseInt(merchant_fees.count) },
        forex_margin:  { total: parseFloat(forex_margin.total  || 0), count: parseInt(forex_margin.count)  },
        bill_fees:     { total: parseFloat(bill_fees.total     || 0), count: parseInt(bill_fees.count)     },
        grand_total,
      },
      platform_volume: parseFloat(total_volume.total || 0),
      daily_revenue:   daily,
    })
  } catch (err) {
    logger.error('Revenue report failed', { err: err.message })
    res.status(500).json({ error: 'Failed to fetch revenue report' })
  }
})

module.exports = router
