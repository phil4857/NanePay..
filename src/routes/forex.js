// src/routes/forex.js  ← REPLACEMENT
const express = require('express')
const axios   = require('axios')
const db      = require('../db')
const logger  = require('../config/logger')
const { authenticate, requireRole } = require('../middleware/auth')

const router = express.Router()

// ── FEES ─────────────────────────────────────────────────────
const FOREX_MARKUP = parseFloat(process.env.FOREX_MARKUP || '0.02') // 2%

// ── LIVE RATES CACHE ──────────────────────────────────────────
let ratesCache = null
let cacheTime  = null
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

const fetchLiveRates = async () => {
  try {
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
        source:     'mock',
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
      source:     'live',
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

const applyMarkup = (midRate) => ({
  buy_rate:  parseFloat((midRate * (1 + FOREX_MARKUP)).toFixed(4)),
  sell_rate: parseFloat((midRate * (1 - FOREX_MARKUP)).toFixed(4)),
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
      markup_pct: FOREX_MARKUP * 100,
    }))

    return res.json({
      rates,
      source:     midRates.source,
      updated_at: midRates.updated_at,
      base:       'KES',
    })
  } catch (err) {
    logger.error('Get rates failed', { err: err.message })
    return res.status(500).json({ error: 'Failed to fetch rates' })
  }
})

// ── POST /api/forex/exchange ──────────────────────────────────
router.post('/exchange', authenticate, async (req, res) => {
  const { currency, direction } = req.body
  const amount = parseFloat(req.body.amount)

  if (!currency || !direction || !amount || amount <= 0) {
    return res.status(400).json({ error: 'currency, direction, and amount are required' })
  }
  if (!['buy', 'sell'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be buy or sell' })
  }

  try {
    const midRates = await getRates()
    if (!midRates) {
      return res.status(503).json({ error: 'Rates unavailable. Try again.' })
    }

    const midRate = midRates[currency]
    if (!midRate) {
      return res.status(400).json({ error: `Unsupported currency: ${currency}` })
    }

    const { buy_rate, sell_rate } = applyMarkup(midRate)

    let kesAmount, foreignAmount, margin

    if (direction === 'buy') {
      foreignAmount = amount
      kesAmount     = parseFloat((amount * buy_rate).toFixed(2))
      margin        = parseFloat((amount * (buy_rate - midRate)).toFixed(2))
    } else {
      foreignAmount = amount
      kesAmount     = parseFloat((amount * sell_rate).toFixed(2))
      margin        = parseFloat((amount * (midRate - sell_rate)).toFixed(2))
    }

    await db.transaction(async trx => {
      // Lock wallet
      const wallet = await trx('wallets')
        .where({ user_id: req.user.id })
        .forUpdate()
        .first()

      if (!wallet) throw new Error('WALLET_NOT_FOUND')

      if (direction === 'buy' && parseFloat(wallet.available_balance) < kesAmount) {
        throw new Error('INSUFFICIENT_BALANCE')
      }

      // Update wallet
      if (direction === 'buy') {
        await trx('wallets').where({ user_id: req.user.id })
          .decrement('available_balance', kesAmount)
          .decrement('total_balance',     kesAmount)
      } else {
        await trx('wallets').where({ user_id: req.user.id })
          .increment('available_balance', kesAmount)
          .increment('total_balance',     kesAmount)
      }
      await trx('wallets').where({ user_id: req.user.id }).update({ updated_at: new Date() })

      // Record transaction
      const { v4: uuid } = require('uuid')
      const ref = `FX-${uuid().split('-')[0].toUpperCase()}`

      await trx('transactions').insert({
        id:          uuid(),
        user_id:     req.user.id,
        type:        direction === 'buy' ? 'forex_buy' : 'forex_sell',
        amount:      kesAmount,
        fee:         margin,
        net_amount:  kesAmount,
        status:      'completed',
        reference:   ref,
        description: `${direction === 'buy' ? 'Bought' : 'Sold'} ${foreignAmount} ${currency} @ ${direction === 'buy' ? buy_rate : sell_rate}`,
        metadata:    JSON.stringify({ currency, direction, foreign_amount: foreignAmount, rate: direction === 'buy' ? buy_rate : sell_rate }),
        created_at:  new Date(),
        updated_at:  new Date(),
      })

      // Platform revenue
      await trx('platform_revenue').insert({
        id:          uuid(),
        source:      'merchant_fee',
        amount:      margin,
        fee_rate:    FOREX_MARKUP,
        payer_id:    req.user.id,
        description: `Forex margin — ${direction} ${foreignAmount} ${currency}`,
        created_at:  new Date(),
        updated_at:  new Date(),
      })
    })

    return res.json({
      message:        'Exchange successful',
      direction,
      currency,
      foreign_amount: foreignAmount,
      kes_amount:     kesAmount,
      rate_used:      direction === 'buy' ? buy_rate : sell_rate,
      margin,
    })

  } catch (err) {
    if (err.message === 'INSUFFICIENT_BALANCE') {
      return res.status(400).json({ error: 'Insufficient KES balance' })
    }
    if (err.message === 'WALLET_NOT_FOUND') {
      return res.status(404).json({ error: 'Wallet not found' })
    }
    logger.error('Forex exchange failed', { err: err.message })
    return res.status(500).json({ error: 'Exchange failed. Please try again.' })
  }
})

module.exports = router
