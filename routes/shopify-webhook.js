const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getClientById, insertEvent } = require('../db/database');
const { sendMetaEvent } = require('../services/meta-capi');
const { sendGA4Event } = require('../services/ga4');
const { sendGoogleAdsConversion } = require('../services/google-ads');
const { resolveShopifyEvent, buildCustomData } = require('../services/shopify-mapper');
const { normalizeShopifyPayload } = require('../services/shopify-hasher');
const { buildHashedUserData } = require('../services/hasher');

// Verify Shopify HMAC signature
function verifyShopifyHmac(rawBody, secret, hmacHeader) {
  const computed = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

router.post('/:clientId', async (req, res) => {
  const clientId = req.params.clientId;

  // Look up client
  const client = getClientById(clientId);
  if (!client || !client.active) {
    return res.status(404).json({ error: 'Client not found' });
  }

  // Verify HMAC if secret is configured
  if (client.shopify_webhook_secret) {
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    if (!hmacHeader || !req.rawBody) {
      return res.status(401).json({ error: 'Missing HMAC' });
    }
    if (!verifyShopifyHmac(req.rawBody, client.shopify_webhook_secret, hmacHeader)) {
      return res.status(401).json({ error: 'Invalid HMAC' });
    }
  }

  // Acknowledge immediately
  res.status(200).json({ received: true });

  // Process asynchronously
  const topic = req.get('X-Shopify-Topic') || 'unknown';
  const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

  processShopifyWebhook(client, topic, payload).catch(err => {
    console.error('[Shopify Webhook] Unhandled error:', err.message);
  });
});

async function processShopifyWebhook(client, topic, payload) {
  const timestamp = new Date().toISOString();

  console.log(`[Shopify Webhook] Processing "${topic}" for client "${client.display_name}"`);

  // Map topic to events
  const eventMapping = resolveShopifyEvent(topic);

  // Build custom_data for Meta (content_ids, value, currency, etc.)
  const customData = buildCustomData(topic, payload);

  // Normalize Shopify payload to GHL-like shape so existing hasher works
  const normalized = normalizeShopifyPayload(payload, topic);

  // Check data quality — only send to Meta if we have real customer data
  const hasEmail = !!(normalized.email);
  const hasPhone = !!(normalized.phone);
  const hasName = !!(normalized.first_name || normalized.last_name);

  if (!hasEmail && !hasPhone) {
    console.log(`[Shopify Webhook] Skipping "${topic}" — no email or phone (low quality)`);
    insertEvent({
      timestamp,
      client_id: client.id,
      client_name: client.display_name,
      contact_name: null,
      contact_email: null,
      event_type: eventMapping.meta || topic,
      ghl_workflow_name: `[Shopify] ${topic}`,
      meta_status: 'skipped',
      meta_response: 'Low data quality — no email or phone',
      ga4_status: 'skipped',
      ga4_response: 'Low data quality',
      google_ads_status: 'skipped',
      google_ads_response: 'Low data quality',
      data_quality: 'low',
      raw_payload: JSON.stringify(payload)
    });
    return;
  }

  // Build options
  const options = {
    conversionValue: customData.value || 0,
    currencyCode: customData.currency || 'USD',
    testEventCode: client.meta_test_event_code || null,
    custom_data: Object.keys(customData).length > 0 ? customData : undefined
  };

  // Fire all APIs
  const [metaResult, ga4Result, googleAdsResult] = await Promise.allSettled([
    sendMetaEvent(client, normalized, eventMapping, options),
    sendGA4Event(client, normalized, eventMapping, options),
    sendGoogleAdsConversion(client, normalized, eventMapping, options)
  ]);

  const meta = metaResult.status === 'fulfilled' ? metaResult.value : { success: false, error: metaResult.reason?.message };
  const ga4 = ga4Result.status === 'fulfilled' ? ga4Result.value : { success: false, error: ga4Result.reason?.message };
  const gads = googleAdsResult.status === 'fulfilled' ? googleAdsResult.value : { success: false, error: googleAdsResult.reason?.message };

  const metaStatus = meta.success ? 'success' : 'error';
  const ga4Status = ga4.success ? 'success' : 'error';
  const gadsStatus = gads.skipped ? 'skipped' : (gads.success ? 'success' : 'error');

  console.log(`[Shopify Webhook] Results — Meta: ${metaStatus}, GA4: ${ga4Status}, Google Ads: ${gadsStatus}`);

  // Extract contact name for logging
  const customer = payload.customer || payload;
  const contactName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || null;

  insertEvent({
    timestamp,
    client_id: client.id,
    client_name: client.display_name,
    contact_name: contactName,
    contact_email: customer.email || payload.email || null,
    event_type: eventMapping.meta || topic,
    ghl_workflow_name: `[Shopify] ${topic}`,
    meta_status: metaStatus,
    meta_response: JSON.stringify(meta.response || meta.error),
    ga4_status: ga4Status,
    ga4_response: JSON.stringify(ga4.response || ga4.error),
    google_ads_status: gadsStatus,
    google_ads_response: JSON.stringify(gads.response || gads.error),
    data_quality: normalized.email ? 'high' : 'low',
    raw_payload: JSON.stringify(payload)
  });
}

module.exports = router;
