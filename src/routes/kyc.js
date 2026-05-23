const router = require('express').Router();
const auth = require('../middleware/auth');
const mongoose = require('mongoose');
const User = require('../models/User');
const { sendSMS } = require('../services/sms');
const { sendEmail } = require('../services/email');

// KYC submission schema
const kycSchema = new mongoose.Schema({
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  idType:     { type: String, enum: ['national_id', 'passport'], required: true },
  idNumber:   { type: String, required: true },
  idImageUrl: { type: String },
  selfieUrl:  { type: String },
  status:     { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  reviewNote: { type: String },
  reviewedAt: { type: Date },
}, { timestamps: true });

const KYC = mongoose.models.KYC || mongoose.model('KYC', kycSchema);

// Submit KYC
router.post('/submit', auth, async (req, res) => {
  try {
    const { idType, idNumber } = req.body;
    if (!idType || !idNumber) return res.status(400).json({ message: 'ID type and number required' });

    const existing = await KYC.findOne({ user: req.user.id });
    if (existing && existing.status === 'approved')
      return res.status(400).json({ message: 'KYC already approved' });

    const kyc = await KYC.findOneAndUpdate(
      { user: req.user.id },
      { idType, idNumber, status: 'pending' },
      { upsert: true, new: true }
    );

    await User.findByIdAndUpdate(req.user.id, { kycStatus: 'pending' });

    const user = await User.findById(req.user.id);
    await sendSMS(user.phone, `NanePay: Your KYC documents have been submitted. We will review within 24 hours and notify you.`);
    await sendEmail(user.email, 'KYC Submitted — NanePay',
      `Hi ${user.name}, your KYC documents are under review. We will notify you within 24 hours.`);

    res.status(201).json({ kyc, message: 'KYC submitted. You will be notified within 24 hours.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get KYC status
router.get('/status', auth, async (req, res) => {
  try {
    const kyc = await KYC.findOne({ user: req.user.id }).select('-idNumber -idImageUrl');
    const user = await User.findById(req.user.id).select('kycStatus');
    res.json({ kycStatus: user.kycStatus, submission: kyc || null });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin: approve or reject KYC
router.patch('/:userId/review', auth, async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!['approved', 'rejected'].includes(status))
      return res.status(400).json({ message: 'Status must be approved or rejected' });

    const kyc = await KYC.findOneAndUpdate(
      { user: req.params.userId },
      { status, reviewNote: note, reviewedAt: new Date() },
      { new: true }
    );
    if (!kyc) return res.status(404).json({ message: 'KYC submission not found' });

    await User.findByIdAndUpdate(req.params.userId, { kycStatus: status });

    const user = await User.findById(req.params.userId);
    if (status === 'approved') {
      await sendSMS(user.phone, `NanePay: Your KYC has been approved! You now have full access to all features and higher limits.`);
      await sendEmail(user.email, 'KYC Approved — NanePay', `Congratulations ${user.name}! Your identity has been verified.`);
    } else {
      await sendSMS(user.phone, `NanePay: Your KYC was not approved. Reason: ${note || 'Documents unclear'}. Please resubmit.`);
      await sendEmail(user.email, 'KYC Update — NanePay', `Hi ${user.name}, your KYC was not approved. Reason: ${note}. Please resubmit.`);
    }

    res.json(kyc);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
