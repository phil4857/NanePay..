const express = require('express')
const db      = require('../config/database')
const logger  = require('../config/logger')
const { authenticate } = require('../middleware/auth')

const router = express.Router()
router.use(authenticate)

// ── GET /api/notifications ────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const notifications = await db('notifications')
      .where({ user_id: req.user.userId })
      .orderBy('created_at', 'desc')
      .limit(50)

    const unread = await db('notifications')
      .where({ user_id: req.user.userId, is_read: false })
      .count('id as count')
      .first()

    res.json({ notifications, unread_count: parseInt(unread.count) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications' })
  }
})

// ── PATCH /api/notifications/read-all ─────────────────────────
router.patch('/read-all', async (req, res) => {
  try {
    await db('notifications')
      .where({ user_id: req.user.userId, is_read: false })
      .update({ is_read: true })
    res.json({ message: 'All notifications marked as read' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notifications' })
  }
})

// ── PATCH /api/notifications/:id/read ─────────────────────────
router.patch('/:id/read', async (req, res) => {
  try {
    await db('notifications')
      .where({ id: req.params.id, user_id: req.user.userId })
      .update({ is_read: true })
    res.json({ message: 'Notification marked as read' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notification' })
  }
})

module.exports = router
