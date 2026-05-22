// src/routes/transactions.js  ← REPLACEMENT
const express      = require('express')
const { v4: uuid } = require('uuid')
const db           = require('../db')
const logger       = require('../config/logger')
const { authenticate, requireRole } = require('../middleware')

const router = express.Router()

// ── GET /api/transactions ─────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 20, type, status } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)

    let query = db('transactions')
      .where({ user_id: req.user.id })
      .orderBy('created_at', 'desc')
      .limit(parseInt(limit))
      .offset(offset)

    if (type)   query = query.where({ type })
    if (status) query = query.where({ status })

    const [txns, [{ count }]] = await Promise.all([
      query,
      db('transactions').where({ user_id: req.user.id }).count('id as count'),
    ])

    return res.json({
      transactions: txns,
      pagination: {
        page:  parseInt(page),
        limit: parseInt(limit),
        total: parseInt(count),
      },
    })
  } catch (err) {
    logger.error('Get transactions failed', { err: err.message })
    return res.status(500).json({ error: 'Failed to fetch transactions' })
  }
})

// ── GET /api/transactions/:id ─────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const txn = await db('transactions')
      .where({ id: req.params.id, user_id: req.user.id })
      .first()

    if (!txn) return res.status(404).json({ error: 'Transaction not found' })
    return res.json({ transaction: txn })
  } catch (err) {
    logger.error('Get transaction failed', { err: err.message })
    return res.status(500).json({ error: 'Failed to fetch transaction' })
  }
})

// ── GET /api/transactions/admin/all  (admin only) ─────────────
router.get('/admin/all', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { page = 1, limit = 50, type, status, userId } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)

    let query = db('transactions as t')
      .leftJoin('users as u', 't.user_id', 'u.id')
      .select('t.*', 'u.name as user_name', 'u.phone as user_phone')
      .orderBy('t.created_at', 'desc')
      .limit(parseInt(limit))
      .offset(offset)

    if (type)   query = query.where('t.type', type)
    if (status) query = query.where('t.status', status)
    if (userId) query = query.where('t.user_id', userId)

    const txns = await query
    return res.json({ transactions: txns })
  } catch (err) {
    logger.error('Admin get transactions failed', { err: err.message })
    return res.status(500).json({ error: 'Failed to fetch transactions' })
  }
})

// ── POST /api/transactions/:id/refund  (admin only) ───────────
router.post('/:id/refund', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const txn = await db('transactions').where({ id: req.params.id }).first()
    if (!txn)                         return res.status(404).json({ error: 'Transaction not found' })
    if (txn.status === 'reversed')    return res.status(400).json({ error: 'Already refunded' })
    if (txn.status !== 'completed')   return res.status(400).json({ error: 'Only completed transactions can be refunded' })

    await db.transaction(async trx => {
      // Reverse transaction
      await trx('transactions').where({ id: txn.id }).update({
        status:     'reversed',
        updated_at: new Date(),
      })

      // Credit wallet back
      await trx('wallets').where({ user_id: txn.user_id }).update({
        available_balance: db.raw('available_balance + ?', [txn.amount]),
        total_balance:     db.raw('total_balance + ?',     [txn.amount]),
        updated_at:        new Date(),
      })

      // Ledger refund entry
      const wallet = await trx('wallets').where({ user_id: txn.user_id }).first()
      await trx('ledger').insert({
        id:             uuid(),
        user_id:        txn.user_id,
        wallet_id:      wallet.id,
        type:           'reversal',
        amount:         txn.amount,
        balance_before: parseFloat(wallet.available_balance) - parseFloat(txn.amount),
        balance_after:  parseFloat(wallet.available_balance),
        reference:      `REFUND-${txn.reference}`,
        transaction_id: txn.id,
        description:    `Refund for transaction ${txn.reference}`,
        status:         'completed',
        metadata:       JSON.stringify({ refunded_by: req.user.id }),
        created_at:     new Date(),
        updated_at:     new Date(),
      })

      // Notify user
      await trx('notifications').insert({
        id:         uuid(),
        user_id:    txn.user_id,
        title:      'Refund Processed',
        body:       `KES ${txn.amount} has been refunded to your wallet for transaction ${txn.reference}`,
        type:       'success',
        data:       JSON.stringify({ transaction_id: txn.id, amount: txn.amount }),
        created_at: new Date(),
        updated_at: new Date(),
      })

      // Audit log
      await trx('audit_logs').insert({
        id:          uuid(),
        actor_id:    req.user.id,
        action:      'refund_issued',
        target_type: 'transaction',
        target_id:   txn.id,
        description: `Refund of KES ${txn.amount} issued for ${txn.reference}`,
        created_at:  new Date(),
      })
    })

    return res.json({ message: 'Refund processed successfully', amount: txn.amount })
  } catch (err) {
    logger.error('Refund failed', { err: err.message })
    return res.status(500).json({ error: 'Refund failed. Please try again.' })
  }
})

module.exports = router
