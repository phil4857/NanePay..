// src/routes/wifi.js  ← NEW FILE
const express = require('express')
const { v4: uuid } = require('uuid')
const db      = require('../db')
const ledger  = require('../services/ledger')
const mpesa   = require('../services/mpesa')
const { authenticate, requireRole } = require('../middleware/auth')

const router  = express.Router()
const FEE_RATE = parseFloat(process.env.WIFI_FEE_RATE || '0.01')

// ── GET /api/wifi/offers ─────────────────────────────────────────
// Public — list all active offers (with merchant info)
router.get('/offers', async (req, res) => {
  const { merchantId } = req.query

  let query = db('wifi_offers as o')
    .join('merchants as m', 'o.merchant_id', 'm.id')
    .join('users as u', 'm.user_id', 'u.id')
    .where('o.active', true)
    .where('m.status', 'approved')
    .select(
      'o.*',
      'm.business_name', 'm.location', 'm.logo_url', 'm.rating',
    )
    .orderBy('o.price', 'asc')

  if (merchantId) query = query.where('o.merchant_id', merchantId)

  const offers = await query
  return res.json({ offers })
})

// ── POST /api/wifi/purchase ──────────────────────────────────────
// User purchases a WiFi offer — STK push flow
router.post('/purchase', authenticate, async (req, res) => {
  const { offerId } = req.body

  const offer = await db('wifi_offers as o')
    .join('merchants as m', 'o.merchant_id', 'm.id')
    .where('o.id', offerId)
    .where('o.active', true)
    .where('m.status', 'approved')
    .select('o.*', 'm.business_name')
    .first()

  if (!offer) return res.status(404).json({ message: 'Offer not available' })

  const fee   = parseFloat((offer.price * FEE_RATE).toFixed(2))
  const total = parseFloat((offer.price + fee).toFixed(2))
  const ref   = `WIFI-${uuid().split('-')[0].toUpperCase()}`

  try {
    const stkData = await mpesa.stkPush({
      phone:  req.user.phone,
      amount: total,
      ref,
      desc:   `${offer.business_name} WiFi`,
    })

    if (stkData.ResponseCode !== '0') {
      return res.status(400).json({ message: 'Payment initiation failed' })
    }

    // Create pending purchase
    const purchaseId = uuid()
    await db.transaction(async trx => {
      await trx('transactions').insert({
        id:                  uuid(),
        user_id:             req.user.id,
        type:                'wifi_purchase',
        amount:              total,
        fee,
        net_amount:          offer.price,
        status:              'pending',
        reference:           ref,
        checkout_request_id: stkData.CheckoutRequestID,
        description:         `WiFi: ${offer.name} — ${offer.business_name}`,
        metadata:            JSON.stringify({ offerId, merchantId: offer.merchant_id }),
        created_at:          new Date(),
        updated_at:          new Date(),
      })

      await trx('wifi_purchases').insert({
        id:                  purchaseId,
        customer_id:         req.user.id,
        merchant_id:         offer.merchant_id,
        offer_id:            offerId,
        amount:              total,
        fee,
        merchant_credit:     offer.price,
        status:              'pending',
        checkout_request_id: stkData.CheckoutRequestID,
        created_at:          new Date(),
        updated_at:          new Date(),
      })
    })

    return res.json({
      message:           'Enter your M-Pesa PIN to activate WiFi.',
      checkoutRequestId: stkData.CheckoutRequestID,
      purchaseId,
      offer: { name: offer.name, price: offer.price, duration: offer.duration_type },
      fee,
      total,
    })
  } catch (err) {
    console.error('[WiFi Purchase Error]', err.message)
    return res.status(500).json({ message: 'Purchase failed. Please try again.' })
  }
})

// ── POST /api/wifi/activate (called by STK callback internally)
async function activateWifiSession(purchaseId, trx) {
  const purchase = await trx('wifi_purchases').where({ id: purchaseId }).first()
  const offer    = await trx('wifi_offers').where({ id: purchase.offer_id }).first()

  const now    = new Date()
  const expiry = new Date(now.getTime() + offer.duration_hours * 3600 * 1000)

  await trx('wifi_purchases').where({ id: purchaseId }).update({
    status:       'active',
    activated_at: now,
    expiry_time:  expiry,
    updated_at:   now,
  })

  // Create session
  const sessionId = uuid()
  const username  = `np_${purchaseId.split('-')[0]}`
  const password  = Math.random().toString(36).slice(2, 10)

  await trx('wifi_sessions').insert({
    id:          sessionId,
    purchase_id: purchaseId,
    user_id:     purchase.customer_id,
    username,
    password,
    start_time:  now,
    expiry_time: expiry,
    status:      'active',
    created_at:  now,
    updated_at:  now,
  })

  // Credit merchant wallet
  await trx('merchant_wallets')
    .where({ merchant_id: purchase.merchant_id })
    .increment('balance',        purchase.merchant_credit)
    .increment('total_earnings', purchase.merchant_credit)

  // Platform revenue
  await trx('platform_revenue').insert({
    id:          uuid(),
    source:      'wifi_purchase_fee',
    amount:      purchase.fee,
    fee_rate:    FEE_RATE,
    payer_id:    purchase.customer_id,
    description: `WiFi fee — ${purchaseId}`,
    created_at:  now,
    updated_at:  now,
  })

  // Increment offer purchase count
  await trx('wifi_offers').where({ id: purchase.offer_id }).increment('purchase_count', 1)

  return { sessionId, username, password, expiry }
}

// ── GET /api/wifi/sessions ───────────────────────────────────────
router.get('/sessions', authenticate, async (req, res) => {
  const sessions = await db('wifi_sessions as s')
    .join('wifi_purchases as p', 's.purchase_id', 'p.id')
    .join('wifi_offers as o', 'p.offer_id', 'o.id')
    .join('merchants as m', 'p.merchant_id', 'm.id')
    .where('s.user_id', req.user.id)
    .select('s.*', 'o.name as offer_name', 'o.speed_profile', 'm.business_name')
    .orderBy('s.created_at', 'desc')
    .limit(20)

  return res.json({ sessions })
})

module.exports = { router, activateWifiSession }
