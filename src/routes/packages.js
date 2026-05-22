// src/routes/packages.js  ← REPLACEMENT
const express      = require('express')
const { v4: uuid } = require('uuid')
const db           = require('../db')
const logger       = require('../config/logger')
const { authenticate, requireRole } = require('../middleware')

const router = express.Router()

// ── GET /api/packages ─────────────────────────────────────────
// Public — list all active packages
router.get('/', async (req, res) => {
  try {
    const { merchantId, type } = req.query

    let query = db('wifi_offers as o')
      .join('merchants as m', 'o.merchant_id', 'm.id')
      .where('o.active', true)
      .where('m.status', 'approved')
      .select(
        'o.id', 'o.name', 'o.duration_type', 'o.duration_hours',
        'o.price', 'o.speed_profile', 'o.max_devices', 'o.purchase_count',
        'm.id as merchant_id', 'm.business_name', 'm.location',
        'm.logo_url', 'm.rating',
      )
      .orderBy('o.price', 'asc')

    if (merchantId) query = query.where('o.merchant_id', merchantId)
    if (type)       query = query.where('o.duration_type', type)

    const packages = await query
    return res.json({ packages })
  } catch (err) {
    logger.error('Get packages failed', { err: err.message })
    return res.status(500).json({ error: 'Failed to fetch packages' })
  }
})

// ── GET /api/packages/:id ─────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pkg = await db('wifi_offers as o')
      .join('merchants as m', 'o.merchant_id', 'm.id')
      .where('o.id', req.params.id)
      .select(
        'o.*',
        'm.business_name', 'm.location', 'm.logo_url',
        'm.rating', 'm.rating_count', 'm.description as merchant_description',
      )
      .first()

    if (!pkg) return res.status(404).json({ error: 'Package not found' })
    return res.json({ package: pkg })
  } catch (err) {
    logger.error('Get package failed', { err: err.message })
    return res.status(500).json({ error: 'Failed to fetch package' })
  }
})

// ── POST /api/packages  (merchant creates package) ────────────
router.post('/', authenticate, requireRole('merchant', 'admin'), async (req, res) => {
  try {
    const merchant = await db('merchants')
      .where({ user_id: req.user.id, status: 'approved' })
      .first()

    if (!merchant) {
      return res.status(403).json({ error: 'Merchant account not approved yet' })
    }

    const { name, durationType, durationHours, price, speedProfile, maxDevices } = req.body

    if (!name || !durationType || !durationHours || !price) {
      return res.status(400).json({ error: 'name, durationType, durationHours, price are required' })
    }

    const validTypes = ['hourly', 'midnight', 'daily', 'weekly', 'monthly']
    if (!validTypes.includes(durationType)) {
      return res.status(400).json({ error: `durationType must be one of: ${validTypes.join(', ')}` })
    }

    const id = uuid()
    await db('wifi_offers').insert({
      id,
      merchant_id:    merchant.id,
      name,
      duration_type:  durationType,
      duration_hours: parseInt(durationHours),
      price:          parseFloat(price),
      speed_profile:  speedProfile  || '5Mbps',
      max_devices:    maxDevices    || 1,
      active:         true,
      purchase_count: 0,
      created_at:     new Date(),
      updated_at:     new Date(),
    })

    return res.status(201).json({ message: 'Package created successfully', packageId: id })
  } catch (err) {
    logger.error('Create package failed', { err: err.message })
    return res.status(500).json({ error: 'Failed to create package' })
  }
})

// ── PATCH /api/packages/:id  (merchant updates package) ───────
router.patch('/:id', authenticate, requireRole('merchant', 'admin'), async (req, res) => {
  try {
    const merchant = await db('merchants').where({ user_id: req.user.id }).first()
    if (!merchant) return res.status(404).json({ error: 'Merchant not found' })

    const pkg = await db('wifi_offers')
      .where({ id: req.params.id, merchant_id: merchant.id })
      .first()
    if (!pkg) return res.status(404).json({ error: 'Package not found' })

    const allowed = ['name', 'price', 'speed_profile', 'max_devices', 'active']
    const updates = {}
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k] })
    updates.updated_at = new Date()

    await db('wifi_offers').where({ id: pkg.id }).update(updates)
    return res.json({ message: 'Package updated successfully' })
  } catch (err) {
    logger.error('Update package failed', { err: err.message })
    return res.status(500).json({ error: 'Failed to update package' })
  }
})

// ── DELETE /api/packages/:id  (merchant deletes package) ──────
router.delete('/:id', authenticate, requireRole('merchant', 'admin'), async (req, res) => {
  try {
    const merchant = await db('merchants').where({ user_id: req.user.id }).first()
    if (!merchant) return res.status(404).json({ error: 'Merchant not found' })

    const pkg = await db('wifi_offers')
      .where({ id: req.params.id, merchant_id: merchant.id })
      .first()
    if (!pkg) return res.status(404).json({ error: 'Package not found' })

    // Soft delete — just deactivate
    await db('wifi_offers').where({ id: pkg.id }).update({
      active:     false,
      updated_at: new Date(),
    })

    return res.json({ message: 'Package deactivated successfully' })
  } catch (err) {
    logger.error('Delete package failed', { err: err.message })
    return res.status(500).json({ error: 'Failed to delete package' })
  }
})

module.exports = router
