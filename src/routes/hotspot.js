const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sendSMS } = require('../services/sms');

const FEE_RATE = parseFloat(process.env.PLATFORM_FEE_RATE || '0.01');
const calcFee = (a) => Math.ceil(Number(a) * FEE_RATE * 100) / 100;

// Register a hotspot business
router.post('/register', auth, async (req, res) => {
  try {
    const { business_name, location, phone } = req.body;
    if (!business_name || !location || !phone)
      return res.status(400).json({ message: 'Business name, location and phone are required' });

    const [vendor] = await db('hotspot_vendors')
      .insert({ owner_id: String(req.user.id), business_name, location, phone, status: 'active' })
      .returning('*');

    await sendSMS(phone,
      `NanePay: Your hotspot "${business_name}" is now live! Add packages in the app. NanePay takes 1% per transaction — you keep the rest.`
    );
    res.status(201).json(vendor);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// Get all vendors owned by logged-in user
router.get('/mine', auth, async (req, res) => {
  try {
    const vendors = await db('hotspot_vendors')
      .where({ owner_id: String(req.user.id) })
      .orderBy('created_at', 'desc');

    for (const v of vendors) {
      v.packages = await db('hotspot_packages').where({ vendor_id: v.id, active: true });
    }
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add a package to a vendor
router.post('/:vendorId/packages', auth, async (req, res) => {
  try {
    const { name, price, duration, speed } = req.body;
    if (!name || !price) return res.status(400).json({ message: 'Package name and price required' });

    const vendor = await db('hotspot_vendors')
      .where({ id: req.params.vendorId, owner_id: String(req.user.id) })
      .first();
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    const [pkg] = await db('hotspot_packages')
      .insert({ vendor_id: vendor.id, name, price: Number(price), duration, speed, active: true })
      .returning('*');

    res.status(201).json(pkg);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Remove (deactivate) a package
router.delete('/:vendorId/packages/:pkgId', auth, async (req, res) => {
  try {
    const vendor = await db('hotspot_vendors')
      .where({ id: req.params.vendorId, owner_id: String(req.user.id) })
      .first();
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    await db('hotspot_packages')
      .where({ id: req.params.pkgId, vendor_id: vendor.id })
      .update({ active: false });

    res.json({ message: 'Package removed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Public: browse all active vendors with their packages
router.get('/browse', async (req, res) => {
  try {
    const vendors = await db('hotspot_vendors').where({ status: 'active' });
    for (const v of vendors) {
      v.packages = await db('hotspot_packages').where({ vendor_id: v.id, active: true });
    }
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Customer buys a WiFi package
// Money goes to platform account; vendor earnings tracked for settlement
router.post('/buy', auth, async (req, res) => {
  try {
    const { vendor_id, package_id, pin } = req.body;

    const user = await db('users').where({ id: req.user.id }).first();
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Verify PIN
    const pinOk = await bcrypt.compare(String(pin), user.pin_hash || user.pin || '');
    if (!pinOk) return res.status(401).json({ message: 'Incorrect PIN' });

    const vendor = await db('hotspot_vendors').where({ id: vendor_id, status: 'active' }).first();
    if (!vendor) return res.status(404).json({ message: 'Vendor not found or inactive' });

    const pkg = await db('hotspot_packages')
      .where({ id: package_id, vendor_id, active: true })
      .first();
    if (!pkg) return res.status(404).json({ message: 'Package not found' });

    const platformFee = calcFee(pkg.price);
    const vendorEarns = Number(pkg.price) - platformFee;
    const totalCharge = Number(pkg.price) + platformFee;

    if (Number(user.balance) < totalCharge)
      return res.status(400).json({ message: 'Insufficient balance' });

    // Calculate expiry from package duration string
    const expiresAt = new Date();
    const dur = (pkg.duration || '').toLowerCase();
    if (dur.includes('min'))        expiresAt.setMinutes(expiresAt.getMinutes() + (parseInt(dur) || 30));
    else if (dur.includes('hour'))  expiresAt.setHours(expiresAt.getHours() + (parseInt(dur) || 1));
    else if (dur.includes('day'))   expiresAt.setDate(expiresAt.getDate() + (parseInt(dur) || 1));
    else if (dur.includes('week'))  expiresAt.setDate(expiresAt.getDate() + 7);
    else if (dur.includes('month')) expiresAt.setDate(expiresAt.getDate() + 30);
    else                            expiresAt.setHours(expiresAt.getHours() + 1);

    const voucher = 'NW-' + crypto.randomBytes(4).toString('hex').toUpperCase();

    // Atomic transaction — all or nothing
    await db.transaction(async (trx) => {
      // Deduct from customer balance
      await trx('users').where({ id: user.id }).decrement('balance', totalCharge);

      // Update vendor revenue stats (money held by platform — vendor settles separately)
      await trx('hotspot_vendors').where({ id: vendor.id }).update({
        total_revenue: db.raw('total_revenue + ?', [pkg.price]),
        platform_cut:  db.raw('platform_cut + ?',  [platformFee]),
        txn_count:     db.raw('txn_count + 1'),
      });

      // Create wifi session
      await trx('wifi_sessions').insert({
        user_id:         String(user.id),
        vendor_id:       vendor.id,
        package_id:      pkg.id,
        voucher_code:    voucher,
        amount_paid:     pkg.price,
        platform_fee:    platformFee,
        vendor_earnings: vendorEarns,
        status:          'active',
        expires_at:      expiresAt,
      });

      // Record in transactions table with fee
      await trx('transactions').insert({
        user_id:     user.id,
        type:        'wifi',
        description: `${vendor.business_name} — ${pkg.name}`,
        amount:      -Number(pkg.price),
        fee:         platformFee,
        status:      'success',
        reference:   'NP' + Date.now(),
        metadata:    JSON.stringify({ voucher, vendor_id, package_id, expires_at: expiresAt }),
      });
    });

    await sendSMS(user.phone,
      `NanePay WiFi: ${vendor.business_name} — ${pkg.name} activated!\n` +
      `Voucher: ${voucher}\n` +
      `Valid until: ${expiresAt.toLocaleString('en-KE')}\n` +
      `Fee: KES ${platformFee.toFixed(2)}`
    );

    res.status(201).json({
      voucher,
      expires_at:    expiresAt,
      vendor_name:   vendor.business_name,
      package:       pkg,
      amount_paid:   pkg.price,
      platform_fee:  platformFee,
      vendor_earns:  vendorEarns,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// Vendor stats
router.get('/:vendorId/stats', auth, async (req, res) => {
  try {
    const vendor = await db('hotspot_vendors')
      .where({ id: req.params.vendorId, owner_id: String(req.user.id) })
      .first();
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    res.json({
      business_name: vendor.business_name,
      location:      vendor.location,
      status:        vendor.status,
      total_revenue: Number(vendor.total_revenue),
      platform_cut:  Number(vendor.platform_cut),
      net_earnings:  Number(vendor.total_revenue) - Number(vendor.platform_cut),
      txn_count:     vendor.txn_count,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// User's wifi session history
router.get('/sessions', auth, async (req, res) => {
  try {
    const sessions = await db('wifi_sessions')
      .where({ user_id: String(req.user.id) })
      .join('hotspot_vendors', 'wifi_sessions.vendor_id', 'hotspot_vendors.id')
      .join('hotspot_packages', 'wifi_sessions.package_id', 'hotspot_packages.id')
      .select(
        'wifi_sessions.*',
        'hotspot_vendors.business_name as vendor_name',
        'hotspot_vendors.location as vendor_location',
        'hotspot_packages.name as package_name',
        'hotspot_packages.speed'
      )
      .orderBy('wifi_sessions.created_at', 'desc');

    res.json(sessions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
