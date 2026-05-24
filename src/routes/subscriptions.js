const express = require('express')
const db      = require('../config/database')
const logger  = require('../config/logger')
const authMiddleware = require('../middleware/auth')

const authenticate =
  typeof authMiddleware === 'function'
    ? authMiddleware
   const authMiddleware = require('../middleware/auth')

const authenticate =
  typeof authMiddleware === 'function'
    ? authMiddleware
    : authMiddleware.authenticate || authMiddleware.auth

const requireActive =
  authMiddleware.requireActive ||
  ((req, res, next) => next())

router.use(authenticate, requireActive) 

const requireActive =
  authMiddleware.requireActive ||
  ((req, res, next) => next())

router.use(authenticate, requireActive)
const { generateTxRef, calcFee }      = require('../utils/helpers')
const { notify }                      = require('../services/notifications')

const router = express.Router()
router.use(authenticate, requireActive)

// ── POST /api/subscriptions — subscribe to a package ──────────
router.post('/', async (req, res) => {
const userId     = req.user.userId
const { package_id, account_reference } = req.body

if (!package_id) return res.status(400).json({ error: 'package_id is required' })

try {
const pkg = await db('packages').where({ id: package_id, is_active: true }).first()
if (!pkg) return res.status(404).json({ error: 'Package not found or unavailable' })

const merchant = await db('merchant_profiles')  
  .where({ id: pkg.merchant_id, status: 'APPROVED' }).first()  
if (!merchant) return res.status(400).json({ error: 'Merchant not available' })  

const { fee, net } = calcFee(pkg.price, 'TRANSFER')  

// Calculate expiry  
const now        = new Date()  
const expires_at = new Date(now)  
if (pkg.duration_type === 'MINUTES') expires_at.setMinutes(expires_at.getMinutes() + pkg.duration_value)  
if (pkg.duration_type === 'HOURS')   expires_at.setHours(expires_at.getHours() + pkg.duration_value)  
if (pkg.duration_type === 'DAYS')    expires_at.setDate(expires_at.getDate() + pkg.duration_value)  
if (pkg.duration_type === 'MONTHS')  expires_at.setMonth(expires_at.getMonth() + pkg.duration_value)  

const result = await db.transaction(async (trx) => {  
  // Check wallet balance  
  const wallet = await trx('wallets')  
    .where({ user_id: userId }).forUpdate().first()  

  if (parseFloat(wallet.balance) < pkg.price) throw new Error('INSUFFICIENT_BALANCE')  

  // Deduct from user wallet  
  await trx('wallets').where({ user_id: userId })  
    .decrement('balance', pkg.price)  
    .update({ updated_at: new Date() })  

  // Credit merchant wallet (net amount after NanePay fee)  
  await trx('merchant_profiles').where({ id: merchant.id })  
    .increment('wallet_balance', net)  

  const reference = generateTxRef()  

  // Record transaction  
  const [tx] = await trx('transactions').insert({  
    sender_id:   userId,  
    receiver_id: merchant.user_id,  
    amount:      pkg.price,  
    fee,  
    net_amount:  net,  
    type:        'BILL_PAYMENT',  
    status:      'SUCCESSFUL',  
    reference,  
    description: `Subscription — ${pkg.name}`,  
    created_at:  new Date(),  
  }).returning('*')  

  // Record fee  
  await trx('fee_ledger').insert({  
    transaction_id: tx.id,  
    amount:         fee,  
    type:           'BILL_FEE',  
    created_at:     new Date(),  
  })  

  // Create subscription  
  const [sub] = await trx('subscriptions').insert({  
    user_id:           userId,  
    package_id:        pkg.id,  
    merchant_id:       merchant.id,  
    transaction_id:    tx.id,  
    status:            'ACTIVE',  
    account_reference: account_reference || null,  
    activated_at:      now,  
    expires_at,  
    created_at:        new Date(),  
  }).returning('*')  

  // Commission record  
  await trx('commissions').insert({  
    merchant_id:        merchant.id,  
    transaction_id:     tx.id,  
    transaction_amount: pkg.price,  
    commission_rate:    0.01,  
    commission_amount:  fee,  
    nanepay_fee:        fee,  
    merchant_payout:    net,  
    status:             'PAID',  
    created_at:         new Date(),  
  })  

  return { sub, tx, reference }  
})  

// Notify user  
await notify(userId, {  
  title:    `${pkg.name} Activated!`,  
  body:     `Your subscription is active until ${expires_at.toLocaleString()}`,  
  type:     'SUBSCRIPTION',  
  metadata: { subscription_id: result.sub.id },  
})  

// Notify merchant  
await notify(merchant.user_id, {  
  title:    'New Subscription',  
  body:     `New ${pkg.name} subscription. You earned KES ${net}`,  
  type:     'PAYMENT',  
  metadata: { subscription_id: result.sub.id },  
})  

logger.info('Subscription created', { userId, package_id, amount: pkg.price })  

res.status(201).json({  
  message:    'Subscription activated successfully',  
  reference:  result.reference,  
  subscription: {  
    ...result.sub,  
    package:  pkg,  
    expires_at,  
  },  
})

} catch (err) {
if (err.message === 'INSUFFICIENT_BALANCE') {
return res.status(400).json({ error: 'Insufficient wallet balance' })
}
logger.error('Subscription failed', { err: err.message })
res.status(500).json({ error: 'Subscription failed. Please try again.' })
}
})

// ── GET /api/subscriptions/mine ───────────────────────────────
router.get('/mine', async (req, res) => {
const userId = req.user.userId
try {
const subs = await db('subscriptions as s')
.join('packages as p',          's.package_id',  'p.id')
.join('merchant_profiles as m', 's.merchant_id', 'm.id')
.where({ 's.user_id': userId })
.select('s.*', 'p.name as package_name', 'p.speed_profile', 'p.device_limit',
'm.business_name', 'm.business_logo')
.orderBy('s.created_at', 'desc')

// Auto-expire subscriptions  
const now = new Date()  
const expired = subs.filter(s => s.status === 'ACTIVE' && new Date(s.expires_at) < now)  
if (expired.length > 0) {  
  await db('subscriptions')  
    .whereIn('id', expired.map(s => s.id))  
    .update({ status: 'EXPIRED' })  
  expired.forEach(s => { s.status = 'EXPIRED' })  
}  

res.json({ subscriptions: subs })

} catch (err) {
res.status(500).json({ error: 'Failed to fetch subscriptions' })
}
})

// ── GET /api/subscriptions/:id ────────────────────────────────
router.get('/:id', async (req, res) => {
const userId = req.user.userId
try {
const sub = await db('subscriptions as s')
.join('packages as p',          's.package_id',  'p.id')
.join('merchant_profiles as m', 's.merchant_id', 'm.id')
.where({ 's.id': req.params.id, 's.user_id': userId })
.select('s.*', 'p.name as package_name', 'p.speed_profile', 'p.device_limit',
'p.duration_type', 'p.duration_value', 'm.business_name')
.first()

if (!sub) return res.status(404).json({ error: 'Subscription not found' })  

const sessions = await db('hotspot_sessions')  
  .where({ subscription_id: sub.id })  
  .orderBy('started_at', 'desc')  

res.json({ subscription: sub, sessions })

} catch (err) {
res.status(500).json({ error: 'Failed to fetch subscription' })
}
})

module.exports = router
