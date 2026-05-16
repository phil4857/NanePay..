const jwt    = require('jsonwebtoken')
const db     = require('../config/database')
const logger = require('../config/logger')

const authenticate = (req, res, next) => {
  const header = req.headers['authorization']
  const token  = header && header.startsWith('Bearer ')
    ? header.split(' ')[1]
    : null

  if (!token) {
    return res.status(401).json({ error: 'Access token required' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded
    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired. Please login again.' })
    }
    return res.status(403).json({ error: 'Invalid token' })
  }
}

const requireAdmin = async (req, res, next) => {
  try {
    const user = await db('users')
      .where({ id: req.user.userId })
      .select('role', 'is_active')
      .first()

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account suspended' })
    }
    next()
  } catch (err) {
    logger.error('Admin check failed', { err: err.message })
    res.status(500).json({ error: 'Authorization check failed' })
  }
}

const requireActive = async (req, res, next) => {
  try {
    const user = await db('users')
      .where({ id: req.user.userId })
      .select('is_active')
      .first()

    if (!user?.is_active) {
      return res.status(403).json({ error: 'Your account has been suspended. Contact support.' })
    }
    next()
  } catch (err) {
    next(err)
  }
}

module.exports = { authenticate, requireAdmin, requireActive }
