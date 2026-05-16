const { validationResult, body, param } = require('express-validator')

const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error:  'Validation failed',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg })),
    })
  }
  next()
}

const rules = {
  register: [
    body('name').trim().notEmpty().withMessage('Name is required')
      .isLength({ min: 2, max: 100 }),
    body('email').trim().isEmail().withMessage('Valid email required').normalizeEmail(),
    body('phone').trim().notEmpty().withMessage('Phone is required')
      .matches(/^(254|0|)\d{9}$/).withMessage('Enter a valid Kenyan phone number'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
      .matches(/\d/).withMessage('Password must contain at least one number'),
  ],

  login: [
    body('email').trim().isEmail().withMessage('Valid email required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
  ],

  transfer: [
    body('phone').trim().notEmpty().withMessage('Recipient phone is required')
      .matches(/^(254|0|)\d{9}$/).withMessage('Enter a valid phone number'),
    body('amount').isFloat({ min: 10 }).withMessage('Minimum transfer is KES 10')
      .isFloat({ max: 1000000 }).withMessage('Maximum is KES 1,000,000'),
    body('note').optional().trim().isLength({ max: 200 }),
  ],

  deposit: [
    body('amount').isFloat({ min: 10 }).withMessage('Minimum deposit is KES 10')
      .isFloat({ max: 150000 }).withMessage('Maximum M-Pesa deposit is KES 150,000'),
  ],

  withdraw: [
    body('phone').optional().trim()
      .matches(/^(254|0|)\d{9}$/).withMessage('Valid phone required'),
    body('amount').isFloat({ min: 10 }).withMessage('Minimum withdrawal is KES 10')
      .isFloat({ max: 150000 }).withMessage('Maximum withdrawal is KES 150,000'),
  ],

  forex: [
    body('currency').isIn(['USD', 'GBP', 'EUR', 'TZS', 'UGX']).withMessage('Unsupported currency'),
    body('amount').isFloat({ min: 1 }).withMessage('Amount must be greater than 0'),
    body('direction').isIn(['buy', 'sell']).withMessage('Direction must be buy or sell'),
  ],

  invest: [
    body('plan_id').isIn(['flexi', '90day', 'growth']).withMessage('Invalid investment plan'),
    body('amount').isFloat({ min: 500 }).withMessage('Minimum investment is KES 500'),
  ],

  merchantRegister: [
    body('business_name').trim().notEmpty().withMessage('Business name is required')
      .isLength({ min: 2, max: 100 }),
    body('business_type').trim().notEmpty().withMessage('Business type is required'),
  ],

  txId: [
    param('id').isUUID().withMessage('Invalid transaction ID'),
  ],
}

module.exports = { validate, rules }
