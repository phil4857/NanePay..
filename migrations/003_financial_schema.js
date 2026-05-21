// migrations/003_financial_schema.js

exports.up = async function (knex) {

  // ── Enable pgcrypto ──────────────────────────────────────────
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

  // ─────────────────────────────────────────────────────────────
  // WALLETS UPGRADE
  // ─────────────────────────────────────────────────────────────

  const hasAvailableBalance =
    await knex.schema.hasColumn('wallets', 'available_balance')

  if (!hasAvailableBalance) {
    await knex.schema.alterTable('wallets', (t) => {
      t.decimal('available_balance', 14, 2)
        .defaultTo(0)
        .notNullable()
    })

    await knex.raw(`
      UPDATE wallets
      SET available_balance = balance
    `)
  }

  const hasLockedBalance =
    await knex.schema.hasColumn('wallets', 'locked_balance')

  if (!hasLockedBalance) {
    await knex.schema.alterTable('wallets', (t) => {
      t.decimal('locked_balance', 14, 2)
        .defaultTo(0)
        .notNullable()
    })
  }

  const hasTotalBalance =
    await knex.schema.hasColumn('wallets', 'total_balance')

  if (!hasTotalBalance) {
    await knex.schema.alterTable('wallets', (t) => {
      t.decimal('total_balance', 14, 2)
        .defaultTo(0)
        .notNullable()
    })

    await knex.raw(`
      UPDATE wallets
      SET total_balance = balance
    `)
  }

  // ─────────────────────────────────────────────────────────────
  // TRANSACTIONS UPGRADE
  // ─────────────────────────────────────────────────────────────

  const hasCheckoutRequestId =
    await knex.schema.hasColumn('transactions', 'checkout_request_id')

  if (!hasCheckoutRequestId) {
    await knex.schema.alterTable('transactions', (t) => {
      t.string('checkout_request_id').unique().nullable()
    })
  }

  const hasMerchantRequestId =
    await knex.schema.hasColumn('transactions', 'merchant_request_id')

  if (!hasMerchantRequestId) {
    await knex.schema.alterTable('transactions', (t) => {
      t.string('merchant_request_id').nullable()
    })
  }

  // ─────────────────────────────────────────────────────────────
  // LEDGER
  // ─────────────────────────────────────────────────────────────

  const hasLedger = await knex.schema.hasTable('ledger')

  if (!hasLedger) {
    await knex.schema.createTable('ledger', (t) => {

      t.uuid('id')
        .primary()
        .defaultTo(knex.raw('gen_random_uuid()'))

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
        'service_payment',
        'wifi_purchase',
        'fee',
        'commission',
        'merchant_credit',
        'merchant_debit',
        'platform_fee',
        'refund',
        'reversal'
      ]).notNullable()

      t.decimal('amount', 14, 2).notNullable()

      t.decimal('balance_before', 14, 2).notNullable()

      t.decimal('balance_after', 14, 2).notNullable()

      t.string('reference').unique().notNullable()

      t.uuid('transaction_id')
        .references('id')
        .inTable('transactions')
        .onDelete('SET NULL')
        .nullable()

      t.text('description').nullable()

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

  const hasPlatformRevenue =
    await knex.schema.hasTable('platform_revenue')

  if (!hasPlatformRevenue) {
    await knex.schema.createTable('platform_revenue', (t) => {

      t.uuid('id')
        .primary()
        .defaultTo(knex.raw('gen_random_uuid()'))

      t.uuid('transaction_id')
        .references('id')
        .inTable('transactions')
        .onDelete('SET NULL')
        .nullable()

      t.uuid('ledger_id')
        .references('id')
        .inTable('ledger')
        .onDelete('SET NULL')
        .nullable()

      t.enum('source', [
        'transfer_fee',
        'wifi_fee',
        'withdrawal_fee',
        'merchant_fee',
        'subscription_fee',
        'service_fee',
        'other'
      ]).notNullable()

      t.decimal('amount', 14, 2).notNullable()

      t.decimal('fee_rate', 5, 4)
        .defaultTo(0.01)

      t.uuid('payer_id')
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
        .nullable()

      t.text('description').nullable()

      t.timestamps(true, true)
    })
  }

  // ─────────────────────────────────────────────────────────────
  // MERCHANT WALLETS
  // ─────────────────────────────────────────────────────────────

  const hasMerchantWallets =
    await knex.schema.hasTable('merchant_wallets')

  if (!hasMerchantWallets) {
    await knex.schema.createTable('merchant_wallets', (t) => {

      t.uuid('id')
        .primary()
        .defaultTo(knex.raw('gen_random_uuid()'))

      t.uuid('merchant_id')
        .references('id')
        .inTable('merchant_profiles')
        .onDelete('CASCADE')
        .unique()

      t.decimal('balance', 14, 2)
        .defaultTo(0)

      t.decimal('pending_balance', 14, 2)
        .defaultTo(0)

      t.decimal('total_earnings', 14, 2)
        .defaultTo(0)

      t.decimal('total_withdrawn', 14, 2)
        .defaultTo(0)

      t.string('currency', 3)
        .defaultTo('KES')

      t.timestamps(true, true)
    })
  }

  // ─────────────────────────────────────────────────────────────
  // PACKAGES
  // ─────────────────────────────────────────────────────────────

  const hasPackages =
    await knex.schema.hasTable('packages')

  if (!hasPackages) {
    await knex.schema.createTable('packages', (t) => {

      t.uuid('id')
        .primary()
        .defaultTo(knex.raw('gen_random_uuid()'))

      t.uuid('merchant_id')
        .nullable()
        .references('id')
        .inTable('merchant_profiles')
        .onDelete('CASCADE')

      t.string('name', 100).notNullable()

      t.text('description').nullable()

      t.enum('category', [
        'WIFI',
        'ELECTRICITY',
        'WATER',
        'SCHOOL',
        'RENT',
        'CUSTOM'
      ]).defaultTo('WIFI')

      t.enum('duration_type', [
        'MINUTES',
        'HOURS',
        'DAYS',
        'MONTHS'
      ]).notNullable()

      t.integer('duration_value').notNullable()

      t.decimal('price', 15, 2).notNullable()

      t.string('speed_profile', 50).nullable()

      t.integer('device_limit').defaultTo(1)

      t.boolean('is_active').defaultTo(true)

      t.jsonb('metadata').nullable()

      t.timestamp('created_at')
        .defaultTo(knex.fn.now())
    })
  }

  // ─────────────────────────────────────────────────────────────
  // SUBSCRIPTIONS
  // ─────────────────────────────────────────────────────────────

  const hasSubscriptions =
    await knex.schema.hasTable('subscriptions')

  if (!hasSubscriptions) {
    await knex.schema.createTable('subscriptions', (t) => {

      t.uuid('id')
        .primary()
        .defaultTo(knex.raw('gen_random_uuid()'))

      t.uuid('user_id')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      t.uuid('package_id')
        .notNullable()
        .references('id')
        .inTable('packages')

      t.uuid('merchant_id')
        .notNullable()
        .references('id')
        .inTable('merchant_profiles')

      t.uuid('transaction_id')
        .nullable()
        .references('id')
        .inTable('transactions')

      t.enum('status', [
        'PENDING',
        'ACTIVE',
        'EXPIRED',
        'CANCELLED',
        'SUSPENDED'
      ]).defaultTo('PENDING')

      t.string('account_reference', 100).nullable()

      t.timestamp('activated_at').nullable()

      t.timestamp('expires_at').nullable()

      t.integer('devices_connected')
        .defaultTo(0)

      t.jsonb('metadata').nullable()

      t.timestamp('created_at')
        .defaultTo(knex.fn.now())
    })
  }

  // ─────────────────────────────────────────────────────────────
  // HOTSPOT SESSIONS
  // ─────────────────────────────────────────────────────────────

  const hasHotspotSessions =
    await knex.schema.hasTable('hotspot_sessions')

  if (!hasHotspotSessions) {
    await knex.schema.createTable('hotspot_sessions', (t) => {

      t.uuid('id')
        .primary()
        .defaultTo(knex.raw('gen_random_uuid()'))

      t.uuid('subscription_id')
        .notNullable()
        .references('id')
        .inTable('subscriptions')
        .onDelete('CASCADE')

      t.uuid('user_id')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      t.string('mac_address', 20).nullable()

      t.string('ip_address', 45).nullable()

      t.string('device_name', 100).nullable()

      t.bigInteger('bytes_uploaded')
        .defaultTo(0)

      t.bigInteger('bytes_downloaded')
        .defaultTo(0)

      t.enum('status', [
        'ACTIVE',
        'DISCONNECTED',
        'EXPIRED'
      ]).defaultTo('ACTIVE')

      t.timestamp('started_at')
        .defaultTo(knex.fn.now())

      t.timestamp('ended_at').nullable()
    })
  }

  // ─────────────────────────────────────────────────────────────
  // ROUTERS
  // ─────────────────────────────────────────────────────────────

  const hasRouters =
    await knex.schema.hasTable('routers')

  if (!hasRouters) {
    await knex.schema.createTable('routers', (t) => {

      t.uuid('id')
        .primary()
        .defaultTo(knex.raw('gen_random_uuid()'))

      t.uuid('merchant_id')
        .notNullable()
        .references('id')
        .inTable('merchant_profiles')
        .onDelete('CASCADE')

      t.string('name', 100).notNullable()

      t.enum('type', [
        'MIKROTIK',
        'OPENWRT',
        'RADIUS',
        'CUSTOM'
      ]).defaultTo('MIKROTIK')

      t.string('ip_address', 45).nullable()

      t.integer('port')
        .defaultTo(8728)

      t.string('username', 100).nullable()

      t.string('password_encrypted', 255).nullable()

      t.string('api_endpoint', 255).nullable()

      t.string('api_key_router', 255).nullable()

      t.boolean('is_online')
        .defaultTo(false)

      t.timestamp('last_seen').nullable()

      t.jsonb('config').nullable()

      t.timestamp('created_at')
        .defaultTo(knex.fn.now())
    })
  }

  // ─────────────────────────────────────────────────────────────
  // COMMISSIONS
  // ─────────────────────────────────────────────────────────────

  const hasCommissions =
    await knex.schema.hasTable('commissions')

  if (!hasCommissions) {
    await knex.schema.createTable('commissions', (t) => {

      t.uuid('id')
        .primary()
        .defaultTo(knex.raw('gen_random_uuid()'))

      t.uuid('merchant_id')
        .notNullable()
        .references('id')
        .inTable('merchant_profiles')
        .onDelete('CASCADE')

      t.uuid('transaction_id')
        .notNullable()
        .references('id')
        .inTable('transactions')

      t.decimal('transaction_amount', 15, 2)
        .notNullable()

      t.decimal('commission_rate', 5, 4)
        .notNullable()

      t.decimal('commission_amount', 15, 2)
        .notNullable()

      t.decimal('nanepay_fee', 15, 2)
        .notNullable()

      t.decimal('merchant_payout', 15, 2)
        .notNullable()

      t.enum('status', [
        'PENDING',
        'PAID',
        'HELD'
      ]).defaultTo('PENDING')

      t.timestamp('created_at')
        .defaultTo(knex.fn.now())
    })
  }

  // ─────────────────────────────────────────────────────────────
  // PASSWORD RESETS
  // ─────────────────────────────────────────────────────────────

  const hasPasswordResets =
    await knex.schema.hasTable('password_resets')

  if (!hasPasswordResets) {
    await knex.schema.createTable('password_resets', (t) => {

      t.bigIncrements('id')

      t.uuid('user_id')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      t.string('token', 100)
        .unique()
        .notNullable()

      t.boolean('used')
        .defaultTo(false)

      t.timestamp('expires_at')
        .notNullable()

      t.timestamp('created_at')
        .defaultTo(knex.fn.now())
    })
  }

  // ─────────────────────────────────────────────────────────────
  // MERCHANT RATINGS
  // ─────────────────────────────────────────────────────────────

  const hasMerchantRatings =
    await knex.schema.hasTable('merchant_ratings')

  if (!hasMerchantRatings) {
    await knex.schema.createTable('merchant_ratings', (t) => {

      t.uuid('id')
        .primary()
        .defaultTo(knex.raw('gen_random_uuid()'))

      t.uuid('merchant_id')
        .notNullable()
        .references('id')
        .inTable('merchant_profiles')
        .onDelete('CASCADE')

      t.uuid('user_id')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      t.integer('rating').notNullable()

      t.text('review').nullable()

      t.timestamp('created_at')
        .defaultTo(knex.fn.now())
    })
  }

  // ─────────────────────────────────────────────────────────────
  // MERCHANT PROFILE UPGRADES
  // ─────────────────────────────────────────────────────────────

  const hasMerchantStatus =
    await knex.schema.hasColumn('merchant_profiles', 'status')

  if (!hasMerchantStatus) {
    await knex.schema.alterTable('merchant_profiles', (t) => {

      t.string('status', 20)
        .defaultTo('PENDING')

      t.text('rejection_reason').nullable()

      t.decimal('wallet_balance', 15, 2)
        .defaultTo(0)

      t.string('business_logo', 500).nullable()

      t.text('business_description').nullable()

      t.string('website', 255).nullable()

      t.decimal('avg_rating', 3, 2)
        .defaultTo(0)

      t.integer('total_ratings')
        .defaultTo(0)
    })
  }

  // ─────────────────────────────────────────────────────────────
  // USER UPGRADES
  // ─────────────────────────────────────────────────────────────

  const hasEmailVerified =
    await knex.schema.hasColumn('users', 'email_verified')

  if (!hasEmailVerified) {
    await knex.schema.alterTable('users', (t) => {

      t.boolean('email_verified')
        .defaultTo(false)

      t.boolean('phone_verified')
        .defaultTo(false)

      t.string('avatar', 500).nullable()
    })
  }

  // ─────────────────────────────────────────────────────────────
  // INDEXES
  // ─────────────────────────────────────────────────────────────

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user
    ON subscriptions(user_id)
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_status
    ON subscriptions(status)
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_notifications_user
    ON notifications(user_id)
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_hotspot_subscription
    ON hotspot_sessions(subscription_id)
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_transactions_checkout
    ON transactions(checkout_request_id)
  `)
}

exports.down = async function (knex) {

  await knex.schema.dropTableIfExists('merchant_ratings')
  await knex.schema.dropTableIfExists('password_resets')
  await knex.schema.dropTableIfExists('commissions')
  await knex.schema.dropTableIfExists('routers')
  await knex.schema.dropTableIfExists('hotspot_sessions')
  await knex.schema.dropTableIfExists('subscriptions')
  await knex.schema.dropTableIfExists('packages')
  await knex.schema.dropTableIfExists('merchant_wallets')
  await knex.schema.dropTableIfExists('platform_revenue')
  await knex.schema.dropTableIfExists('ledger')
}
