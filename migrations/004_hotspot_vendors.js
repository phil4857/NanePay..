exports.up = function(knex) {
  return knex.schema

    // Multi-vendor hotspot businesses
    .createTable('hotspot_vendors', (t) => {
      t.increments('id').primary();
      t.integer('owner_id').references('id').inTable('users').onDelete('CASCADE');
      t.string('business_name').notNullable();
      t.string('location').notNullable();
      t.string('phone').notNullable();
      t.enum('status', ['pending','active','suspended']).defaultTo('active');
      t.decimal('total_revenue', 15, 2).defaultTo(0);
      t.decimal('platform_cut', 15, 2).defaultTo(0); // 1% accumulated
      t.integer('txn_count').defaultTo(0);
      t.timestamps(true, true);
    })

    // Packages per vendor — each vendor controls their own
    .createTable('hotspot_packages', (t) => {
      t.increments('id').primary();
      t.integer('vendor_id').references('id').inTable('hotspot_vendors').onDelete('CASCADE');
      t.string('name').notNullable();          // "Hourly", "Daily" etc.
      t.decimal('price', 10, 2).notNullable();
      t.string('duration');                    // "1 Hour", "24 Hours"
      t.string('speed');                       // "10 Mbps"
      t.boolean('active').defaultTo(true);
      t.timestamps(true, true);
    })

    // WiFi sessions — when a customer buys a package
    .createTable('wifi_sessions', (t) => {
      t.increments('id').primary();
      t.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
      t.integer('vendor_id').references('id').inTable('hotspot_vendors');
      t.integer('package_id').references('id').inTable('hotspot_packages');
      t.string('voucher_code').unique();
      t.decimal('amount_paid', 10, 2);
      t.decimal('platform_fee', 10, 2);        // 1% stored per session
      t.decimal('vendor_earnings', 10, 2);     // amount - fee
      t.enum('status', ['active','expired']).defaultTo('active');
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
