const express = require('express')
const db      = require('../config/database')
const logger  = require('../config/logger')
const { v4: uuidv4 } = require('uuid')
const { authenticate, requireActive } = require('../middleware/auth')
const { validate, rules }             = require('../middleware/validate')
const { auditLog }                    = require('../middleware/audit')
const { generateTxRef, calcFee }      = require('../utils/helpers')

const router = express.Router()
router.use(authenticate, requireActive)

router.post('/register', rules.merchantRegister, validate, async (req, res) => {
  const userId = req.user.userId
  const { business_name, business_type } = req.body
  try {
    const existing = await db('merchant_profiles').where({ user_id: userId }).first()
    if (existing) return res.status(409).json({ error: 'Merchant profile already exists' })

    const slug    = business_name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + uuidv4().slice(0, 4)
    const api_key = 'np_live_' + uuidv4().replace(/-/g, '')

    const [merchant] = await db('merchant_profiles').insert({
      user_id: userId, business_name: business_name.trim(),
      business_type: business_type.trim(), slug, api_key,
      fee_rate: parseFloat(process.env.MERCHANT_FEE_RATE || '0.008'),
      created_at: new Date(),
    }).returning('*')

    await db('users').where({ id: userId }).update({ role: 'merchant' })

    res.status(201).json({
      message: 'Merchant account created',
      merchant,
      payment_link: `https://nanepay.com/pay/${slug}`,
    })
  } catch (err) {
    logger.error('Merchant register failed', { err: err.message })
    res.status(500).json({ error: 'Registration failed.' })
  }
})

router.get('/profile', async (req, res) => {
  try {
    const merchant = await db('merchant_profiles').where({ user_id: req.user.userId }).first()
    if (!merchant) return res.status(404).json({ error: 'No merchant profile found' })
    res.json({ ...merchant, payment_link: `https://nanepay.com/pay/${merchant.slug}` })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch merchant profile' })
  }
})

router.post('/payment-links', async (req, res) => {
  const { title, amount } = req.body
  try {
    const merchant = await db('merchant_profiles').where({ user_id: req.user.userId }).first()
    if (!merchant) return res.status(403).json({ error: 'Merchant profile required' })

    const [link] = await db('payment_links').insert({
      merchant_id: merchant.id, title: title?.trim() || 'Payment',
      amount: amount ? parseFloat(amount) : null,
      currency: 'KES', slug: uuidv4().slice(0, 8),
      is_active: true, collected: 0, created_at: new Date(),
    }).returning('*')

    res.status(201).json({ ...link, url: `https://nanepay.com/pay/${link.slug}` })
  } catch (err) {
    res.status(500).json({ error: 'Failed to create payment link' })
  }
})

router.get('/payment-links', async (req, res) => {
  try {
    const merchant = await db('merchant_profiles').where({ user_id: req.user.userId }).first()
    if (!merchant) return res.status(403).json({ error: 'Merchant profile required' })
    const links = await db('payment_links').where({ merchant_id: merchant.id }).orderBy('created_at', 'desc')
    res.json({ links: links.map(l => ({ ...l, url: `https://nanepay.com/pay/${l.slug}` })) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payment links' })
  }
})

router.get('/analytics', async (req, res) => {
  try {
    const merchant = await db('merchant_profiles').where({ user_id: req.user.userId }).first()
    if (!merchant) return res.status(403).json({ error: 'Merchant profile required' })
    const [volume]    = await db('transactions').where({ receiver_id: req.user.userId, type: 'MERCHANT_PAYMENT', status: 'SUCCESSFUL' }).sum('amount as total').count('id as count')
    const [fees_paid] = await db('transactions').where({ receiver_id: req.user.userId, type: 'MERCHANT_PAYMENT', status: 'SUCCESSFUL' }).sum('fee as total')
    res.json({ total_volume: parseFloat(volume.total || 0), total_payments: parseInt(volume.count || 0), total_fees: parseFloat(fees_paid.total || 0), fee_rate: merchant.fee_rate })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch analytics' })
  }
})

module.exports = router
