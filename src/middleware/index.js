// src/middleware/index.js  ← NEW FILE
const auth     = require('./auth')
const validate = require('./validate')
const audit    = require('./audit')

module.exports = {
  ...auth,
  ...validate,
  ...audit,
}
