// src/db.js  ← REPLACEMENT
const knex = require('knex')
require('dotenv').config()

const env = process.env.NODE_ENV || 'development'

// Load knexfile and pick the correct environment config
const knexfile = require('../knexfile')
const config   = knexfile[env]

if (!config) {
  throw new Error(`No knex config found for environment: ${env}`)
}

const db = knex(config)

module.exports = db
