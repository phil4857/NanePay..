exports.up = async function (knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.string('name', 100).notNullable()
    t.string('email', 255).unique().notNullable()
    t.string('phone', 20).unique().notNullable()
    t.string('password', 255).notNullable()
    t.enum('role', ['user', 'merchant', 'admin']).defaultTo('user')
    t.boolean('is_active').defaultTo(true)
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })

  await knex.schema.createTable('wallets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('user_id').unique().notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.decimal('balance', 15, 2).defaultTo(0.00)
    t.decimal('investment_balance', 15, 2).defaultTo(0.00)
    t.string('currency', 3).defaultTo('KES')
    t.timestamp('updated_at').defaultTo(knex.fn.now())
  })

  await knex.schema.createTable('transactions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('sender_id').nullable().references('id').inTable('users')
    t.uuid('receiver_id').nullable().references('id').inTable('users')
    t.decimal('amount', 15, 2).notNullable()
    t.decimal('fee', 15, 2).defaultTo(0.00)
    t.decimal('net_amount', 15, 2).notNullable()
    t.enum('type', ['TRANSFER','MPESA_DEPOSIT','MPESA_WITHDRAW','FOREX_BUY','FOREX_SELL','INVESTMENT_IN','INVESTMENT_OUT','MERCHANT_PAYMENT','FEE','REVERSAL']).notNullable()
    t.enum('status', ['PENDING','SUCCESSFUL','FAILED','REVERSED']).defaultTo('PENDING')
    t.string('reference', 50).unique().notNullable()
    t.text('description').nullable()
    t.string('mpesa_checkout_id', 100).nullable()
    t.string('mpesa_reference', 50).nullable()
    t.decimal('forex_rate', 15, 6).nullable()
    t.string('forex_currency', 5).nullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })

  await knex.schema.createTable('fee_ledger', (t) => {
    t.bigIncrements('id')
    t.uuid('transaction_id').nullable().references('id').inTable('transactions')
    t.decimal('amount', 15, 2).notNullable()
    t.enum('type', ['TRANSFER_FEE','MERCHANT_FEE','FOREX_MARGIN','INVEST_SPREAD']).notNullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })

  await knex.schema.createTable('investments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.string('plan_id', 50).notNullable()
    t.decimal('amount', 15, 2).notNullable()
    t.enum('status', ['ACTIVE','MATURED','WITHDRAWN']).defaultTo('ACTIVE')
    t.timestamp('started_at').defaultTo(knex.fn.now())
    t.timestamp('matures_at').nullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })

  await knex.schema.createTable('merchant_profiles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('user_id').unique().notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.string('business_name', 100).notNullable()
    t.string('business_type', 100).notNullable()
    t.string('slug', 100).unique().notNullable()
    t.string('api_key', 100).unique().notNullable()
    t.decimal('fee_rate', 5, 4).defaultTo(0.008)
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })

  await knex.schema.createTable('payment_links', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('merchant_id').notNullable().references('id').inTable('merchant_profiles').onDelete('CASCADE')
    t.string('title', 200).notNullable()
    t.decimal('amount', 15, 2).nullable()
    t.string('currency', 3).defaultTo('KES')
    t.string('slug', 20).unique().notNullable()
    t.boolean('is_active').defaultTo(true)
    t.decimal('collected', 15, 2).defaultTo(0.00)
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })

  await knex.schema.createTable('audit_logs', (t) => {
    t.bigIncrements('id')
    t.uuid('user_id').nullable().references('id').inTable('users')
    t.string('action', 100).notNullable()
    t.specificType('ip_address', 'INET').nullable()
    t.text('user_agent').nullable()
    t.jsonb('metadata').nullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })

  await knex.raw('CREATE INDEX idx_tx_sender   ON transactions(sender_id)')
  await knex.raw('CREATE INDEX idx_tx_receiver ON transactions(receiver_id)')
  await knex.raw('CREATE INDEX idx_tx_status   ON transactions(status)')
  await knex.raw('CREATE INDEX idx_tx_created  ON transactions(created_at DESC)')
  await knex.raw('CREATE INDEX idx_audit_user  ON audit_logs(user_id)')
}

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('audit_logs')
  await knex.schema.dropTableIfExists('payment_links')
  await knex.schema.dropTableIfExists('merchant_profiles')
  await knex.schema.dropTableIfExists('investments')
  await knex.schema.dropTableIfExists('fee_ledger')
  await knex.schema.dropTableIfExists('transactions')
  await knex.schema.dropTableIfExists('wallets')
  await knex.schema.dropTableIfExists('users')
}
