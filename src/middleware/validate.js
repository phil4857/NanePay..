// src/middleware/validate.js  ← NEW FILE
const { validationResult, body } = require('express-validator')

// Run validation and return errors if any
const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(422).json({
      message: errors.array()[0].msg,
      errors:  errors.array(),
    })
  }
  next()
}

// Reusable validation rule sets
const rules = {
  register: [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('phone').matches(/^0[17]\d{8}$/).withMessage('Valid Kenyan phone required'),
    body('password').isLength({ min: 8 }).withMessage('Password min 8 characters'),
  ],

  login: [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],

  transfer: [
    body('toPhone').notEmpty().withMessage('Recipient phone is required'),
    body('amount').isFloat({ min: 10 }).withMessage('Minimum transfer is KES 10'),
  ],

  deposit: [
    body('amount').isFloat({ min: 1 }).withMessage('Minimum deposit is KES 1'),
  ],

  withdrawal: [
    body('amount').isFloat({ min: 100 }).withMessage('Minimum withdrawal is KES 100'),
  ],

  forex: [
    body('currency').notEmpty().withMessage('Currency is required'),
    body('direction').isIn(['buy', 'sell']).withMessage('Direction must be buy or sell'),
    body('amount').isFloat({ min: 1 }).withMessage('Amount must be greater than 0'),
  ],

  invest: [
    body('plan_id').notEmpty().withMessage('Plan ID is required'),
    body('amount').isFloat({ min: 1 }).withMessage('Amount must be greater than 0'),
  ],

  package: [
    body('name').trim().notEmpty().withMessage('Package name is required'),
    body('price').isFloat({ min: 1 }).withMessage('Price must be greater than 0'),
    body('duration_hours').isInt({ min: 1 }).withMessage('Duration must be at least 1 hour'),
  ],

  billPay: [
    body('billerId').notEmpty().withMessage('Biller ID is required'),
    body('accountNumber').notEmpty().withMessage('Account number is required'),
    body('amount').isFloat({ min: 1 }).withMessage('Amount must be greater than 0'),
  ],
}

module.exports = { validate, rules }
