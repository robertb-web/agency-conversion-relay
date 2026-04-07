const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { buildHashedUserData } = require('./hasher');

const META_API_VERSION = 'v25.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

/**
 * Sends a conversion event to the Meta Conversions API.
 *
 * @param {object} client - Client config from DB
 * @param {object} payload - Raw GHL webhook payload
 * @param {object} eventMapping - { meta: 'EventName', ... }
 * @param {object} options - { testEventCode, conversionValue, currencyCode }
 * @returns {{ success: boolean, response: object, error: string|null }}
 */
async function sendMetaEvent(client, payload, eventMapping, options = {}) {
  if (!client.meta_pixel_id || !client.meta_capi_token) {
    return { success: false, response: null, error: 'Missing Meta Pixel ID or CAPI token' };
  }

  const attr = payload.contact?.attributionSource || {};
  const hashedUserData = buildHashedUserData(payload);

  // Build deduplication event ID
  const eventId = uuidv4();

  // Determine action_source and event_source_url
  const rawEventSourceUrl = attr.referrer || attr.sessionSourceUrl || attr.url || undefined;
  let actionSource = rawEventSourceUrl ? 'website' : 'system_generated';
  let eventSourceUrl = rawEventSourceUrl;

  // Per-client domain override for flagged accounts
  if (client.override_domain) {
    eventSourceUrl = client.override_domain;
    actionSource = 'website';
  }

  const serverEvent = {
    event_name: eventMapping.meta,
    event_time: Math.floor(Date.now() / 1000),
    action_source: actionSource,
    event_id: eventId,
    user_data: hashedUserData
  };

  if (eventSourceUrl) {
    serverEvent.event_source_url = eventSourceUrl;
  }

  // Add custom_data: use provided custom_data (Shopify) or auto-build for Purchase (GHL)
  if (options.custom_data) {
    serverEvent.custom_data = options.custom_data;
  } else if (eventMapping.meta === 'Purchase') {
    serverEvent.custom_data = {
      value: options.conversionValue || 0,
      currency: options.currencyCode || 'USD'
    };
  }

  const requestBody = {
    data: [serverEvent]
  };

  // Add test event code if provided (for testing in Meta Events Manager)
  const testCode = options.testEventCode || process.env.META_TEST_EVENT_CODE;
  if (testCode) {
    requestBody.test_event_code = testCode;
    console.log(`[Meta CAPI] Using test event code: ${testCode}`);
  }

  const url = `${META_API_BASE}/${client.meta_pixel_id}/events`;
  console.log(`[Meta CAPI] Sending to pixel: ${client.meta_pixel_id}`);
  console.log(`[Meta CAPI] Full request body: ${JSON.stringify(requestBody, null, 2)}`);

  // Exponential backoff retry for rate limits (max 3 retries)
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await axios.post(url, requestBody, {
        params: { access_token: client.meta_capi_token },
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });

      console.log(`[Meta CAPI] Response:`, JSON.stringify(response.data));
      return {
        success: true,
        response: response.data,
        error: null,
        eventId
      };
    } catch (err) {
      const statusCode = err.response?.status;
      const errorData = err.response?.data;

      // Rate limit - retry with backoff
      if (statusCode === 429 && attempt < 2) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(r => setTimeout(r, delay));
        lastError = err;
        continue;
      }

      const errorMessage = errorData?.error?.message || err.message;
      console.error(`[Meta CAPI] Error (attempt ${attempt + 1}):`, errorMessage);
      return {
        success: false,
        response: errorData || null,
        error: errorMessage
      };
    }
  }

  return {
    success: false,
    response: null,
    error: lastError?.message || 'Max retries exceeded'
  };
}

/**
 * Sends a test event to verify the Meta CAPI connection for a client.
 */
async function sendTestEvent(client) {
  const fakePayload = {
    email: 'test@example.com',
    phone: '+15555555555',
    first_name: 'Test',
    last_name: 'User',
    contact_id: 'test-contact-id-123',
    contact: {
      attributionSource: {
        referrer: 'https://example.com',
        sessionSourceUrl: 'https://example.com/thank-you'
      }
    }
  };

  return sendMetaEvent(
    client,
    fakePayload,
    { meta: 'Lead' },
    { testEventCode: client.meta_test_event_code || process.env.META_TEST_EVENT_CODE || 'TEST12345' }
  );
}

module.exports = { sendMetaEvent, sendTestEvent };
