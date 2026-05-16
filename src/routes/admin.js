const express = require('express')
const db      = require('../config/database')
const logger  = require('../config/logger')
const { authenticate, requireAdmin } = require('../middleware/auth')
const { auditLog }                   = require('../middleware/audit')
const { paginate }                   = require('../utils/helpers')

const router = express.Router()
router.use(authenticate, requireAdmin)

router.get('/users', async (req, res) => {
  const { page, limit, offset } = paginate(null, req.query.page, req.query.limit)
  const { search, role } = req.query
  try {
    let query = db('users').select('id', 'name', 'email', 'phone', 'role', 'is_active', 'created_at')
      .orderBy('created_at', 'desc').limit(limit).offset(offset)
    if (search) query = query.where(function () {
      this.whereILike('name', `%${search}%`).orWhereILike('email', `%${search}%`)
    })
    if (role) query = query.where({ role })
    const [users, [{ total }]] = await Promise.all([query, db('users').count('id as total')])
    const enriched = await Promise.all(users.map(async (u) => {
      const wallet = await db('wallets').where({ user_id: u.id }).select('balance').first()
      return { ...u, balance: parseFloat(wallet?.balance || 0) }
    }))
    res.json({ users: enriched, pagination: { page, limit, total: parseInt(total) } })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' })
  }
})

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

router.get('/transactions', async (req, res) => {
  const { page, limit, offset } = paginate(null, req.query.page, req.query.limit)
  const { type, status } = req.query
  try {
    let query = db('transactions').orderBy('created_at', 'desc').limit(limit).offset(offset)
    if (type)   query = query.where({ type })
    if (status) query = query.where({ status })
    const [transactions, [{ total }]] = await Promise.all([query, db('transactions').count('id as total')])
    res.json({ transactions: transactions.map(t => ({ ...t, amount: parseFloat(t.amount), fee: parseFloat(t.fee || 0) })), pagination: { page, limit, total: parseInt(total) } })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transactions' })
  }
})

router.patch('/transactions/:id/reverse', async (req, res) => {
  try {
    const tx = await db('transactions').where({ id: req.params.id }).first()
    if (!tx) return res.status(404).json({ error: 'Transaction not found' })
    if (tx.status !== 'SUCCESSFUL') return res.status(400).json({ error: 'Only successful transactions can be reversed' })
    if (tx.type !== 'TRANSFER') return res.status(400).json({ error: 'Only transfers can be reversed' })

    await db.transaction(async (trx) => {
      await trx('transactions').where({ id: tx.id }).update({ status: 'REVERSED' })
      if (tx.sender_id) await trx('wallets').where({ user_id: tx.sender_id }).increment('balance', tx.amount)
      if (tx.receiver_id) await trx('wallets').where({ user_id: tx.receiver_id }).decrement('balance', tx.net_amount)
      await trx('transactions').insert({
        sender_id: tx.receiver_id, receiver_id: tx.sender_id,
        amount: tx.amount, fee: 0, net_amount: tx.amount,
        type: 'REVERSAL', status: 'SUCCESSFUL',
        reference: 'REV-' + tx.reference, description: `Reversal of ${tx.reference}`, created_at: new Date(),
      })
    })
    await auditLog(req, 'TRANSACTION_REVERSED', { tx_id: tx.id })
    res.json({ message: 'Transaction reversed successfully' })
  } catch (err) {
    res.status(500).json({ error: 'Reversal failed' })
  }
})

router.get('/reports/revenue', async (req, res) => {
  try {
    const [transfer_fees] = await db('fee_ledger').where({ type: 'TRANSFER_FEE' }).sum('amount as total').count('id as count')
    const [merchant_fees] = await db('fee_ledger').where({ type: 'MERCHANT_FEE' }).sum('amount as total').count('id as count')
    const [forex_margin]  = await db('fee_ledger').where({ type: 'FOREX_MARGIN' }).sum('amount as total').count('id as count')
    res.json({
      revenue: {
        transfer_fees: { total: parseFloat(transfer_fees.total || 0), count: parseInt(transfer_fees.count) },
        merchant_fees: { total: parseFloat(merchant_fees.total || 0), count: parseInt(merchant_fees.count) },
        forex_margin:  { total: parseFloat(forex_margin.total  || 0), count: parseInt(forex_margin.count) },
        grand_total:   parseFloat(transfer_fees.total || 0) + parseFloat(merchant_fees.total || 0) + parseFloat(forex_margin.total || 0),
      },
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch revenue report' })
  }
})

module.exports = router
