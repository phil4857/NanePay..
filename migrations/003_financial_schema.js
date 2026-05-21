// migrations/003_financial_schema.js  ← NEW FILE

exports.up = async knex => {

  // ── Wallets (upgrade) ─────────────────────────────────────────
  await knex.schema.createTable('wallets', t => {
    t.uuid('id').primary()
    t.uuid('user_id').references('id').inTable('users').onDelete('CASCADE').unique()
    t.decimal('available_balance', 14, 2).defaultTo(0).notNullable()
    t.decimal('locked_balance',    14, 2).defaultTo(0).notNullable()
    t.decimal('total_balance',     14, 2).defaultTo(0).notNullable()
    t.string('currency', 3).defaultTo('KES')
    t.timestamps(true, true)
  })

  // ── Ledger (heart of the system) ─────────────────────────────
  await knex.schema.createTable('ledger', t => {
    t.uuid('id').primary()
    t.uuid('user_id').references('id').inTable('users').onDelete('SET NULL').nullable()
    t.uuid('wallet_id').references('id').inTable('wallets').onDelete('SET NULL').nullable()
    t.enum('type', [
      'deposit', 'withdrawal', 'transfer_in', 'transfer_out',
      'wifi_purchase', 'wifi_refund', 'fee', 'commission',
      'merchant_credit', 'merchant_debit', 'platform_fee', 'reversal'
    ]).notNullable()
    t.decimal('amount',          14, 2).notNullable()
    t.decimal('balance_before',  14, 2).notNullable()
    t.decimal('balance_after',   14, 2).notNullable()
    t.string('reference').unique().notNullable()
    t.uuid('transaction_id').nullable()
    t.text('description')
    t.enum('status', ['pending', 'completed', 'failed', 'reversed']).defaultTo('completed')
    t.jsonb('metadata').defaultTo('{}')
    t.timestamps(true, true)
  })

  // ── Platform revenue ──────────────────────────────────────────
  await knex.schema.createTable('platform_revenue', t => {
    t.uuid('id').primary()
    t.uuid('transaction_id').nullable()
    t.uuid('ledger_id').references('id').inTable('ledger').onDelete('SET NULL').nullable()
    t.enum('source', [
      'transfer_fee', 'wifi_purchase_fee', 'withdrawal_fee',
      'merchant_fee', 'subscription_fee', 'other'
    ]).notNullable()
    t.decimal('amount', 14, 2).notNullable()
    t.decimal('fee_rate', 5, 4).defaultTo(0.01)
    t.uuid('payer_id').references('id').inTable('users').onDelete('SET NULL').nullable()
    t.text('description')
    t.timestamps(true, true)
  })

  // ── Transactions ──────────────────────────────────────────────
  await knex.schema.createTable('transactions', t => {
    t.uuid('id').primary()
    t.uuid('user_id').references('id').inTable('users').onDelete('SET NULL').nullable()
    t.enum('type', [
      'deposit', 'withdrawal', 'transfer',
      'wifi_purchase', 'refund', 'commission'
    ]).notNullable()
    t.decimal('amount',      14, 2).notNullable()
    t.decimal('fee',         14, 2).defaultTo(0)
    t.decimal('net_amount',  14, 2).notNullable()
    t.enum('status', ['pending', 'completed', 'failed', 'reversed']).defaultTo('pending')
    t.string('reference').unique().notNullable()
    t.string('mpesa_receipt').nullable()
    t.string('checkout_request_id').unique().nullable()  // idempotency key
    t.string('merchant_request_id').nullable()
    t.text('description')
    t.jsonb('metadata').defaultTo('{}')
    t.timestamps(true, true)
  })

  // ── Merchant wallets ──────────────────────────────────────────
  await knex.schema.createTable('merchant_wallets', t => {
    t.uuid('id').primary()
    t.uuid('merchant_id').references('id').inTable('merchants').onDelete('CASCADE').unique()
    t.decimal('balance',             14, 2).defaultTo(0)
    t.decimal('total_earnings',      14, 2).defaultTo(0)
    t.decimal('pending_withdrawal',  14, 2).defaultTo(0)
    t.decimal('total_withdrawn',     14, 2).defaultTo(0)
    t.string('currency', 3).defaultTo('KES')
    t.timestamps(true, true)
  })

  // ── WiFi offers ───────────────────────────────────────────────
  await knex.schema.createTable('wifi_offers', t => {
    t.uuid('id').primary()
    t.uuid('merchant_id').references('id').inTable('merchants').onDelete('CASCADE')
    t.string('name').notNullable()
    t.enum('duration_type', ['hourly', 'midnight', 'daily', 'weekly', 'monthly']).notNullable()
    t.integer('duration_hours').notNullable()
    t.decimal('price',       14, 2).notNullable()
    t.string('speed_profile').defaultTo('5Mbps')
    t.integer('max_devices').defaultTo(1)
    t.boolean('active').defaultTo(true)
    t.integer('purchase_count').defaultTo(0)
    t.timestamps(true, true)
  })

  // ── WiFi purchases ────────────────────────────────────────────
  await knex.schema.createTable('wifi_purchases', t => {
    t.uuid('id').primary()
    t.uuid('customer_id').references('id').inTable('users').onDelete('SET NULL').nullable()
    t.uuid('merchant_id').references('id').inTable('merchants').onDelete('SET NULL').nullable()
    t.uuid('offer_id').references('id').inTable('wifi_offers').onDelete('SET NULL').nullable()
    t.uuid('transaction_id').references('id').inTable('transactions').onDelete('SET NULL').nullable()
    t.decimal('amount',          14, 2).notNullable()
    t.decimal('fee',             14, 2).defaultTo(0)
    t.decimal('merchant_credit', 14, 2).notNullable()
    t.enum('status', ['pending', 'active', 'expired', 'cancelled', 'refunded']).defaultTo('pending')
    t.timestamp('activated_at').nullable()
    t.timestamp('expiry_time').nullable()
    t.string('checkout_request_id').nullable()
    t.timestamps(true, true)
  })

  // ── WiFi sessions ─────────────────────────────────────────────
  await knex.schema.createTable('wifi_sessions', t => {
    t.uuid('id').primary()
    t.uuid('purchase_id').references('id').inTable('wifi_purchases').onDelete('CASCADE')
    t.uuid('user_id').references('id').inTable('users').onDelete('SET NULL').nullable()
    t.string('device_mac').nullable()
    t.string('device_ip').nullable()
    t.string('username').nullable()       // Radius/MikroTik username
    t.string('password').nullable()       // Radius/MikroTik password (hashed)
    t.timestamp('start_time').notNullable()
    t.timestamp('expiry_time').notNullable()
    t.enum('status', ['active', 'expired', 'disconnected', 'blocked']).defaultTo('active')
    t.integer('device_count').defaultTo(0)
    t.bigInteger('bytes_up').defaultTo(0)
    t.bigInteger('bytes_down').defaultTo(0)
    t.timestamps(true, true)
  })

  // ── Withdrawals ───────────────────────────────────────────────
  await knex.schema.createTable('withdrawals', t => {
    t.uuid('id').primary()
    t.uuid('user_id').references('id').inTable('users').onDelete('SET NULL').nullable()
    t.uuid('merchant_id').references('id').inTable('merchants').onDelete('SET NULL').nullable()
    t.decimal('amount',        14, 2).notNullable()
    t.decimal('fee',           14, 2).defaultTo(0)
    t.decimal('net_amount',    14, 2).notNullable()
    t.enum('status', ['pending', 'approved', 'processing', 'paid', 'rejected', 'failed']).defaultTo('pending')
    t.enum('method', ['mpesa', 'bank']).defaultTo('mpesa')
    t.string('phone_number').nullable()
    t.string('mpesa_receipt').nullable()
    t.uuid('approved_by').references('id').inTable('users').onDelete('SET NULL').nullable()
    t.timestamp('approved_at').nullable()
    t.text('rejection_reason').nullable()
    t.timestamps(true, true)
  })

  // ── Audit logs ────────────────────────────────────────────────
  await knex.schema.createTable('audit_logs', t => {
    t.uuid('id').primary()
    t.uuid('actor_id').references('id').inTable('users').onDelete('SET NULL').nullable()
    t.enum('action', [
      'user_created', 'user_banned', 'user_unbanned',
      'merchant_approved', 'merchant_rejected', 'merchant_suspended',
      'withdrawal_approved', 'withdrawal_rejected',
      'balance_adjusted', 'refund_issued',
      'admin_login', 'settings_changed'
    ]).notNullable()
    t.string('target_type').nullable()   // 'user', 'merchant', 'withdrawal', etc.
    t.uuid('target_id').nullable()
    t.text('description')
    t.jsonb('before').defaultTo('{}')
    t.jsonb('after').defaultTo('{}')
    t.string('ip_address').nullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })

  // ── Notifications ─────────────────────────────────────────────
  await knex.schema.createTable('notifications', t => {
    t.uuid('id').primary()
    t.uuid('user_id').references('id').inTable('users').onDelete('CASCADE')
    t.string('title').notNullable()
    t.text('body').notNullable()
    t.enum('type', ['info', 'success', 'warning', 'error', 'payment', 'wifi']).defaultTo('info')
    t.boolean('read').defaultTo(false)
    t.jsonb('data').defaultTo('{}')
    t.timestamps(true, true)
  })
}

exports.down = async knex => {
  const tables = [
    'notifications', 'audit_logs', 'withdrawals',
    'wifi_sessions', 'wifi_purchases', 'wifi_offers',
    'merchant_wallets', 'transactions', 'platform_revenue',
    'ledger', 'wallets'
  ]
  for (const t of tables) await knex.schema.dropTableIfExists(t)
}
