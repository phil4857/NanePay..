require('dotenv').config();

let smsClient = null;

// Lazy-load Africa's Talking only if API key is set
const getClient = () => {
  if (smsClient) return smsClient;
  if (!process.env.AT_API_KEY || process.env.AT_API_KEY === 'your_africastalking_api_key') {
    return null;
  }
  try {
    const AfricasTalking = require('africastalking');
    const at = AfricasTalking({ apiKey: process.env.AT_API_KEY, username: process.env.AT_USERNAME || 'sandbox' });
    smsClient = at.SMS;
  } catch (e) {
    console.warn('[SMS] africastalking package not installed');
  }
  return smsClient;
};

const sendSMS = async (to, message) => {
  if (!to || !message) return;

  // Always log in development
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[SMS DEV] To: ${to}`);
    console.log(`[SMS DEV] Message: ${message}`);
    return { status: 'dev-mock', to, message };
  }

  const client = getClient();
  if (!client) {
    console.warn('[SMS] No SMS client configured — skipping send');
    return;
  }

  try {
    const result = await client.send({
      to: [to],
      message,
      from: process.env.AT_SENDER_ID || 'NanePay',
    });
    return result;
  } catch (err) {
    // Never throw — SMS failure must not break transactions
    console.error('[SMS Error]', err.message);
  }
};

const sendBulkSMS = async (recipients, message) => {
  if (!recipients?.length || !message) return;
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[BULK SMS DEV] To ${recipients.length} recipients: ${message}`);
    return;
  }
  const client = getClient();
  if (!client) return;
  try {
    await client.send({ to: recipients, message, from: process.env.AT_SENDER_ID || 'NanePay' });
  } catch (err) {
    console.error('[Bulk SMS Error]', err.message);
  }
};

module.exports = { sendSMS, sendBulkSMS };
