// src/routes/bills.js  ← REPLACEMENT
const express  = require('express')
const { v4: uuid } = require('uuid')
const db       = require('../db')
const logger   = require('../config/logger')
const { authenticate } = require('../middleware/auth')

const router = express.Router()

// ── SUPPORTED BILLERS ─────────────────────────────────────────
const BILLERS = [
  { id: 'kplc_prepaid',  name: 'KPLC Prepaid',   category: 'electricity', icon: '⚡', paybill: '888880' },
  { id: 'kplc_postpaid', name: 'KPLC Postpaid',  category: 'electricity', icon: '⚡', paybill: '888882' },
  { id: 'nairobi_water', name: 'Nairobi Water',  category: 'water',       icon: '💧', paybill: '444700' },
  { id: 'dstv',          name: 'DStv',            category: 'tv',          icon: '📺', paybill: '444900' },
  { id: 'gotv',          name: 'GOtv',            category: 'tv',          icon: '📺', paybill: '444950' },
  { id: 'zuku',          name: 'Zuku',            category: 'internet',    icon: '🌐', paybill: '222222' },
  { id: 'safaricom_home',name: 'Safaricom Home',  category: 'internet',    icon: '🌐', paybill: '777700' },
  { id: 'nhif',          name: 'NHIF',            category: 'insurance',   icon: '🏥', paybill: '200999' },
  { id: 'nssf',          name: 'NSSF',            category: 'pension',     icon: '🏦', paybill: '333200' },
  { id: 'nairobi_rates', name: 'Nairobi County',  category: 'county',      icon: '🏛️', paybill: '222100' },
]

// ── GET /api/bills/billers ────────────────────────────────────
router.get('/billers', authenticate, (req, res) => {
  const { category } = req.query
  const filtered = category
    ? BILLERS.filter(b => b.category === category)
    : BILLERS

  const categories = [...new Set(BILLERS.map(b => b.category))]
  return res.json({ billers: filtered, categories })
})

// ── GET /api/bills/history ────────────────────────────────────
router.get('/history', authenticate, async (req, res) => {
  try {
    const bills = await db('transactions')
      .where({ user_id: req.user.id, type: 'bill_payment' })
      .orderBy('created_at', 'desc')
      .limit(50)

    return res.json({ bills })
  } catch (err) {
    logger.error('Failed to fetch bill history', { err: err.message })
    return res.status(500).json({ error: 'Failed to fetch bill history' })
  }
})

// ── POST /api/bills/pay ───────────────────────────────────────
router.post('/pay', authenticate, async (req, res) => {
  const { billerId, accountNumber, amount } = req.body

  if (!billerId || !accountNumber || !amount || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'billerId, accountNumber, and amount are required' })
  }

  const biller = BILLERS.find(b => b.id === billerId)
  if (!biller) {
    return res.status(400).json({ error: `Unsupported biller: ${billerId}` })
  }

  const amt = parseFloat(amount)

  try {
    await db.transaction(async trx => {
      // Lock and check wallet
      const wallet = await trx('wallets')
        .where({ user_id: req.user.id })
        .forUpdate()
        .first()

      if (!wallet) throw new Error('WALLET_NOT_FOUND')
      if (parseFloat(wallet.available_balance) < amt) throw new Error('INSUFFICIENT_BALANCE')

      // Deduct from wallet
      await trx('wallets').where({ user_id: req.user.id }).update({
        available_balance: db.raw('available_balance - ?', [amt]),
        total_balance:     db.raw('total_balance - ?', [amt]),
        updated_at:        new Date(),
      })

      // Record transaction
      const ref = `BILL-${uuid().split('-')[0].toUpperCase()}`
      await trx('transactions').insert({
        id:          uuid(),
        user_id:     req.user.id,
        type:        'bill_payment',
        amount:      amt,
        fee:         0,
        net_amount:  amt,
        status:      'completed',
        reference:   ref,
        description: `${biller.name} — Account: ${accountNumber}`,
        metadata:    JSON.stringify({
          biller_id:      billerId,
          biller_name:    biller.name,
          paybill:        biller.paybill,
          account_number: accountNumber,
          category:       biller.category,
        }),
        created_at:  new Date(),
        updated_at:  new Date(),
      })

      // Ledger entry
      await trx('ledger').insert({
        id:             uuid(),
        user_id:        req.user.id,
        wallet_id:      wallet.id,
        type:           'wifi_purchase', // reusing closest type
        amount:         amt,
        balance_before: parseFloat(wallet.available_balance),
        balance_after:  parseFloat(wallet.available_balance) - amt,
        reference:      `LED-${ref}`,
        description:    `Bill payment — ${biller.name}`,
        status:         'completed',
        metadata:       JSON.stringify({ billerId, accountNumber }),
        created_at:     new Date(),
        updated_at:     new Date(),
      })

      // Notification
      await trx('notifications').insert({
        id:         uuid(),
        user_id:    req.user.id,
        title:      'Bill Payment Successful',
        body:       `KES ${amt} paid to ${biller.name} for account ${accountNumber}`,
        type:       'payment',
        data:       JSON.stringify({ billerId, amount: amt, reference: ref }),
        created_at: new Date(),
        updated_at: new Date(),
      })
    })

    return res.json({
      message:        'Bill payment successful',
      biller:         biller.name,
      account_number: accountNumber,
      amount:         amt,
    })

  } catch (err) {
    if (err.message === 'INSUFFICIENT_BALANCE') {
      return res.status(400).json({ error: 'Insufficient balance' })
    }
    if (err.message === 'WALLET_NOT_FOUND') {
      return res.status(404).json({ error: 'Wallet not found' })
    }
    logger.error('Bill payment failed', { err: err.message })
    return res.status(500).json({ error: 'Payment failed. Please try again.' })
  }
})

module.exports = router
