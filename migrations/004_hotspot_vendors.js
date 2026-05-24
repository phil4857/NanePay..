exports.up = function(knex) {
  return knex.schema

    .createTable('hotspot_vendors', (t) => {
      t.increments('id').primary();
      t.string('owner_id').notNullable(); // string covers both UUID and integer as string
      t.string('business_name').notNullable();
      t.string('location').notNullable();
      t.string('phone').notNullable();
      t.enu('status', ['pending','active','suspended']).defaultTo('active');
      t.decimal('total_revenue', 15, 2).defaultTo(0);
      t.decimal('platform_cut', 15, 2).defaultTo(0);
      t.integer('txn_count').defaultTo(0);
      t.timestamps(true, true);
    })

    .createTable('hotspot_packages', (t) => {
      t.increments('id').primary();
      t.integer('vendor_id').references('id').inTable('hotspot_vendors').onDelete('CASCADE');
      t.string('name').notNullable();
      t.decimal('price', 10, 2).notNullable();
      t.string('duration');
      t.string('speed');
      t.boolean('active').defaultTo(true);
      t.timestamps(true, true);
    })

    .createTable('wifi_sessions', (t) => {
      t.increments('id').primary();
      t.string('user_id').notNullable();
      t.integer('vendor_id').references('id').inTable('hotspot_vendors');
      t.integer('package_id').references('id').inTable('hotspot_packages');
      t.string('voucher_code').unique();
      t.decimal('amount_paid', 10, 2);
      t.decimal('platform_fee', 10, 2);
      t.decimal('vendor_earnings', 10, 2);
      t.enu('status', ['active','expired']).defaultTo('active');
      t.timestamp('expires_at');
      t.timestamps(true, true);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('wifi_sessions')
    .dropTableIfExists('hotspot_packages')
    .dropTableIfExists('hotspot_vendors');
};
