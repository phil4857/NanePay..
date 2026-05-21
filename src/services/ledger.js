// src/services/ledger.js

const { v4: uuid } = require('uuid')
const db = require('../config/database')

// ───────────────────────────────────────────────────────────────
// PLATFORM CONFIG
// ───────────────────────────────────────────────────────────────

const PLATFORM_FEE_RATE   = parseFloat(process.env.PLATFORM_FEE_RATE || '0.01')
const WIFI_FEE_RATE       = parseFloat(process.env.WIFI_FEE_RATE || '0.01')
const WITHDRAWAL_FEE_RATE = parseFloat(process.env.WITHDRAWAL_FEE_RATE || '0.01')

// Platform receiving account (Pochi / Bank)
const PLATFORM_RECEIVER = process.env.PLATFORM_RECEIVER || '0748066116'

// ───────────────────────────────────────────────────────────────
// SYSTEM WALLET CREDIT
// ───────────────────────────────────────────────────────────────

async function creditSystemWallet(trx, amount) {

  const wallet = await trx('system_wallet').first()

  if (!wallet) {
    throw new Error('System wallet not initialized')
  }

  await trx('system_wallet')
    .where({ id: wallet.id })
    .update({
      available_balance:
        parseFloat(wallet.available_balance) + parseFloat(amount),

      total_revenue:
        parseFloat(wallet.total_revenue) + parseFloat(amount),

      updated_at: new Date()
    })
}

// ───────────────────────────────────────────────────────────────
// CORE LEDGER ENTRY
// ONLY THIS FUNCTION MAY CHANGE USER BALANCES
// ───────────────────────────────────────────────────────────────

async function postEntry({
  userId,
  type,
  amount,
  reference,
  description = '',
  transactionId = null,
  metadata = {},
  trx = null
}) {

  const run = async (t) => {

    // Lock wallet row
    const wallet = await t('wallets')
      .where({ user_id: userId })
      .forUpdate()
      .first()

    if (!wallet) {
      throw new Error(`Wallet not found for user ${userId}`)
    }

    const balanceBefore = parseFloat(wallet.available_balance || 0)

    const balanceAfter = parseFloat(
      (balanceBefore + amount).toFixed(2)
    )

    if (balanceAfter < 0) {
      throw new Error(
        `Insufficient balance. Available: ${balanceBefore}`
      )
    }

    const entryId = uuid()

    // Ledger entry
    await t('ledger').insert({
      id: entryId,
      user_id: userId,
      wallet_id: wallet.id,
      type,
      amount,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      reference,
      transaction_id: transactionId,
      description,
      status: 'completed',
      metadata,
      created_at: new Date(),
      updated_at: new Date()
    })

    // Update wallet
    await t('wallets')
      .where({ user_id: userId })
      .update({
        available_balance: balanceAfter,

        total_balance:
          balanceAfter +
          parseFloat(wallet.locked_balance || 0),

        updated_at: new Date()
      })

    const updatedWallet = await t('wallets')
      .where({ user_id: userId })
      .first()

    const ledgerEntry = await t('ledger')
      .where({ id: entryId })
      .first()

    return {
      ledgerEntry,
      wallet: updatedWallet
    }
  }

  if (trx) {
    return run(trx)
  }

  return db.transaction(run)
}

// ───────────────────────────────────────────────────────────────
// USER TO USER TRANSFER
// ───────────────────────────────────────────────────────────────

async function transfer({
  fromUserId,
  toUserId,
  amount,
  description = '',
  metadata = {}
}) {

  amount = parseFloat(amount)

  const fee = parseFloat(
    (amount * PLATFORM_FEE_RATE).toFixed(2)
  )

  const total = parseFloat(
    (amount + fee).toFixed(2)
  )

  const ref =
    `TXF-${uuid().split('-')[0].toUpperCase()}`

  return db.transaction(async trx => {

    // Debit sender
    const { ledgerEntry: debitEntry } = await postEntry({
      userId: fromUserId,
      type: 'transfer_out',
      amount: -total,
      reference: `${ref}-OUT`,
      description:
        `Transfer sent. Fee receiver: ${PLATFORM_RECEIVER}`,
      metadata,
      trx
    })

    // Credit receiver
    await postEntry({
      userId: toUserId,
      type: 'transfer_in',
      amount: amount,
      reference: `${ref}-IN`,
      description: 'Transfer received',
      metadata,
      trx
    })

    // Platform revenue
    await trx('platform_revenue').insert({
      id: uuid(),
      ledger_id: debitEntry.id,
      source: 'transfer_fee',
      amount: fee,
      fee_rate: PLATFORM_FEE_RATE,
      payer_id: fromUserId,
      description:
        `1% transfer fee credited to ${PLATFORM_RECEIVER}`,
      created_at: new Date(),
      updated_at: new Date()
    })

    // Credit platform wallet
    await creditSystemWallet(trx, fee)

    return {
      reference: ref,
      amount,
      fee,
      total
    }
  })
}

// ───────────────────────────────────────────────────────────────
// MPESA DEPOSIT
// ───────────────────────────────────────────────────────────────

async function deposit({
  userId,
  amount,
  reference,
  mpesaReceipt,
  checkoutRequestId = null,
  merchantRequestId = null,
  metadata = {}
}) {

  amount = parseFloat(amount)

  return db.transaction(async trx => {

    // Prevent duplicate callbacks
    if (checkoutRequestId) {

      const existing = await trx('transactions')
        .where({
          checkout_request_id: checkoutRequestId,
          status: 'completed'
        })
        .first()

      if (existing) {
        return {
          duplicate: true,
          transaction: existing
        }
      }
    }

    const txnId = uuid()

    // Create transaction
    await trx('transactions').insert({
      id: txnId,
      user_id: userId,
      type: 'deposit',
      amount,
      fee: 0,
      net_amount: amount,
      status: 'completed',
      reference,
      mpesa_receipt: mpesaReceipt,
      checkout_request_id: checkoutRequestId,
      merchant_request_id: merchantRequestId,
      description:
        `M-Pesa deposit received on ${PLATFORM_RECEIVER}`,
      metadata,
      created_at: new Date(),
      updated_at: new Date()
    })

    // Credit wallet
    const result = await postEntry({
      userId,
      type: 'deposit',
      amount,
      reference: `DEP-${reference}`,
      transactionId: txnId,
      description:
        `M-Pesa deposit via ${PLATFORM_RECEIVER}`,
      metadata: {
        ...metadata,
        mpesaReceipt
      },
      trx
    })

    return {
      transactionId: txnId,
      ...result
    }
  })
}

// ───────────────────────────────────────────────────────────────
// WIFI PURCHASE
// USER PAYS → MERCHANT GETS CREDIT → PLATFORM TAKES 1%
// ───────────────────────────────────────────────────────────────

async function wifiPurchaseDebit({
  userId,
  merchantId,
  amount,
  purchaseId,
  reference,
  trx
}) {

  amount = parseFloat(amount)

  const fee = parseFloat(
    (amount * WIFI_FEE_RATE).toFixed(2)
  )

  const merchantCredit = parseFloat(
    (amount - fee).toFixed(2)
  )

  // Debit user
  await postEntry({
    userId,
    type: 'wifi_purchase',
    amount: -amount,
    reference: `WIFI-${reference}`,
    description:
      `WiFi purchase. Fee sent to ${PLATFORM_RECEIVER}`,
    metadata: {
      purchaseId,
      merchantId,
      fee
    },
    trx
  })

  // Credit merchant
  await trx('merchant_wallets')
    .where({ merchant_id: merchantId })
    .increment('balance', merchantCredit)
    .increment('total_earnings', merchantCredit)

  // Record revenue
  await trx('platform_revenue').insert({
    id: uuid(),
    source: 'wifi_purchase_fee',
    amount: fee,
    fee_rate: WIFI_FEE_RATE,
    payer_id: userId,
    description:
      `WiFi fee credited to ${PLATFORM_RECEIVER}`,
    created_at: new Date(),
    updated_at: new Date()
  })

  // Credit system wallet
  await creditSystemWallet(trx, fee)

  return {
    amount,
    fee,
    merchantCredit
  }
}

// ───────────────────────────────────────────────────────────────
// WITHDRAWAL
// ───────────────────────────────────────────────────────────────

async function withdrawalDebit({
  userId,
  amount,
  withdrawalId,
  reference,
  trx
}) {

  amount = parseFloat(amount)

  const fee = parseFloat(
    (amount * WITHDRAWAL_FEE_RATE).toFixed(2)
  )

  const total = parseFloat(
    (amount + fee).toFixed(2)
  )

  // Debit wallet
  await postEntry({
    userId,
    type: 'withdrawal',
    amount: -total,
    reference: `WD-${reference}`,
    description:
      `Withdrawal. Fee credited to ${PLATFORM_RECEIVER}`,
    metadata: {
      withdrawalId,
      fee
    },
    trx
  })

  // Record revenue
  await trx('platform_revenue').insert({
    id: uuid(),
    source: 'withdrawal_fee',
    amount: fee,
    fee_rate: WITHDRAWAL_FEE_RATE,
    payer_id: userId,
    description:
      `Withdrawal fee credited to ${PLATFORM_RECEIVER}`,
    created_at: new Date(),
    updated_at: new Date()
  })

  // Credit system wallet
  await creditSystemWallet(trx, fee)

  return {
    amount,
    fee,
    total
  }
}

module.exports = {
  postEntry,
  transfer,
  deposit,
  wifiPurchaseDebit,
  withdrawalDebit,
  creditSystemWallet
}
