const express = require('express')
const db      = require('../config/database')
const logger  = require('../config/logger')
const { authenticate, requireActive } = require('../middleware/auth')
const { validate, rules }             = require('../middleware/validate')
const { auditLog }                    = require('../middleware/audit')
const { generateTxRef, getForexRate } = require('../utils/helpers')

const router = express.Router()
router.use(authenticate, requireActive)

router.get('/rates', (req, res) => {
  const currencies = ['USD', 'GBP', 'EUR', 'TZS', 'UGX']
  const rates = currencies.map(c => ({
    ...getForexRate(c),
    flag: { USD: '🇺🇸', GBP: '🇬🇧', EUR: '🇪🇺', TZS: '🇹🇿', UGX: '🇺🇬' }[c],
    name: { USD: 'US Dollar', GBP: 'British Pound', EUR: 'Euro', TZS: 'Tanzanian Shilling', UGX: 'Ugandan Shilling' }[c],
  }))
  res.json({ rates, updated_at: new Date() })
})

router.post('/exchange', rules.forex, validate, async (req, res) => {
  const userId    = req.user.userId
  const { currency, direction } = req.body
  const amount    = parseFloat(req.body.amount)
  const rate      = getForexRate(currency)
  if (!rate) return res.status(400).json({ error: 'Unsupported currency' })

  try {
    let kesAmount, foreignAmount, nanepay_margin

    if (direction === 'buy') {
      foreignAmount  = amount
      kesAmount      = parseFloat((amount * rate.buy_rate).toFixed(2))
      nanepay_margin = parseFloat((kesAmount - amount * rate.mid_rate).toFixed(2))
    } else {
      foreignAmount  = amount
      kesAmount      = parseFloat((amount * rate.sell_rate).toFixed(2))
      nanepay_margin = parseFloat((amount * rate.mid_rate - kesAmount).toFixed(2))
    }

    await db.transaction(async (trx) => {
      const wallet = await trx('wallets').where({ user_id: userId }).forUpdate().first()
      if (direction === 'buy' && parseFloat(wallet.balance) < kesAmount) {
        throw new Error('INSUFFICIENT_BALANCE')
      }

      if (direction === 'buy') {
        await trx('wallets').where({ user_id: userId }).decrement('balance', kesAmount).update({ updated_at: new Date() })
      } else {
        await trx('wallets').where({ user_id: userId }).increment('balance', kesAmount).update({ updated_at: new Date() })
      }

      await trx('transactions').insert({
        sender_id:      direction === 'buy'  ? userId : null,
        receiver_id:    direction === 'sell' ? userId : null,
        amount:         kesAmount,
        fee:            nanepay_margin,
        net_amount:     kesAmount,
        type:           direction === 'buy' ? 'FOREX_BUY' : 'FOREX_SELL',
        status:         'SUCCESSFUL',
        reference:      generateTxRef(),
        forex_rate:     direction === 'buy' ? rate.buy_rate : rate.sell_rate,
        forex_currency: currency,
        description:    `${direction === 'buy' ? 'Bought' : 'Sold'} ${foreignAmount} ${currency}`,
        created_at:     new Date(),
      })

      await trx('fee_ledger').insert({ amount: nanepay_margin, type: 'FOREX_MARGIN', created_at: new Date() })
    })

    res.json({ message: 'Exchange successful', direction, currency, foreign_amount: foreignAmount, kes_amount: kesAmount, rate_used: direction === 'buy' ? rate.buy_rate : rate.sell_rate })
  } catch (err) {
    if (err.message === 'INSUFFICIENT_BALANCE') return res.status(400).json({ error: 'Insufficient KES balance' })
    logger.error('Forex failed', { err: err.message })
    res.status(500).json({ error: 'Exchange failed. Please try again.' })
  }
})

module.exports = router
