const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { calcFee, totalWithFee, parseExpiry, generateRef } = require('../utils/helpers');
const { sendSMS }          = require('../services/sms');
const { sendReceiptEmail } = require('../services/email');

// Get all active vendors with packages (public)
router.get('/vendors', async (req, res) => {
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
// 1% fee charged on top — money goes to platform, vendor earnings tracked for settlement
router.post('/buy', auth, async (req, res) => {
  try {
    const { vendor_id, package_id, pin } = req.body;
    if (!vendor_id || !package_id)
      return res.status(400).json({ message: 'vendor_id and package_id are required' });

    const user = await db('users').where({ id: req.user.id }).first();
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Verify PIN
    const pinOk = await bcrypt.compare(String(pin), user.pin_hash || '');
    if (!pinOk) return res.status(401).json({ message: 'Incorrect PIN' });

    const vendor = await db('hotspot_vendors')
      .where({ id: vendor_id, status: 'active' }).first();
    if (!vendor) return res.status(404).json({ message: 'Vendor not found or inactive' });

    const pkg = await db('hotspot_packages')
      .where({ id: package_id, vendor_id, active: true }).first();
    if (!pkg) return res.status(404).json({ message: 'Package not found' });

    const platformFee  = calcFee(pkg.price);
    const vendorEarns  = Number(pkg.price) - platformFee;
    const totalCharge  = Number(pkg.price) + platformFee;

    if (Number(user.balance) < totalCharge)
      return res.status(400).json({ message: `Insufficient balance. Need KES ${totalCharge.toFixed(2)} (includes 1% fee)` });

    const expiresAt = parseExpiry(pkg.duration);
    const voucher   = 'NW-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const ref       = generateRef();

    await db.transaction(async (trx) => {
      // Deduct from customer
      await trx('users').where({ id: user.id }).decrement('balance', totalCharge);

      // Update vendor revenue — platform holds the money, vendor_earnings tracked for settlement
      await trx('hotspot_vendors').where({ id: vendor.id }).update({
        total_revenue: db.raw('total_revenue + ?', [Number(pkg.price)]),
        platform_cut:  db.raw('platform_cut + ?',  [platformFee]),
        txn_count:     db.raw('txn_count + 1'),
      });

      // Create session
      await trx('wifi_sessions').insert({
        user_id:         String(user.id),
        vendor_id:       vendor.id,
        package_id:      pkg.id,
        voucher_code:    voucher,
        amount_paid:     Number(pkg.price),
        platform_fee:    platformFee,
        vendor_earnings: vendorEarns,
        status:          'active',
        expires_at:      expiresAt,
      });

      // Record transaction
      await trx('transactions').insert({
        user_id:     user.id,
        type:        'wifi',
        description: `${vendor.business_name} — ${pkg.name}`,
        amount:      -Number(pkg.price),
        fee:         platformFee,
        status:      'success',
        reference:   ref,
        metadata:    JSON.stringify({ voucher, vendor_id, package_id, expires_at: expiresAt }),
      });
    });

    await sendSMS(user.phone,
      `NanePay WiFi: ${vendor.business_name} — ${pkg.name} activated!\n` +
      `Voucher: ${voucher}\n` +
      `Valid until: ${expiresAt.toLocaleString('en-KE')}\n` +
      `Fee: KES ${platformFee.toFixed(2)}. Ref: ${ref}`
    );

    res.status(201).json({
      voucher,
      expires_at:   expiresAt,
      vendor_name:  vendor.business_name,
      package_name: pkg.name,
      amount_paid:  Number(pkg.price),
      platform_fee: platformFee,
      vendor_earns: vendorEarns,
      reference:    ref,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// Get user's session history
router.get('/sessions', auth, async (req, res) => {
  try {
    const sessions = await db('wifi_sessions')
      .where('wifi_sessions.user_id', String(req.user.id))
      .leftJoin('hotspot_vendors',  'wifi_sessions.vendor_id',  'hotspot_vendors.id')
      .leftJoin('hotspot_packages', 'wifi_sessions.package_id', 'hotspot_packages.id')
      .select(
        'wifi_sessions.*',
        'hotspot_vendors.business_name as vendor_name',
        'hotspot_vendors.location      as vendor_location',
        'hotspot_packages.name         as package_name',
        'hotspot_packages.speed        as package_speed'
      )
      .orderBy('wifi_sessions.created_at', 'desc');
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Check voucher validity (public — for MikroTik or captive portal integration)
router.get('/validate/:voucher', async (req, res) => {
  try {
    const session = await db('wifi_sessions')
      .where({ voucher_code: req.params.voucher })
      .first();
    if (!session)
      return res.status(404).json({ valid: false, message: 'Voucher not found' });

    const now     = new Date();
    const expired = new Date(session.expires_at) < now;

    if (expired && session.status === 'active') {
      await db('wifi_sessions').where({ id: session.id }).update({ status: 'expired' });
    }

    res.json({
      valid:      !expired,
      status:     expired ? 'expired' : 'active',
      expires_at: session.expires_at,
      voucher:    session.voucher_code,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
