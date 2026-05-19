const express  = require('express')
const bcrypt   = require('bcryptjs')
const crypto   = require('crypto')
const db       = require('../config/database')
const logger   = require('../config/logger')
const { authLimiter } = require('../middleware/rateLimit')

const router = express.Router()

// ── POST /api/auth/forgot-password ────────────────────────────
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Email is required' })

  try {
    const user = await db('users').where({ email: email.toLowerCase().trim() }).first()

    // Always return success even if user not found (security)
    if (!user) {
      return res.json({ message: 'If that email exists, a reset link has been sent.' })
    }

    const token     = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    await db('password_resets').insert({
      user_id:    user.id,
      token,
      used:       false,
      expires_at: expiresAt,
      created_at: new Date(),
    })

    // In production send email here
    // For now log the token
    logger.info('Password reset token generated', {
      userId: user.id,
      token,
      reset_url: `${process.env.FRONTEND_URL}/auth/reset-password?token=${token}`,
    })

    res.json({
      message: 'Password reset link sent. Check your email.',
      // Remove this in production:
      dev_token: process.env.NODE_ENV !== 'production' ? token : undefined,
    })
  } catch (err) {
    logger.error('Forgot password failed', { err: err.message })
    res.status(500).json({ error: 'Failed to process request' })
  }
})

// ── POST /api/auth/reset-password ─────────────────────────────
router.post('/reset-password', authLimiter, async (req, res) => {
  const { token, password } = req.body
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' })
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
  if (!/\d/.test(password)) return res.status(400).json({ error: 'Password must contain at least one number' })

  try {
    const reset = await db('password_resets')
      .where({ token, used: false })
      .where('expires_at', '>', new Date())
      .first()

    if (!reset) return res.status(400).json({ error: 'Invalid or expired reset token' })

    const hashed = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'))

    await db.transaction(async (trx) => {
      await trx('users').where({ id: reset.user_id }).update({ password: hashed })
      await trx('password_resets').where({ id: reset.id }).update({ used: true })
    })

    logger.info('Password reset successful', { userId: reset.user_id })
    res.json({ message: 'Password reset successfully. You can now login.' })
  } catch (err) {
    logger.error('Reset password failed', { err: err.message })
    res.status(500).json({ error: 'Failed to reset password' })
  }
})

module.exports = router
