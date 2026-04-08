const axios = require('axios');

const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ADS_API_VERSION = 'v23';

/**
 * Exchanges a refresh token for a fresh access token.
 */
async function getAccessToken(client) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: client.oauth_client_id,
    client_secret: client.oauth_client_secret,
    refresh_token: client.google_ads_refresh_token
  });

  const response = await axios.post(GOOGLE_OAUTH_TOKEN_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000
  });

  return response.data.access_token;
}

/**
 * Formats a Date object into the Google Ads required format:
 * yyyy-mm-dd HH:mm:ss+HH:mm
 * Defaults to UTC offset.
 */
function formatConversionDateTime(date) {
  const d = date || new Date();
  const pad = n => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+00:00`
  );
}

/**
 * Cleans a Google Ads customer ID by removing dashes.
 * e.g. "123-456-7890" → "1234567890"
 */
function cleanCustomerId(customerId) {
  return String(customerId).replace(/-/g, '');
}

/**
 * Uploads an offline click conversion to Google Ads.
 * Only fires if gclid is present on the contact.
 *
 * @param {object} client - Client config from DB
 * @param {object} payload - Raw GHL webhook payload
 * @param {object} eventMapping - { google_ads: 'Conversion Action Name', ... }
 * @param {object} options - { conversionValue, currencyCode }
 * @returns {{ success: boolean, skipped: boolean, response: object, error: string|null }}
 */
async function sendGoogleAdsConversion(client, payload, eventMapping, options = {}) {
  const attr = payload.contact?.attributionSource || {};
  const gclid = attr.gclid;

  // Skip if no gclid (not from a Google Ads click)
  if (!gclid) {
    return { success: true, skipped: true, response: null, error: null };
  }

  // Skip if no Google Ads action configured for this event type
  if (!eventMapping.google_ads) {
    return { success: true, skipped: true, response: null, error: null };
  }

  // Validate required client credentials
  if (!client.google_ads_customer_id || !client.google_ads_conversion_action_id) {
    return { success: false, skipped: false, response: null, error: 'Missing Google Ads customer ID or conversion action ID' };
  }
  if (!client.oauth_client_id || !client.oauth_client_secret || !client.google_ads_refresh_token) {
    return { success: false, skipped: false, response: null, error: 'Missing Google Ads OAuth credentials' };
  }

  const customerId = cleanCustomerId(client.google_ads_customer_id);
  const conversionActionId = client.google_ads_conversion_action_id;
  const conversionActionResource = `customers/${customerId}/conversionActions/${conversionActionId}`;

  const conversion = {
    gclid,
    conversionAction: conversionActionResource,
    conversionDateTime: formatConversionDateTime(new Date()),
    conversionValue: options.conversionValue || 0,
    currencyCode: options.currencyCode || 'USD',
    consent: {
      adUserData: 'GRANTED',
      adPersonalization: 'GRANTED'
    }
  };

  // Add order_id (contact_id as dedup key) if available
  if (payload.contact_id) {
    conversion.orderId = payload.contact_id;
  }

  const developerToken = client.google_ads_developer_token || process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) {
    return { success: false, skipped: false, response: null, error: 'Missing Google Ads developer token' };
  }

  let accessToken;
  try {
    accessToken = await getAccessToken(client);
  } catch (err) {
    const errorMsg = err.response?.data?.error_description || err.message;
    console.error('[Google Ads] Token refresh failed:', errorMsg);
    return { success: false, skipped: false, response: null, error: `Token refresh failed: ${errorMsg}` };
  }

  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}:uploadClickConversions`;

  try {
    const response = await axios.post(url, {
      conversions: [conversion],
      partialFailure: true
    }, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': developerToken,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    const data = response.data;

    // Check for partial failure
    if (data.partialFailureError) {
      console.error('[Google Ads] Partial failure:', JSON.stringify(data.partialFailureError));
      return {
        success: false,
        skipped: false,
        response: data,
        error: JSON.stringify(data.partialFailureError)
      };
    }

    return { success: true, skipped: false, response: data, error: null };
  } catch (err) {
    const errorMessage = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;
    console.error('[Google Ads] Upload error:', errorMessage);
    return { success: false, skipped: false, response: err.response?.data || null, error: errorMessage };
  }
}

/**
 * Sends a test conversion to verify Google Ads credentials.
 * Uses a fake gclid — this will return CLICK_NOT_FOUND which is expected.
 */
async function sendTestEvent(client) {
  const fakePayload = {
    contact_id: 'test-contact-id-123',
    contact: {
      attributionSource: {
        gclid: 'test-gclid-' + Date.now()
      }
    }
  };

  const result = await sendGoogleAdsConversion(
    client,
    fakePayload,
    { google_ads: 'Lead' },
    { conversionValue: 0 }
  );

  // CLICK_NOT_FOUND with a fake gclid is an expected test outcome
  return result;
}

module.exports = { sendGoogleAdsConversion, sendTestEvent, formatConversionDateTime };
