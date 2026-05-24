exports.up = async function(knex) {

  // hotspot_vendors
  const hasVendors = await knex.schema.hasTable('hotspot_vendors');
  if (!hasVendors) {
    await knex.schema.createTable('hotspot_vendors', (t) => {
      t.increments('id').primary();
      t.string('owner_id').notNullable();         // string — works with UUID or integer
      t.string('business_name').notNullable();
      t.string('location').notNullable();
      t.string('phone').notNullable();
      t.enu('status', ['pending','active','suspended']).defaultTo('active');
      t.decimal('total_revenue', 15, 2).defaultTo(0);
      t.decimal('platform_cut',  15, 2).defaultTo(0);
      t.integer('txn_count').defaultTo(0);
      t.timestamps(true, true);
    });
  }

  // hotspot_packages
  const hasPkgs = await knex.schema.hasTable('hotspot_packages');
  if (!hasPkgs) {
    await knex.schema.createTable('hotspot_packages', (t) => {
      t.increments('id').primary();
      t.integer('vendor_id')
        .references('id').inTable('hotspot_vendors').onDelete('CASCADE');
      t.string('name').notNullable();
      t.decimal('price', 10, 2).notNullable();
      t.string('duration');
      t.string('speed');
      t.boolean('active').defaultTo(true);
      t.timestamps(true, true);
    });
  }

  // wifi_sessions — already exists on your DB, so we only add missing columns
  const hasSessions = await knex.schema.hasTable('wifi_sessions');
  if (!hasSessions) {
    await knex.schema.createTable('wifi_sessions', (t) => {
      t.increments('id').primary();
      t.string('user_id').notNullable();
      t.integer('vendor_id').references('id').inTable('hotspot_vendors');
      t.integer('package_id').references('id').inTable('hotspot_packages');
      t.string('voucher_code').unique();
      t.decimal('amount_paid',     10, 2);
      t.decimal('platform_fee',    10, 2);
      t.decimal('vendor_earnings', 10, 2);
      t.enu('status', ['active','expired']).defaultTo('active');
      t.timestamp('expires_at');
      t.timestamps(true, true);
    });
  } else {
    // Table exists — just add any missing columns safely
    const hasPlatformFee    = await knex.schema.hasColumn('wifi_sessions', 'platform_fee');
    const hasVendorEarnings = await knex.schema.hasColumn('wifi_sessions', 'vendor_earnings');
    const hasVendorId       = await knex.schema.hasColumn('wifi_sessions', 'vendor_id');
    const hasPackageId      = await knex.schema.hasColumn('wifi_sessions', 'package_id');

    await knex.schema.alterTable('wifi_sessions', (t) => {
      if (!hasPlatformFee)    t.decimal('platform_fee',    10, 2).defaultTo(0);
      if (!hasVendorEarnings) t.decimal('vendor_earnings', 10, 2).defaultTo(0);
      if (!hasVendorId)       t.integer('vendor_id');
      if (!hasPackageId)      t.integer('package_id');
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('wifi_sessions');
  await knex.schema.dropTableIfExists('hotspot_packages');
  await knex.schema.dropTableIfExists('hotspot_vendors');
};
