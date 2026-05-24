const router = require('express').Router();
const auth = require('../middleware/auth');
const db = require('../../knexfile'); // adjust path to your knex instance
const { sendSMS } = require('../services/sms');

const FEE_RATE = parseFloat(process.env.PLATFORM_FEE_RATE || '0.01');
const calcFee = (a) => Math.ceil(Number(a) * FEE_RATE * 100) / 100;

// ── Vendor registers their hotspot business ───────────────────────────────────
router.post('/register', auth, async (req, res) => {
  try {
    const { business_name, location, phone } = req.body;
    if (!business_name || !location || !phone)
      return res.status(400).json({ message: 'Business name, location and phone required' });

    const [vendor] = await db('hotspot_vendors')
      .insert({ owner_id: req.user.id, business_name, location, phone, status: 'active' })
      .returning('*');

    await sendSMS(phone, `NanePay: Your hotspot "${business_name}" is now live! Add packages in the app. NanePay takes 1% per transaction — you keep the rest.`);
    res.status(201).json(vendor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Vendor gets their own businesses ─────────────────────────────────────────
router.get('/mine', auth, async (req, res) => {
  try {
    const vendors = await db('hotspot_vendors')
      .where({ owner_id: req.user.id })
      .orderBy('created_at', 'desc');

    // Attach packages to each vendor
    for (const v of vendors) {
      v.packages = await db('hotspot_packages').where({ vendor_id: v.id, active: true });
    }
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Vendor adds a package ─────────────────────────────────────────────────────
router.post('/:vendorId/packages', auth, async (req, res) => {
  try {
    const { name, price, duration, speed } = req.body;
    if (!name || !price) return res.status(400).json({ message: 'Name and price required' });

    // Make sure vendor belongs to this user
    const vendor = await db('hotspot_vendors')
      .where({ id: req.params.vendorId, owner_id: req.user.id })
      .first();
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    const [pkg] = await db('hotspot_packages')
      .insert({ vendor_id: vendor.id, name, price, duration, speed })
      .returning('*');

    res.status(201).json(pkg);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Vendor removes a package ──────────────────────────────────────────────────
router.delete('/:vendorId/packages/:pkgId', auth, async (req, res) => {
  try {
    const vendor = await db('hotspot_vendors')
      .where({ id: req.params.vendorId, owner_id: req.user.id }).first();
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    await db('hotspot_packages').where({ id: req.params.pkgId, vendor_id: vendor.id }).update({ active: false });
    res.json({ message: 'Package removed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Public: browse all active vendors + packages ──────────────────────────────
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

// ── Customer buys a WiFi package — money goes to PLATFORM account, vendor credited separately ──
router.post('/buy', auth, async (req, res) => {
  try {
    const { vendor_id, package_id, pin } = req.body;

    const user = await db('users').where({ id: req.user.id }).first();
    // Verify PIN (adjust to your auth pattern)
    const bcrypt = require('bcryptjs');
    const pinOk = await bcrypt.compare(String(pin), user.pin_hash);
    if (!pinOk) return res.status(401).json({ message: 'Incorrect PIN' });

    const vendor = await db('hotspot_vendors').where({ id: vendor_id, status: 'active' }).first();
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    const pkg = await db('hotspot_packages').where({ id: package_id, vendor_id, active: true }).first();
    if (!pkg) return res.status(404).json({ message: 'Package not found' });

    const platformFee = calcFee(pkg.price);
    const vendorEarns = pkg.price - platformFee;
    const totalCharge = pkg.price + platformFee;

    if (user.balance < totalCharge)
      return res.status(400).json({ message: 'Insufficient balance' });

    // Calculate expiry
    const expiresAt = new Date();
    const dur = (pkg.duration || '').toLowerCase();
    if (dur.includes('min'))        expiresAt.setMinutes(expiresAt.getMinutes() + (parseInt(dur) || 30));
    else if (dur.includes('hour'))  expiresAt.setHours(expiresAt.getHours() + (parseInt(dur) || 1));
    else if (dur.includes('day'))   expiresAt.setDate(expiresAt.getDate() + (parseInt(dur) || 1));
    else if (dur.includes('week'))  expiresAt.setDate(expiresAt.getDate() + 7);
    else if (dur.includes('month')) expiresAt.setDate(expiresAt.getDate() + 30);
    else                            expiresAt.setHours(expiresAt.getHours() + 1);

    const crypto = require('crypto');
    const voucher = 'NW-' + crypto.randomBytes(4).toString('hex').toUpperCase();

    // All in one transaction — atomic
    await db.transaction(async (trx) => {
      // Deduct from customer
      await trx('users').where({ id: user.id }).decrement('balance', totalCharge);

      // Money lands in PLATFORM account (no direct vendor credit — platform holds it)
      // Vendor earnings tracked separately for settlement
      await trx('hotspot_vendors').where({ id: vendor.id }).increment({
        total_revenue: pkg.price,
        platform_cut:  platformFee,
        txn_count:     1,
      });

      // Record session
      await trx('wifi_sessions').insert({
        user_id: user.id, vendor_id: vendor.id, package_id: pkg.id,
        voucher_code: voucher, amount_paid: pkg.price,
        platform_fee: platformFee, vendor_earnings: vendorEarns,
        status: 'active', expires_at: expiresAt,
      });

      // Record transaction with fee
      await trx('transactions').insert({
        user_id: user.id, type: 'wifi',
        description: `${vendor.business_name} — ${pkg.name}`,
        amount: -pkg.price,
        fee: platformFee,
        status: 'success',
        metadata: JSON.stringify({ voucher, vendor_id, package_id, expires_at: expiresAt }),
      });
    });

    await sendSMS(user.phone, `NanePay WiFi: ${vendor.business_name} — ${pkg.name} activated! Voucher: ${voucher}. Valid until ${expiresAt.toLocaleString('en-KE')}. Fee: KES ${platformFee.toFixed(2)}`);

    res.status(201).json({ voucher, expires_at: expiresAt, vendor_name: vendor.business_name, package: pkg, platform_fee: platformFee });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Vendor stats dashboard ────────────────────────────────────────────────────
router.get('/:vendorId/stats', auth, async (req, res) => {
  try {
    const vendor = await db('hotspot_vendors')
      .where({ id: req.params.vendorId, owner_id: req.user.id }).first();
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    const netEarnings = vendor.total_revenue - vendor.platform_cut;
    res.json({
      business_name: vendor.business_name,
      total_revenue: vendor.total_revenue,
      platform_cut:  vendor.platform_cut,
      net_earnings:  netEarnings,
      txn_count:     vendor.txn_count,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
