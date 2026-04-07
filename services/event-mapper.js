/**
 * Default event type mappings from GHL workflow name to ad platform event names.
 * Clients can override these via the dashboard (stored as JSON in clients.event_mappings).
 *
 * Structure:
 * {
 *   "GHL Workflow Name": {
 *     meta: "MetaEventName",
 *     ga4: "ga4_event_name",
 *     google_ads: "Conversion Action Name or null to skip"
 *   }
 * }
 */
const DEFAULT_MAPPINGS = {
  'Conversion Event | Lead': {
    meta: 'Lead',
    ga4: 'generate_lead',
    google_ads: 'Lead'
  },
  'Conversion Event | Webinar Reg': {
    meta: 'Lead',
    ga4: 'webinar_registration',
    google_ads: 'Webinar Registration'
  },
  'Conversion Event | Webinar Attended': {
    meta: 'webinar_attended',
    ga4: 'webinar_attended',
    google_ads: 'Webinar Attended'
  },
  'Conversion Event | Webinar Attendee': {
    meta: 'webinar_attended',
    ga4: 'webinar_attended',
    google_ads: 'Webinar Attended'
  },
  'Conversion Event | Webinar No Show': {
    meta: 'webinar_noshow',
    ga4: 'webinar_noshow',
    google_ads: null // no value - skip Google Ads
  },
  'Conversion Event | Consultation': {
    meta: 'Schedule',
    ga4: 'book_appointment',
    google_ads: 'Consultation Booked'
  },
  'Conversion Event | Sale': {
    meta: 'Purchase',
    ga4: 'purchase',
    google_ads: 'Purchase'
  },
  'Conversion Event | Sale (Core Program)': {
    meta: 'Purchase',
    ga4: 'purchase',
    google_ads: 'Purchase',
    conversionValue: 249
  },
  'Conversion Event | Sale (Webinar Program)': {
    meta: 'Purchase',
    ga4: 'purchase',
    google_ads: 'Purchase',
    conversionValue: 420
  },
  'Conversion Event |Webinar Registration': {
    meta: 'Lead',
    ga4: 'webinar_registration',
    google_ads: 'Webinar Registration'
  },
  'Conversion Event | Webinar Registration': {
    meta: 'Lead',
    ga4: 'webinar_registration',
    google_ads: 'Webinar Registration'
  },
  'Conversion Event | Webinar (High-Interest)': {
    meta: 'Lead',
    ga4: 'generate_lead',
    google_ads: 'Lead'
  }
};

/**
 * Resolves the event mapping for a given GHL workflow name.
 * Checks client-specific overrides first, then falls back to defaults.
 * If no match is found, returns a generic mapping.
 *
 * @param {string} workflowName - The GHL workflow.name field
 * @param {string|object} clientEventMappings - JSON string or object from clients.event_mappings
 * @returns {{ meta: string, ga4: string, google_ads: string|null }}
 */
function resolveEventMapping(workflowName, clientEventMappings) {
  let clientMappings = {};
  if (clientEventMappings) {
    try {
      clientMappings = typeof clientEventMappings === 'string'
        ? JSON.parse(clientEventMappings)
        : clientEventMappings;
    } catch (e) {
      // ignore malformed JSON
    }
  }

  // Client override takes priority
  if (clientMappings[workflowName]) {
    return clientMappings[workflowName];
  }

  // Default mapping
  if (DEFAULT_MAPPINGS[workflowName]) {
    return DEFAULT_MAPPINGS[workflowName];
  }

  // Fuzzy match: check if workflow name contains known keywords
  const lower = (workflowName || '').toLowerCase();
  if (lower.includes('sale') || lower.includes('purchase')) {
    return { meta: 'Purchase', ga4: 'purchase', google_ads: 'Purchase' };
  }
  if (lower.includes('lead') || lower.includes('form')) {
    return { meta: 'Lead', ga4: 'generate_lead', google_ads: 'Lead' };
  }
  if (lower.includes('webinar') && lower.includes('reg')) {
    return { meta: 'Lead', ga4: 'webinar_registration', google_ads: 'Webinar Registration' };
  }
  if (lower.includes('webinar') && lower.includes('attend')) {
    return { meta: 'webinar_attended', ga4: 'webinar_attended', google_ads: 'Webinar Attended' };
  }
  if (lower.includes('consult') || lower.includes('appointment') || lower.includes('book')) {
    return { meta: 'Schedule', ga4: 'book_appointment', google_ads: 'Consultation Booked' };
  }

  // Generic fallback
  return {
    meta: workflowName || 'CustomEvent',
    ga4: (workflowName || 'custom_event').toLowerCase().replace(/[^a-z0-9_]/g, '_').substring(0, 40),
    google_ads: null
  };
}

/**
 * Determines data quality based on available fields.
 */
function assessDataQuality(payload) {
  const attr = payload.contact?.attributionSource || {};
  const hasHighQuality = payload.email || payload.phone;
  const hasMediumQuality = payload.first_name || payload.last_name;
  const hasAttribution = attr.fbclid || attr.fbc || attr.fbp || attr.gclid || attr.gaClientId;

  if (!hasHighQuality && !hasMediumQuality) return 'low';
  if (!hasHighQuality) return 'medium';
  if (!hasAttribution) return 'normal';
  return 'high';
}

module.exports = {
  DEFAULT_MAPPINGS,
  resolveEventMapping,
  assessDataQuality
};
