const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const db      = require('../db');
const auth    = require('../middleware/auth');
const { sendSMS }          = require('../services/sms');
const { sendWelcomeEmail } = require('../services/email');

const sign = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

// Register
router.post('/register', async (req, res) => {
  try {
    let { name, email, phone, password } = req.body;
    if (!name || !email || !phone || !password)
      return res.status(400).json({ message: 'All fields are required' });

    // Normalise phone
    phone = phone.replace(/^0/, '+254');
    if (!phone.startsWith('+254'))
      return res.status(400).json({ message: 'Enter a valid Kenyan phone number' });

    const exists = await db('users').where({ email }).orWhere({ phone }).first();
    if (exists) return res.status(409).json({ message: 'Email or phone already registered' });

    const password_hash  = await bcrypt.hash(password, 12);
    const referral_code  = 'NANE-' + crypto.randomBytes(3).toString('hex').toUpperCase();

    const [user] = await db('users')
      .insert({ name, email, phone, password_hash, referral_code })
      .returning(['id','name','email','phone','referral_code','balance','kyc_status']);

    await sendSMS(phone, `Welcome to NanePay, ${name}! Your account is ready. Referral code: ${referral_code}`);
    await sendWelcomeEmail(user);

    res.status(201).json({ token: sign(user.id), user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password required' });

    const user = await db('users').where({ email }).first();
    if (!user) return res.status(401).json({ message: 'Invalid email or password' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: 'Invalid email or password' });

    const { password_hash, pin_hash, ...safeUser } = user;
    res.json({ token: sign(user.id), user: safeUser });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  try {
    const user = await db('users')
      .where({ id: req.user.id })
      .select('id','name','email','phone','balance','referral_code','kyc_status','created_at')
      .first();
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Set / update 4-digit PIN
router.post('/set-pin', auth, async (req, res) => {
  try {
    const { pin, password } = req.body;
    if (!pin || !/^\d{4}$/.test(pin))
      return res.status(400).json({ message: 'PIN must be exactly 4 digits' });

    const user = await db('users').where({ id: req.user.id }).first();
    const ok   = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: 'Incorrect password' });

    const pin_hash = await bcrypt.hash(pin, 10);
    await db('users').where({ id: req.user.id }).update({ pin_hash });

    res.json({ message: 'PIN set successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Forgot password — send reset link via SMS + email
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await db('users').where({ email }).first();
    // Always return 200 to prevent user enumeration
    if (!user) return res.json({ message: 'If registered, a reset link has been sent.' });

    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db('password_resets').insert({ user_id: user.id, token, expires_at: expiresAt })
      .onConflict('user_id').merge();

    const link = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    await sendSMS(user.phone, `NanePay password reset: ${link} (expires in 1 hour)`);

    const { sendEmail } = require('../services/email');
    await sendEmail(user.email, 'NanePay Password Reset',
      `Click to reset your password: ${link} (expires in 1 hour)`);

    res.json({ message: 'Reset link sent to your email and phone.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Reset password with token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password)
      return res.status(400).json({ message: 'Token and new password required' });

    const reset = await db('password_resets')
      .where({ token })
      .where('expires_at', '>', new Date())
      .first();
    if (!reset) return res.status(400).json({ message: 'Invalid or expired reset token' });

    const password_hash = await bcrypt.hash(password, 12);
    await db('users').where({ id: reset.user_id }).update({ password_hash });
    await db('password_resets').where({ token }).delete();

    res.json({ message: 'Password reset successfully. Please log in.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
