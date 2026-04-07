const express = require('express');
const router = express.Router();

const {
  getAllClients, getClientById, createClient, updateClient, deleteClient,
  getEvents, getStats, insertEvent
} = require('../db/database');

const { sendMetaEvent, sendTestEvent: metaTestEvent } = require('../services/meta-capi');
const { sendGA4Event, sendTestEvent: ga4TestEvent } = require('../services/ga4');
const { sendGoogleAdsConversion, sendTestEvent: gadsTestEvent } = require('../services/google-ads');
const { DEFAULT_MAPPINGS } = require('../services/event-mapper');

// --- Stats ---
router.get('/stats', (req, res) => {
  try {
    const stats = getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Events ---
router.get('/events', (req, res) => {
  try {
    const { clientId, eventType, status, startDate, endDate, page, limit } = req.query;
    const result = getEvents({
      clientId: clientId ? parseInt(clientId) : undefined,
      eventType,
      status,
      startDate,
      endDate,
      page: page ? parseInt(page) : 1,
      limit: limit ? Math.min(parseInt(limit), 200) : 50
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single event (for raw payload inspect)
router.get('/events/:id', (req, res) => {
  const { getDb } = require('../db/database');
  try {
    const event = getDb().prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Clients ---
router.get('/clients', (req, res) => {
  try {
    res.json(getAllClients());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/clients/:id', (req, res) => {
  try {
    const client = getClientById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    // Mask sensitive tokens in response
    res.json(maskSensitiveFields(client));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/clients', (req, res) => {
  try {
    const data = sanitizeClientData(req.body);
    if (!data.display_name) {
      return res.status(400).json({ error: 'display_name is required' });
    }
    if (!data.ghl_location_id && data.client_type !== 'shopify') {
      return res.status(400).json({ error: 'ghl_location_id is required for non-Shopify clients' });
    }
    const id = createClient(data);
    res.status(201).json({ id, message: 'Client created successfully' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A client with that Location ID already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.put('/clients/:id', (req, res) => {
  try {
    const existing = getClientById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Client not found' });

    const data = sanitizeClientData(req.body);
    // Preserve existing sensitive fields if not provided (empty string = no change)
    const merged = mergeSensitiveFields(existing, data);
    updateClient(req.params.id, merged);
    res.json({ message: 'Client updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/clients/:id', (req, res) => {
  try {
    const existing = getClientById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Client not found' });
    deleteClient(req.params.id);
    res.json({ message: 'Client deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Test Connections ---
router.post('/clients/:id/test', async (req, res) => {
  try {
    const client = getClientById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const results = {};

    // Test Meta CAPI
    if (client.meta_pixel_id && client.meta_capi_token) {
      results.meta = await metaTestEvent(client);
    } else {
      results.meta = { skipped: true, error: 'No Meta credentials configured' };
    }

    // Test GA4
    if (client.ga4_measurement_id && client.ga4_api_secret) {
      results.ga4 = await ga4TestEvent(client);
    } else {
      results.ga4 = { skipped: true, error: 'No GA4 credentials configured' };
    }

    // Test Google Ads
    if (client.google_ads_customer_id && client.oauth_client_id && client.google_ads_refresh_token) {
      results.google_ads = await gadsTestEvent(client);
    } else {
      results.google_ads = { skipped: true, error: 'No Google Ads credentials configured' };
    }

    // Log the test event to the event table
    insertEvent({
      timestamp: new Date().toISOString(),
      client_id: client.id,
      client_name: client.display_name,
      contact_name: 'Test User',
      contact_email: 'test@example.com',
      event_type: 'Lead',
      ghl_workflow_name: '[Dashboard Test]',
      meta_status: results.meta?.success ? 'success' : (results.meta?.skipped ? 'skipped' : 'error'),
      meta_response: JSON.stringify(results.meta?.response || results.meta?.error || null),
      ga4_status: results.ga4?.success ? 'success' : (results.ga4?.skipped ? 'skipped' : 'error'),
      ga4_response: JSON.stringify(results.ga4?.response || results.ga4?.error || null),
      google_ads_status: results.google_ads?.success ? 'success' : (results.google_ads?.skipped ? 'skipped' : 'error'),
      google_ads_response: JSON.stringify(results.google_ads?.response || results.google_ads?.error || null),
      data_quality: 'normal',
      raw_payload: JSON.stringify({ test: true })
    });

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Default event mappings (for the UI to display) ---
router.get('/event-mappings/defaults', (req, res) => {
  res.json(DEFAULT_MAPPINGS);
});

// --- Helper functions ---

const SENSITIVE_FIELDS = ['meta_capi_token', 'ga4_api_secret', 'oauth_client_secret', 'google_ads_refresh_token', 'google_ads_developer_token', 'shopify_webhook_secret'];

function maskSensitiveFields(client) {
  const masked = { ...client };
  SENSITIVE_FIELDS.forEach(field => {
    if (masked[field]) {
      masked[field] = masked[field].substring(0, 6) + '••••••';
    }
  });
  return masked;
}

function sanitizeClientData(body) {
  return {
    display_name: body.display_name?.trim() || '',
    ghl_location_id: body.ghl_location_id?.trim() || '',
    meta_pixel_id: body.meta_pixel_id?.trim() || '',
    meta_capi_token: body.meta_capi_token?.trim() || '',
    ga4_measurement_id: body.ga4_measurement_id?.trim() || '',
    ga4_api_secret: body.ga4_api_secret?.trim() || '',
    google_ads_customer_id: body.google_ads_customer_id?.trim() || '',
    google_ads_conversion_action_id: body.google_ads_conversion_action_id?.trim() || '',
    google_ads_developer_token: body.google_ads_developer_token?.trim() || '',
    oauth_client_id: body.oauth_client_id?.trim() || '',
    oauth_client_secret: body.oauth_client_secret?.trim() || '',
    google_ads_refresh_token: body.google_ads_refresh_token?.trim() || '',
    meta_test_event_code: body.meta_test_event_code?.trim() || '',
    event_mappings: body.event_mappings
      ? (typeof body.event_mappings === 'string' ? body.event_mappings : JSON.stringify(body.event_mappings))
      : '{}',
    override_domain: (() => {
      let d = (body.override_domain || '').trim();
      if (d && !/^https?:\/\//i.test(d)) d = 'https://' + d;
      return d;
    })(),
    shopify_domain: body.shopify_domain?.trim() || '',
    shopify_webhook_secret: body.shopify_webhook_secret?.trim() || '',
    client_type: body.client_type?.trim() || 'ghl',
    active: body.active !== undefined ? (body.active ? 1 : 0) : 1
  };
}

// When updating, keep existing sensitive values if the incoming value is empty
function mergeSensitiveFields(existing, incoming) {
  const merged = { ...incoming };
  SENSITIVE_FIELDS.forEach(field => {
    if (!merged[field]) {
      merged[field] = existing[field];
    }
  });
  return merged;
}

module.exports = router;
