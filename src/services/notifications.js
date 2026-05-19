const db     = require('../config/database')
const logger = require('../config/logger')

const notify = async (userId, { title, body, type = 'SYSTEM', metadata = {} }) => {
  try {
    await db('notifications').insert({
      user_id:    userId,
      title,
      body,
      type,
      metadata:   JSON.stringify(metadata),
      created_at: new Date(),
    })
  } catch (err) {
    logger.error('Failed to create notification', { err: err.message })
  }
}

module.exports = { notify }
