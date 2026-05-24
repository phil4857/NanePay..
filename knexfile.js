require('dotenv').config();

module.exports = {
  development: {
    client: 'postgresql',
    connection: {
      host:     process.env.DB_HOST     || '127.0.0.1',
      port:     process.env.DB_PORT     || 5432,
      database: process.env.DB_NAME     || 'nanepay',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
    },
    pool: { min: 2, max: 10 },
    migrations: { directory: './migrations' },
  },

  production: {
    client: 'postgresql',
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // ← This fixes the Render timeout error
    },
    pool: {
      min: 2,
      max: 10,
      acquireTimeoutMillis: 60000,
      createTimeoutMillis:  60000,
      idleTimeoutMillis:    30000,
    },
    migrations: { directory: './migrations' },
  },
};
