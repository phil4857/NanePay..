// src/app.js  ← REPLACEMENT
const express    = require('express')
const cors       = require('cors')
const helmet     = require('helmet')
const morgan     = require('morgan')
const rateLimit  = require('express-rate-limit')
require('dotenv').config()

const app = express()

// ── Security middleware ─────────────────────────────────────────
app.use(helmet())
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    /\.vercel\.app$/,
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}))

// ── Rate limiting ───────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  max:      parseInt(process.env.RATE_LIMIT_MAX)        || 100,
  message:  { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders:   false,
})
const authLimiter = rateLimit({
  windowMs: 900000,
  max:      parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  message:  { error: 'Too many auth attempts, please try again in 15 minutes.' },
})
app.use(globalLimiter)

// ── Body parsing ────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }))
app.use(express.urlencoded({ extended: true }))
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))

// ── Routes ──────────────────────────────────────────────────────
app.use('/api/auth',          authLimiter, require('./routes/auth'))
app.use('/api/users',         require('./routes/users'))
app.use('/api/wallet',        require('./routes/wallet'))
app.use('/api/transactions',  require('./routes/transactions'))
app.use('/api/merchants',     require('./routes/merchants'))
app.use('/api/packages',      require('./routes/packages'))
app.use('/api/subscriptions', require('./routes/subscriptions'))
app.use('/api/mpesa',         require('./routes/mpesa'))
app.use('/api/withdrawals',   require('./routes/withdrawals'))
app.use('/api/notifications', require('./routes/notifications'))
app.use('/api/admin',         require('./routes/admin'))

// ── Health check ────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: process.env.NODE_ENV })
})

// ── 404 ─────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' })
})

// ── Global error handler ────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  })
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log(`🚀 NanePay API running on port ${PORT} [${process.env.NODE_ENV}]`))

module.exports = app
