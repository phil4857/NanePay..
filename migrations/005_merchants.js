exports.up = async function(knex) {
  const has = await knex.schema.hasTable('merchants');
  if (!has) {
    await knex.schema.createTable('merchants', (t) => {
      t.increments('id').primary();
      t.string('user_id').notNullable();
      t.string('business_name').notNullable();
      t.string('payment_slug').unique();
      t.enu('status', ['active','suspended']).defaultTo('active');
      t.decimal('total_sales', 15, 2).defaultTo(0);
      t.decimal('total_fees',  15, 2).defaultTo(0);
      t.integer('txn_count').defaultTo(0);
      t.timestamps(true, true);
    });
  }
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('merchants');
};
