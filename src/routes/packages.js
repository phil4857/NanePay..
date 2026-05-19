const express = require('express')
const db      = require('../config/database')
const logger  = require('../config/logger')
const { authenticate, requireActive } = require('../middleware/auth')

const router = express.Router()

// ── GET /api/packages — public marketplace ────────────────────
router.get('/', async (req, res) => {
  try {
    const { category, merchant_id } = req.query

    let query = db('packages as p')
      .join('merchant_profiles as m', 'p.merchant_id', 'm.id')
      .join('users as u', 'm.user_id', 'u.id')
      .where({ 'p.is_active': true, 'm.status': 'APPROVED' })
      .select(
        'p.*',
        'm.business_name', 'm.business_logo', 'm.avg_rating',
        'm.slug as merchant_slug',
      )
      .orderBy('p.price', 'asc')

    if (category)    query = query.where({ 'p.category': category.toUpperCase() })
    if (merchant_id) query = query.where({ 'p.merchant_id': merchant_id })

    const packages = await query
    res.json({ packages })
  } catch (err) {
    logger.error('Get packages failed', { err: err.message })
    res.status(500).json({ error: 'Failed to fetch packages' })
  }
})

// ── GET /api/packages/:id ─────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pkg = await db('packages as p')
      .join('merchant_profiles as m', 'p.merchant_id', 'm.id')
      .where({ 'p.id': req.params.id })
      .select('p.*', 'm.business_name', 'm.business_logo', 'm.avg_rating', 'm.slug as merchant_slug')
      .first()

    if (!pkg) return res.status(404).json({ error: 'Package not found' })
    res.json({ package: pkg })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch package' })
  }
})

// ── POST /api/packages — merchant creates package ─────────────
router.post('/', authenticate, requireActive, async (req, res) => {
  const userId = req.user.userId
  const { name, description, category, duration_type, duration_value, price, speed_profile, device_limit } = req.body

  if (!name || !duration_type || !duration_value || !price) {
    return res.status(400).json({ error: 'name, duration_type, duration_value and price are required' })
  }

  try {
    const merchant = await db('merchant_profiles').where({ user_id: userId }).first()
    if (!merchant) return res.status(403).json({ error: 'Merchant profile required' })

    const [pkg] = await db('packages').insert({
      merchant_id:    merchant.id,
      name:           name.trim(),
      description:    description?.trim(),
      category:       (category || 'WIFI').toUpperCase(),
      duration_type:  duration_type.toUpperCase(),
      duration_value: parseInt(duration_value),
      price:          parseFloat(price),
      speed_profile:  speed_profile?.trim(),
      device_limit:   parseInt(device_limit || 1),
      is_active:      true,
      created_at:     new Date(),
    }).returning('*')

    res.status(201).json({ message: 'Package created', package: pkg })
  } catch (err) {
    logger.error('Create package failed', { err: err.message })
    res.status(500).json({ error: 'Failed to create package' })
  }
})

// ── PATCH /api/packages/:id ───────────────────────────────────
router.patch('/:id', authenticate, requireActive, async (req, res) => {
  const userId = req.user.userId
  try {
    const merchant = await db('merchant_profiles').where({ user_id: userId }).first()
    if (!merchant) return res.status(403).json({ error: 'Merchant profile required' })

    const pkg = await db('packages').where({ id: req.params.id, merchant_id: merchant.id }).first()
    if (!pkg) return res.status(404).json({ error: 'Package not found' })

    const allowed = ['name', 'description', 'price', 'speed_profile', 'device_limit', 'is_active']
    const updates: any = {}
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k] })

    const [updated] = await db('packages').where({ id: pkg.id }).update(updates).returning('*')
    res.json({ message: 'Package updated', package: updated })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update package' })
  }
})

module.exports = router
