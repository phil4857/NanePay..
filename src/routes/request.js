const express = require('express')
const db      = require('../config/database')
const logger  = require('../config/logger')

const authMiddleware = require('../middleware/auth')

const authenticate =
  typeof authMiddleware === 'function'
    ? authMiddleware
    : authMiddleware.authenticate || authMiddleware.auth

const requireActive =
  authMiddleware.requireActive ||
  ((req, res, next) => next())

const { normalizePhone } = require('../utils/helpers')
const { notify }         = require('../services/notifications')

const router = express.Router()

router.use(authenticate, requireActive)

// ── POST /api/request — request money ────────────────────────
router.post('/', async (req, res) => {
  const requesterId = req.user.userId || req.user.id

  const { phone, amount, note } = req.body

  if (!phone || !amount) {
    return res.status(400).json({
      error: 'phone and amount are required',
    })
  }

  if (parseFloat(amount) < 1) {
    return res.status(400).json({
      error: 'Minimum request is KES 1',
    })
  }

  try {
    const requester = await db('users')
      .where({ id: requesterId })
      .first()

    if (!requester) {
      return res.status(404).json({
        error: 'Requester not found',
      })
    }

    const target = await db('users')
      .where({ phone: normalizePhone(phone) })
      .first()

    if (!target) {
      return res.status(404).json({
        error: 'User not found with that phone number',
      })
    }

    if (target.id === requesterId) {
      return res.status(400).json({
        error: 'Cannot request money from yourself',
      })
    }

    await notify(target.id, {
      title: `Money Request from ${requester.name}`,
      body: `${requester.name} is requesting KES ${parseFloat(amount).toLocaleString()}${note ? ` — ${note}` : ''}`,
      type: 'PAYMENT',
      metadata: {
        type: 'MONEY_REQUEST',
        requester_id: requesterId,
        requester_name: requester.name,
        requester_phone: requester.phone,
        amount: parseFloat(amount),
        note: note || null,
      },
    })

    return res.json({
      message: `Money request sent to ${target.name}`,
      requested_from: {
        name: target.name,
        phone: target.phone,
      },
      amount: parseFloat(amount),
      note: note || null,
    })

  } catch (err) {
    logger.error('Money request failed', {
      error: err.message,
    })

    return res.status(500).json({
      error: 'Failed to send money request',
    })
  }
})

module.exports = router
