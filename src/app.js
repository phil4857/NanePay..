require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// ── Routes ────────────────────────────────────────────────────────────────────
const loadRoute = (path, name) => {
  try {
    const route = require(path)

    if (!route || typeof route !== 'function') {
      console.error(`❌ Route "${name}" is invalid`)
      console.log(route)
      process.exit(1)
    }

    console.log(`✅ Loaded route: ${name}`)
    return route
  } catch (err) {
    console.error(`❌ Failed loading route: ${name}`)
    console.error(err)
    process.exit(1)
  }
}

app.use('/api/auth',          loadRoute('./routes/auth', 'auth'))
app.use('/api/wallet',        loadRoute('./routes/wallet', 'wallet'))
app.use('/api/transactions',  loadRoute('./routes/transactions', 'transactions'))
app.use('/api/invest',        loadRoute('./routes/invest', 'invest'))
app.use('/api/forex',         loadRoute('./routes/forex', 'forex'))
app.use('/api/wifi',          loadRoute('./routes/wifi', 'wifi'))
app.use('/api/hotspot',       loadRoute('./routes/hotspot', 'hotspot'))
app.use('/api/merchant',      loadRoute('./routes/merchant', 'merchant'))
app.use('/api/coupon',        loadRoute('./routes/coupon', 'coupon'))
app.use('/api/referrals',     loadRoute('./routes/referrals', 'referrals'))
app.use('/api/kyc',           loadRoute('./routes/kyc', 'kyc'))
app.use('/api/notifications', loadRoute('./routes/notifications', 'notifications'))
app.use('/api/bills',         loadRoute('./routes/bills', 'bills'))
app.use('/api/subscriptions', loadRoute('./routes/subscriptions', 'subscriptions'))
app.use('/api/withdrawal',    loadRoute('./routes/withdrawal', 'withdrawal'))
app.use('/api/request',       loadRoute('./routes/request', 'request'))
app.use('/api/qr',            loadRoute('./routes/qr', 'qr'))
app.use('/api/packages',      loadRoute('./routes/packages', 'packages'))
app.use('/api/passwords',     loadRoute('./routes/passwords', 'passwords'))
app.use('/api/mikrotik',      loadRoute('./routes/mikrotik', 'mikrotik'))
app.use('/api/admin',         loadRoute('./routes/admin', 'admin'))

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'NanePay API', timestamp: new Date() })
);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) =>
  res.status(404).json({ message: `Route ${req.method} ${req.path} not found` })
);

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack || err.message);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n🚀 NanePay API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
});

module.exports = app;
