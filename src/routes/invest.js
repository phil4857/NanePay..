const express = require('express')
const db      = require('../config/database')
const logger  = require('../config/logger')
const { authenticate, requireActive } = require('../middleware/auth')
const { validate, rules }             = require('../middleware/validate')
const { auditLog }                    = require('../middleware/audit')
const { generateTxRef, INVESTMENT_PLANS, calcInvestmentReturn } = require('../utils/helpers')

const router = express.Router()
router.use(authenticate, requireActive)

router.get('/plans', (req, res) => res.json({ plans: INVESTMENT_PLANS }))

router.get('/mine', async (req, res) => {
  try {
    const investments = await db('investments').where({ user_id: req.user.userId }).orderBy('created_at', 'desc')
    const enriched = investments.map(inv => {
      const plan = INVESTMENT_PLANS.find(p => p.id === inv.plan_id)
      const days = Math.floor((new Date() - new Date(inv.started_at)) / 86400000)
      const { earnings, total } = calcInvestmentReturn(parseFloat(inv.amount), plan.apy, days)
      return { ...inv, plan, amount: parseFloat(inv.amount), current_value: total, earnings, days_active: days }
    })
    res.json({ investments: enriched })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch investments' })
  }
})

router.post('/', rules.invest, validate, async (req, res) => {
  const userId  = req.user.userId
  const plan_id = req.body.plan_id
  const amount  = parseFloat(req.body.amount)
  const plan    = INVESTMENT_PLANS.find(p => p.id === plan_id)
  if (!plan) return res.status(400).json({ error: 'Invalid plan' })
  if (amount < plan.min_amount) return res.status(400).json({ error: `Minimum is KES ${plan.min_amount}` })

  try {
    const matures_at = plan.lock_days > 0
      ? new Date(Date.now() + plan.lock_days * 86400000)
      : null

    const investment = await db.transaction(async (trx) => {
      const wallet = await trx('wallets').where({ user_id: userId }).forUpdate().first()
      if (parseFloat(wallet.balance) < amount) throw new Error('INSUFFICIENT_BALANCE')

      await trx('wallets').where({ user_id: userId })
        .decrement('balance', amount).increment('investment_balance', amount).update({ updated_at: new Date() })

      const [inv] = await trx('investments').insert({
        user_id: userId, plan_id, amount, status: 'ACTIVE',
        started_at: new Date(), matures_at, created_at: new Date(),
      }).returning('*')

      await trx('transactions').insert({
        sender_id: userId, amount, fee: 0, net_amount: amount,
        type: 'INVESTMENT_IN', status: 'SUCCESSFUL',
        reference: generateTxRef(), description: `Invested in ${plan.name}`, created_at: new Date(),
      })

      return inv
    })

    res.status(201).json({
      message: 'Investment started successfully',
      investment: { ...investment, plan, amount },
      expected_return: calcInvestmentReturn(amount, plan.apy, plan.lock_days || 365),
    })
  } catch (err) {
    if (err.message === 'INSUFFICIENT_BALANCE') return res.status(400).json({ error: 'Insufficient balance' })
    logger.error('Investment failed', { err: err.message })
    res.status(500).json({ error: 'Investment failed. Please try again.' })
  }
})

router.post('/:id/withdraw', async (req, res) => {
  const userId = req.user.userId
  try {
    const investment = await db('investments').where({ id: req.params.id, user_id: userId }).first()
    if (!investment) return res.status(404).json({ error: 'Investment not found' })
    if (investment.status !== 'ACTIVE') return res.status(400).json({ error: 'Already withdrawn' })

    const plan = INVESTMENT_PLANS.find(p => p.id === investment.plan_id)
    if (plan.lock_days > 0 && new Date() < new Date(investment.matures_at)) {
      return res.status(400).json({ error: `Locked until ${new Date(investment.matures_at).toLocaleDateString()}` })
    }

    const days = Math.floor((new Date() - new Date(investment.started_at)) / 86400000)
    const { earnings, total } = calcInvestmentReturn(parseFloat(investment.amount), plan.apy, days)

    await db.transaction(async (trx) => {
      await trx('investments').where({ id: investment.id }).update({ status: 'WITHDRAWN' })
      await trx('wallets').where({ user_id: userId })
        .increment('balance', total).decrement('investment_balance', parseFloat(investment.amount)).update({ updated_at: new Date() })
      await trx('transactions').insert({
        receiver_id: userId, amount: total, fee: 0, net_amount: total,
        type: 'INVESTMENT_OUT', status: 'SUCCESSFUL',
        reference: generateTxRef(), description: `Withdrew from ${plan.name} — KES ${earnings} earned`, created_at: new Date(),
      })
    })

    res.json({ message: 'Investment withdrawn', principal: parseFloat(investment.amount), earnings, total })
  } catch (err) {
    res.status(500).json({ error: 'Withdrawal failed.' })
  }
})

module.exports = router
