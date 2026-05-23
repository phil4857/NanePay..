const router = require('express').Router();
const auth = require('../middleware/auth');
const HotspotVendor = require('../models/HotspotVendor');
const { sendSMS } = require('../services/sms');
const { sendEmail } = require('../services/email');

// Register as a hotspot vendor
router.post('/register', auth, async (req, res) => {
  try {
    const { name, location, phone } = req.body;
    if (!name || !location || !phone)
      return res.status(400).json({ message: 'Name, location and phone are required' });

    const existing = await HotspotVendor.findOne({ owner: req.user.id });
    // Allow multiple — just create a new one
    const vendor = await HotspotVendor.create({
      owner: req.user.id, name, location, phone, status: 'active',
    });

    await sendSMS(phone, `NanePay: Your hotspot "${name}" has been registered! Add packages in the app to start receiving payments. NanePay takes 1% per transaction.`);
    await sendEmail(req.user.email, 'Hotspot Registered — NanePay',
      `Your hotspot "${name}" at ${location} is now live on NanePay. Log in to add packages and start earning.`);

    res.status(201).json(vendor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get all vendors owned by logged-in user
router.get('/mine', auth, async (req, res) => {
  try {
    const vendors = await HotspotVendor.find({ owner: req.user.id }).sort({ createdAt: -1 });
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single vendor
router.get('/:id', auth, async (req, res) => {
  try {
    const vendor = await HotspotVendor.findOne({ _id: req.params.id, owner: req.user.id });
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });
    res.json(vendor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add a package to a vendor
router.post('/:id/packages', auth, async (req, res) => {
  try {
    const { name, price, duration, speed } = req.body;
    if (!name || !price) return res.status(400).json({ message: 'Package name and price are required' });

    const vendor = await HotspotVendor.findOne({ _id: req.params.id, owner: req.user.id });
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    vendor.packages.push({ name, price: Number(price), duration, speed });
    await vendor.save();

    res.json(vendor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Remove a package from a vendor
router.delete('/:id/packages/:pkgId', auth, async (req, res) => {
  try {
    const vendor = await HotspotVendor.findOne({ _id: req.params.id, owner: req.user.id });
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    vendor.packages = vendor.packages.filter(p => p._id.toString() !== req.params.pkgId);
    await vendor.save();
    res.json(vendor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Vendor revenue summary
router.get('/:id/stats', auth, async (req, res) => {
  try {
    const vendor = await HotspotVendor.findOne({ _id: req.params.id, owner: req.user.id });
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    res.json({
      revenue:     vendor.revenue,
      txnCount:    vendor.txnCount,
      platformCut: vendor.platformCut,
      netEarnings: vendor.revenue - vendor.platformCut,
      packages:    vendor.packages.length,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
