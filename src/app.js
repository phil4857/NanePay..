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
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/wallet',        require('./routes/wallet'));
app.use('/api/transactions',  require('./routes/transactions'));
app.use('/api/invest',        require('./routes/invest'));
app.use('/api/forex',         require('./routes/forex'));
app.use('/api/wifi',          require('./routes/wifi'));
app.use('/api/hotspot',       require('./routes/hotspot'));
app.use('/api/merchant',      require('./routes/merchant'));
app.use('/api/coupon',        require('./routes/coupon'));
app.use('/api/referrals',     require('./routes/referrals'));
app.use('/api/kyc',           require('./routes/kyc'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/bills',         require('./routes/bills'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/withdrawal',    require('./routes/withdrawal'));
app.use('/api/request',       require('./routes/request'));
app.use('/api/qr',            require('./routes/qr'));
app.use('/api/packages',      require('./routes/packages'));
app.use('/api/passwords',     require('./routes/passwords'));
app.use('/api/mikrotik',      require('./routes/mikrotik'));
app.use('/api/admin',         require('./routes/admin'));

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
