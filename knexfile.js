require('dotenv').config();

module.exports = {
  development: {
    client: 'postgresql',
    connection: process.env.DATABASE_URL || {
      host:     process.env.DB_HOST     || '127.0.0.1',
      port:     process.env.DB_PORT     || 5432,
      database: process.env.DB_NAME     || 'nanepay',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
    },
    migrations: { directory: './migrations' },
    pool: { min: 2, max: 10 },
  },

  production: {
    client: 'postgresql',
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Required for Render PostgreSQL
    },
    migrations: { directory: './migrations' },
    pool: { min: 2, max: 10 },
  },
};
