const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const notifs = await db('notifications')
      .where({ user_id: req.user.id })
      .orderBy('created_at', 'desc')
      .limit(50);
    const [{ count }] = await db('notifications')
      .where({ user_id: req.user.id, read: false })
      .count('id as count');
    res.json({ notifications: notifs, unread_count: Number(count) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/:id/read', auth, async (req, res) => {
  try {
    const [notif] = await db('notifications')
      .where({ id: req.params.id, user_id: req.user.id })
      .update({ read: true, read_at: new Date() })
      .returning('*');
    if (!notif) return res.status(404).json({ message: 'Notification not found' });
    res.json(notif);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/read-all', auth, async (req, res) => {
  try {
    await db('notifications')
      .where({ user_id: req.user.id, read: false })
      .update({ read: true, read_at: new Date() });
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Helper used by other services
const createNotification = async (userId, type, title, body) => {
  try {
    await db('notifications').insert({ user_id: userId, type, title, body, read: false });
  } catch (err) {
    console.error('[Notification Error]', err.message);
  }
};

module.exports = router;
module.exports.createNotification = createNotification;
