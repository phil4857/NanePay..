// src/routes/wallet.js  ← NEW FILE
const express = require('express')
const { v4: uuid } = require('uuid')
const db      = require('../db')
const ledger  = require('../services/ledger')
const { authenticate } = require('../middleware/auth')

const router = express.Router()

// ── GET /api/wallet ─────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const wallet = await db('wallets').where({ user_id: req.user.id }).first()
  if (!wallet) return res.status(404).json({ message: 'Wallet not found' })
  return res.json({ wallet })
})

// ── GET /api/wallet/transactions ────────────────────────────────
router.get('/transactions', authenticate, async (req, res) => {
  const { page = 1, limit = 20, type, status } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  let query = db('transactions')
    .where({ user_id: req.user.id })
    .orderBy('created_at', 'desc')
    .limit(parseInt(limit))
    .offset(offset)

  if (type)   query = query.where({ type })
  if (status) query = query.where({ status })

  const [transactions, [{ count }]] = await Promise.all([
    query,
    db('transactions').where({ user_id: req.user.id }).count('id as count'),
  ])

  return res.json({
    transactions,
    pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(count) },
  })
})

// ── GET /api/wallet/ledger ──────────────────────────────────────
router.get('/ledger', authenticate, async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const entries = await db('ledger')
    .where({ user_id: req.user.id })
    .orderBy('created_at', 'desc')
    .limit(parseInt(limit))
    .offset(offset)

  return res.json({ entries })
})

// ── POST /api/wallet/transfer ───────────────────────────────────
router.post('/transfer', authenticate, async (req, res) => {
  const { toPhone, amount, description = '' } = req.body

  if (!toPhone || !amount || amount < 10) {
    return res.status(400).json({ message: 'Minimum transfer is KES 10' })
  }
  if (toPhone === req.user.phone) {
    return res.status(400).json({ message: 'Cannot transfer to yourself' })
  }

  const recipient = await db('users').where({ phone: toPhone }).first()
  if (!recipient) return res.status(404).json({ message: 'Recipient not found' })

  try {
    const result = await ledger.transfer({
      fromUserId:  req.user.id,
      toUserId:    recipient.id,
      amount:      parseFloat(amount),
      description: description || `Transfer to ${recipient.name}`,
    })

    // Notify recipient
    await db('notifications').insert({
      id:         uuid(),
      user_id:    recipient.id,
      title:      'Money Received',
      body:       `You received KES ${amount} from ${req.user.name}`,
      type:       'payment',
      data:       JSON.stringify({ from: req.user.name, amount }),
      created_at: new Date(),
      updated_at: new Date(),
    })

    return res.json({
      message: `KES ${amount} sent to ${recipient.name}`,
      ...result,
    })
  } catch (err) {
    return res.status(400).json({ message: err.message })
  }
})

module.exports = router
