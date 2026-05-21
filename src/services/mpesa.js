// src/services/mpesa.js  ← REPLACEMENT
const axios  = require('axios')
const logger = require('../config/logger')

const MPESA_ENV = process.env.MPESA_ENV || 'sandbox'

const BASE_URL =
  MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke'

// ─────────────────────────────────────────────────────────────
// LAZY ENV VALIDATION — only runs when M-Pesa is actually used
// ─────────────────────────────────────────────────────────────

const REQUIRED_ENVS = [
  'MPESA_CONSUMER_KEY',
  'MPESA_CONSUMER_SECRET',
  'MPESA_SHORTCODE',
  'MPESA_PASSKEY',
  'MPESA_CALLBACK_URL',
]

function validateEnv() {
  const missing = REQUIRED_ENVS.filter(k => !process.env[k])
  if (missing.length > 0) {
    throw new Error(`Missing required M-Pesa env variables: ${missing.join(', ')}`)
  }
}

// ─────────────────────────────────────────────────────────────
// NORMALIZE PHONE
// 0712345678 → 254712345678
// ─────────────────────────────────────────────────────────────

function normalizePhone(phone) {
  if (!phone) return null

  const cleaned = String(phone).replace(/\D/g, '')

  if (cleaned.startsWith('254'))                        return cleaned
  if (cleaned.startsWith('0'))                          return `254${cleaned.slice(1)}`
  if (cleaned.startsWith('7') || cleaned.startsWith('1')) return `254${cleaned}`

  return cleaned
}

// ─────────────────────────────────────────────────────────────
// TIMESTAMP
// ─────────────────────────────────────────────────────────────

function getTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, '')
    .slice(0, 14)
}

// ─────────────────────────────────────────────────────────────
// PASSWORD
// ─────────────────────────────────────────────────────────────

function generatePassword(timestamp) {
  const shortcode = process.env.MPESA_SHORTCODE
  const passkey   = process.env.MPESA_PASSKEY

  return Buffer
    .from(`${shortcode}${passkey}${timestamp}`)
    .toString('base64')
}

// ─────────────────────────────────────────────────────────────
// ACCESS TOKEN
// ─────────────────────────────────────────────────────────────

async function getAccessToken() {
  validateEnv()

  try {
    const credentials = Buffer
      .from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`)
      .toString('base64')

    const response = await axios.get(
      `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${credentials}` } }
    )

    return response.data.access_token

  } catch (err) {
    logger.error('Failed to get M-Pesa token', {
      error: err.message,
      data:  err.response?.data,
    })
    throw err
  }
}

// ─────────────────────────────────────────────────────────────
// STK PUSH
// ─────────────────────────────────────────────────────────────

async function stkPush({
  phone,
  amount,
  reference   = 'NanePay',
  description = 'NanePay Payment',
  type        = 'buygoods', // buygoods | paybill
}) {
  validateEnv()

  try {
    const token     = await getAccessToken()
    const timestamp = getTimestamp()
    const password  = generatePassword(timestamp)

    const normalizedPhone = normalizePhone(phone)
    if (!normalizedPhone || normalizedPhone.length !== 12) {
      throw new Error(`Invalid phone number: ${phone}`)
    }

    const transactionType =
      type === 'paybill'
        ? 'CustomerPayBillOnline'
        : 'CustomerBuyGoodsOnline'

    const payload = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password:          password,
      Timestamp:         timestamp,
      TransactionType:   transactionType,
      Amount:            Math.ceil(amount),
      PartyA:            normalizedPhone,
      PartyB:            process.env.MPESA_SHORTCODE,
      PhoneNumber:       normalizedPhone,
      CallBackURL:       process.env.MPESA_CALLBACK_URL,
      AccountReference:  String(reference).slice(0, 12),
      TransactionDesc:   String(description).slice(0, 50),
    }

    logger.info('Initiating STK Push', { phone: normalizedPhone, amount, reference })

    const response = await axios.post(
      `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    return response.data

  } catch (err) {
    logger.error('STK Push Failed', {
      error: err.message,
      data:  err.response?.data,
    })
    throw err
  }
}

// ─────────────────────────────────────────────────────────────
// STK QUERY
// ─────────────────────────────────────────────────────────────

async function querySTKStatus(checkoutRequestId) {
  validateEnv()

  try {
    const token     = await getAccessToken()
    const timestamp = getTimestamp()
    const password  = generatePassword(timestamp)

    const payload = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password:          password,
      Timestamp:         timestamp,
      CheckoutRequestID: checkoutRequestId,
    }

    const response = await axios.post(
      `${BASE_URL}/mpesa/stkpushquery/v1/query`,
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    return response.data

  } catch (err) {
    logger.error('STK Query Failed', {
      error: err.message,
      data:  err.response?.data,
    })
    throw err
  }
}

// ─────────────────────────────────────────────────────────────
// B2C PAYOUT
// ─────────────────────────────────────────────────────────────

async function b2cPayout({
  phone,
  amount,
  remarks  = 'NanePay Withdrawal',
  occasion = 'Withdrawal',
}) {
  validateEnv()

  try {
    const token           = await getAccessToken()
    const normalizedPhone = normalizePhone(phone)

    const payload = {
      InitiatorName:      process.env.MPESA_INITIATOR_NAME,
      SecurityCredential: process.env.MPESA_SECURITY_CREDENTIAL,
      CommandID:          'BusinessPayment',
      Amount:             Math.floor(amount),
      PartyA:             process.env.MPESA_SHORTCODE,
      PartyB:             normalizedPhone,
      Remarks:            remarks,
      QueueTimeOutURL:    process.env.MPESA_B2C_TIMEOUT_URL,
      ResultURL:          process.env.MPESA_B2C_RESULT_URL,
      Occasion:           occasion,
    }

    logger.info('Initiating B2C payout', { phone: normalizedPhone, amount })

    const response = await axios.post(
      `${BASE_URL}/mpesa/b2c/v1/paymentrequest`,
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    return response.data

  } catch (err) {
    logger.error('B2C payout failed', {
      error: err.message,
      data:  err.response?.data,
    })
    throw err
  }
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = {
  stkPush,
  querySTKStatus,
  b2cPayout,
  normalizePhone,
  getAccessToken,
}
