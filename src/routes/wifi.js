const router = require('express').Router();
const auth = require('../middleware/auth');
const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const HotspotVendor = require('../models/HotspotVendor');
const { sendSMS } = require('../services/sms');
const { sendReceiptEmail } = require('../services/email');
const crypto = require('crypto');

const FEE_RATE = parseFloat(process.env.PLATFORM_FEE_RATE || '0.01');
const calcFee = (a) => Math.ceil(Number(a) * FEE_RATE * 100) / 100;

// WiFi session schema
const sessionSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  vendor:      { type: mongoose.Schema.Types.ObjectId, ref: 'HotspotVendor', required: true },
  packageName: { type: String },
  price:       { type: Number },
  voucher:     { type: String, unique: true },
  status:      { type: String, enum: ['active','expired'], default: 'active' },
  expiresAt:   { type: Date },
}, { timestamps: true });

const WifiSession = mongoose.models.WifiSession || mongoose.model('WifiSession', sessionSchema);

// Get all active vendors
router.get('/vendors', async (req, res) => {
  try {
    const vendors = await HotspotVendor.find({ status: 'active' }).select('-__v');
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Buy a WiFi package from a vendor
router.post('/buy', auth, async (req, res) => {
  try {
    const { vendorId, packageId, pin } = req.body;

    const user = await User.findById(req.user.id);
    const pinOk = await user.comparePIN(pin);
    if (!pinOk) return res.status(401).json({ message: 'Incorrect PIN' });

    const vendor = await HotspotVendor.findById(vendorId);
    if (!vendor || vendor.status !== 'active') return res.status(404).json({ message: 'Vendor not found or inactive' });

    const pkg = vendor.packages.id(packageId);
    if (!pkg) return res.status(404).json({ message: 'Package not found' });

    const f = calcFee(pkg.price);
    const totalDeduct = pkg.price + f;
    if (user.balance < totalDeduct) return res.status(400).json({ message: 'Insufficient balance' });

    // Deduct from user
    await User.findByIdAndUpdate(user._id, { $inc: { balance: -totalDeduct } });

    // Credit vendor (minus platform cut)
    const vendorEarns = pkg.price - f;
    await HotspotVendor.findByIdAndUpdate(vendor._id, {
      $inc: { revenue: pkg.price, txnCount: 1, platformCut: f },
    });

    // Generate voucher code
    const voucher = 'NW-' + crypto.randomBytes(4).toString('hex').toUpperCase();

    // Parse duration into expiry
    const expiresAt = new Date();
    if (pkg.duration?.toLowerCase().includes('hour')) {
      const hrs = parseInt(pkg.duration) || 1;
      expiresAt.setHours(expiresAt.getHours() + hrs);
    } else if (pkg.duration?.toLowerCase().includes('day')) {
      const days = parseInt(pkg.duration) || 1;
      expiresAt.setDate(expiresAt.getDate() + days);
    } else if (pkg.duration?.toLowerCase().includes('week')) {
      expiresAt.setDate(expiresAt.getDate() + 7);
    } else if (pkg.duration?.toLowerCase().includes('month')) {
      expiresAt.setDate(expiresAt.getDate() + 30);
    } else {
      expiresAt.setHours(expiresAt.getHours() + 1);
    }

    const session = await WifiSession.create({
      user: user._id, vendor: vendor._id,
      packageName: pkg.name, price: pkg.price, voucher, expiresAt,
    });

    const tx = await Transaction.create({
      user: user._id, type: 'wifi',
      label: `${vendor.name} — ${pkg.name}`,
      amount: -pkg.price, fee: f, status: 'success',
      metadata: { vendorId, packageId, voucher, expiresAt },
    });

    await sendSMS(user.phone, `NanePay WiFi: ${vendor.name} ${pkg.name} activated! Voucher: ${voucher}. Valid until ${expiresAt.toLocaleString('en-KE')}. Fee: KES ${f.toFixed(2)}. Ref: ${tx.ref}`);
    await sendReceiptEmail(user, tx);

    res.status(201).json({ voucher, expiresAt, session, transaction: tx });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get user's wifi sessions
router.get('/sessions', auth, async (req, res) => {
  try {
    const sessions = await WifiSession.find({ user: req.user.id })
      .populate('vendor', 'name location')
      .sort({ createdAt: -1 });
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
