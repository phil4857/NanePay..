// src/routes/mpesa.js

const express = require('express')
const { v4: uuid } = require('uuid')

const db      = require('../db')
const ledger  = require('../services/ledger')
const mpesa   = require('../services/mpesa')

const { authenticate } = require('../middleware/auth')

const router = express.Router()

/**
 * ---------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------
 */

function parseAmount(value) {
  return parseFloat(Number(value).toFixed(2))
}

/**
 * ---------------------------------------------------------
 * POST /api/mpesa/stk-push
 * Deposit request
 * ---------------------------------------------------------
 */

router.post('/stk-push', authenticate, async (req, res) => {
  try {
    const amount = parseAmount(req.body.amount)
    const user   = req.user

    if (!amount || amount < 1) {
      return res.status(400).json({
        message: 'Minimum deposit is KES 1'
      })
    }

    const DEPOSIT_FEE_RATE = parseFloat(
      process.env.DEPOSIT_FEE_RATE || '0'
    )

    const fee   = parseAmount(amount * DEPOSIT_FEE_RATE)
    const total = parseAmount(amount + fee)

    const reference = `DEP-${uuid().split('-')[0].toUpperCase()}`

    /**
     * STK PUSH
     */
    const stk = await mpesa.stkPush({
      phone: user.phone,
      amount: total,
      ref: reference,
      desc: 'NanePay Deposit'
    })

    if (stk.ResponseCode !== '0') {
      return res.status(400).json({
        message:
          stk.ResponseDescription ||
          'Failed to initiate STK Push'
      })
    }

    /**
     * Store pending transaction
     */
    await db('transactions').insert({
      id: uuid(),

      user_id: user.id,

      type: 'deposit',

      amount,
      fee,
      net_amount: amount,

      status: 'pending',

      reference,

      checkout_request_id: stk.CheckoutRequestID,
      merchant_request_id: stk.MerchantRequestID,

      description: 'M-Pesa wallet deposit',

      metadata: JSON.stringify({
        phone: user.phone,
        total_charged: total
      }),

      created_at: new Date(),
      updated_at: new Date()
    })

    return res.json({
      success: true,
      message:
        'STK Push sent. Complete payment on your phone.',

      reference,

      amount,
      fee,
      total,

      checkoutRequestId: stk.CheckoutRequestID
    })
  } catch (err) {
    console.error('[STK PUSH ERROR]', err)

    return res.status(500).json({
      success: false,
      message: 'Could not initiate payment'
    })
  }
})

/**
 * ---------------------------------------------------------
 * POST /api/mpesa/stk-callback
 * Safaricom callback
 * ---------------------------------------------------------
 */

router.post('/stk-callback', async (req, res) => {

  // IMPORTANT:
  // Always respond immediately
  res.status(200).json({
    ResultCode: 0,
    ResultDesc: 'Accepted'
  })

  try {

    const callback = req.body?.Body?.stkCallback

    if (!callback) return

    const checkoutId = callback.CheckoutRequestID
    const resultCode = callback.ResultCode

    console.log(
      `[STK CALLBACK] ${checkoutId} => ${resultCode}`
    )

    /**
     * Find transaction
     */
    const tx = await db('transactions')
      .where({
        checkout_request_id: checkoutId
      })
      .first()

    if (!tx) {
      console.log(
        `[STK CALLBACK] Transaction not found`
      )
      return
    }

    /**
     * Idempotency protection
     */
    if (
      ['completed', 'failed'].includes(tx.status)
    ) {
      console.log(
        `[STK CALLBACK] Duplicate callback ignored`
      )
      return
    }

    /**
     * FAILED PAYMENT
     */
    if (resultCode !== 0) {

      await db('transactions')
        .where({ id: tx.id })
        .update({
          status: 'failed',

          metadata: JSON.stringify({
            ...(tx.metadata || {}),
            resultCode,
            resultDesc: callback.ResultDesc
          }),

          updated_at: new Date()
        })

      console.log(
        `[STK CALLBACK] Payment failed`
      )

      return
    }

    /**
     * SUCCESSFUL PAYMENT
     */
    const items = callback.CallbackMetadata?.Item || []

    const getItem = name =>
      items.find(i => i.Name === name)?.Value

    const mpesaReceipt = getItem('MpesaReceiptNumber')
    const paidAmount   = getItem('Amount')
    const phone        = getItem('PhoneNumber')

    /**
     * Receipt duplication protection
     */
    const receiptExists = await db('transactions')
      .where({ mpesa_receipt: mpesaReceipt })
      .first()

    if (receiptExists) {
      console.log(
        `[STK CALLBACK] Duplicate receipt ignored`
      )
      return
    }

    await db.transaction(async trx => {

      /**
       * Mark transaction completed
       */
      await trx('transactions')
        .where({ id: tx.id })
        .update({

          status: 'completed',

          mpesa_receipt: mpesaReceipt,

          metadata: JSON.stringify({
            paidAmount,
            phone,
            checkoutId
          }),

          updated_at: new Date()
        })

      /**
       * Credit wallet using ledger
       */
      await ledger.deposit({
        userId: tx.user_id,

        amount: tx.net_amount,

        reference: tx.reference,

        mpesaReceipt,

        metadata: {
          checkoutId,
          phone,
          paidAmount
        },

        trx
      })

      /**
       * Notification
       */
      const hasNotifications =
        await trx.schema.hasTable('notifications')

      if (hasNotifications) {
        await trx('notifications').insert({
          id: uuid(),

          user_id: tx.user_id,

          title: 'Deposit Successful',

          body:
            `KES ${tx.net_amount} deposited successfully`,

          type: 'payment',

          data: JSON.stringify({
            amount: tx.net_amount,
            receipt: mpesaReceipt
          }),

          created_at: new Date(),
          updated_at: new Date()
        })
      }
    })

    console.log(
      `[STK CALLBACK] Deposit completed: ${mpesaReceipt}`
    )

  } catch (err) {

    console.error(
      '[STK CALLBACK ERROR]',
      err.message,
      err.stack
    )
  }
})

/**
 * ---------------------------------------------------------
 * GET /api/mpesa/stk-status/:checkoutId
 * ---------------------------------------------------------
 */

router.get(
  '/stk-status/:checkoutId',
  authenticate,
  async (req, res) => {

    try {

      const tx = await db('transactions')
        .where({
          checkout_request_id:
            req.params.checkoutId,

          user_id: req.user.id
        })
        .first()

      if (!tx) {
        return res.status(404).json({
          message: 'Transaction not found'
        })
      }

      return res.json({
        success: true,

        status: tx.status,

        amount: tx.amount,

        fee: tx.fee,

        reference: tx.reference,

        mpesaReceipt: tx.mpesa_receipt
      })

    } catch (err) {

      console.error(err)

      return res.status(500).json({
        message: 'Could not fetch status'
      })
    }
  }
)

/**
 * ---------------------------------------------------------
 * POST /api/mpesa/b2c-result
 * Withdrawal callback
 * ---------------------------------------------------------
 */

router.post('/b2c-result', async (req, res) => {

  res.status(200).json({
    ResultCode: 0,
    ResultDesc: 'Accepted'
  })

  try {

    const result = req.body?.Result

    if (!result) return

    const {
      ResultCode,
      TransactionID,
      OriginatorConversationID
    } = result

    const withdrawal = await db('withdrawals')
      .where({
        reference: OriginatorConversationID
      })
      .first()

    if (!withdrawal) return

    /**
     * SUCCESS
     */
    if (ResultCode === 0) {

      await db('withdrawals')
        .where({ id: withdrawal.id })
        .update({

          status: 'paid',

          mpesa_receipt: TransactionID,

          updated_at: new Date()
        })

      console.log(
        `[B2C] Withdrawal paid`
      )

      return
    }

    /**
     * FAILED → refund wallet
     */
    await db.transaction(async trx => {

      await trx('withdrawals')
        .where({ id: withdrawal.id })
        .update({

          status: 'failed',

          updated_at: new Date()
        })

      await ledger.postEntry({
        userId: withdrawal.user_id,

        type: 'reversal',

        amount: +withdrawal.net_amount,

        reference:
          `REV-${withdrawal.reference}`,

        description:
          'Withdrawal reversal',

        metadata: {
          withdrawalId: withdrawal.id
        },

        trx
      })
    })

    console.log(
      `[B2C] Withdrawal reversed`
    )

  } catch (err) {

    console.error(
      '[B2C RESULT ERROR]',
      err.message
    )
  }
})

/**
 * ---------------------------------------------------------
 * POST /api/mpesa/b2c-timeout
 * ---------------------------------------------------------
 */

router.post('/b2c-timeout', async (req, res) => {

  res.status(200).json({
    ResultCode: 0,
    ResultDesc: 'Accepted'
  })

  console.warn(
    '[B2C TIMEOUT]',
    JSON.stringify(req.body)
  )
})

module.exports = router
