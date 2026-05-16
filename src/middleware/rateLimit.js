const rateLimit = require('express-rate-limit')

const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max:      parseInt(process.env.RATE_LIMIT_MAX || '100'),
  message:  { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders:   false,
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10'),
  message:  { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders:   false,
})

const mpesaLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max:      30,
  message:  { error: 'Too many M-Pesa requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders:   false,
})

const transferLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max:      20,
  message:  { error: 'Transfer limit reached. Try again in an hour.' },
  standardHeaders: true,
  legacyHeaders:   false,
})

module.exports = { apiLimiter, authLimiter, mpesaLimiter, transferLimiter }
