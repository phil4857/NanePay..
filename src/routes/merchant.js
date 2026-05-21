// src/routes/merchants.js  ← NEW FILE
const express = require('express')
const { v4: uuid } = require('uuid')
const db      = require('../db')
const { authenticate, requireRole } = require('../middleware/auth')

const router = express.Router()

// ── GET /api/merchants (public listing) ─────────────────────────
router.get('/', async (req, res) => {
  const merchants = await db('merchants as m')
    .join('users as u', 'm.user_id', 'u.id')
    .where('m.status', 'approved')
    .select('m.id', 'm.business_name', 'm.location', 'm.logo_url', 'm.rating', 'm.rating_count', 'm.description')
    .orderBy('m.rating', 'desc')

  return res.json({ merchants })
})

// ── GET /api/merchants/dashboard ────────────────────────────────
router.get('/dashboard', authenticate, requireRole('merchant', 'admin'), async (req, res) => {
  const merchant = await db('merchants').where({ user_id: req.user.id }).first()
  if (!merchant) return res.status(404).json({ message: 'Merchant profile not found' })

  const wallet     = await db('merchant_wallets').where({ merchant_id: merchant.id }).first()
  const offersCount = await db('wifi_offers').where({ merchant_id: merchant.id, active: true }).count('id as count').first()
  const salesCount  = await db('wifi_purchases').where({ merchant_id: merchant.id, status: 'active' }).count('id as count').first()

  // Revenue last 7 days
  const recentRevenue = await db('wifi_purchases')
    .where({ merchant_id: merchant.id })
    .whereIn('status', ['active', 'expired'])
    .where('created_at', '>=', new Date(Date.now() - 7 * 86400000))
    .sum('merchant_credit as total')
    .first()

  return res.json({
    merchant,
    wallet: wallet || { balance: 0, total_earnings: 0, pending_withdrawal: 0 },
    stats: {
      activeOffers:   parseInt(offersCount?.count || 0),
      totalSales:     parseInt(salesCount?.count || 0),
      revenueThisWeek: parseFloat(recentRevenue?.total || 0),
    },
  })
})

// ── POST /api/merchants/offers ───────────────────────────────────
router.post('/offers', authenticate, requireRole('merchant', 'admin'), async (req, res) => {
  const merchant = await db('merchants').where({ user_id: req.user.id, status: 'approved' }).first()
  if (!merchant) return res.status(403).json({ message: 'Merchant account not approved yet' })

  const { name, durationType, durationHours, price, speedProfile, maxDevices } = req.body
  if (!name || !durationType || !durationHours || !price) {
    return res.status(400).json({ message: 'name, durationType, durationHours, price are required' })
  }

  const offerId = uuid()
  await db('wifi_offers').insert({
    id:             offerId,
    merchant_id:    merchant.id,
    name,
    duration_type:  durationType,
    duration_hours: durationHours,
    price,
    speed_profile:  speedProfile || '5Mbps',
    max_devices:    maxDevices || 1,
    active:         true,
    created_at:     new Date(),
    updated_at:     new Date(),
  })

  return res.status(201).json({ message: 'Offer created', offerId })
})

// ── PATCH /api/merchants/offers/:id ─────────────────────────────
router.patch('/offers/:id', authenticate, requireRole('merchant', 'admin'), async (req, res) => {
  const merchant = await db('merchants').where({ user_id: req.user.id }).first()
  if (!merchant) return res.status(404).json({ message: 'Not found' })

  const offer = await db('wifi_offers').where({ id: req.params.id, merchant_id: merchant.id }).first()
  if (!offer) return res.status(404).json({ message: 'Offer not found' })

  const allowed = ['name', 'price', 'speed_profile', 'max_devices', 'active']
  const updates = {}
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k] })
  updates.updated_at = new Date()

  await db('wifi_offers').where({ id: offer.id }).update(updates)
  return res.json({ message: 'Offer updated' })
})

// ── GET /api/merchants/sales ─────────────────────────────────────
router.get('/sales', authenticate, requireRole('merchant', 'admin'), async (req, res) => {
  const merchant = await db('merchants').where({ user_id: req.user.id }).first()
  if (!merchant) return res.status(404).json({ message: 'Not found' })

  const sales = await db('wifi_purchases as p')
    .join('wifi_offers as o', 'p.offer_id', 'o.id')
    .join('users as u', 'p.customer_id', 'u.id')
    .where('p.merchant_id', merchant.id)
    .select('p.*', 'o.name as offer_name', 'u.name as customer_name', 'u.phone as customer_phone')
    .orderBy('p.created_at', 'desc')
    .limit(100)

  return res.json({ sales })
})

module.exports = router
