const express = require('express')
const db      = require('../config/database')
const logger  = require('../config/logger')
const { authenticate }    = require('../middleware/auth')
const { validate, rules } = require('../middleware/validate')
const { paginate }        = require('../utils/helpers')

const router = express.Router()
router.use(authenticate)

router.get('/', async (req, res) => {
  const userId = req.user.userId
  const { page, limit, offset } = paginate(null, req.query.page, req.query.limit)
  const { type, status } = req.query

  try {
    let query = db('transactions')
      .where(function () {
        this.where('sender_id', userId).orWhere('receiver_id', userId)
      })
      .orderBy('created_at', 'desc')
      .limit(limit).offset(offset)

    if (type)   query = query.where({ type })
    if (status) query = query.where({ status })

    let countQuery = db('transactions')
      .where(function () {
        this.where('sender_id', userId).orWhere('receiver_id', userId)
      }).count('id as total')

    const [transactions, [{ total }]] = await Promise.all([query, countQuery])

    const enriched = await Promise.all(transactions.map(async (tx) => {
      const sender   = tx.sender_id
        ? await db('users').where({ id: tx.sender_id }).select('name', 'phone').first()
        : null
      const receiver = tx.receiver_id
        ? await db('users').where({ id: tx.receiver_id }).select('name', 'phone').first()
        : null
      return {
        ...tx,
        amount:     parseFloat(tx.amount),
        fee:        parseFloat(tx.fee || 0),
        net_amount: parseFloat(tx.net_amount || tx.amount),
        direction:  tx.receiver_id === userId ? 'in' : 'out',
        sender,
        receiver,
      }
    }))

    res.json({
      transactions: enriched,
      pagination: { page, limit, total: parseInt(total), pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    logger.error('Get transactions failed', { err: err.message })
    res.status(500).json({ error: 'Failed to fetch transactions' })
  }
})

router.get('/:id', rules.txId, validate, async (req, res) => {
  const userId = req.user.userId
  try {
    const tx = await db('transactions').where({ id: req.params.id }).first()
    if (!tx) return res.status(404).json({ error: 'Transaction not found' })
    if (tx.sender_id !== userId && tx.receiver_id !== userId) {
      return res.status(403).json({ error: 'Access denied' })
    }
    res.json({
      ...tx,
      amount:     parseFloat(tx.amount),
      fee:        parseFloat(tx.fee || 0),
      direction:  tx.receiver_id === userId ? 'in' : 'out',
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transaction' })
  }
})

module.exports = router
