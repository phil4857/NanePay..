const express = require('express')
const axios   = require('axios')
const db      = require('../config/database')
const logger  = require('../config/logger')
const { authenticate, requireActive } = require('../middleware/auth')

const router = express.Router()

// ── Helper: call MikroTik REST API ────────────────────────────
function mikrotikCall(routerRecord, endpoint, method, data) {
  method = method || 'GET'
  return axios({
    method:  method,
    url:     'http://' + routerRecord.ip_address + ':' + (routerRecord.port || 80) + '/rest' + endpoint,
    auth:    { username: routerRecord.username, password: routerRecord.password_encrypted },
    timeout: 10000,
    data:    data || undefined,
  })
  .then(function(res) { return { success: true,  data:  res.data      } })
  .catch(function(err){ return { success: false, error: err.message   } })
}

// ── Helper: format MikroTik uptime string ─────────────────────
function formatUptime(type, value) {
  if (type === 'MINUTES') return '00:' + String(value).padStart(2, '0') + ':00'
  if (type === 'HOURS')   return String(value).padStart(2, '0') + ':00:00'
  if (type === 'DAYS')    return value + 'd00:00:00'
  return '01:00:00'
}

// ── POST /api/mikrotik/routers — add a router ─────────────────
router.post('/routers', authenticate, requireActive, async (req, res) => {
  const userId = req.user.userId
  const { name, type, ip_address, port, username, password, api_endpoint, api_key } = req.body

  if (!name || !ip_address) {
    return res.status(400).json({ error: 'name and ip_address are required' })
  }

  try {
    const merchant = await db('merchant_profiles')
      .where({ user_id: userId })
      .first()

    if (!merchant) {
      return res.status(403).json({ error: 'Merchant profile required' })
    }

    const inserted = await db('routers').insert({
      merchant_id:        merchant.id,
      name:               name,
      type:               (type || 'MIKROTIK').toUpperCase(),
      ip_address:         ip_address,
      port:               port || 8728,
      username:           username || 'admin',
      password_encrypted: password || '',
      api_endpoint:       api_endpoint || null,
      api_key_router:     api_key || null,
      is_online:          false,
      created_at:         new Date(),
    }).returning('*')

    const routerRecord = inserted[0]
    routerRecord.password_encrypted = undefined

    res.status(201).json({ message: 'Router added', router: routerRecord })
  } catch (err) {
    logger.error('Add router failed', { err: err.message })
    res.status(500).json({ error: 'Failed to add router' })
  }
})

// ── GET /api/mikrotik/routers — list merchant routers ─────────
router.get('/routers', authenticate, requireActive, async (req, res) => {
  try {
    const merchant = await db('merchant_profiles')
      .where({ user_id: req.user.userId })
      .first()

    if (!merchant) {
      return res.status(403).json({ error: 'Merchant profile required' })
    }

    const routers = await db('routers').where({ merchant_id: merchant.id })

    const sanitized = routers.map(function(r) {
      return Object.assign({}, r, { password_encrypted: undefined })
    })

    res.json({ routers: sanitized })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch routers' })
  }
})

// ── POST /api/mikrotik/routers/:id/test — test connection ─────
router.post('/routers/:id/test', authenticate, requireActive, async (req, res) => {
  try {
    const routerRecord = await db('routers').where({ id: req.params.id }).first()
    if (!routerRecord) {
      return res.status(404).json({ error: 'Router not found' })
    }

    const result = await mikrotikCall(routerRecord, '/system/identity')

    await db('routers').where({ id: routerRecord.id }).update({
      is_online: result.success,
      last_seen: result.success ? new Date() : routerRecord.last_seen,
    })

    res.json({
      connected: result.success,
      identity:  result.data  || null,
      error:     result.error || null,
    })
  } catch (err) {
    logger.error('Router test failed', { err: err.message })
    res.status(500).json({ error: 'Connection test failed' })
  }
})

// ── POST /api/mikrotik/activate — activate hotspot user ───────
router.post('/activate', authenticate, requireActive, async (req, res) => {
  const { subscription_id, router_id, mac_address } = req.body

  if (!subscription_id || !router_id) {
    return res.status(400).json({ error: 'subscription_id and router_id are required' })
  }

  try {
    const sub = await db('subscriptions as s')
      .join('packages as p', 's.package_id', 'p.id')
      .where({ 's.id': subscription_id })
      .select('s.*', 'p.speed_profile', 'p.duration_type', 'p.duration_value')
      .first()

    if (!sub) {
      return res.status(404).json({ error: 'Subscription not found' })
    }
    if (sub.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'Subscription is not active' })
    }

    const user         = await db('users').where({ id: sub.user_id }).first()
    const routerRecord = await db('routers').where({ id: router_id }).first()

    if (!routerRecord) {
      return res.status(404).json({ error: 'Router not found' })
    }

    const hotspotUser = {
      name:           user.phone,
      password:       sub.id.slice(0, 8),
      profile:        sub.speed_profile || 'default',
      comment:        'NanePay-' + sub.id,
      'mac-address':  mac_address || '',
      'limit-uptime': formatUptime(sub.duration_type, sub.duration_value),
    }

    const result = await mikrotikCall(routerRecord, '/ip/hotspot/user', 'PUT', hotspotUser)

    if (result.success) {
      await db('hotspot_sessions').insert({
        subscription_id: sub.id,
        user_id:         sub.user_id,
        mac_address:     mac_address || null,
        status:          'ACTIVE',
        started_at:      new Date(),
      })

      logger.info('Hotspot user activated', {
        userId:   sub.user_id,
        phone:    user.phone,
        router:   routerRecord.name,
      })
    }

    res.json({
      success:     result.success,
      credentials: { username: user.phone, password: sub.id.slice(0, 8) },
      error:       result.error || null,
      note:        result.success ? null : 'Subscription is active but router connection failed',
    })
  } catch (err) {
    logger.error('MikroTik activate failed', { err: err.message })
    res.status(500).json({ error: 'Activation failed. Please try again.' })
  }
})

// ── POST /api/mikrotik/disconnect — disconnect a user ─────────
router.post('/disconnect', authenticate, requireActive, async (req, res) => {
  const { subscription_id, router_id } = req.body

  if (!subscription_id || !router_id) {
    return res.status(400).json({ error: 'subscription_id and router_id are required' })
  }

  try {
    const sub          = await db('subscriptions').where({ id: subscription_id }).first()
    const user         = await db('users').where({ id: sub.user_id }).first()
    const routerRecord = await db('routers').where({ id: router_id }).first()

    if (!routerRecord) {
      return res.status(404).json({ error: 'Router not found' })
    }

    await mikrotikCall(routerRecord, '/ip/hotspot/user/' + user.phone, 'DELETE')

    await db('hotspot_sessions')
      .where({ subscription_id: subscription_id, status: 'ACTIVE' })
      .update({ status: 'DISCONNECTED', ended_at: new Date() })

    res.json({ success: true, message: 'User disconnected from hotspot' })
  } catch (err) {
    logger.error('MikroTik disconnect failed', { err: err.message })
    res.status(500).json({ error: 'Disconnect failed' })
  }
})

// ── GET /api/mikrotik/sessions — active sessions ──────────────
router.get('/sessions', authenticate, requireActive, async (req, res) => {
  try {
    const merchant = await db('merchant_profiles')
      .where({ user_id: req.user.userId })
      .first()

    if (!merchant) {
      return res.status(403).json({ error: 'Merchant profile required' })
    }

    const sessions = await db('hotspot_sessions as hs')
      .join('subscriptions as s', 'hs.subscription_id', 's.id')
      .join('users as u',         'hs.user_id',         'u.id')
      .join('packages as p',      's.package_id',       'p.id')
      .where({ 's.merchant_id': merchant.id })
      .select(
        'hs.*',
        'u.name as user_name',
        'u.phone as user_phone',
        'p.name as package_name',
        'p.speed_profile',
      )
      .orderBy('hs.started_at', 'desc')
      .limit(100)

    res.json({ sessions })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sessions' })
  }
})

module.exports = router
