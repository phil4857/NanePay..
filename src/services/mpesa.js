const axios  = require('axios')
const logger = require('../config/logger')

const BASE_URL = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke'

const getToken = async () => {
  const key    = process.env.MPESA_CONSUMER_KEY
  const secret = process.env.MPESA_CONSUMER_SECRET

  if (!key || !secret) {
    throw new Error('M-Pesa credentials not configured')
  }

  const credentials = Buffer.from(`${key}:${secret}`).toString('base64')
  const res = await axios.get(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${credentials}` } }
  )
  return res.data.access_token
}

const getTimestampAndPassword = () => {
  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14)

  const password = Buffer.from(
    `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
  ).toString('base64')

  return { timestamp, password }
}

const initiateSTKPush = async ({ phone, amount, reference, description }) => {
  const token = await getToken()
  const { timestamp, password } = getTimestampAndPassword()

  logger.info('Initiating STK Push', { phone, amount, reference })

  const res = await axios.post(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password:          password,
      Timestamp:         timestamp,
      TransactionType:   'CustomerPayBillOnline',
      Amount:            Math.ceil(amount),
      PartyA:            phone,
      PartyB:            process.env.MPESA_SHORTCODE,
      PhoneNumber:       phone,
      CallBackURL:       process.env.MPESA_CALLBACK_URL,
      AccountReference:  reference,
      TransactionDesc:   description || 'NanePay Wallet Deposit',
    },
    { headers: { Authorization: `Bearer ${token}` } }
  )

  return res.data
}

const initiateB2C = async ({ phone, amount, reference }) => {
  const token = await getToken()

  const res = await axios.post(
    `${BASE_URL}/mpesa/b2c/v1/paymentrequest`,
    {
      InitiatorName:      process.env.MPESA_INITIATOR_NAME || 'testapi',
      SecurityCredential: process.env.MPESA_SECURITY_CREDENTIAL,
      CommandID:          'BusinessPayment',
      Amount:             Math.ceil(amount),
      PartyA:             process.env.MPESA_SHORTCODE,
      PartyB:             phone,
      Remarks:            `NanePay withdrawal ${reference}`,
      QueueTimeOutURL:    process.env.MPESA_B2C_TIMEOUT_URL,
      ResultURL:          process.env.MPESA_B2C_RESULT_URL,
      Occasion:           reference,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  )

  return res.data
}

const querySTKStatus = async (checkoutRequestId) => {
  const token = await getToken()
  const { timestamp, password } = getTimestampAndPassword()

  const res = await axios.post(
    `${BASE_URL}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password:          password,
      Timestamp:         timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  )

  return res.data
}

module.exports = { initiateSTKPush, initiateB2C, querySTKStatus }
