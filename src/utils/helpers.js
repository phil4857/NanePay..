const crypto = require('crypto');

const generateRef = () =>
  'NP' + Date.now() + crypto.randomBytes(2).toString('hex').toUpperCase();

const calcFee = (amount) => {
  const rate = parseFloat(process.env.PLATFORM_FEE_RATE || '0.01');
  return Math.ceil(Number(amount) * rate * 100) / 100;
};

const totalWithFee = (amount) => Number(amount) + calcFee(amount);

const parseExpiry = (duration) => {
  const d = new Date();
  const dur = (duration || '').toLowerCase();
  if (dur.includes('min'))        d.setMinutes(d.getMinutes() + (parseInt(dur) || 30));
  else if (dur.includes('hour'))  d.setHours(d.getHours() + (parseInt(dur) || 1));
  else if (dur.includes('day'))   d.setDate(d.getDate() + (parseInt(dur) || 1));
  else if (dur.includes('week'))  d.setDate(d.getDate() + 7);
  else if (dur.includes('month')) d.setDate(d.getDate() + 30);
  else                            d.setHours(d.getHours() + 1);
  return d;
};

module.exports = { generateRef, calcFee, totalWithFee, parseExpiry };
