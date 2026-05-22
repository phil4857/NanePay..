// src/routes/auth.js  ← REPLACEMENT
const express  = require('express')
const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const { v4: uuid } = require('uuid')
const db       = require('../config/database')
const logger   = require('../config/logger')
const { authenticate }    = require('../middleware/auth')
const { authLimiter }     = require('../middleware/rateLimit')
const { validate, rules } = require('../middleware/validate')
const { auditLog }        = require('../middleware/audit')

const router = express.Router()

// ── Phone normalizer ───────────────────────────────────────────
// Accepts: 07XXXXXXXX, 01XXXXXXXX, +2547XXXXXXXX, 2547XXXXXXXX
function normalizePhone(raw) {
  if (!raw) return ''
  const cleaned = String(raw).replace(/\s+/g, '').replace(/^\+/, '')
  // 254XXXXXXXXX → 0XXXXXXXXX
  if (/^254[17]\d{8}$/.test(cleaned)) return '0' + cleaned.slice(3)
  // Already 07 or 01
  if (/^0[17]\d{8}$/.test(cleaned)) return cleaned
  return cleaned
}

// ── POST /api/auth/register ─────────────────────────────────────
router.post('/register',
  authLimiter, rules.register, validate,
  async (req, res) => {
    const { name, email, password, role = 'user', businessName, businessType } = req.body
    const phone = normalizePhone(req.body.phone)

    // Validate normalized phone
    if (!/^0[17]\d{8}$/.test(phone)) {
      return res.status(422).json({
        error: 'Enter a valid phone number: 07XXXXXXXX, 01XXXXXXXX, or +254XXXXXXXXX'
      })
    }

    try {
      const existing = await db('users')
        .where({ email }).orWhere({ phone }).first()

      if (existing) {
        const field = existing.email === email ? 'Email' : 'Phone number'
        return res.status(409).json({ error: `${field} already registered` })
      }

      const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12')
      const hashed = await bcrypt.hash(password, rounds)

      const { user, wallet } = await db.transaction(async trx => {
        const [user] = await trx('users').insert({
          name:       name.trim(),
          email:      email.toLowerCase().trim(),
          phone,
          password:   hashed,
          role,
          is_active:  true,
          is_banned:  false,
          created_at: new Date(),
          updated_at: new Date(),
        }).returning(['id', 'name', 'email', 'phone', 'role', 'created_at'])

        const [wallet] = await trx('wallets').insert({
          user_id:           user.id,
          available_balance: 0.00,
          locked_balance:    0.00,
          total_balance:     0.00,
          currency:          'KES',
          created_at:        new Date(),
          updated_at:        new Date(),
        }).returning(['id', 'available_balance', 'locked_balance', 'total_balance', 'currency'])

        // If merchant — create pending merchant record
        if (role === 'merchant' && businessName) {
          await trx('merchants').insert({
            id:            uuid(),
            user_id:       user.id,
            business_name: businessName,
            business_type: businessType || null,
            status:        'pending',
            balance:       0,
            total_revenue: 0,
            rating:        0,
            rating_count:  0,
            created_at:    new Date(),
            updated_at:    new Date(),
          })
        }

        return { user, wallet }
      })

      const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      )

      logger.info('New user registered', { userId: user.id })

      return res.status(201).json({
        message: 'Account created successfully',
        token,
        user,
        wallet,
      })

    } catch (err) {
      logger.error('Registration failed', { err: err.message, stack: err.stack })

      if (err.code === '23505') {
        return res.status(409).json({ error: 'Email or phone already registered' })
      }

      return res.status(500).json({
        error:  'Registration failed. Please try again.',
        reason: process.env.NODE_ENV !== 'production' ? err.message : undefined,
      })
    }
  }
)

// ── POST /api/auth/login ────────────────────────────────────────
router.post('/login',
  authLimiter, rules.login, validate,
  async (req, res) => {
    const { email, password } = req.body

    try {
      const user = await db('users')
        .where({ email: email.toLowerCase().trim() })
        .first()

      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' })
      }
      if (!user.is_active || user.is_banned) {
        return res.status(403).json({ error: 'Account suspended. Contact support.' })
      }

      const match = await bcrypt.compare(password, user.password)
      if (!match) {
        return res.status(401).json({ error: 'Invalid email or password' })
      }

      await db('users').where({ id: user.id }).update({ last_login: new Date() })

      const wallet = await db('wallets').where({ user_id: user.id }).first()

      const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      )

      logger.info('User logged in', { userId: user.id })

      return res.json({
        message: 'Login successful',
        token,
        user: {
          id:    user.id,
          name:  user.name,
          email: user.email,
          phone: user.phone,
          role:  user.role,
        },
        wallet: {
          balance:           parseFloat(wallet?.available_balance || '0'),
          locked_balance:    parseFloat(wallet?.locked_balance    || '0'),
          total_balance:     parseFloat(wallet?.total_balance     || '0'),
          currency:          wallet?.currency || 'KES',
        },
      })

    } catch (err) {
      logger.error('Login failed', { err: err.message })
      return res.status(500).json({
        error:  'Login failed. Please try again.',
        reason: process.env.NODE_ENV !== 'production' ? err.message : undefined,
      })
    }
  }
)

// ── GET /api/auth/me ────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await db('users')
      .where({ id: req.user.userId })
      .select('id', 'name', 'email', 'phone', 'role', 'is_active', 'created_at')
      .first()

    if (!user) return res.status(404).json({ error: 'User not found' })

    const wallet = await db('wallets')
      .where({ user_id: user.id })
      .select(
        'id', 'available_balance', 'locked_balance',
        'total_balance', 'currency'
      )
      .first()

    return res.json({
      user,
      wallet: {
        balance:        parseFloat(wallet?.available_balance || '0'),
        locked_balance: parseFloat(wallet?.locked_balance    || '0'),
        total_balance:  parseFloat(wallet?.total_balance     || '0'),
        currency:       wallet?.currency || 'KES',
      },
    })
  } catch (err) {
    logger.error('Get me failed', { err: err.message })
    return res.status(500).json({ error: 'Failed to fetch profile' })
  }
})

// ── POST /api/auth/logout ───────────────────────────────────────
router.post('/logout', authenticate, async (req, res) => {
  await auditLog(req, 'LOGOUT', {})
  return res.json({ message: 'Logged out successfully' })
})

// ── POST /api/auth/forgot-password ─────────────────────────────
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Email is required' })

  try {
    const user = await db('users').where({ email: email.toLowerCase().trim() }).first()
    if (user) {
      const token   = uuid()
      const expires = new Date(Date.now() + 3600000) // 1 hour
      await db('password_resets').insert({
        email:      user.email,
        token,
        used:       false,
        expires_at: expires,
        created_at: new Date(),
      })
      // TODO: send reset email
      logger.info(`[DEV] Password reset token for ${email}: ${token}`)
    }
    // Always return success — prevent email enumeration
    return res.json({
      message: 'If that email exists, a reset link has been sent.'
    })
  } catch (err) {
    logger.error('Forgot password failed', { err: err.message })
    return res.status(500).json({ error: 'Request failed. Please try again.' })
  }
})

// ── POST /api/auth/reset-password ──────────────────────────────
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body

  if (!token || !password) {
    return res.status(400).json({ error: 'Token and password are required' })
  }
  if (password.length < 8) {
    return res.status(422).json({ error: 'Password must be at least 8 characters' })
  }

  try {
    const reset = await db('password_resets')
      .where({ token, used: false })
      .where('expires_at', '>', new Date())
      .first()

    if (!reset) {
      return res.status(400).json({ error: 'Invalid or expired reset token' })
    }

    const hashed = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'))

    await db.transaction(async trx => {
      await trx('users').where({ email: reset.email }).update({
        password:   hashed,
        updated_at: new Date(),
      })
      await trx('password_resets').where({ token }).update({ used: true })
    })

    return res.json({ message: 'Password reset successful. Please sign in.' })

  } catch (err) {
    logger.error('Reset password failed', { err: err.message })
    return res.status(500).json({ error: 'Reset failed. Please try again.' })
  }
})

module.exports = router
