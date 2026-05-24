const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const { sendSMS }   = require('../services/sms');
const { sendEmail } = require('../services/email');

router.post('/submit', auth, async (req, res) => {
  try {
    const { id_type, id_number } = req.body;
    if (!id_type || !id_number)
      return res.status(400).json({ message: 'ID type and number required' });

    await db('kyc_submissions')
      .insert({ user_id: req.user.id, id_type, id_number, status: 'pending' })
      .onConflict('user_id').merge({ id_type, id_number, status: 'pending', updated_at: new Date() });

    await db('users').where({ id: req.user.id }).update({ kyc_status: 'pending' });

    const user = await db('users').where({ id: req.user.id }).first();
    await sendSMS(user.phone,
      `NanePay: Your KYC documents have been submitted. We review within 24 hours and will notify you.`
    );

    res.json({ message: 'KYC submitted. You will be notified within 24 hours.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/status', auth, async (req, res) => {
  try {
    const user = await db('users').where({ id: req.user.id }).select('kyc_status').first();
    const sub  = await db('kyc_submissions')
      .where({ user_id: req.user.id })
      .select('id_type','status','created_at','updated_at')
      .first();
    res.json({ kyc_status: user.kyc_status, submission: sub || null });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin: review KYC
router.patch('/:userId/review', auth, async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!['approved','rejected'].includes(status))
      return res.status(400).json({ message: 'Status must be approved or rejected' });

    await db('kyc_submissions')
      .where({ user_id: req.params.userId })
      .update({ status, review_note: note, reviewed_at: new Date() });

    await db('users').where({ id: req.params.userId }).update({ kyc_status: status });

    const user = await db('users').where({ id: req.params.userId }).first();
    if (status === 'approved') {
      await sendSMS(user.phone, `NanePay: Your KYC is approved! You now have full access and higher limits.`);
      await sendEmail(user.email, 'KYC Approved — NanePay', `Congratulations ${user.name}! Your identity has been verified.`);
    } else {
      await sendSMS(user.phone, `NanePay: KYC not approved. Reason: ${note || 'Documents unclear'}. Please resubmit.`);
      await sendEmail(user.email, 'KYC Update — NanePay', `Hi ${user.name}, your KYC was not approved. Reason: ${note}. Please resubmit in the app.`);
    }

    res.json({ message: `KYC ${status} for user ${req.params.userId}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
