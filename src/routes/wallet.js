const express = require('express')
const db      = require('../config/database')
const logger  = require('../config/logger')
const { authenticate, requireActive } = require('../middleware/auth')
const { transferLimiter }             = require('../middleware/rateLimit')
const { validate, rules }             = require('../middleware/validate')
const { auditLog }                    = require('../middleware/audit')
const { generateTxRef, calcFee, normalizePhone } = require('../utils/helpers')

const router = express.Router()
router.use(authenticate, requireActive)

router.get('/', async (req, res) => {
  try {
    const wallet = await db('wallets')
      .where({ user_id: req.user.userId })
      .select('balance', 'currency', 'investment_balance')
      .first()

    if (!wallet) return res.status(404).json({ error: 'Wallet not found' })

    res.json({
      balance:            parseFloat(wallet.balance),
      investment_balance: parseFloat(wallet.investment_balance || 0),
      currency:           wallet.currency,
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch wallet' })
  }
})

router.post('/transfer',
  transferLimiter, rules.transfer, validate,
  async (req, res) => {
    const senderId = req.user.userId
    const phone    = normalizePhone(req.body.phone)
    const amount   = parseFloat(req.body.amount)
    const note     = req.body.note?.trim() || null

    try {
      const sender = await db('users').where({ id: senderId }).first()
      if (normalizePhone(sender.phone) === phone) {
        return res.status(400).json({ error: 'You cannot transfer to yourself' })
      }

      const { fee, net } = calcFee(amount, 'TRANSFER')

      const tx = await db.transaction(async (trx) => {
        const senderWallet = await trx('wallets')
          .where({ user_id: senderId }).forUpdate().first()

        if (parseFloat(senderWallet.balance) < amount) throw new Error('INSUFFICIENT_BALANCE')

        const receiver = await trx('users').where({ phone }).first()
        if (!receiver)          throw new Error('RECIPIENT_NOT_FOUND')
        if (!receiver.is_active) throw new Error('RECIPIENT_SUSPENDED')

        await trx('wallets').where({ user_id: senderId })
          .decrement('balance', amount).update({ updated_at: new Date() })

        await trx('wallets').where({ user_id: receiver.id })
          .increment('balance', net).update({ updated_at: new Date() })

        const reference = generateTxRef()

        const [transaction] = await trx('transactions').insert({
          sender_id:   senderId,
          receiver_id: receiver.id,
          amount, fee,
          net_amount:  net,
          type:        'TRANSFER',
          status:      'SUCCESSFUL',
          reference,
          description: note,
          created_at:  new Date(),
        }).returning('*')

        await trx('fee_ledger').insert({
          transaction_id: transaction.id,
          amount: fee,
          type:   'TRANSFER_FEE',
          created_at: new Date(),
        })

        return { transaction, receiver }
      })

      await auditLog(req, 'TRANSFER', { amount, fee, to: phone })
      logger.info('Transfer successful', { from: senderId, to: phone, amount, fee })

      res.json({
        message:    'Transfer successful',
        reference:  tx.transaction.reference,
        amount, fee,
        net_amount: net,
        receiver:   { name: tx.receiver.name, phone: tx.receiver.phone },
      })
    } catch (err) {
      if (err.message === 'INSUFFICIENT_BALANCE')  return res.status(400).json({ error: 'Insufficient balance' })
      if (err.message === 'RECIPIENT_NOT_FOUND')   return res.status(404).json({ error: 'Recipient not found. Check the phone number.' })
      if (err.message === 'RECIPIENT_SUSPENDED')   return res.status(400).json({ error: 'Recipient account is suspended' })
      logger.error('Transfer failed', { err: err.message })
      res.status(500).json({ error: 'Transfer failed. Please try again.' })
    }
  }
)

router.post('/withdraw',
  rules.withdraw, validate,
  async (req, res) => {
    const userId = req.user.userId
    const amount = parseFloat(req.body.amount)
    const phone  = req.body.phone
      ? normalizePhone(req.body.phone)
      : normalizePhone((await db('users').where({ id: userId }).first()).phone)

    try {
      const wallet = await db('wallets').where({ user_id: userId }).select('balance').first()
      if (parseFloat(wallet.balance) < amount) {
        return res.status(400).json({ error: 'Insufficient balance' })
      }

      await db.transaction(async (trx) => {
        await trx('wallets').where({ user_id: userId })
          .forUpdate().decrement('balance', amount).update({ updated_at: new Date() })

        await trx('transactions').insert({
          sender_id:   userId,
          amount, fee: 0, net_amount: amount,
          type:        'MPESA_WITHDRAW',
          status:      'PENDING',
          reference:   generateTxRef(),
          description: `Withdrawal to ${phone}`,
          created_at:  new Date(),
        })
      })

      await auditLog(req, 'WITHDRAW_INITIATED', { amount, phone })
      res.json({ message: 'Withdrawal initiated. You will receive M-Pesa shortly.', amount, phone, status: 'PENDING' })
    } catch (err) {
      logger.error('Withdraw failed', { err: err.message })
      res.status(500).json({ error: 'Withdrawal failed. Please try again.' })
    }
  }
)

module.exports = router
