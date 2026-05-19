const express = require('express')
const axios   = require('axios')
const db      = require('../config/database')
const logger  = require('../config/logger')
const { authenticate, requireActive } = require('../middleware/auth')
const { validate, rules }             = require('../middleware/validate')
const { auditLog }                    = require('../middleware/audit')
const { generateTxRef, FEES }         = require('../utils/helpers')

const router = express.Router()

// ── LIVE RATES CACHE ─────────────────────────────────────────
// Rates cached for 1 hour to avoid hitting API limits
let ratesCache = null
let cacheTime  = null
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

const fetchLiveRates = async () => {
  try {
    // Using ExchangeRate-API free tier (1500 requests/month free)
    // Sign up at: https://www.exchangerate-api.com
    const apiKey = process.env.EXCHANGE_RATE_API_KEY
    
    if (!apiKey) {
      // Fallback mock rates if no API key configured
      return {
        USD: 129.5,
        GBP: 163.2,
        EUR: 140.8,
        TZS: 0.0495,
        UGX: 0.0338,
        ZAR: 7.12,
        NGN: 0.089,
        source: 'mock',
        updated_at: new Date().toISOString(),
      }
    }

    const res = await axios.get(
      `https://v6.exchangerate-api.com/v6/${apiKey}/latest/KES`,
      { timeout: 10000 }
    )

    const rates = res.data.conversion_rates
    return {
      USD: parseFloat((1 / rates.USD).toFixed(4)),
      GBP: parseFloat((1 / rates.GBP).toFixed(4)),
      EUR: parseFloat((1 / rates.EUR).toFixed(4)),
      TZS: parseFloat((1 / rates.TZS).toFixed(6)),
      UGX: parseFloat((1 / rates.UGX).toFixed(6)),
      ZAR: parseFloat((1 / rates.ZAR).toFixed(4)),
      NGN: parseFloat((1 / rates.NGN).toFixed(6)),
      source: 'live',
      updated_at: new Date().toISOString(),
    }
  } catch (err) {
    logger.error('Failed to fetch live rates', { err: err.message })
    return null
  }
}

const getRates = async () => {
  const now = Date.now()
  if (ratesCache && cacheTime && (now - cacheTime) < CACHE_TTL) {
    return ratesCache
  }
  const fresh = await fetchLiveRates()
  if (fresh) {
    ratesCache = fresh
    cacheTime  = now
  }
  return ratesCache
}

const applyMarkup = (midRate, markup = FEES.FOREX_MARKUP) => ({
  buy_rate:  parseFloat((midRate * (1 + markup)).toFixed(4)),
  sell_rate: parseFloat((midRate * (1 - markup)).toFixed(4)),
  mid_rate:  midRate,
})

// ── GET /api/forex/rates ──────────────────────────────────────
router.get('/rates', authenticate, async (req, res) => {
  try {
    const midRates = await getRates()
    if (!midRates) {
      return res.status(503).json({ error: 'Rates temporarily unavailable' })
    }

    const currencies = [
      { code: 'USD', flag: '🇺🇸', name: 'US Dollar' },
      { code: 'GBP', flag: '🇬🇧', name: 'British Pound' },
      { code: 'EUR', flag: '🇪🇺', name: 'Euro' },
      { code: 'TZS', flag: '🇹🇿', name: 'Tanzanian Shilling' },
      { code: 'UGX', flag: '🇺🇬', name: 'Ugandan Shilling' },
      { code: 'ZAR', flag: '🇿🇦', name: 'South African Rand' },
      { code: 'NGN', flag: '🇳🇬', name: 'Nigerian Naira' },
    ]

    const rates = currencies.map(c => ({
      ...c,
      ...applyMarkup(midRates[c.code]),
      markup_pct:  FEES.FOREX_MARKUP * 100,
    }))

    res.json({
      rates,
      source:     midRates.source,
      updated_at: midRates.updated_at,
      base:       'KES',
    })
  } catch (err) {
    logger.error('Get rates failed', { err: err.message })
    res.status(500).json({ error: 'Failed to fetch rates' })
  }
})

// ── POST /api/forex/exchange ──────────────────────────────────
router.post('/exchange',
  authenticate, requireActive,
  rules.forex, validate,
  async (req, res) => {
    const userId    = req.user.userId
    const { currency, direction } = req.body
    const amount    = parseFloat(req.body.amount)

    try {
      const midRates = await getRates()
      if (!midRates) return res.status(503).json({ error: 'Rates unavailable. Try again.' })

      const midRate = midRates[currency]
      if (!midRate) return res.status(400).json({ error: 'Unsupported currency' })

      const { buy_rate, sell_rate } = applyMarkup(midRate)

      let kesAmount, foreignAmount, nanepay_margin

      if (direction === 'buy') {
        foreignAmount  = amount
        kesAmount      = parseFloat((amount * buy_rate).toFixed(2))
        nanepay_margin = parseFloat((amount * (buy_rate - midRate)).toFixed(2))
      } else {
        foreignAmount  = amount
        kesAmount      = parseFloat((amount * sell_rate).toFixed(2))
        nanepay_margin = parseFloat((amount * (midRate - sell_rate)).toFixed(2))
      }

      await db.transaction(async (trx) => {
        const wallet = await trx('wallets')
          .where({ user_id: userId }).forUpdate().first()

        if (direction === 'buy' && parseFloat(wallet.balance) < kesAmount) {
          throw new Error('INSUFFICIENT_BALANCE')
        }

        if (direction === 'buy') {
          await trx('wallets').where({ user_id: userId })
            .decrement('balance', kesAmount).update({ updated_at: new Date() })
        } else {
          await trx('wallets').where({ user_id: userId })
            .increment('balance', kesAmount).update({ updated_at: new Date() })
        }

        const reference = generateTxRef()

        await trx('transactions').insert({
          sender_id:      direction === 'buy'  ? userId : null,
          receiver_id:    direction === 'sell' ? userId : null,
          amount:         kesAmount,
          fee:            nanepay_margin,
          net_amount:     kesAmount,
          type:           direction === 'buy' ? 'FOREX_BUY' : 'FOREX_SELL',
          status:         'SUCCESSFUL',
          reference,
          forex_rate:     direction === 'buy' ? buy_rate : sell_rate,
          forex_currency: currency,
          description:    `${direction === 'buy' ? 'Bought' : 'Sold'} ${foreignAmount} ${currency} @ ${direction === 'buy' ? buy_rate : sell_rate}`,
          created_at:     new Date(),
        })

        await trx('fee_ledger').insert({
          amount:     nanepay_margin,
          type:       'FOREX_MARGIN',
          created_at: new Date(),
        })
      })

      await auditLog(req, 'FOREX_EXCHANGE', { currency, direction, amount, kesAmount })

      res.json({
        message:        'Exchange successful',
        direction,
        currency,
        foreign_amount: foreignAmount,
        kes_amount:     kesAmount,
        rate_used:      direction === 'buy' ? buy_rate : sell_rate,
        nanepay_margin,
      })
    } catch (err) {
      if (err.message === 'INSUFFICIENT_BALANCE') {
        return res.status(400).json({ error: 'Insufficient KES balance' })
      }
      logger.error('Forex exchange failed', { err: err.message })
      res.status(500).json({ error: 'Exchange failed. Please try again.' })
    }
  }
)

module.exports = router
