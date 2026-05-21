// migrations/003_financial_schema.js

exports.up = async function (knex) {

  // ── Enable pgcrypto extension ────────────────────────────────
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

  // ─────────────────────────────────────────────────────────────
  // WALLETS UPGRADE
  // ─────────────────────────────────────────────────────────────

  const hasAvailableBalance = await knex.schema.hasColumn('wallets', 'available_balance')

  if (!hasAvailableBalance) {
    await knex.schema.alterTable('wallets', (t) => {
      t.decimal('available_balance', 14, 2).defaultTo(0).notNullable()
    })

    // migrate old balance
    await knex.raw(`
      UPDATE wallets
      SET available_balance = balance
    `)
  }

  const hasLockedBalance = await knex.schema.hasColumn('wallets', 'locked_balance')

  if (!hasLockedBalance) {
    await knex.schema.alterTable('wallets', (t) => {
      t.decimal('locked_balance', 14, 2).defaultTo(0).notNullable()
    })
  }

  const hasTotalBalance = await knex.schema.hasColumn('wallets', 'total_balance')

  if (!hasTotalBalance) {
    await knex.schema.alterTable('wallets', (t) => {
      t.decimal('total_balance', 14, 2).defaultTo(0).notNullable()
    })

    // migrate old balance
    await knex.raw(`
      UPDATE wallets
      SET total_balance = balance
    `)
  }

  // ─────────────────────────────────────────────────────────────
  // TRANSACTIONS UPGRADE
  // ─────────────────────────────────────────────────────────────

  const hasCheckoutRequestId = await knex.schema.hasColumn('transactions', 'checkout_request_id')

  if (!hasCheckoutRequestId) {
    await knex.schema.alterTable('transactions', (t) => {
      t.string('checkout_request_id').unique().nullable()
    })
  }

  const hasMerchantRequestId = await knex.schema.hasColumn('transactions', 'merchant_request_id')

  if (!hasMerchantRequestId) {
    await knex.schema.alterTable('transactions', (t) => {
      t.string('merchant_request_id').nullable()
    })
  }

  // ─────────────────────────────────────────────────────────────
  // LEDGER TABLE
  // ─────────────────────────────────────────────────────────────

  const hasLedger = await knex.schema.hasTable('ledger')

  if (!hasLedger) {
    await knex.schema.createTable('ledger', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))

      t.uuid('user_id')
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
        .nullable()

      t.uuid('wallet_id')
        .references('id')
        .inTable('wallets')
        .onDelete('SET NULL')
        .nullable()

      t.enum('type', [
        'deposit',
        'withdrawal',
        'transfer_in',
        'transfer_out',
        'wifi_purchase',
        'wifi_refund',
        'fee',
        'commission',
        'merchant_credit',
        'merchant_debit',
        'platform_fee',
        'reversal'
      ]).notNullable()

      t.decimal('amount', 14, 2).notNullable()
      t.decimal('balance_before', 14, 2).notNullable()
      t.decimal('balance_after', 14, 2).notNullable()

      t.string('reference').unique().notNullable()

      t.uuid('transaction_id').nullable()

      t.text('description')

      t.enum('status', [
        'pending',
        'completed',
        'failed',
        'reversed'
      ]).defaultTo('completed')

      t.jsonb('metadata').defaultTo('{}')

      t.timestamps(true, true)
    })
  }

  // ─────────────────────────────────────────────────────────────
  // PLATFORM REVENUE
  // ─────────────────────────────────────────────────────────────

  const hasPlatformRevenue = await knex.schema.hasTable('platform_revenue')

  if (!hasPlatformRevenue) {
    await knex.schema.createTable('platform_revenue', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))

      t.uuid('transaction_id').nullable()

      t.uuid('ledger_id')
        .references('id')
        .inTable('ledger')
        .onDelete('SET NULL')
        .nullable()

      t.enum('source', [
        'transfer_fee',
        'wifi_purchase_fee',
        'withdrawal_fee',
        'merchant_fee',
        'subscription_fee',
        'other'
      ]).notNullable()

      t.decimal('amount', 14, 2).notNullable()

      t.decimal('fee_rate', 5, 4).defaultTo(0.01)

      t.uuid('payer_id')
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
        .nullable()

      t.text('description')

      t.timestamps(true, true)
    })
  }

  // ─────────────────────────────────────────────────────────────
  // MERCHANT WALLETS
  // ─────────────────────────────────────────────────────────────

  const hasMerchantWallets = await knex.schema.hasTable('merchant_wallets')

  if (!hasMerchantWallets) {
    await knex.schema.createTable('merchant_wallets', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))

      t.uuid('merchant_id')
        .references('id')
        .inTable('merchant_profiles')
        .onDelete('CASCADE')
        .unique()

      t.decimal('balance', 14, 2).defaultTo(0)
      t.decimal('total_earnings', 14, 2).defaultTo(0)
      t.decimal('pending_withdrawal', 14, 2).defaultTo(0)
      t.decimal('total_withdrawn', 14, 2).defaultTo(0)

      t.string('currency', 3).defaultTo('KES')

      t.timestamps(true, true)
    })
  }

  // ─────────────────────────────────────────────────────────────
  // WIFI OFFERS
  // ─────────────────────────────────────────────────────────────

  const hasWifiOffers = await knex.schema.hasTable('wifi_offers')

  if (!hasWifiOffers) {
    await knex.schema.createTable('wifi_offers', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))

      t.uuid('merchant_id')
        .references('id')
        .inTable('merchant_profiles')
        .onDelete('CASCADE')

      t.string('name').notNullable()

      t.enum('duration_type', [
        'hourly',
        'midnight',
        'daily',
        'weekly',
        'monthly'
      ]).notNullable()

      t.integer('duration_hours').notNullable()

      t.decimal('price', 14, 2).notNullable()

      t.string('speed_profile').defaultTo('5Mbps')

      t.integer('max_devices').defaultTo(1)

      t.boolean('active').defaultTo(true)

      t.integer('purchase_count').defaultTo(0)

      t.timestamps(true, true)
    })
  }

  // ─────────────────────────────────────────────────────────────
  // WIFI PURCHASES
  // ─────────────────────────────────────────────────────────────

  const hasWifiPurchases = await knex.schema.hasTable('wifi_purchases')

  if (!hasWifiPurchases) {
    await knex.schema.createTable('wifi_purchases', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))

      t.uuid('customer_id')
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
        .nullable()

      t.uuid('merchant_id')
        .references('id')
        .inTable('merchant_profiles')
        .onDelete('SET NULL')
        .nullable()

      t.uuid('offer_id')
        .references('id')
        .inTable('wifi_offers')
        .onDelete('SET NULL')
        .nullable()

      t.uuid('transaction_id')
        .references('id')
        .inTable('transactions')
        .onDelete('SET NULL')
        .nullable()

      t.decimal('amount', 14, 2).notNullable()
      t.decimal('fee', 14, 2).defaultTo(0)
      t.decimal('merchant_credit', 14, 2).notNullable()

      t.enum('status', [
        'pending',
        'active',
        'expired',
        'cancelled',
        'refunded'
      ]).defaultTo('pending')

      t.timestamp('activated_at').nullable()
      t.timestamp('expiry_time').nullable()

      t.string('checkout_request_id').nullable()

      t.timestamps(true, true)
    })
  }

  // ─────────────────────────────────────────────────────────────
  // WIFI SESSIONS
  // ─────────────────────────────────────────────────────────────

  const hasWifiSessions = await knex.schema.hasTable('wifi_sessions')

  if (!hasWifiSessions) {
    await knex.schema.createTable('wifi_sessions', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))

      t.uuid('purchase_id')
        .references('id')
        .inTable('wifi_purchases')
        .onDelete('CASCADE')

      t.uuid('user_id')
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
        .nullable()

      t.string('device_mac').nullable()
      t.string('device_ip').nullable()

      t.string('username').nullable()

      t.timestamp('start_time').notNullable()
      t.timestamp('expiry_time').notNullable()

      t.enum('status', [
        'active',
        'expired',
        'disconnected',
        'blocked'
      ]).defaultTo('active')

      t.integer('device_count').defaultTo(0)

      t.bigInteger('bytes_up').defaultTo(0)
      t.bigInteger('bytes_down').defaultTo(0)

      t.timestamps(true, true)
    })
  }

  // ─────────────────────────────────────────────────────────────
  // WITHDRAWALS
  // ─────────────────────────────────────────────────────────────

  const hasWithdrawals = await knex.schema.hasTable('withdrawals')

  if (!hasWithdrawals) {
    await knex.schema.createTable('withdrawals', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))

      t.uuid('user_id')
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
        .nullable()

      t.uuid('merchant_id')
        .references('id')
        .inTable('merchant_profiles')
        .onDelete('SET NULL')
        .nullable()

      t.decimal('amount', 14, 2).notNullable()
      t.decimal('fee', 14, 2).defaultTo(0)
      t.decimal('net_amount', 14, 2).notNullable()

      t.enum('status', [
        'pending',
        'approved',
        'processing',
        'paid',
        'rejected',
        'failed'
      ]).defaultTo('pending')

      t.enum('method', ['mpesa', 'bank']).defaultTo('mpesa')

      t.string('phone_number').nullable()
      t.string('mpesa_receipt').nullable()

      t.uuid('approved_by')
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
        .nullable()

      t.timestamp('approved_at').nullable()

      t.text('rejection_reason').nullable()

      t.timestamps(true, true)
    })
  }

  // ─────────────────────────────────────────────────────────────
  // NOTIFICATIONS
  // ─────────────────────────────────────────────────────────────

  const hasNotifications = await knex.schema.hasTable('notifications')

  if (!hasNotifications) {
    await knex.schema.createTable('notifications', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))

      t.uuid('user_id')
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      t.string('title').notNullable()

      t.text('body').notNullable()

      t.enum('type', [
        'info',
        'success',
        'warning',
        'error',
        'payment',
        'wifi'
      ]).defaultTo('info')

      t.boolean('read').defaultTo(false)

      t.jsonb('data').defaultTo('{}')

      t.timestamps(true, true)
    })
  }
}

exports.down = async function (knex) {

  await knex.schema.dropTableIfExists('notifications')
  await knex.schema.dropTableIfExists('withdrawals')
  await knex.schema.dropTableIfExists('wifi_sessions')
  await knex.schema.dropTableIfExists('wifi_purchases')
  await knex.schema.dropTableIfExists('wifi_offers')
  await knex.schema.dropTableIfExists('merchant_wallets')
  await knex.schema.dropTableIfExists('platform_revenue')
  await knex.schema.dropTableIfExists('ledger')

}
