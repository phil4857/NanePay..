const express = require('express')
const { v4: uuid } = require('uuid')

const db = require('../db')

const ledger = require('../services/ledger')
const mpesa = require('../services/mpesa')

const authMiddleware = require('../middleware/auth')

const authenticate =
  typeof authMiddleware === 'function'
    ? authMiddleware
    : authMiddleware.authenticate || authMiddleware.auth

const requireRole =
  authMiddleware.requireRole ||
  (() => (req, res, next) => next())

const router = express.Router()

const FEE_RATE = parseFloat(
  process.env.WITHDRAWAL_FEE_RATE || '0.01'
)

// ── POST /api/withdrawals/request ─────────────────────────────
router.post('/request', authenticate, async (req, res) => {

  const { amount, phone } = req.body

  if (!amount || Number(amount) < 100) {
    return res.status(400).json({
      message: 'Minimum withdrawal is KES 100',
    })
  }

  const fee = parseFloat(
    (Number(amount) * FEE_RATE).toFixed(2)
  )

  const net = parseFloat(
    (Number(amount) - fee).toFixed(2)
  )

  const withdrawalId = uuid()

  const ref = `WD-${withdrawalId
    .split('-')[0]
    .toUpperCase()}`

  try {

    await db.transaction(async trx => {

      if (
        ledger &&
        typeof ledger.withdrawalDebit === 'function'
      ) {

        await ledger.withdrawalDebit({
          userId: req.user.id,
          amount: Number(amount),
          withdrawalId,
          reference: ref,
          trx,
        })

      } else {

        const wallet = await trx('wallets')
          .where({ user_id: req.user.id })
          .first()

        if (!wallet) {
          throw new Error('Wallet not found')
        }

        if (Number(wallet.balance) < Number(amount)) {
          throw new Error('Insufficient balance')
        }

        await trx('wallets')
          .where({ user_id: req.user.id })
          .decrement('balance', Number(amount))
      }

      await trx('withdrawals').insert({
        id: withdrawalId,
        user_id: req.user.id,
        amount: Number(amount),
        fee,
        net_amount: net,
        status: 'pending',
        method: 'mpesa',
        phone_number: phone || req.user.phone,
        created_at: new Date(),
        updated_at: new Date(),
      })
    })

    return res.status(201).json({
      message:
        'Withdrawal request submitted successfully',
      withdrawalId,
      amount: Number(amount),
      fee,
      net,
    })

  } catch (err) {

    return res.status(400).json({
      message: err.message || 'Withdrawal failed',
    })
  }
})

// ── GET /api/withdrawals ──────────────────────────────────────
router.get('/', authenticate, async (req, res) => {

  try {

    const withdrawals = await db('withdrawals')
      .where({ user_id: req.user.id })
      .orderBy('created_at', 'desc')
      .limit(50)

    return res.json({
      withdrawals,
    })

  } catch (err) {

    return res.status(500).json({
      message: 'Failed to fetch withdrawals',
    })
  }
})

// ── POST /api/withdrawals/:id/approve ─────────────────────────
router.post(
  '/:id/approve',
  authenticate,
  requireRole('admin'),
  async (req, res) => {

    try {

      const withdrawal = await db('withdrawals')
        .where({
          id: req.params.id,
          status: 'pending',
        })
        .first()

      if (!withdrawal) {
        return res.status(404).json({
          message:
            'Withdrawal not found or already processed',
        })
      }

      let b2cResult = {}

      if (
        mpesa &&
        typeof mpesa.b2cPayout === 'function'
      ) {

        b2cResult = await mpesa.b2cPayout({
          phone: withdrawal.phone_number,
          amount: withdrawal.net_amount,
          occasion: `WD-${withdrawal.id
            .split('-')[0]}`,
        })
      }

      await db('withdrawals')
        .where({ id: withdrawal.id })
        .update({
          status: 'processing',
          approved_by: req.user.id,
          approved_at: new Date(),
          mpesa_receipt:
            b2cResult.ConversationID || null,
          updated_at: new Date(),
        })

      return res.json({
        message:
          'Withdrawal approved successfully',
      })

    } catch (err) {

      return res.status(500).json({
        message:
          err.message || 'Approval failed',
      })
    }
  }
)

// ── POST /api/withdrawals/:id/reject ──────────────────────────
router.post(
  '/:id/reject',
  authenticate,
  requireRole('admin'),
  async (req, res) => {

    const { reason } = req.body

    try {

      const withdrawal = await db('withdrawals')
        .where({
          id: req.params.id,
          status: 'pending',
        })
        .first()

      if (!withdrawal) {
        return res.status(404).json({
          message: 'Withdrawal not found',
        })
      }

      await db.transaction(async trx => {

        await trx('withdrawals')
          .where({ id: withdrawal.id })
          .update({
            status: 'rejected',
            rejection_reason: reason || 'Rejected',
            approved_by: req.user.id,
            approved_at: new Date(),
            updated_at: new Date(),
          })

        if (
          ledger &&
          typeof ledger.postEntry === 'function'
        ) {

          await ledger.postEntry({
            userId: withdrawal.user_id,
            type: 'reversal',
            amount: Number(withdrawal.amount),
            reference: `REFUND-WD-${withdrawal.id
              .split('-')[0]}`,
            description:
              `Withdrawal rejected`,
            trx,
          })

        } else {

          await trx('wallets')
            .where({
              user_id: withdrawal.user_id,
            })
            .increment(
              'balance',
              Number(withdrawal.amount)
            )
        }
      })

      return res.json({
        message:
          'Withdrawal rejected and refunded',
      })

    } catch (err) {

      return res.status(500).json({
        message:
          err.message || 'Rejection failed',
      })
    }
  }
)

module.exports = router
