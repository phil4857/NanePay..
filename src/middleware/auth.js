// src/middleware/auth.js  ← REPLACEMENT
const jwt = require('jsonwebtoken')
const db  = require('../db')

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' })
    }
    const token   = header.split(' ')[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user    = await db('users').where({ id: decoded.id }).first()
    if (!user)          return res.status(401).json({ message: 'User not found' })
    if (user.is_banned) return res.status(403).json({ message: 'Account suspended' })
    req.user = user
    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired. Please sign in again.' })
    }
    return res.status(401).json({ message: 'Invalid token' })
  }
}

const requireActive = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Not authenticated' })
  if (!req.user.is_active) return res.status(403).json({ message: 'Account is inactive' })
  next()
}

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Not authenticated' })
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: `Access denied. Required: ${roles.join(' or ')}` })
  }
  next()
}

const optionalAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization
    if (header && header.startsWith('Bearer ')) {
      const token   = header.split(' ')[1]
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      const user    = await db('users').where({ id: decoded.id }).first()
      if (user && !user.is_banned) req.user = user
    }
  } catch { /* silent */ }
  next()
}

module.exports = { authenticate, requireActive, requireRole, optionalAuth }
