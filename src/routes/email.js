require('dotenv').config();

const sendEmail = async (to, subject, text, html) => {
  if (!to || !subject) return;

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[EMAIL DEV] To: ${to} | Subject: ${subject}`);
    return;
  }

  if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY === 'your_resend_api_key') {
    console.warn('[EMAIL] No Resend API key — skipping send');
    return;
  }

  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@nanepay.app',
      to,
      subject,
      text,
      html: html || `<p>${text}</p>`,
    });
  } catch (err) {
    console.error('[Email Error]', err.message);
  }
};

const sendReceiptEmail = async (user, tx) => {
  if (!user?.email) return;
  const amount = Math.abs(Number(tx.amount || 0));
  const fee    = Number(tx.fee || 0);
  const html   = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#080B12;color:#EEF2FF;padding:32px;border-radius:16px">
      <h2 style="color:#00E5A0;margin-bottom:4px">NanePay Receipt</h2>
      <p style="color:#5A6A8A;font-size:13px">Transaction Confirmation</p>
      <hr style="border-color:#1C2540;margin:20px 0"/>
      <table style="width:100%;font-size:14px">
        <tr><td style="color:#5A6A8A;padding:6px 0">Reference</td>
            <td style="text-align:right;font-weight:600">${tx.reference || tx.ref || '—'}</td></tr>
        <tr><td style="color:#5A6A8A;padding:6px 0">Type</td>
            <td style="text-align:right;font-weight:600;text-transform:capitalize">${tx.type}</td></tr>
        <tr><td style="color:#5A6A8A;padding:6px 0">Amount</td>
            <td style="text-align:right;font-weight:700;color:${Number(tx.amount)>0?'#00E5A0':'#EF4444'}">
              ${Number(tx.amount)>0?'+':''}KES ${amount.toFixed(2)}</td></tr>
        <tr><td style="color:#5A6A8A;padding:6px 0">Platform Fee (1%)</td>
            <td style="text-align:right;color:#F97316">KES ${fee.toFixed(2)}</td></tr>
        <tr><td style="color:#5A6A8A;padding:6px 0">Status</td>
            <td style="text-align:right;color:#00E5A0;text-transform:capitalize">${tx.status}</td></tr>
        <tr><td style="color:#5A6A8A;padding:6px 0">Date</td>
            <td style="text-align:right">${new Date().toLocaleString('en-KE')}</td></tr>
      </table>
      <hr style="border-color:#1C2540;margin:20px 0"/>
      <p style="color:#5A6A8A;font-size:12px;text-align:center">NanePay — Your Complete Fintech Ecosystem<br/>
      Support: support@nanepay.app</p>
    </div>`;
  await sendEmail(user.email, `NanePay Receipt — ${tx.reference || tx.ref}`,
    `Transaction processed. Amount: KES ${amount.toFixed(2)}. Fee: KES ${fee.toFixed(2)}.`, html);
};

const sendWelcomeEmail = async (user) => {
  if (!user?.email) return;
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#080B12;color:#EEF2FF;padding:32px;border-radius:16px;text-align:center">
      <h1 style="color:#00E5A0">Welcome to NanePay!</h1>
      <p style="color:#9AA5C0;margin:16px 0">Hi ${user.name}, your account is ready.</p>
      <p style="color:#5A6A8A;font-size:13px">Your referral code:
        <strong style="color:#00E5A0;letter-spacing:3px">${user.referral_code || ''}</strong></p>
      <a href="${process.env.FRONTEND_URL || 'https://nanepay.app'}"
        style="display:inline-block;margin-top:24px;background:#00E5A0;color:#080B12;
               padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700">
        Open NanePay
      </a>
    </div>`;
  await sendEmail(user.email, 'Welcome to NanePay!', `Welcome ${user.name}! Your account is ready.`, html);
};

module.exports = { sendEmail, sendReceiptEmail, sendWelcomeEmail };
