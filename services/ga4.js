const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { hashEmail, hashPhone, hashName } = require('./hasher');

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

/**
 * Extracts and normalizes the GA4 client_id from GHL's gaClientId field.
 * GHL stores it as 'GA1.2.XXXXXXXXXX.XXXXXXXXXX' — use the full value.
 * If missing, generate a UUID fallback.
 */
function extractClientId(gaClientId) {
  if (gaClientId && gaClientId.trim()) {
    return gaClientId.trim();
  }
  return uuidv4();
}

/**
 * Sends a conversion event to the GA4 Measurement Protocol.
 *
 * @param {object} client - Client config from DB
 * @param {object} payload - Raw GHL webhook payload
 * @param {object} eventMapping - { ga4: 'event_name', ... }
 * @param {object} options - { conversionValue, currencyCode }
 * @returns {{ success: boolean, response: object, error: string|null }}
 */
async function sendGA4Event(client, payload, eventMapping, options = {}) {
  if (!client.ga4_measurement_id || !client.ga4_api_secret) {
    return { success: false, response: null, error: 'Missing GA4 Measurement ID or API secret' };
  }

  const attr = payload.contact?.attributionSource || {};
  const clientId = extractClientId(attr.gaClientId);

  // Build event params
  const eventParams = {
    engagement_time_msec: 1,
    session_id: String(Date.now())
  };

  // Add value/currency for purchase events
  if (eventMapping.ga4 === 'purchase' && options.conversionValue) {
    eventParams.value = options.conversionValue;
    eventParams.currency = options.currencyCode || 'USD';
    eventParams.transaction_id = payload.contact_id || uuidv4();
  }

  // Add campaign/utm params if available
  if (attr.utmSource) eventParams.source = attr.utmSource;
  if (attr.utmMedium) eventParams.medium = attr.utmMedium;
  if (attr.campaign) eventParams.campaign = attr.campaign;

  const requestBody = {
    client_id: clientId,
    events: [{
      name: eventMapping.ga4,
      params: eventParams
    }]
  };

  // Add user_id if we have a contact_id
  if (payload.contact_id) {
    requestBody.user_id = payload.contact_id;
  }

  // Add user_data for enhanced conversions (hashed PII)
  const userData = {};
  if (payload.email) {
    userData.sha256_email_address = hashEmail(payload.email);
  }
  if (payload.phone) {
    userData.sha256_phone_number = hashPhone(payload.phone);
  }
  if (payload.first_name || payload.last_name || payload.city || payload.postal_code) {
    userData.address = {};
    if (payload.first_name) userData.address.sha256_first_name = hashName(payload.first_name);
    if (payload.last_name) userData.address.sha256_last_name = hashName(payload.last_name);
    if (payload.city) userData.address.city = payload.city.toLowerCase().trim();
    if (payload.state) userData.address.region = payload.state.toLowerCase().trim();
    if (payload.postal_code) userData.address.postal_code = payload.postal_code.trim();
    if (payload.country) userData.address.country = payload.country.trim().toUpperCase();
  }
  if (Object.keys(userData).length > 0) {
    requestBody.user_data = userData;
  }

  const url = `${GA4_ENDPOINT}?measurement_id=${client.ga4_measurement_id}&api_secret=${client.ga4_api_secret}`;

  try {
    const response = await axios.post(url, requestBody, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });

    // GA4 Measurement Protocol returns 204 on success with no body
    return {
      success: true,
      response: { status: response.status, data: response.data || 'accepted' },
      error: null
    };
  } catch (err) {
    const errorMessage = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;
    console.error('[GA4] Error:', errorMessage);
    return {
      success: false,
      response: err.response?.data || null,
      error: errorMessage
    };
  }
}

/**
 * Sends a test event to verify GA4 connection.
 */
async function sendTestEvent(client) {
  const fakePayload = {
    email: 'test@example.com',
    contact_id: 'test-contact-id-123',
    contact: { attributionSource: { gaClientId: `GA1.2.${Date.now()}.${Date.now()}` } }
  };

  return sendGA4Event(client, fakePayload, { ga4: 'generate_lead' });
}

module.exports = { sendGA4Event, sendTestEvent, extractClientId };
