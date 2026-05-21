// knexfile.js  ← REPLACEMENT (root of project)
require('dotenv').config()

const base = {
  client: 'pg',
  migrations: { directory: './migrations' },
  seeds:      { directory: './seeds' },
}

module.exports = {
  development: {
    ...base,
    connection: process.env.DATABASE_URL || {
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME     || 'nanepay',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
    },
  },

  production: {
    ...base,
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    },
    pool: { min: 2, max: 10 },
  },
}
