const express = require('express')
const db      = require('../config/database')
const logger  = require('../config/logger')
const { authenticate, requireActive } = require('../middleware/auth')
const { auditLog }                    = require('../middleware/audit')
const { generateTxRef }               = require('../utils/helpers')

const router = express.Router()
router.use(authenticate, requireActive)

// ── NANEPAY FEE: 1% on all bill payments ─────────────────────
const NANEPAY_FEE = 0.01

// ── WIFI PROVIDERS WITH PACKAGES ─────────────────────────────
const WIFI_PROVIDERS = {
  safaricom: {
    name: 'Safaricom Home Fibre',
    logo: '📶',
    packages: [
      { id: 'saf_1hr',   label: '1 Hour',    price: 20,   validity: '1 hour',   speed: '5 Mbps'  },
      { id: 'saf_3hr',   label: '3 Hours',   price: 50,   validity: '3 hours',  speed: '5 Mbps'  },
      { id: 'saf_6hr',   label: '6 Hours',   price: 80,   validity: '6 hours',  speed: '10 Mbps' },
      { id: 'saf_12hr',  label: '12 Hours',  price: 130,  validity: '12 hours', speed: '10 Mbps' },
      { id: 'saf_24hr',  label: '24 Hours',  price: 200,  validity: '24 hours', speed: '20 Mbps' },
      { id: 'saf_7day',  label: '7 Days',    price: 900,  validity: '7 days',   speed: '20 Mbps' },
      { id: 'saf_30day', label: '30 Days',   price: 2999, validity: '30 days',  speed: '40 Mbps' },
    ],
  },
  zuku: {
    name: 'Zuku Fibre',
    logo: '📶',
    packages: [
      { id: 'zuku_1hr',   label: '1 Hour',   price: 15,   validity: '1 hour',   speed: '4 Mbps'  },
      { id: 'zuku_3hr',   label: '3 Hours',  price: 40,   validity: '3 hours',  speed: '4 Mbps'  },
      { id: 'zuku_6hr',   label: '6 Hours',  price: 70,   validity: '6 hours',  speed: '8 Mbps'  },
      { id: 'zuku_12hr',  label: '12 Hours', price: 110,  validity: '12 hours', speed: '8 Mbps'  },
      { id: 'zuku_24hr',  label: '24 Hours', price: 180,  validity: '24 hours', speed: '15 Mbps' },
      { id: 'zuku_7day',  label: '7 Days',   price: 750,  validity: '7 days',   speed: '15 Mbps' },
      { id: 'zuku_30day', label: '30 Days',  price: 2499, validity: '30 days',  speed: '30 Mbps' },
    ],
  },
  faiba: {
    name: 'Faiba 4G',
    logo: '📶',
    packages: [
      { id: 'faiba_1hr',   label: '1 Hour',   price: 10,   validity: '1 hour',   speed: '3 Mbps'  },
      { id: 'faiba_3hr',   label: '3 Hours',  price: 25,   validity: '3 hours',  speed: '3 Mbps'  },
      { id: 'faiba_6hr',   label: '6 Hours',  price: 50,   validity: '6 hours',  speed: '5 Mbps'  },
      { id: 'faiba_12hr',  label: '12 Hours', price: 90,   validity: '12 hours', speed: '5 Mbps'  },
      { id: 'faiba_24hr',  label: '24 Hours', price: 150,  validity: '24 hours', speed: '10 Mbps' },
      { id: 'faiba_7day',  label: '7 Days',   price: 600,  validity: '7 days',   speed: '10 Mbps' },
      { id: 'faiba_30day', label: '30 Days',  price: 1999, validity: '30 days',  speed: '20 Mbps' },
    ],
  },
  airtel: {
    name: 'Airtel Home',
    logo: '📶',
    packages: [
      { id: 'airtel_1hr',   label: '1 Hour',   price: 15,   validity: '1 hour',   speed: '4 Mbps'  },
      { id: 'airtel_3hr',   label: '3 Hours',  price: 35,   validity: '3 hours',  speed: '4 Mbps'  },
      { id: 'airtel_6hr',   label: '6 Hours',  price: 65,   validity: '6 hours',  speed: '8 Mbps'  },
      { id: 'airtel_12hr',  label: '12 Hours', price: 100,  validity: '12 hours', speed: '8 Mbps'  },
      { id: 'airtel_24hr',  label: '24 Hours', price: 170,  validity: '24 hours', speed: '15 Mbps' },
      { id: 'airtel_7day',  label: '7 Days',   price: 700,  validity: '7 days',   speed: '15 Mbps' },
      { id: 'airtel_30day', label: '30 Days',  price: 2299, validity: '30 days',  speed: '25 Mbps' },
    ],
  },
  custom: {
    name: 'Custom Hotspot',
    logo: '📶',
    packages: [
      { id: 'custom_30min', label: '30 Minutes', price: 5,  validity: '30 mins',  speed: 'Varies' },
      { id: 'custom_1hr',   label: '1 Hour',     price: 10, validity: '1 hour',   speed: 'Varies' },
      { id: 'custom_2hr',   label: '2 Hours',    price: 20, validity: '2 hours',  speed: 'Varies' },
      { id: 'custom_3hr',   label: '3 Hours',    price: 30, validity: '3 hours',  speed: 'Varies' },
      { id: 'custom_6hr',   label: '6 Hours',    price: 50, validity: '6 hours',  speed: 'Varies' },
      { id: 'custom_12hr',  label: '12 Hours',   price: 80, validity: '12 hours', speed: 'Varies' },
      { id: 'custom_24hr',  label: '24 Hours',   price: 120, validity: '24 hours', speed: 'Varies' },
    ],
  },
}

// ── OTHER BILL TYPES ──────────────────────────────────────────
const BILL_TYPES = {
  ELECTRICITY: {
    label: 'Electricity', icon: '⚡',
    providers: [
      { id: 'kplc_prepaid',  name: 'KPLC Prepaid Token' },
      { id: 'kplc_postpaid', name: 'KPLC Postpaid'      },
    ],
  },
  WATER: {
    label: 'Water', icon: '💧',
    providers: [
      { id: 'nairobi_water', name: 'Nairobi Water' },
      { id: 'mombasa_water', name: 'Mombasa Water' },
      { id: 'kisumu_water',  name: 'Kisumu Water'  },
    ],
  },
  SCHOOL: {
    label: 'School Fees', icon: '🎓',
    providers: [
      { id: 'primary',    name: 'Primary School'    },
      { id: 'secondary',  name: 'Secondary School'  },
      { id: 'university', name: 'University / TVET' },
    ],
  },
  RENT: {
    label: 'Rent', icon: '🏠',
    providers: [
      { id: 'residential', name: 'Residential Rent' },
      { id: 'commercial',  name: 'Commercial Rent'  },
    ],
  },
}

// ── GET /api/bills/wifi-providers ─────────────────────────────
router.get('/wifi-providers', (req, res) => {
  const providers = Object.entries(WIFI_PROVIDERS).map(([id, p]) => ({
    id,
    name:     p.name,
    logo:     p.logo,
    packages: p.packages,
  }))
  res.json({ providers })
})

// ── GET /api/bills/types ──────────────────────────────────────
router.get('/types', (req, res) => {
  const types = Object.entries(BILL_TYPES).map(([key, val]) => ({
    type: key,
    ...val,
    fee_pct: '1%',
    fee_rate: NANEPAY_FEE,
  }))
  res.json({ types })
})

// ── POST /api/bills/wifi ──────────────────────────────────────
// Pay for a WiFi package — NanePay charges 1%
router.post('/wifi', async (req, res) => {
  const userId      = req.user.userId
  const { provider_id, package_id, account_number } = req.body

  if (!provider_id || !package_id || !account_number) {
    return res.status(400).json({ error: 'provider_id, package_id and account_number are required' })
  }

  const provider = WIFI_PROVIDERS[provider_id]
  if (!provider) return res.status(400).json({ error: 'Invalid WiFi provider' })

  const pkg = provider.packages.find(p => p.id === package_id)
  if (!pkg) return res.status(400).json({ error: 'Invalid package' })

  const amount = pkg.price
  const fee    = parseFloat((amount * NANEPAY_FEE).toFixed(2))
  const total  = parseFloat((amount + fee).toFixed(2))

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
        amount,
        fee,
        net_amount:  amount,
        type:        'BILL_PAYMENT',
        status:      'SUCCESSFUL',
        reference,
        description: `WiFi — ${provider.name} ${pkg.label} (${pkg.validity})`,
        metadata:    JSON.stringify({
          bill_type:      'WIFI',
          provider_id,
          provider_name:  provider.name,
          package_id,
          package_label:  pkg.label,
          validity:       pkg.validity,
          speed:          pkg.speed,
          account_number,
        }),
        created_at: new Date(),
      }).returning('*')

      await trx('fee_ledger').insert({
        amount:     fee,
        type:       'BILL_FEE',
        created_at: new Date(),
      })

      return { tx, reference }
    })

    await auditLog(req, 'WIFI_PAYMENT', { provider_id, package_id, amount, fee })
    logger.info('WiFi payment successful', { userId, provider_id, package_id, amount })

    res.json({
      message:        'WiFi payment successful',
      reference:      result.reference,
      provider:       provider.name,
      package:        pkg.label,
      validity:       pkg.validity,
      speed:          pkg.speed,
      account_number,
      amount,
      fee,
      total_charged:  total,
      fee_pct:        '1%',
    })
  } catch (err) {
    if (err.message === 'INSUFFICIENT_BALANCE') {
      return res.status(400).json({ error: 'Insufficient balance' })
    }
    logger.error('WiFi payment failed', { err: err.message })
    res.status(500).json({ error: 'Payment failed. Please try again.' })
  }
})

// ── POST /api/bills/pay ───────────────────────────────────────
// Pay electricity, water, school, rent — NanePay charges 1%
router.post('/pay', async (req, res) => {
  const userId   = req.user.userId
  const { type, provider_id, account_number, amount } = req.body

  if (!type || !amount || !account_number) {
    return res.status(400).json({ error: 'type, account_number and amount are required' })
  }

  const billType = BILL_TYPES[type.toUpperCase()]
  if (!billType) return res.status(400).json({ error: 'Invalid bill type' })

  const parsedAmount = parseFloat(amount)
  if (parsedAmount < 1) return res.status(400).json({ error: 'Amount must be at least KES 1' })

  const fee   = parseFloat((parsedAmount * NANEPAY_FEE).toFixed(2))
  const total = parseFloat((parsedAmount + fee).toFixed(2))

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
        description: `${billType.label} — ${account_number}`,
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

    res.json({
      message:       'Payment successful',
      reference:     result.reference,
      bill_type:     billType.label,
      account_number,
      amount:        parsedAmount,
      fee,
      total_charged: total,
      fee_pct:       '1%',
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
        amount:   parseFloat(b.amount),
        fee:      parseFloat(b.fee || 0),
        metadata: b.metadata ? JSON.parse(b.metadata) : {},
      }))
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bill history' })
  }
})

module.exports = router
