const express = require('express');
const router = express.Router();

const { getClientByLocationId, insertEvent } = require('../db/database');
const { sendMetaEvent } = require('../services/meta-capi');
const { sendGA4Event } = require('../services/ga4');
const { sendGoogleAdsConversion } = require('../services/google-ads');
const { resolveEventMapping, assessDataQuality } = require('../services/event-mapper');

/**
 * POST /webhook/ghl
 * Receives all GoHighLevel webhook events.
 */
router.post('/ghl', async (req, res) => {
  // Immediately acknowledge the webhook to GHL
  res.status(200).json({ received: true });

  // Process asynchronously to avoid GHL timeout
  processWebhook(req.body).catch(err => {
    console.error('[Webhook] Unhandled processing error:', err.message);
  });
});

async function processWebhook(payload) {
  const timestamp = new Date().toISOString();

  // Validate minimum payload structure
  if (!payload || typeof payload !== 'object') {
    console.warn('[Webhook] Invalid payload received');
    return;
  }

  // Extract location ID for client routing
  const locationId = payload.location?.id || payload.locationId;
  if (!locationId) {
    console.warn('[Webhook] No location.id found in payload - logging as unrouted');
    await logUnrouted(payload, timestamp, 'No location.id field');
    return;
  }

  // Look up client by location ID
  const client = getClientByLocationId(locationId);
  if (!client) {
    console.warn(`[Webhook] No client configured for locationId: ${locationId}`);
    await logUnrouted(payload, timestamp, `No client for locationId: ${locationId}`);
    return;
  }

  // Determine event type from workflow name
  const workflowName = payload.workflow?.name || payload.workflowName || 'Unknown Workflow';
  const eventMapping = resolveEventMapping(workflowName, client.event_mappings);
  const dataQuality = assessDataQuality(payload);

  console.log(`[Webhook] Processing "${workflowName}" for client "${client.display_name}" (quality: ${dataQuality})`);

  // Flag incomplete data
  if (dataQuality === 'low') {
    console.warn(`[Webhook] Low data quality for contact ${payload.contact_id || 'unknown'}`);
  }

  // Extract conversion value: from GHL order data, or from mapping defaults
  const conversionValue = payload.order?.amount || payload.conversionValue || eventMapping.conversionValue || 0;
  const currencyCode = payload.order?.currency || 'USD';

  const options = { conversionValue, currencyCode, testEventCode: client.meta_test_event_code || null };

  // Fire all three API calls in parallel
  const [metaResult, ga4Result, googleAdsResult] = await Promise.allSettled([
    sendMetaEvent(client, payload, eventMapping, options),
    sendGA4Event(client, payload, eventMapping, options),
    sendGoogleAdsConversion(client, payload, eventMapping, options)
  ]);

  // Unwrap settled results
  const meta = metaResult.status === 'fulfilled' ? metaResult.value : { success: false, error: metaResult.reason?.message };
  const ga4 = ga4Result.status === 'fulfilled' ? ga4Result.value : { success: false, error: ga4Result.reason?.message };
  const gads = googleAdsResult.status === 'fulfilled' ? googleAdsResult.value : { success: false, error: googleAdsResult.reason?.message };

  // Determine status labels
  const metaStatus = meta.success ? 'success' : 'error';
  const ga4Status = ga4.success ? 'success' : 'error';
  const gadsStatus = gads.skipped ? 'skipped' : (gads.success ? 'success' : 'error');

  console.log(`[Webhook] Results — Meta: ${metaStatus}, GA4: ${ga4Status}, Google Ads: ${gadsStatus}`);
  if (!meta.success) console.error('[Webhook] Meta error:', meta.error);
  if (!ga4.success) console.error('[Webhook] GA4 error:', ga4.error);
  if (!gads.success && !gads.skipped) console.error('[Webhook] Google Ads error:', gads.error);

  // Log event to database
  const contactName = [payload.first_name, payload.last_name].filter(Boolean).join(' ') || null;

  insertEvent({
    timestamp,
    client_id: client.id,
    client_name: client.display_name,
    contact_name: contactName,
    contact_email: payload.email || null,
    event_type: eventMapping.meta || workflowName,
    ghl_workflow_name: workflowName,
    meta_status: metaStatus,
    meta_response: JSON.stringify(meta.response || meta.error),
    ga4_status: ga4Status,
    ga4_response: JSON.stringify(ga4.response || ga4.error),
    google_ads_status: gadsStatus,
    google_ads_response: JSON.stringify(gads.response || gads.error),
    data_quality: dataQuality,
    raw_payload: JSON.stringify(payload)
  });
}

async function logUnrouted(payload, timestamp, reason) {
  const contactName = [payload.first_name, payload.last_name].filter(Boolean).join(' ') || null;
  insertEvent({
    timestamp,
    client_id: null,
    client_name: 'UNROUTED',
    contact_name: contactName,
    contact_email: payload.email || null,
    event_type: 'unrouted',
    ghl_workflow_name: payload.workflow?.name || 'unknown',
    meta_status: 'skipped',
    meta_response: reason,
    ga4_status: 'skipped',
    ga4_response: reason,
    google_ads_status: 'skipped',
    google_ads_response: reason,
    data_quality: 'low',
    raw_payload: JSON.stringify(payload)
  });
}

module.exports = router;
