const express = require('express')
const db      = require('../config/database')
const logger  = require('../config/logger')
const { authenticate, requireActive } = require('../middleware/auth')
const { mpesaLimiter }                = require('../middleware/rateLimit')
const { validate, rules }             = require('../middleware/validate')
const { auditLog }                    = require('../middleware/audit')
const { initiateSTKPush }             = require('../services/mpesa')
const { generateTxRef, normalizePhone } = require('../utils/helpers')

const router = express.Router()

router.post('/stk-push',
  authenticate, requireActive, mpesaLimiter, rules.deposit, validate,
  async (req, res) => {
    const userId = req.user.userId
    const amount = parseFloat(req.body.amount)

    try {
      const user      = await db('users').where({ id: userId }).select('phone', 'name').first()
      const phone     = normalizePhone(user.phone)
      const reference = generateTxRef()

      const [pending] = await db('transactions').insert({
        receiver_id: userId,
        amount, fee: 0, net_amount: amount,
        type:        'MPESA_DEPOSIT',
        status:      'PENDING',
        reference,
        description: 'M-Pesa wallet deposit',
        created_at:  new Date(),
      }).returning('*')

      let stkResponse
      try {
        stkResponse = await initiateSTKPush({ phone, amount, reference, description: 'NanePay Wallet Deposit' })
      } catch (mpesaErr) {
        await db('transactions').where({ id: pending.id }).update({ status: 'FAILED' })

        if (mpesaErr.message.includes('not configured')) {
          return res.json({
            message: 'STK Push sent (MOCK MODE — add M-Pesa credentials to go live)',
            transaction_id: pending.id,
            reference,
            checkout_request_id: 'MOCK-' + Date.now(),
            mock: true,
          })
        }
        return res.status(502).json({ error: 'Could not reach M-Pesa. Please try again.' })
      }

      await db('transactions').where({ id: pending.id })
        .update({ mpesa_checkout_id: stkResponse.CheckoutRequestID })

      await auditLog(req, 'MPESA_STK_PUSH', { amount, reference })

      res.json({
        message:             'STK Push sent. Enter your M-Pesa PIN on your phone.',
        transaction_id:      pending.id,
        reference,
        checkout_request_id: stkResponse.CheckoutRequestID,
      })
    } catch (err) {
      logger.error('STK push error', { err: err.message })
      res.status(500).json({ error: 'Deposit failed. Please try again.' })
    }
  }
)

// PUBLIC — no auth — Safaricom calls this
router.post('/callback', async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' })

  try {
    const callback = req.body?.Body?.stkCallback
    if (!callback) return

    const { ResultCode, CheckoutRequestID, CallbackMetadata } = callback

    if (ResultCode !== 0) {
      await db('transactions').where({ mpesa_checkout_id: CheckoutRequestID }).update({ status: 'FAILED' })
      return
    }

    const meta      = CallbackMetadata?.Item || []
    const mpesaCode = meta.find(i => i.Name === 'MpesaReceiptNumber')?.Value
    const amount    = parseFloat(meta.find(i => i.Name === 'Amount')?.Value || '0')

    await db.transaction(async (trx) => {
      const tx = await trx('transactions').where({ mpesa_checkout_id: CheckoutRequestID }).first()
      if (!tx || tx.status === 'SUCCESSFUL') return

      await trx('transactions').where({ id: tx.id })
        .update({ status: 'SUCCESSFUL', mpesa_reference: mpesaCode, amount })

      await trx('wallets').where({ user_id: tx.receiver_id })
        .increment('balance', amount).update({ updated_at: new Date() })

      logger.info('Wallet credited', { userId: tx.receiver_id, amount, mpesaCode })
    })
  } catch (err) {
    logger.error('Callback error', { err: err.message })
  }
})

router.get('/status/:checkoutId', authenticate, async (req, res) => {
  try {
    const tx = await db('transactions')
      .where({ mpesa_checkout_id: req.params.checkoutId })
      .select('status', 'amount', 'reference', 'mpesa_reference')
      .first()

    if (!tx) return res.status(404).json({ error: 'Transaction not found' })
    res.json(tx)
  } catch (err) {
    res.status(500).json({ error: 'Status check failed' })
  }
})

router.post('/b2c/result', async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  logger.info('B2C result received', { body: req.body })
})

router.post('/b2c/timeout', async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  logger.warn('B2C timeout', { body: req.body })
})

module.exports = router
