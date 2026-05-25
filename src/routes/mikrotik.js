const express = require('express')
const axios = require('axios')

const db = require('../config/database')
const logger = require('../config/logger')

const authMiddleware = require('../middleware/auth')

const authenticate =
  typeof authMiddleware === 'function'
    ? authMiddleware
    : authMiddleware.authenticate || authMiddleware.auth

const requireActive =
  authMiddleware.requireActive ||
  ((req, res, next) => next())

const requireRole =
  authMiddleware.requireRole ||
  ((...roles) => (req, res, next) => next())

const router = express.Router()

// ── Mikrotik API helper ───────────────────────────────────────
async function mikrotikRequest(
  router_url,
  username,
  password,
  command,
  params = {}
) {
  const url = `${router_url}/rest${command}`

  const response = await axios({
    method: Object.keys(params).length ? 'post' : 'get',
    url,
    auth: {
      username,
      password,
    },
    data: Object.keys(params).length ? params : undefined,
    timeout: 8000,
  })

  return response.data
}

// ── GET /api/mikrotik/routers ─────────────────────────────────
router.get('/routers', authenticate, requireActive, async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId

    const merchant = await db('merchant_profiles')
      .where({ user_id: userId })
      .first()

    if (!merchant) {
      return res.status(403).json({
        error: 'Merchant profile required',
      })
    }

    const routers = await db('mikrotik_routers')
      .where({ merchant_id: merchant.id })
      .select(
        'id',
        'name',
        'router_url',
        'is_active',
        'created_at'
      )
      .orderBy('created_at', 'desc')

    return res.json({ routers })
  } catch (err) {
    logger.error('Get routers failed', {
      err: err.message,
    })

    return res.status(500).json({
      error: 'Failed to fetch routers',
    })
  }
})

// ── POST /api/mikrotik/routers ────────────────────────────────
router.post('/routers', authenticate, requireActive, async (req, res) => {
  const {
    name,
    router_url,
    api_username,
    api_password,
  } = req.body

  if (!name || !router_url || !api_username || !api_password) {
    return res.status(400).json({
      error:
        'name, router_url, api_username and api_password are required',
    })
  }

  try {
    const userId = req.user.id || req.user.userId

    const merchant = await db('merchant_profiles')
      .where({ user_id: userId })
      .first()

    if (!merchant) {
      return res.status(403).json({
        error: 'Merchant profile required',
      })
    }

    // Test connection
    await mikrotikRequest(
      router_url,
      api_username,
      api_password,
      '/system/identity'
    )

    const [routerRecord] = await db('mikrotik_routers')
      .insert({
        merchant_id: merchant.id,
        name: name.trim(),
        router_url: router_url.trim(),
        api_username: api_username.trim(),
        api_password,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning([
        'id',
        'name',
        'router_url',
        'is_active',
        'created_at',
      ])

    return res.status(201).json({
      message: 'Router registered successfully',
      router: routerRecord,
    })
  } catch (err) {
    if (
      err.code === 'ECONNREFUSED' ||
      err.code === 'ETIMEDOUT'
    ) {
      return res.status(400).json({
        error:
          'Could not connect to router. Check credentials and URL.',
      })
    }

    logger.error('Register router failed', {
      err: err.message,
    })

    return res.status(500).json({
      error: 'Failed to register router',
    })
  }
})

// ── GET /api/mikrotik/routers/:id/status ─────────────────────
router.get(
  '/routers/:id/status',
  authenticate,
  requireActive,
  async (req, res) => {
    try {
      const userId = req.user.id || req.user.userId

      const merchant = await db('merchant_profiles')
        .where({ user_id: userId })
        .first()

      if (!merchant) {
        return res.status(403).json({
          error: 'Merchant profile required',
        })
      }

      const routerRecord = await db('mikrotik_routers')
        .where({
          id: req.params.id,
          merchant_id: merchant.id,
        })
        .first()

      if (!routerRecord) {
        return res.status(404).json({
          error: 'Router not found',
        })
      }

      const identity = await mikrotikRequest(
        routerRecord.router_url,
        routerRecord.api_username,
        routerRecord.api_password,
        '/system/identity'
      )

      const resource = await mikrotikRequest(
        routerRecord.router_url,
        routerRecord.api_username,
        routerRecord.api_password,
        '/system/resource'
      )

      return res.json({
        online: true,
        identity: identity?.name || 'Unknown',
        uptime: resource?.uptime,
        cpu_load: resource?.['cpu-load'],
        memory: resource?.['free-memory'],
      })
    } catch (err) {
      return res.json({
        online: false,
        error: 'Router unreachable',
      })
    }
  }
)

// ── POST /api/mikrotik/provision ──────────────────────────────
router.post('/provision', authenticate, requireActive, async (req, res) => {
  const { subscription_id } = req.body

  if (!subscription_id) {
    return res.status(400).json({
      error: 'subscription_id is required',
    })
  }

  try {
    const userId = req.user.id || req.user.userId

    const sub = await db('subscriptions as s')
      .join('packages as p', 's.package_id', 'p.id')
      .join('merchant_profiles as m', 's.merchant_id', 'm.id')
      .join('users as u', 's.user_id', 'u.id')
      .where({
        's.id': subscription_id,
        's.user_id': userId,
      })
      .select(
        's.id as sub_id',
        's.status',
        's.expires_at',
        'p.speed_profile',
        'p.device_limit',
        'p.duration_type',
        'p.duration_value',
        'm.id as merchant_id',
        'u.phone'
      )
      .first()

    if (!sub) {
      return res.status(404).json({
        error: 'Subscription not found',
      })
    }

    if (sub.status !== 'ACTIVE') {
      return res.status(400).json({
        error: 'Subscription is not active',
      })
    }

    const routerRecord = await db('mikrotik_routers')
      .where({
        merchant_id: sub.merchant_id,
        is_active: true,
      })
      .first()

    if (!routerRecord) {
      return res.status(404).json({
        error: 'No active router found',
      })
    }

    const hsUsername = `hs_${sub.phone.replace(/\D/g, '')}`
    const hsPassword = Math.random().toString(36).slice(-8)

    const profile = sub.speed_profile || 'default'

    await mikrotikRequest(
      routerRecord.router_url,
      routerRecord.api_username,
      routerRecord.api_password,
      '/ip/hotspot/user/add',
      {
        name: hsUsername,
        password: hsPassword,
        profile,
        comment: `NanePay sub:${sub.sub_id}`,
        'limit-uptime': buildUptimeLimit(
          sub.duration_type,
          sub.duration_value
        ),
      }
    )

    await db('subscriptions')
      .where({ id: subscription_id })
      .update({
        hotspot_username: hsUsername,
        hotspot_password: hsPassword,
        updated_at: new Date(),
      })

    logger.info('Hotspot user provisioned', {
      subscription_id,
      hsUsername,
    })

    return res.json({
      message: 'Hotspot user provisioned',
      username: hsUsername,
      password: hsPassword,
      profile,
    })
  } catch (err) {
    logger.error('Provision failed', {
      err: err.message,
    })

    return res.status(500).json({
      error: 'Failed to provision hotspot user',
    })
  }
})

// ── DELETE /api/mikrotik/provision/:subscription_id ───────────
router.delete(
  '/provision/:subscription_id',
  authenticate,
  requireActive,
  async (req, res) => {
    try {
      const userId = req.user.id || req.user.userId

      const sub = await db('subscriptions as s')
        .join('merchant_profiles as m', 's.merchant_id', 'm.id')
        .where({
          's.id': req.params.subscription_id,
          's.user_id': userId,
        })
        .select(
          's.hotspot_username',
          's.merchant_id'
        )
        .first()

      if (!sub) {
        return res.status(404).json({
          error: 'Subscription not found',
        })
      }

      if (!sub.hotspot_username) {
        return res.status(400).json({
          error: 'No hotspot user linked',
        })
      }

      const routerRecord = await db('mikrotik_routers')
        .where({
          merchant_id: sub.merchant_id,
          is_active: true,
        })
        .first()

      if (!routerRecord) {
        return res.status(404).json({
          error: 'No active router found',
        })
      }

      const users = await mikrotikRequest(
        routerRecord.router_url,
        routerRecord.api_username,
        routerRecord.api_password,
        `/ip/hotspot/user?name=${sub.hotspot_username}`
      )

      if (users && users.length > 0) {
        await mikrotikRequest(
          routerRecord.router_url,
          routerRecord.api_username,
          routerRecord.api_password,
          `/ip/hotspot/user/${users[0]['.id']}/delete`
        )
      }

      await db('subscriptions')
        .where({
          id: req.params.subscription_id,
        })
        .update({
          hotspot_username: null,
          hotspot_password: null,
          updated_at: new Date(),
        })

      logger.info('Hotspot user removed', {
        subscription_id: req.params.subscription_id,
      })

      return res.json({
        message: 'Hotspot user removed successfully',
      })
    } catch (err) {
      logger.error('Deprovision failed', {
        err: err.message,
      })

      return res.status(500).json({
        error: 'Failed to remove hotspot user',
      })
    }
  }
)

// ── GET /api/mikrotik/active-users/:router_id ─────────────────
router.get(
  '/active-users/:router_id',
  authenticate,
  requireActive,
  async (req, res) => {
    try {
      const userId = req.user.id || req.user.userId

      const merchant = await db('merchant_profiles')
        .where({ user_id: userId })
        .first()

      if (!merchant) {
        return res.status(403).json({
          error: 'Merchant profile required',
        })
      }

      const routerRecord = await db('mikrotik_routers')
        .where({
          id: req.params.router_id,
          merchant_id: merchant.id,
        })
        .first()

      if (!routerRecord) {
        return res.status(404).json({
          error: 'Router not found',
        })
      }

      const active = await mikrotikRequest(
        routerRecord.router_url,
        routerRecord.api_username,
        routerRecord.api_password,
        '/ip/hotspot/active'
      )

      return res.json({
        count: active?.length || 0,
        active_users: (active || []).map(u => ({
          user: u.user,
          ip: u.address,
          uptime: u.uptime,
          bytes_in: u['bytes-in'],
          bytes_out: u['bytes-out'],
        })),
      })
    } catch (err) {
      logger.error('Active users fetch failed', {
        err: err.message,
      })

      return res.status(500).json({
        error: 'Failed to fetch active users',
      })
    }
  }
)

// ── Helper ────────────────────────────────────────────────────
function buildUptimeLimit(duration_type, duration_value) {
  const map = {
    HOURS: 'h',
    DAYS: 'd',
    WEEKS: 'w',
  }

  const suffix =
    map[duration_type?.toUpperCase()] || 'd'

  return `${duration_value}${suffix}`
}

module.exports = router
