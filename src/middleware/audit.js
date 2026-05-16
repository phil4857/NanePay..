const db     = require('../config/database')
const logger = require('../config/logger')

const auditLog = async (req, action, metadata = {}) => {
  try {
    await db('audit_logs').insert({
      user_id:    req.user?.userId || null,
      action,
      ip_address: req.ip || req.socket?.remoteAddress,
      user_agent: req.headers['user-agent'] || null,
      metadata:   JSON.stringify(metadata),
      created_at: new Date(),
    })
  } catch (err) {
    logger.error('Audit log failed', { action, err: err.message })
  }
}

module.exports = { auditLog }
