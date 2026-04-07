const { isWithin90Days, getFbcTimestamp } = require('./hasher');

/**
 * Finds a value from Shopify's note_attributes array [{name, value}].
 */
function extractNoteAttribute(noteAttributes, name) {
  if (!Array.isArray(noteAttributes)) return null;
  const attr = noteAttributes.find(a => a.name === name);
  return attr ? attr.value : null;
}

/**
 * Normalizes a Shopify webhook payload into a flat GHL-like shape
 * so the existing buildHashedUserData() from hasher.js can process it.
 */
function normalizeShopifyPayload(shopifyPayload, topic) {
  const payload = shopifyPayload || {};
  let customer, address, noteAttributes, clientDetails;

  if (topic === 'customers/create') {
    // The payload IS the customer object
    customer = payload;
    address = payload.default_address || {};
    noteAttributes = payload.note_attributes || [];
    clientDetails = {};
  } else if (topic === 'carts/update') {
    // Carts have limited data
    customer = {};
    address = {};
    noteAttributes = payload.note_attributes || [];
    clientDetails = {};
  } else {
    // orders/*, checkouts/*
    customer = payload.customer || {};
    address = payload.billing_address || {};
    noteAttributes = payload.note_attributes || [];
    clientDetails = payload.client_details || {};
  }

  // Extract fbp and fbc from note_attributes
  const fbp = extractNoteAttribute(noteAttributes, '_fbp');
  let fbc = extractNoteAttribute(noteAttributes, '_fbc');

  // Only include fbc if within 90 days
  if (fbc) {
    const fbcTs = getFbcTimestamp(fbc);
    if (!fbcTs || !isWithin90Days(fbcTs)) {
      fbc = null;
    }
  }

  return {
    email: customer.email || payload.email || null,
    phone: customer.phone || address.phone || null,
    first_name: customer.first_name || address.first_name || null,
    last_name: customer.last_name || address.last_name || null,
    city: address.city || null,
    state: address.province_code || null,
    postal_code: address.zip || null,
    country: address.country_code || null,
    contact_id: String(customer.id || payload.id || ''),
    contact: {
      attributionSource: {
        ip: clientDetails.browser_ip || payload.browser_ip || null,
        userAgent: clientDetails.user_agent || null,
        fbp: fbp || null,
        fbc: fbc || null,
        url: null
      }
    }
  };
}

module.exports = { normalizeShopifyPayload, extractNoteAttribute };
