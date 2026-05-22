// src/middleware/index.js  ← REPLACEMENT
const auth      = require('./auth')
const validate  = require('./validate')
const audit     = require('./audit')
const rateLimit = require('./rateLimit')

module.exports = {
  ...auth,
  ...validate,
  ...audit,
  ...rateLimit,
}
