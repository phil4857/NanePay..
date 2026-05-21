// src/routes/withdrawals.js  ← NEW FILE
const express = require('express')
const { v4: uuid } = require('uuid')
const db      = require('../db')
const ledger  = require('../services/ledger')
const mpesa   = require('../services/mpesa')
const { authenticate, requireRole } = require('../middleware/auth')

const router = express.Router()

const FEE_RATE = parseFloat(process.env.WITHDRAWAL_FEE_RATE || '0.01')

// ── POST /api/withdrawals/request ───────────────────────────────
router.post('/request', authenticate, async (req, res) => {
  const { amount, phone } = req.body

  if (!amount || amount < 100) {
    return res.status(400).json({ message: 'Minimum withdrawal is KES 100' })
  }

  const fee    = parseFloat((amount * FEE_RATE).toFixed(2))
  const net    = parseFloat((amount - fee).toFixed(2))
  const withdrawalId = uuid()
  const ref    = `WD-${withdrawalId.split('-')[0].toUpperCase()}`

  try {
    await db.transaction(async trx => {
      // Debit wallet immediately (locked)
      await ledger.withdrawalDebit({
        userId:       req.user.id,
        amount,
        withdrawalId,
        reference:    ref,
        trx,
      })

      // Create withdrawal request
      await trx('withdrawals').insert({
        id:          withdrawalId,
        user_id:     req.user.id,
        amount,
        fee,
        net_amount:  net,
        status:      'pending',
        method:      'mpesa',
        phone_number: phone || req.user.phone,
        created_at:  new Date(),
        updated_at:  new Date(),
      })
    })

    return res.status(201).json({
      message:      'Withdrawal request submitted. Admin will process within 24 hours.',
      withdrawalId,
      amount,
      fee,
      net,
    })
  } catch (err) {
    return res.status(400).json({ message: err.message })
  }
})

// ── GET /api/withdrawals ─────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const withdrawals = await db('withdrawals')
    .where({ user_id: req.user.id })
    .orderBy('created_at', 'desc')
    .limit(50)
  return res.json({ withdrawals })
})

// ── POST /api/withdrawals/:id/approve  (Admin only) ─────────────
router.post('/:id/approve', authenticate, requireRole('admin'), async (req, res) => {
  const withdrawal = await db('withdrawals').where({ id: req.params.id, status: 'pending' }).first()
  if (!withdrawal) return res.status(404).json({ message: 'Withdrawal not found or already processed' })

  try {
    // Send B2C
    const b2cResult = await mpesa.b2cPayout({
      phone:   withdrawal.phone_number,
      amount:  withdrawal.net_amount,
      occasion: `WD-${withdrawal.id.split('-')[0]}`,
    })

    await db('withdrawals').where({ id: withdrawal.id }).update({
      status:      'processing',
      approved_by: req.user.id,
      approved_at: new Date(),
      mpesa_receipt: b2cResult.ConversationID,
      updated_at:  new Date(),
    })

    // Audit log
    await db('audit_logs').insert({
      id:          uuid(),
      actor_id:    req.user.id,
      action:      'withdrawal_approved',
      target_type: 'withdrawal',
      target_id:   withdrawal.id,
      description: `Withdrawal of KES ${withdrawal.amount} approved`,
      created_at:  new Date(),
    })

    return res.json({ message: 'Withdrawal approved and B2C initiated.' })
  } catch (err) {
    return res.status(500).json({ message: `B2C failed: ${err.message}` })
  }
})

// ── POST /api/withdrawals/:id/reject  (Admin only) ──────────────
router.post('/:id/reject', authenticate, requireRole('admin'), async (req, res) => {
  const { reason } = req.body
  const withdrawal  = await db('withdrawals').where({ id: req.params.id, status: 'pending' }).first()
  if (!withdrawal) return res.status(404).json({ message: 'Not found' })

  await db.transaction(async trx => {
    await trx('withdrawals').where({ id: withdrawal.id }).update({
      status:           'rejected',
      rejection_reason: reason,
      approved_by:      req.user.id,
      approved_at:      new Date(),
      updated_at:       new Date(),
    })

    // Refund wallet
    await ledger.postEntry({
      userId:      withdrawal.user_id,
      type:        'reversal',
      amount:      +withdrawal.amount,
      reference:   `REFUND-WD-${withdrawal.id.split('-')[0]}`,
      description: `Withdrawal rejected: ${reason}`,
      trx,
    })

    await trx('notifications').insert({
      id:         uuid(),
      user_id:    withdrawal.user_id,
      title:      'Withdrawal Rejected',
      body:       `Your withdrawal of KES ${withdrawal.amount} was rejected. Reason: ${reason}. Amount refunded.`,
      type:       'warning',
      created_at: new Date(),
      updated_at: new Date(),
    })
  })

  return res.json({ message: 'Withdrawal rejected and amount refunded.' })
})

module.exports = router
