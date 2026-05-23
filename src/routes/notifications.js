const router = require('express').Router();
const auth = require('../middleware/auth');
const mongoose = require('mongoose');

const notifSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:    { type: String }, // promo, investment, wifi, birthday, referral, system
  title:   { type: String, required: true },
  body:    { type: String, required: true },
  read:    { type: Boolean, default: false },
  readAt:  { type: Date },
}, { timestamps: true });

const Notification = mongoose.models.Notification || mongoose.model('Notification', notifSchema);

// Get all notifications for user
router.get('/', auth, async (req, res) => {
  try {
    const notifs = await Notification.find({ user: req.user.id })
      .sort({ createdAt: -1 }).limit(50);
    const unreadCount = await Notification.countDocuments({ user: req.user.id, read: false });
    res.json({ notifications: notifs, unreadCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Mark single notification as read
router.patch('/:id/read', auth, async (req, res) => {
  try {
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { read: true, readAt: new Date() },
      { new: true }
    );
    if (!notif) return res.status(404).json({ message: 'Notification not found' });
    res.json(notif);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Mark all as read
router.patch('/read-all', auth, async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user.id, read: false },
      { read: true, readAt: new Date() }
    );
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Internal helper to create a notification (used by other services)
const createNotification = async (userId, type, title, body) => {
  try {
    return await Notification.create({ user: userId, type, title, body });
  } catch (err) {
    console.error('[Notification Error]', err.message);
  }
};

module.exports = router;
module.exports.createNotification = createNotification;
