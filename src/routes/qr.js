const express = require('express')
const db      = require('../config/database')
const { authenticate, requireActive } = require('../middleware/auth')
const { v4: uuidv4 }                  = require('uuid')

const router = express.Router()
router.use(authenticate, requireActive)

// ── POST /api/qr/generate — generate QR payment link ──────────
router.post('/generate', async (req, res) => {
  const userId = req.user.userId
  const { amount, description } = req.body

  try {
    const user = await db('users').where({ id: userId }).select('name', 'phone').first()
    const qr_id = uuidv4().slice(0, 12).toUpperCase()

    const qr_data = {
      qr_id,
      type:        'NANEPAY_PAYMENT',
      recipient:   { name: user.name, phone: user.phone, user_id: userId },
      amount:      amount ? parseFloat(amount) : null,
      description: description || null,
      url:         `${process.env.FRONTEND_URL}/pay/${qr_id}`,
      created_at:  new Date().toISOString(),
    }

    // Store QR temporarily (24 hours)
    await db('notifications').insert({
      user_id:    userId,
      title:      'QR Payment Generated',
      body:       `QR code ${qr_id} created${amount ? ` for KES ${amount}` : ''}`,
      type:       'PAYMENT',
      metadata:   JSON.stringify(qr_data),
      created_at: new Date(),
    })

    res.json({
      qr_id,
      qr_data:    JSON.stringify(qr_data),
      qr_url:     `${process.env.FRONTEND_URL}/pay/${qr_id}`,
      amount:     amount || null,
      description: description || null,
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' })
  }
})

// ── GET /api/qr/:qr_id — get QR payment info ─────────────────
router.get('/:qr_id', async (req, res) => {
  try {
    const qr_notif = await db('notifications')
      .whereRaw("metadata->>'qr_id' = ?", [req.params.qr_id])
      .first()

    if (!qr_notif) return res.status(404).json({ error: 'QR code not found or expired' })

    const qr_data = JSON.parse(qr_notif.metadata)
    res.json({ qr_data })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch QR data' })
  }
})

module.exports = router
