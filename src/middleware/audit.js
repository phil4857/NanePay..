// src/middleware/audit.js  ← NEW FILE
const { v4: uuid } = require('uuid')
const db = require('../db')

const auditLog = async (req, action, metadata = {}) => {
  try {
    await db('audit_logs').insert({
      id:          uuid(),
      actor_id:    req.user?.id || null,
      action,
      target_type: metadata.target_type || null,
      target_id:   metadata.target_id   || null,
      description: metadata.description || action,
      before:      JSON.stringify(metadata.before || {}),
      after:       JSON.stringify(metadata.after  || {}),
      ip_address:  req.ip || null,
      created_at:  new Date(),
    })
  } catch (err) {
    // Audit log failure should never crash the app
    console.error('[AuditLog Error]', err.message)
  }
}

module.exports = { auditLog }
