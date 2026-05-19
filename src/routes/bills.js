const express = require('express')
const db      = require('../config/database')
const logger  = require('../config/logger')
const { authenticate, requireActive } = require('../middleware/auth')
const { auditLog }                    = require('../middleware/audit')
const { generateTxRef, calcFee }      = require('../utils/helpers')

const router = express.Router()
router.use(authenticate, requireActive)

// ── BILL CATEGORIES & FEES ────────────────────────────────────
const BILL_TYPES = {
  WIFI:       { label: 'WiFi / Hotspot', fee_rate: 0.015, icon: '📶' },
  ELECTRICITY:{ label: 'Electricity',    fee_rate: 0.010, icon: '⚡' },
  WATER:      { label: 'Water',          fee_rate: 0.010, icon: '💧' },
  SCHOOL:     { label: 'School Fees',    fee_rate: 0.008, icon: '🎓' },
  RENT:       { label: 'Rent',           fee_rate: 0.005, icon: '🏠' },
}

// ── GET /api/bills/types ──────────────────────────────────────
router.get('/types', (req, res) => {
  const types = Object.entries(BILL_TYPES).map(([key, val]) => ({
    type: key,
    ...val,
    fee_pct: (val.fee_rate * 100).toFixed(1),
  }))
  res.json({ types })
})

// ── GET /api/bills/providers ──────────────────────────────────
router.get('/providers/:type', (req, res) => {
  const type = req.params.type.toUpperCase()
  
  const PROVIDERS = {
    WIFI: [
      { id: 'safaricom_home', name: 'Safaricom Home Fibre', logo: '📶' },
      { id: 'zuku',           name: 'Zuku Fibre',           logo: '📶' },
      { id: 'faiba',          name: 'Faiba 4G',             logo: '📶' },
      { id: 'airtel_home',    name: 'Airtel Home',          logo: '📶' },
      { id: 'hotspot_custom', name: 'Custom Hotspot',       logo: '📶' },
    ],
    ELECTRICITY: [
      { id: 'kplc_prepaid',  name: 'KPLC Prepaid Token', logo: '⚡' },
      { id: 'kplc_postpaid', name: 'KPLC Postpaid',      logo: '⚡' },
    ],
    WATER: [
      { id: 'nairobi_water', name: 'Nairobi Water',    logo: '💧' },
      { id: 'mombasa_water', name: 'Mombasa Water',    logo: '💧' },
      { id: 'kisumu_water',  name: 'Kisumu Water',     logo: '💧' },
    ],
    SCHOOL: [
      { id: 'primary',    name: 'Primary School',    logo: '🎓' },
      { id: 'secondary',  name: 'Secondary School',  logo: '🎓' },
      { id: 'university', name: 'University / TVET', logo: '🎓' },
    ],
    RENT: [
      { id: 'residential', name: 'Residential Rent', logo: '🏠' },
      { id: 'commercial',  name: 'Commercial Rent',  logo: '🏢' },
    ],
  }

  const providers = PROVIDERS[type] || []
  res.json({ providers })
})

// ── POST /api/bills/pay ───────────────────────────────────────
router.post('/pay', async (req, res) => {
  const userId   = req.user.userId
  const { type, provider_id, account_number, amount, description } = req.body

  if (!type || !amount || !account_number) {
    return res.status(400).json({ error: 'type, account_number and amount are required' })
  }

  const billType = BILL_TYPES[type.toUpperCase()]
  if (!billType) {
    return res.status(400).json({ error: 'Invalid bill type' })
  }

  const parsedAmount = parseFloat(amount)
  if (parsedAmount < 1) {
    return res.status(400).json({ error: 'Amount must be greater than 0' })
  }

  const fee     = parseFloat((parsedAmount * billType.fee_rate).toFixed(2))
  const total   = parseFloat((parsedAmount + fee).toFixed(2))

  try {
    const result = await db.transaction(async (trx) => {
      const wallet = await trx('wallets')
        .where({ user_id: userId }).forUpdate().first()

      if (parseFloat(wallet.balance) < total) {
        throw new Error('INSUFFICIENT_BALANCE')
      }

      await trx('wallets').where({ user_id: userId })
        .decrement('balance', total)
        .update({ updated_at: new Date() })

      const reference = generateTxRef()

      const [tx] = await trx('transactions').insert({
        sender_id:   userId,
        amount:      parsedAmount,
        fee,
        net_amount:  parsedAmount,
        type:        'BILL_PAYMENT',
        status:      'SUCCESSFUL',
        reference,
        description: description || `${billType.label} payment — ${account_number}`,
        metadata:    JSON.stringify({ bill_type: type, provider_id, account_number }),
        created_at:  new Date(),
      }).returning('*')

      await trx('fee_ledger').insert({
        amount:     fee,
        type:       'BILL_FEE',
        created_at: new Date(),
      })

      return { tx, reference }
    })

    await auditLog(req, 'BILL_PAYMENT', { type, amount: parsedAmount, fee })

    logger.info('Bill payment successful', { userId, type, amount: parsedAmount })

    res.json({
      message:        'Payment successful',
      reference:      result.reference,
      bill_type:      billType.label,
      account_number,
      amount:         parsedAmount,
      fee,
      total_charged:  total,
      fee_pct:        (billType.fee_rate * 100).toFixed(1),
    })
  } catch (err) {
    if (err.message === 'INSUFFICIENT_BALANCE') {
      return res.status(400).json({ error: 'Insufficient balance' })
    }
    logger.error('Bill payment failed', { err: err.message })
    res.status(500).json({ error: 'Payment failed. Please try again.' })
  }
})

// ── GET /api/bills/history ────────────────────────────────────
router.get('/history', async (req, res) => {
  const userId = req.user.userId
  try {
    const bills = await db('transactions')
      .where({ sender_id: userId, type: 'BILL_PAYMENT' })
      .orderBy('created_at', 'desc')
      .limit(50)

    res.json({
      bills: bills.map(b => ({
        ...b,
        amount:     parseFloat(b.amount),
        fee:        parseFloat(b.fee || 0),
        metadata:   b.metadata ? JSON.parse(b.metadata) : {},
      }))
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bill history' })
  }
})

module.exports = router
