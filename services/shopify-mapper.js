const SHOPIFY_TOPIC_MAP = {
  'orders/paid': { meta: 'Purchase', ga4: 'purchase', google_ads: 'Purchase' },
  'orders/create': { meta: 'Purchase', ga4: 'purchase', google_ads: 'Purchase' },
  'checkouts/create': { meta: 'InitiateCheckout', ga4: 'begin_checkout', google_ads: null },
  'checkouts/update': { meta: 'InitiateCheckout', ga4: 'begin_checkout', google_ads: null },
  'customers/create': { meta: 'Lead', ga4: 'generate_lead', google_ads: 'Lead' },
  'carts/update': { meta: 'AddToCart', ga4: 'add_to_cart', google_ads: null }
};

/**
 * Resolves a Shopify webhook topic to ad platform event names.
 * Returns the mapping or a generic fallback.
 */
function resolveShopifyEvent(topic) {
  if (SHOPIFY_TOPIC_MAP[topic]) {
    return SHOPIFY_TOPIC_MAP[topic];
  }
  // Generic fallback for unmapped topics
  return { meta: 'ViewContent', ga4: 'page_view', google_ads: null };
}

/**
 * Builds Meta custom_data from a Shopify webhook payload.
 */
function buildCustomData(topic, payload) {
  if (topic.startsWith('orders/')) {
    const lineItems = payload.line_items || [];
    return {
      value: parseFloat(payload.total_price) || 0,
      currency: payload.currency || 'USD',
      content_ids: lineItems.map(item => String(item.product_id)),
      content_type: 'product',
      num_items: lineItems.length,
      order_id: String(payload.id)
    };
  }

  if (topic.startsWith('checkouts/')) {
    const lineItems = payload.line_items || [];
    return {
      value: parseFloat(payload.total_price) || 0,
      currency: payload.currency || 'USD',
      content_ids: lineItems.map(item => String(item.product_id)),
      content_type: 'product',
      num_items: lineItems.length
    };
  }

  if (topic === 'carts/update') {
    const lineItems = payload.line_items || [];
    return {
      content_ids: lineItems.map(item => String(item.product_id)),
      content_type: 'product',
      num_items: lineItems.length
    };
  }

  if (topic === 'customers/create') {
    return {};
  }

  return {};
}

module.exports = { SHOPIFY_TOPIC_MAP, resolveShopifyEvent, buildCustomData };
