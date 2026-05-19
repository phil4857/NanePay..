require('dotenv').config()
const express = require('express')
const helmet  = require('helmet')
const cors    = require('cors')
const morgan  = require('morgan')
const logger  = require('./config/logger')
const { apiLimiter } = require('./middleware/rateLimit')

const app = express()

app.set('trust proxy', 1)
app.use(helmet())
app.use(cors({
  origin: [
    'https://nane-pay-avya.vercel.app',
    process.env.FRONTEND_URL,
    'http://localhost:3000',
  ],
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}))
app.use(express.json({ limit: '10kb' }))
app.use(express.urlencoded({ extended: true }))
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }))
app.use('/api', apiLimiter)

app.get('/health', (req, res) => {
  res.json({
    status:  'ok',
    service: 'NanePay API',
    version: '1.0.0',
    time:    new Date().toISOString(),
  })
})

app.use('/api/auth',         require('./routes/auth'))
app.use('/api/wallet',       require('./routes/wallet'))
app.use('/api/transactions', require('./routes/transactions'))
app.use('/api/mpesa',        require('./routes/mpesa'))
app.use('/api/forex',        require('./routes/forex'))
app.use('/api/invest',       require('./routes/invest'))
app.use('/api/merchant',     require('./routes/merchant'))
app.use('/api/admin',        require('./routes/admin'))
app.use('/api/bills',        require('./routes/bills'))

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` })
})

app.use((err, req, res, next) => {
  logger.error('Unhandled error', { err: err.message, path: req.path })
  res.status(500).json({ error: 'Something went wrong. Please try again.' })
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  logger.info(`🚀 NanePay API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`)
})

module.exports = app
