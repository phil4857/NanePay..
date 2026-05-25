const express = require('express')
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

const { generateTxRef, calcFee } = require('../utils/helpers')
const { notify } = require('../services/notifications')

const router = express.Router()

router.use(authenticate, requireActive)

// ── POST /api/subscriptions ───────────────────────────────────
router.post('/', async (req, res) => {
  const userId = req.user.id
  const { package_id, account_reference } = req.body

  if (!package_id) {
    return res.status(400).json({ error: 'package_id is required' })
  }

  try {
    const pkg = await db('packages')
      .where({ id: package_id, is_active: true })
      .first()

    if (!pkg) {
      return res.status(404).json({ error: 'Package not found or unavailable' })
    }

    const merchant = await db('merchant_profiles')
      .where({ id: pkg.merchant_id, status: 'APPROVED' })
      .first()

    if (!merchant) {
      return res.status(400).json({ error: 'Merchant not available' })
    }

    const feeData = calcFee(pkg.price)
    const fee = feeData.fee || 0
    const net = feeData.net || (pkg.price - fee)

    const now = new Date()
    const expires_at = new Date(now)

    if (pkg.duration_type === 'MINUTES') {
      expires_at.setMinutes(expires_at.getMinutes() + pkg.duration_value)
    }

    if (pkg.duration_type === 'HOURS') {
      expires_at.setHours(expires_at.getHours() + pkg.duration_value)
    }

    if (pkg.duration_type === 'DAYS') {
      expires_at.setDate(expires_at.getDate() + pkg.duration_value)
    }

    if (pkg.duration_type === 'MONTHS') {
      expires_at.setMonth(expires_at.getMonth() + pkg.duration_value)
    }

    const result = await db.transaction(async (trx) => {

      const wallet = await trx('wallets')
        .where({ user_id: userId })
        .forUpdate()
        .first()

      if (!wallet) {
        throw new Error('WALLET_NOT_FOUND')
      }

      if (parseFloat(wallet.balance) < pkg.price) {
        throw new Error('INSUFFICIENT_BALANCE')
      }

      await trx('wallets')
        .where({ user_id: userId })
        .decrement('balance', pkg.price)
        .update({ updated_at: new Date() })

      await trx('merchant_profiles')
        .where({ id: merchant.id })
        .increment('wallet_balance', net)

      const reference = generateTxRef()

      const txData = {
        sender_id: userId,
        receiver_id: merchant.user_id,
        amount: pkg.price,
        fee,
        net_amount: net,
        type: 'BILL_PAYMENT',
        status: 'SUCCESSFUL',
        reference,
        description: `Subscription — ${pkg.name}`,
        created_at: new Date(),
      }

      let tx

      const insertedTx = await trx('transactions')
        .insert(txData)
        .returning('*')

      tx = Array.isArray(insertedTx) ? insertedTx[0] : insertedTx

      await trx('fee_ledger').insert({
        transaction_id: tx.id,
        amount: fee,
        type: 'BILL_FEE',
        created_at: new Date(),
      })

      const subData = {
        user_id: userId,
        package_id: pkg.id,
        merchant_id: merchant.id,
        transaction_id: tx.id,
        status: 'ACTIVE',
        account_reference: account_reference || null,
        activated_at: now,
        expires_at,
        created_at: new Date(),
      }

      const insertedSub = await trx('subscriptions')
        .insert(subData)
        .returning('*')

      const sub = Array.isArray(insertedSub)
        ? insertedSub[0]
        : insertedSub

      await trx('commissions').insert({
        merchant_id: merchant.id,
        transaction_id: tx.id,
        transaction_amount: pkg.price,
        commission_rate: 0.01,
        commission_amount: fee,
        nanepay_fee: fee,
        merchant_payout: net,
        status: 'PAID',
        created_at: new Date(),
      })

      return { sub, tx, reference }
    })

    try {
      await notify(userId, {
        title: `${pkg.name} Activated!`,
        body: `Your subscription is active until ${expires_at.toLocaleString()}`,
        type: 'SUBSCRIPTION',
        metadata: { subscription_id: result.sub.id },
      })
    } catch (e) {
      console.log('User notification failed')
    }

    try {
      await notify(merchant.user_id, {
        title: 'New Subscription',
        body: `New ${pkg.name} subscription. You earned KES ${net}`,
        type: 'PAYMENT',
        metadata: { subscription_id: result.sub.id },
      })
    } catch (e) {
      console.log('Merchant notification failed')
    }

    logger.info('Subscription created', {
      userId,
      package_id,
      amount: pkg.price,
    })

    return res.status(201).json({
      message: 'Subscription activated successfully',
      reference: result.reference,
      subscription: {
        ...result.sub,
        package: pkg,
        expires_at,
      },
    })

  } catch (err) {

    if (err.message === 'INSUFFICIENT_BALANCE') {
      return res.status(400).json({
        error: 'Insufficient wallet balance',
      })
    }

    if (err.message === 'WALLET_NOT_FOUND') {
      return res.status(404).json({
        error: 'Wallet not found',
      })
    }

    logger.error('Subscription failed', {
      err: err.message,
    })

    return res.status(500).json({
      error: 'Subscription failed. Please try again.',
    })
  }
})

// ── GET /api/subscriptions/mine ───────────────────────────────
router.get('/mine', async (req, res) => {

  const userId = req.user.id

  try {

    const subs = await db('subscriptions as s')
      .join('packages as p', 's.package_id', 'p.id')
      .join('merchant_profiles as m', 's.merchant_id', 'm.id')
      .where({ 's.user_id': userId })
      .select(
        's.*',
        'p.name as package_name',
        'p.speed_profile',
        'p.device_limit',
        'm.business_name',
        'm.business_logo'
      )
      .orderBy('s.created_at', 'desc')

    const now = new Date()

    const expired = subs.filter(
      s =>
        s.status === 'ACTIVE' &&
        new Date(s.expires_at) < now
    )

    if (expired.length > 0) {

      await db('subscriptions')
        .whereIn(
          'id',
          expired.map(s => s.id)
        )
        .update({ status: 'EXPIRED' })

      expired.forEach(s => {
        s.status = 'EXPIRED'
      })
    }

    return res.json({
      subscriptions: subs,
    })

  } catch (err) {

    return res.status(500).json({
      error: 'Failed to fetch subscriptions',
    })
  }
})

// ── GET /api/subscriptions/:id ────────────────────────────────
router.get('/:id', async (req, res) => {

  const userId = req.user.id

  try {

    const sub = await db('subscriptions as s')
      .join('packages as p', 's.package_id', 'p.id')
      .join('merchant_profiles as m', 's.merchant_id', 'm.id')
      .where({
        's.id': req.params.id,
        's.user_id': userId,
      })
      .select(
        's.*',
        'p.name as package_name',
        'p.speed_profile',
        'p.device_limit',
        'p.duration_type',
        'p.duration_value',
        'm.business_name'
      )
      .first()

    if (!sub) {
      return res.status(404).json({
        error: 'Subscription not found',
      })
    }

    const sessions = await db('hotspot_sessions')
      .where({ subscription_id: sub.id })
      .orderBy('started_at', 'desc')

    return res.json({
      subscription: sub,
      sessions,
    })

  } catch (err) {

    return res.status(500).json({
      error: 'Failed to fetch subscription',
    })
  }
})

module.exports = router
