// src/utils/helpers.js  ← NEW FILE
const { v4: uuid } = require('uuid')

// ── Transaction reference generator ──────────────────────────
const generateTxRef = (prefix = 'NP') => {
  return `${prefix}-${uuid().split('-')[0].toUpperCase()}-${Date.now().toString(36).toUpperCase()}`
}

// ── Platform fee constants ────────────────────────────────────
const FEES = {
  TRANSFER_FEE:    parseFloat(process.env.TRANSFER_FEE_RATE    || '0.01'),
  WITHDRAWAL_FEE:  parseFloat(process.env.WITHDRAWAL_FEE_RATE  || '0.01'),
  WIFI_FEE:        parseFloat(process.env.WIFI_FEE_RATE        || '0.01'),
  FOREX_MARKUP:    parseFloat(process.env.FOREX_MARKUP         || '0.02'),
  INVESTMENT_SPREAD: parseFloat(process.env.INVESTMENT_SPREAD  || '0.015'),
}

// ── Investment plans ──────────────────────────────────────────
const INVESTMENT_PLANS = [
  {
    id:          'flexible',
    name:        'Flexible',
    apy:         0.05,
    min_amount:  100,
    lock_days:   0,
    description: 'No lock-in, withdraw anytime. 5% annual return.',
  },
  {
    id:          'starter',
    name:        'Starter',
    apy:         0.08,
    min_amount:  500,
    lock_days:   30,
    description: 'Low risk, 8% annual return. Locked for 30 days.',
  },
  {
    id:          'growth',
    name:        'Growth',
    apy:         0.15,
    min_amount:  2000,
    lock_days:   90,
    description: 'Medium risk, 15% annual return. Locked for 90 days.',
  },
  {
    id:          'premium',
    name:        'Premium',
    apy:         0.25,
    min_amount:  10000,
    lock_days:   180,
    description: 'Higher return, 25% annual return. Locked for 180 days.',
  },
]

// ── Investment return calculator ──────────────────────────────
const calcInvestmentReturn = (principal, apy, days) => {
  const earnings = parseFloat((principal * apy * (days / 365)).toFixed(2))
  const total    = parseFloat((principal + earnings).toFixed(2))
  return { earnings, total }
}

module.exports = {
  generateTxRef,
  FEES,
  INVESTMENT_PLANS,
  calcInvestmentReturn,
}
