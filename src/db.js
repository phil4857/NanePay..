require('dotenv').config();
const knex = require('knex');

const config = {
  client: 'postgresql',
  connection: process.env.NODE_ENV === 'production'
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }, // Required for Render/Heroku PostgreSQL
      }
    : {
        host:     process.env.DB_HOST     || '127.0.0.1',
        port:     process.env.DB_PORT     || 5432,
        database: process.env.DB_NAME     || 'nanepay',
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || '',
      },
  pool: {
    min: 2,
    max: 10,
    acquireTimeoutMillis: 30000,
    createTimeoutMillis:  30000,
    idleTimeoutMillis:    30000,
  },
  migrations: { directory: '../migrations' },
};

const db = knex(config);

// Test connection on startup
db.raw('SELECT 1')
  .then(() => console.log('✅ Database connected'))
  .catch((err) => console.error('❌ Database connection failed:', err.message));

module.exports = db;
