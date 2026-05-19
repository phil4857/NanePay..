const express = require('express')
const axios   = require('axios')
const db      = require('../config/database')
const logger  = require('../config/logger')
const { authenticate, requireActive } = require('../middleware/auth')

const router = express.Router()

// ── MikroTik API Helper ───────────────────────────────────────
const mikrotikAPI = async (router, endpoint, method = 'GET', data = null) => {
  try {
    const baseUrl = `http://${router.ip_address}:${router.port || 80}/rest`
    const config = {
      method,
      url:     `${baseUrl}${endpoint}`,
      auth:    { username: router.username, password: router.password_encrypted },
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
    }
    if (data) config.data = data
    const res = await axios(config)
    return { success: true, data: res.data }
  } catch (err) {
    logger.error('MikroTik API error', { err: err.message })
    return { success: false, error: err.message }
  }
}

// ── POST /api/mikrotik/routers — add router ───────────────────
router.post('/routers', authenticate, requireActive, async (req, res) => {
  const userId = req.user.userId
  const { name, type, ip_address, port, username, password, api_endpoint, api_key } = req.body

  if (!name || !ip_address) return res.status(400).json({ error: 'name and ip_address are required' })

  try {
    const merchant = await db('merchant_profiles').where({ user_id: userId }).first()
    if (!merchant) return res.status(403).json({ error: 'Merchant profile required' })

    const [routerRecord] = await db('routers').insert({
      merchant_id:        merchant.id,
      name,
      type:               (type || 'MIKROTIK').toUpperCase(),
      ip_address,
      port:               port || 8728,
      username:           username || 'admin',
      password_encrypted: password,
      api_endpoint:       api_endpoint || null,
      api_key:            api_key || null,
      created_at:         new Date(),
    }).returning('*')

    res.status(201).json({ message: 'Router added', router: { ...routerRecord, password_encrypted: undefined } })
  } catch (err) {
    logger.error('Add router failed', { err: err.message })
    res.status(500).json({ error: 'Failed to add router' })
  }
})

// ── GET /api/mikrotik/routers — list merchant routers ─────────
router.get('/routers', authenticate, requireActive, async (req, res) => {
  try {
    const merchant = await db('merchant_profiles').where({ user_id: req.user.userId }).first()
    if (!merchant) return res.status(403).json({ error: 'Merchant profile required' })

    const routers = await db('routers').where({ merchant_id: merchant.id })
    res.json({ routers: routers.map(r => ({ ...r, password_encrypted: undefined })) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch routers' })
  }
})

// ── POST /api/mikrotik/routers/:id/test — test connection ─────
router.post('/routers/:id/test', authenticate, requireActive, async (req, res) => {
  try {
    const routerRecord = await db('routers').where({ id: req.params.id }).first()
    if (!routerRecord) return res.status(404).json({ error: 'Router not found' })

    const result = await mikrotikAPI(routerRecord, '/system/identity')
    if (result.success) {
      await db('routers').where({ id: routerRecord.id }).update({ is_online: true, last_seen: new Date() })
      res.json({ connected: true, identity: result.data })
    } else {
      await db('routers').where({ id: routerRecord.id }).update({ is_online: false })
      res.json({ connected: false, error: result.error })
    }
  } catch (err) {
    res.status(500).json({ error: 'Connection test failed' })
  }
})

// ── POST /api/mikrotik/activate — activate hotspot user ───────
// Called automatically when subscription is created
router.post('/activate', authenticate, requireActive, async (req, res) => {
  const { subscription_id, router_id, mac_address } = req.body

  try {
    const sub = await db('subscriptions as s')
      .join('packages as p', 's.package_id', 'p.id')
      .where({ 's.id': subscription_id })
      .select('s.*', 'p.speed_profile', 'p.device_limit', 'p.duration_type', 'p.duration_value')
      .first()

    if (!sub) return res.status(404).json({ error: 'Subscription not found' })
    if (sub.status !== 'ACTIVE') return res.status(400).json({ error: 'Subscription not active' })

    const routerRecord = await db('routers').where({ id: router_id }).first()
    if (!routerRecord) return res.status(404).json({ error: 'Router not found' })

    const user = await db('users').where({ id: sub.user_id }).first()

    // MikroTik hotspot user creation
    const hotspotUser = {
      name:     user.phone,
      password: sub.id.slice(0, 8),
      profile:  sub.speed_profile || 'default',
      comment:  `NanePay-${sub.id}`,
      'mac-address': mac_address || '',
      'limit-uptime': formatUptime(sub.duration_type, sub.duration_value),
    }

    const result = await mikrotikAPI(routerRecord, '/ip/hotspot/user', 'PUT', hotspotUser)

    if (result.success) {
      await db('hotspot_sessions').insert({
        subscription_id: sub.id,
        user_id:         sub.user_id,
        mac_address:     mac_address || null,
        status:          'ACTIVE',
        started_at:      new Date(),
      })

      res.json({ success: true, credentials: { username: user.phone, password: sub.id.slice(0, 8) } })
    } else {
      res.json({ success: false, error: result.error, note: 'Subscription active but router connection failed' })
    }
  } catch (err) {
    logger.error('MikroTik activate failed', { err: err.message })
    res.status(500).json({ error: 'Activation failed' })
  }
})

// ── POST /api/mikrotik/disconnect ─────────────────────────────
router.post('/disconnect', authenticate, requireActive, async (req, res) => {
  const { subscription_id, router_id } = req.body

  try {
    const sub  = await db('subscriptions').where({ id: subscription_id }).first()
    const user = await db('users').where({ id: sub.user_id }).first()
    const routerRecord = await db('routers').where({ id: router_id }).first()

    await mikrotikAPI(routerRecord, `/ip/hotspot/user/${user.phone}`, 'DELETE')

    await db('hotspot_sessions')
      .where({ subscription_id, status: 'ACTIVE' })
      .update({ status: 'DISCONNECTED', ended_at: new Date() })

    res.json({ success: true, message: 'User disconnected' })
  } catch (err) {
    res.status(500).json({ error: 'Disconnect failed' })
  }
})

// ── Helper: format MikroTik uptime ────────────────────────────
const formatUptime = (type, value) => {
  if (type === 'MINUTES') return `00:${String(value).padStart(2, '0')}:00`
  if (type === 'HOURS')   return `${String(value).padStart(2, '0')}:00:00`
  if (type === 'DAYS')    return `${value}d00:00:00`
  return '01:00:00'
}

module.exports = router
