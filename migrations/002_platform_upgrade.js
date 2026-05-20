exports.up = async function (knex) {
  // ── PACKAGES ────────────────────────────────────────────────
  await knex.schema.createTable('packages', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('merchant_id').nullable().references('id').inTable('merchant_profiles').onDelete('CASCADE')
    t.string('name', 100).notNullable()
    t.text('description').nullable()
    t.enum('category', ['WIFI', 'ELECTRICITY', 'WATER', 'SCHOOL', 'RENT', 'CUSTOM']).defaultTo('WIFI')
    t.enum('duration_type', ['MINUTES', 'HOURS', 'DAYS', 'MONTHS']).notNullable()
    t.integer('duration_value').notNullable()
    t.decimal('price', 15, 2).notNullable()
    t.string('speed_profile', 50).nullable()
    t.integer('device_limit').defaultTo(1)
    t.boolean('is_active').defaultTo(true)
    t.jsonb('metadata').nullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })

  // ── SUBSCRIPTIONS ────────────────────────────────────────────
  await knex.schema.createTable('subscriptions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.uuid('package_id').notNullable().references('id').inTable('packages')
    t.uuid('merchant_id').notNullable().references('id').inTable('merchant_profiles')
    t.uuid('transaction_id').nullable().references('id').inTable('transactions')
    t.enum('status', ['PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'SUSPENDED']).defaultTo('PENDING')
    t.string('account_reference', 100).nullable()
    t.timestamp('activated_at').nullable()
    t.timestamp('expires_at').nullable()
    t.integer('devices_connected').defaultTo(0)
    t.jsonb('metadata').nullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })

  // ── HOTSPOT SESSIONS ─────────────────────────────────────────
  await knex.schema.createTable('hotspot_sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('subscription_id').notNullable().references('id').inTable('subscriptions')
    t.uuid('user_id').notNullable().references('id').inTable('users')
    t.string('mac_address', 20).nullable()
    t.string('ip_address', 45).nullable()
    t.string('device_name', 100).nullable()
    t.bigInteger('bytes_uploaded').defaultTo(0)
    t.bigInteger('bytes_downloaded').defaultTo(0)
    t.enum('status', ['ACTIVE', 'DISCONNECTED', 'EXPIRED']).defaultTo('ACTIVE')
    t.timestamp('started_at').defaultTo(knex.fn.now())
    t.timestamp('ended_at').nullable()
  })

  // ── ROUTERS ──────────────────────────────────────────────────
  await knex.schema.createTable('routers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('merchant_id').notNullable().references('id').inTable('merchant_profiles').onDelete('CASCADE')
    t.string('name', 100).notNullable()
    t.enum('type', ['MIKROTIK', 'OPENWRT', 'RADIUS', 'CUSTOM']).defaultTo('MIKROTIK')
    t.string('ip_address', 45).nullable()
    t.integer('port').defaultTo(8728)
    t.string('username', 100).nullable()
    t.string('password_encrypted', 255).nullable()
    t.string('api_endpoint', 255).nullable()
    t.string('api_key_router', 255).nullable()
    t.boolean('is_online').defaultTo(false)
    t.timestamp('last_seen').nullable()
    t.jsonb('config').nullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })

  // ── WITHDRAWALS ──────────────────────────────────────────────
  await knex.schema.createTable('withdrawals', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.decimal('amount', 15, 2).notNullable()
    t.decimal('fee', 15, 2).defaultTo(0)
    t.decimal('net_amount', 15, 2).notNullable()
    t.string('phone', 20).notNullable()
    t.enum('status', ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REVERSED']).defaultTo('PENDING')
    t.string('mpesa_code', 50).nullable()
    t.string('reference', 50).unique().notNullable()
    t.text('failure_reason').nullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())
    t.timestamp('completed_at').nullable()
  })

  // ── NOTIFICATIONS ─────────────────────────────────────────────
  await knex.schema.createTable('notifications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.string('title', 200).notNullable()
    t.text('body').notNullable()
    t.enum('type', ['PAYMENT', 'SUBSCRIPTION', 'WITHDRAWAL', 'SECURITY', 'PROMO', 'SYSTEM']).defaultTo('SYSTEM')
    t.boolean('is_read').defaultTo(false)
    t.jsonb('metadata').nullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })

  // ── COMMISSIONS ───────────────────────────────────────────────
  await knex.schema.createTable('commissions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('merchant_id').notNullable().references('id').inTable('merchant_profiles').onDelete('CASCADE')
    t.uuid('transaction_id').notNullable().references('id').inTable('transactions')
    t.decimal('transaction_amount', 15, 2).notNullable()
    t.decimal('commission_rate', 5, 4).notNullable()
    t.decimal('commission_amount', 15, 2).notNullable()
    t.decimal('nanepay_fee', 15, 2).notNullable()
    t.decimal('merchant_payout', 15, 2).notNullable()
    t.enum('status', ['PENDING', 'PAID', 'HELD']).defaultTo('PENDING')
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })

  // ── PASSWORD RESETS ───────────────────────────────────────────
  await knex.schema.createTable('password_resets', (t) => {
    t.bigIncrements('id')
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.string('token', 100).unique().notNullable()
    t.boolean('used').defaultTo(false)
    t.timestamp('expires_at').notNullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })

  // ── MERCHANT RATINGS ──────────────────────────────────────────
  await knex.schema.createTable('merchant_ratings', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('merchant_id').notNullable().references('id').inTable('merchant_profiles').onDelete('CASCADE')
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.integer('rating').notNullable()
    t.text('review').nullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })

  // ── ALTER EXISTING TABLES ─────────────────────────────────────
  // Add columns to merchant_profiles safely
  const hasMerchantStatus = await knex.schema.hasColumn('merchant_profiles', 'status')
  if (!hasMerchantStatus) {
    await knex.schema.alterTable('merchant_profiles', (t) => {
      t.string('status', 20).defaultTo('PENDING')
      t.text('rejection_reason').nullable()
      t.decimal('wallet_balance', 15, 2).defaultTo(0)
      t.string('business_logo', 500).nullable()
      t.text('business_description').nullable()
      t.string('website', 255).nullable()
      t.decimal('avg_rating', 3, 2).defaultTo(0)
      t.integer('total_ratings').defaultTo(0)
    })
  }

  // Add columns to users safely
  const hasEmailVerified = await knex.schema.hasColumn('users', 'email_verified')
  if (!hasEmailVerified) {
    await knex.schema.alterTable('users', (t) => {
      t.boolean('email_verified').defaultTo(false)
      t.boolean('phone_verified').defaultTo(false)
      t.string('avatar', 500).nullable()
    })
  }

  // Add metadata to transactions if missing
  const hasTxMeta = await knex.schema.hasColumn('transactions', 'metadata')
  if (!hasTxMeta) {
    await knex.schema.alterTable('transactions', (t) => {
      t.jsonb('metadata').nullable()
    })
  }

  // Add BILL_PAYMENT to transactions type if not already
  // Note: PostgreSQL enum alteration — safe approach
  try {
    await knex.raw("ALTER TYPE transactions_type_enum ADD VALUE IF NOT EXISTS 'BILL_PAYMENT'")
  } catch (e) {
    // Enum value may already exist, ignore
  }

  // ── INDEXES ────────────────────────────────────────────────────
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_subs_user    ON subscriptions(user_id)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_subs_status  ON subscriptions(status)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_subs_expires ON subscriptions(expires_at)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_notif_user   ON notifications(user_id)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_notif_read   ON notifications(is_read)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_sessions_sub ON hotspot_sessions(subscription_id)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_withdraw_user ON withdrawals(user_id)')
}

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('merchant_ratings')
  await knex.schema.dropTableIfExists('password_resets')
  await knex.schema.dropTableIfExists('commissions')
  await knex.schema.dropTableIfExists('notifications')
  await knex.schema.dropTableIfExists('withdrawals')
  await knex.schema.dropTableIfExists('routers')
  await knex.schema.dropTableIfExists('hotspot_sessions')
  await knex.schema.dropTableIfExists('subscriptions')
  await knex.schema.dropTableIfExists('packages')
}
