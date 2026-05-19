const express  = require('express')
const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const db       = require('../config/database')
const logger   = require('../config/logger')
const { authenticate }    = require('../middleware/auth')
const { authLimiter }     = require('../middleware/rateLimit')
const { validate, rules } = require('../middleware/validate')
const { auditLog }        = require('../middleware/audit')
const { normalizePhone }  = require('../utils/helpers')

const router = express.Router()

router.post('/register',
  authLimiter, rules.register, validate,
  async (req, res) => {
    const { name, email, password } = req.body
    const phone = normalizePhone(req.body.phone)

    try {
      const existing = await db('users')
        .where({ email }).orWhere({ phone }).first()

      if (existing) {
        const field = existing.email === email ? 'Email' : 'Phone number'
        return res.status(409).json({ error: `${field} already registered` })
      }

      const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12')
      const hashed = await bcrypt.hash(password, rounds)

      const { user, wallet } = await db.transaction(async (trx) => {
        const [user] = await trx('users').insert({
          name:       name.trim(),
          email:      email.toLowerCase().trim(),
          phone,
          password:   hashed,
          role:       'user',
          is_active:  true,
          created_at: new Date(),
        }).returning(['id', 'name', 'email', 'phone', 'role', 'created_at'])

        const [wallet] = await trx('wallets').insert({
          user_id:    user.id,
          balance:    0.00,
          currency:   'KES',
          updated_at: new Date(),
        }).returning(['id', 'balance', 'currency'])

        return { user, wallet }
      })

      const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      )

      logger.info('New user registered', { userId: user.id })

      res.status(201).json({
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
      if (err.message.includes('JWT')) {
        return res.status(500).json({ error: 'Server configuration error. Contact support.' })
      }

      res.status(500).json({
        error:  'Registration failed. Please try again.',
        reason: err.message,
      })
    }
  }
)

router.post('/login',
  authLimiter, rules.login, validate,
  async (req, res) => {
    const { email, password } = req.body

    try {
      const user = await db('users')
        .where({ email: email.toLowerCase().trim() }).first()

      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' })
      }
      if (!user.is_active) {
        return res.status(403).json({ error: 'Account suspended. Contact support.' })
      }

      const match = await bcrypt.compare(password, user.password)
      if (!match) {
        return res.status(401).json({ error: 'Invalid email or password' })
      }

      const wallet = await db('wallets').where({ user_id: user.id }).first()

      const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      )

      logger.info('User logged in', { userId: user.id })

      res.json({
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
          balance:  parseFloat(wallet.balance),
          currency: wallet.currency,
        },
      })
    } catch (err) {
      logger.error('Login failed', { err: err.message })
      res.status(500).json({
        error:  'Login failed. Please try again.',
        reason: err.message,
      })
    }
  }
)

router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await db('users')
      .where({ id: req.user.userId })
      .select('id', 'name', 'email', 'phone', 'role', 'is_active', 'created_at')
      .first()

    if (!user) return res.status(404).json({ error: 'User not found' })

    const wallet = await db('wallets')
      .where({ user_id: user.id })
      .select('balance', 'currency', 'investment_balance')
      .first()

    res.json({ user, wallet })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' })
  }
})

router.post('/logout', authenticate, async (req, res) => {
  await auditLog(req, 'LOGOUT', {})
  res.json({ message: 'Logged out successfully' })
})

module.exports = router
