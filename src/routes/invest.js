// src/routes/invest.js  ← REPLACEMENT
const express = require('express')
const { v4: uuid } = require('uuid')
const db      = require('../db')
const logger  = require('../config/logger')
const { authenticate } = require('../middleware/auth')

const router = express.Router()

// ── INVESTMENT PLANS ──────────────────────────────────────────
const INVESTMENT_PLANS = [
  {
    id:         'starter',
    name:       'Starter',
    apy:        0.08,         // 8% APY
    min_amount: 500,
    lock_days:  30,
    description: 'Low risk, 8% annual return. Locked for 30 days.',
  },
  {
    id:         'growth',
    name:       'Growth',
    apy:        0.15,         // 15% APY
    min_amount: 2000,
    lock_days:  90,
    description: 'Medium risk, 15% annual return. Locked for 90 days.',
  },
  {
    id:         'premium',
    name:       'Premium',
    apy:        0.25,         // 25% APY
    min_amount: 10000,
    lock_days:  180,
    description: 'Higher return, 25% annual return. Locked for 180 days.',
  },
  {
    id:         'flexible',
    name:       'Flexible',
    apy:        0.05,         // 5% APY
    min_amount: 100,
    lock_days:  0,            // no lock
    description: 'No lock-in, withdraw anytime. 5% annual return.',
  },
]

function calcInvestmentReturn(principal, apy, days) {
  const earnings = parseFloat((principal * apy * (days / 365)).toFixed(2))
  const total    = parseFloat((principal + earnings).toFixed(2))
  return { earnings, total }
}

// ── GET /api/invest/plans ─────────────────────────────────────
router.get('/plans', authenticate, (req, res) => {
  res.json({ plans: INVESTMENT_PLANS })
})

// ── GET /api/invest/mine ──────────────────────────────────────
router.get('/mine', authenticate, async (req, res) => {
  try {
    const investments = await db('investments')
      .where({ user_id: req.user.id })
      .orderBy('created_at', 'desc')

    const enriched = investments.map(inv => {
      const plan = INVESTMENT_PLANS.find(p => p.id === inv.plan_id)
      if (!plan) return inv
      const days = Math.floor((Date.now() - new Date(inv.started_at).getTime()) / 86400000)
      const { earnings, total } = calcInvestmentReturn(parseFloat(inv.amount), plan.apy, days)
      return {
        ...inv,
        plan,
        amount:        parseFloat(inv.amount),
        current_value: total,
        earnings,
        days_active:   days,
      }
    })

    return res.json({ investments: enriched })
  } catch (err) {
    logger.error('Failed to fetch investments', { err: err.message })
    return res.status(500).json({ error: 'Failed to fetch investments' })
  }
})

// ── POST /api/invest ──────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  const { plan_id } = req.body
  const amount      = parseFloat(req.body.amount)

  if (!plan_id || !amount || amount <= 0) {
    return res.status(400).json({ error: 'plan_id and amount are required' })
  }

  const plan = INVESTMENT_PLANS.find(p => p.id === plan_id)
  if (!plan) return res.status(400).json({ error: 'Invalid plan' })
  if (amount < plan.min_amount) {
    return res.status(400).json({ error: `Minimum investment is KES ${plan.min_amount}` })
  }

  try {
    const matures_at = plan.lock_days > 0
      ? new Date(Date.now() + plan.lock_days * 86400000)
      : null

    const investmentId = uuid()

    await db.transaction(async trx => {
      // Lock and check wallet
      const wallet = await trx('wallets')
        .where({ user_id: req.user.id })
        .forUpdate()
        .first()

      if (!wallet) throw new Error('WALLET_NOT_FOUND')
      if (parseFloat(wallet.available_balance) < amount) throw new Error('INSUFFICIENT_BALANCE')

      // Deduct from available balance
      await trx('wallets').where({ user_id: req.user.id }).update({
        available_balance: db.raw('available_balance - ?', [amount]),
        total_balance:     db.raw('total_balance - ?', [amount]),
        updated_at:        new Date(),
      })

      // Create investment record
      await trx('investments').insert({
        id:         investmentId,
        user_id:    req.user.id,
        plan_id,
        amount,
        status:     'active',
        started_at: new Date(),
        matures_at,
        created_at: new Date(),
        updated_at: new Date(),
      })

      // Record transaction
      const ref = `INV-${uuid().split('-')[0].toUpperCase()}`
      await trx('transactions').insert({
        id:          uuid(),
        user_id:     req.user.id,
        type:        'investment_in',
        amount,
        fee:         0,
        net_amount:  amount,
        status:      'completed',
        reference:   ref,
        description: `Invested in ${plan.name} plan`,
        metadata:    JSON.stringify({ plan_id, investment_id: investmentId }),
        created_at:  new Date(),
        updated_at:  new Date(),
      })
    })

    const expectedReturn = calcInvestmentReturn(amount, plan.apy, plan.lock_days || 365)

    return res.status(201).json({
      message:         'Investment started successfully',
      investmentId,
      plan,
      amount,
      matures_at,
      expected_return: expectedReturn,
    })

  } catch (err) {
    if (err.message === 'INSUFFICIENT_BALANCE') {
      return res.status(400).json({ error: 'Insufficient balance' })
    }
    if (err.message === 'WALLET_NOT_FOUND') {
      return res.status(404).json({ error: 'Wallet not found' })
    }
    logger.error('Investment failed', { err: err.message })
    return res.status(500).json({ error: 'Investment failed. Please try again.' })
  }
})

// ── POST /api/invest/:id/withdraw ─────────────────────────────
router.post('/:id/withdraw', authenticate, async (req, res) => {
  try {
    const investment = await db('investments')
      .where({ id: req.params.id, user_id: req.user.id })
      .first()

    if (!investment) {
      return res.status(404).json({ error: 'Investment not found' })
    }
    if (investment.status !== 'active') {
      return res.status(400).json({ error: 'Investment already withdrawn' })
    }

    const plan = INVESTMENT_PLANS.find(p => p.id === investment.plan_id)
    if (!plan) return res.status(400).json({ error: 'Plan not found' })

    // Check lock period
    if (plan.lock_days > 0 && investment.matures_at && new Date() < new Date(investment.matures_at)) {
      return res.status(400).json({
        error: `Investment is locked until ${new Date(investment.matures_at).toLocaleDateString('en-KE')}`,
      })
    }

    const days             = Math.floor((Date.now() - new Date(investment.started_at).getTime()) / 86400000)
    const principal        = parseFloat(investment.amount)
    const { earnings, total } = calcInvestmentReturn(principal, plan.apy, days)

    await db.transaction(async trx => {
      // Mark investment withdrawn
      await trx('investments').where({ id: investment.id }).update({
        status:     'withdrawn',
        updated_at: new Date(),
      })

      // Credit wallet
      await trx('wallets').where({ user_id: req.user.id }).update({
        available_balance: db.raw('available_balance + ?', [total]),
        total_balance:     db.raw('total_balance + ?', [total]),
        updated_at:        new Date(),
      })

      // Record transaction
      const ref = `INV-OUT-${uuid().split('-')[0].toUpperCase()}`
      await trx('transactions').insert({
        id:          uuid(),
        user_id:     req.user.id,
        type:        'investment_out',
        amount:      total,
        fee:         0,
        net_amount:  total,
        status:      'completed',
        reference:   ref,
        description: `Withdrew from ${plan.name} — KES ${earnings} earned`,
        metadata:    JSON.stringify({ plan_id: plan.id, investment_id: investment.id, principal, earnings, days }),
        created_at:  new Date(),
        updated_at:  new Date(),
      })
    })

    return res.json({
      message:   'Investment withdrawn successfully',
      principal,
      earnings,
      total,
      days_active: days,
    })

  } catch (err) {
    logger.error('Investment withdrawal failed', { err: err.message })
    return res.status(500).json({ error: 'Withdrawal failed. Please try again.' })
  }
})

module.exports = router
