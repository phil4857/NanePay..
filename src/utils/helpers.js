const { v4: uuidv4 } = require('uuid')

const generateTxRef = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = uuidv4().replace(/-/g, '').slice(0, 6).toUpperCase()
  return `NP-${date}-${rand}`
}

const FEES = {
  TRANSFER:      parseFloat(process.env.TRANSFER_FEE_RATE  || '0.01'),
  MERCHANT:      parseFloat(process.env.MERCHANT_FEE_RATE  || '0.008'),
  FOREX_MARKUP:  parseFloat(process.env.FOREX_MARKUP_PCT   || '0.02'),
  INVEST_SPREAD: parseFloat(process.env.INVESTMENT_SPREAD  || '0.015'),
}

const calcFee = (amount, type = 'TRANSFER') => {
  const rate = FEES[type] || FEES.TRANSFER
  const fee  = parseFloat((amount * rate).toFixed(2))
  const net  = parseFloat((amount - fee).toFixed(2))
  return { amount, rate, fee, net }
}

const MID_RATES = {
  USD: 129.5,
  GBP: 163.2,
  EUR: 140.8,
  TZS: 0.0495,
  UGX: 0.0338,
}

const getForexRate = (currency) => {
  const mid = MID_RATES[currency]
  if (!mid) return null
  const markup = FEES.FOREX_MARKUP
  return {
    currency,
    mid_rate:   mid,
    buy_rate:   parseFloat((mid * (1 + markup)).toFixed(4)),
    sell_rate:  parseFloat((mid * (1 - markup)).toFixed(4)),
    markup_pct: markup * 100,
  }
}

const INVESTMENT_PLANS = [
  { id: 'flexi',  name: 'Flexi Save',  apy: 6.5,  nanepay_spread: 1.5, min_amount: 500,  lock_days: 0,   risk: 'LOW'    },
  { id: '90day',  name: '90-Day Lock', apy: 9.0,  nanepay_spread: 1.5, min_amount: 2000, lock_days: 90,  risk: 'LOW'    },
  { id: 'growth', name: 'Growth Fund', apy: 12.5, nanepay_spread: 1.5, min_amount: 5000, lock_days: 180, risk: 'MEDIUM' },
]

const calcInvestmentReturn = (amount, apyPercent, days) => {
  const daily    = apyPercent / 100 / 365
  const earnings = parseFloat((amount * daily * days).toFixed(2))
  return { earnings, total: amount + earnings }
}

const normalizePhone = (phone) => {
  const cleaned = String(phone).replace(/\D/g, '')
  if (cleaned.startsWith('0'))   return '254' + cleaned.slice(1)
  if (cleaned.startsWith('254')) return cleaned
  return cleaned
}

const paginate = (query, page = 1, limit = 20) => {
  const safeLimit = Math.min(parseInt(limit), 100)
  const safePage  = Math.max(parseInt(page), 1)
  const offset    = (safePage - 1) * safeLimit
  return { limit: safeLimit, offset, page: safePage }
}

module.exports = {
  generateTxRef,
  calcFee,
  getForexRate,
  INVESTMENT_PLANS,
  calcInvestmentReturn,
  normalizePhone,
  paginate,
  FEES,
}
