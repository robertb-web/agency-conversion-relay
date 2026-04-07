const crypto = require('crypto');

function sha256(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// US state full name → 2-letter abbreviation map
const STATE_ABBR = {
  'alabama': 'al', 'alaska': 'ak', 'arizona': 'az', 'arkansas': 'ar',
  'california': 'ca', 'colorado': 'co', 'connecticut': 'ct', 'delaware': 'de',
  'florida': 'fl', 'georgia': 'ga', 'hawaii': 'hi', 'idaho': 'id',
  'illinois': 'il', 'indiana': 'in', 'iowa': 'ia', 'kansas': 'ks',
  'kentucky': 'ky', 'louisiana': 'la', 'maine': 'me', 'maryland': 'md',
  'massachusetts': 'ma', 'michigan': 'mi', 'minnesota': 'mn', 'mississippi': 'ms',
  'missouri': 'mo', 'montana': 'mt', 'nebraska': 'ne', 'nevada': 'nv',
  'new hampshire': 'nh', 'new jersey': 'nj', 'new mexico': 'nm', 'new york': 'ny',
  'north carolina': 'nc', 'north dakota': 'nd', 'ohio': 'oh', 'oklahoma': 'ok',
  'oregon': 'or', 'pennsylvania': 'pa', 'rhode island': 'ri', 'south carolina': 'sc',
  'south dakota': 'sd', 'tennessee': 'tn', 'texas': 'tx', 'utah': 'ut',
  'vermont': 'vt', 'virginia': 'va', 'washington': 'wa', 'west virginia': 'wv',
  'wisconsin': 'wi', 'wyoming': 'wy', 'district of columbia': 'dc'
};

function normalizeState(state) {
  if (!state) return null;
  const lower = state.trim().toLowerCase();
  // If it's already a 2-letter code, return as-is
  if (lower.length === 2) return lower;
  // Look up full name
  return STATE_ABBR[lower] || lower.substring(0, 2);
}

// Normalize and hash an email address per Meta/Google spec
function hashEmail(email) {
  if (!email) return null;
  let normalized = email.trim().toLowerCase();
  // Gmail/Googlemail: remove dots before @, remove +suffix
  const parts = normalized.split('@');
  if (parts.length === 2 && (parts[1] === 'gmail.com' || parts[1] === 'googlemail.com')) {
    parts[0] = parts[0].replace(/\./g, '').replace(/\+.*$/, '');
    normalized = parts.join('@');
  }
  return sha256(normalized);
}

// Normalize and hash a phone number per Meta spec
function hashPhone(phone) {
  if (!phone) return null;
  // Remove everything except digits and leading +
  let normalized = phone.trim().replace(/[^\d+]/g, '');
  // Ensure country code: if starts with +1... keep it; if 10 digits no code, prepend 1
  if (!normalized.startsWith('+')) {
    const digits = normalized.replace(/\D/g, '');
    if (digits.length === 10) {
      normalized = '1' + digits;
    } else {
      normalized = digits;
    }
  } else {
    normalized = normalized.replace('+', '');
  }
  return sha256(normalized);
}

// Hash first/last name
function hashName(name) {
  if (!name) return null;
  return sha256(name.trim().toLowerCase());
}

// Hash city: lowercase, no spaces
function hashCity(city) {
  if (!city) return null;
  return sha256(city.trim().toLowerCase().replace(/\s+/g, ''));
}

// Hash state: normalize to 2-letter abbr, lowercase
function hashState(state) {
  if (!state) return null;
  const abbr = normalizeState(state);
  return sha256(abbr);
}

// Hash zip: first 5 digits for US
function hashZip(zip) {
  if (!zip) return null;
  const trimmed = zip.trim().replace(/\s/g, '').substring(0, 5);
  return sha256(trimmed);
}

// Hash country: lowercase 2-letter ISO code
function hashCountry(country) {
  if (!country) return null;
  return sha256(country.trim().toLowerCase().substring(0, 2));
}

// Hash external ID (contact_id) as-is
function hashExternalId(id) {
  if (!id) return null;
  return sha256(String(id));
}

/**
 * Checks if a timestamp (ms) is within the last 90 days.
 */
function isWithin90Days(timestampMs) {
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  return (Date.now() - timestampMs) < ninetyDaysMs;
}

/**
 * Extracts the creation timestamp from an fbc value (format: fb.1.{timestamp}.{fbclid}).
 * Returns the timestamp in ms, or null if unparseable.
 */
function getFbcTimestamp(fbc) {
  if (!fbc) return null;
  const parts = fbc.split('.');
  if (parts.length >= 3) {
    const ts = parseInt(parts[2], 10);
    // Could be seconds or ms — normalize to ms
    return ts > 1e12 ? ts : ts * 1000;
  }
  return null;
}

/**
 * Takes a raw GHL payload and returns all hashed user_data fields for Meta CAPI.
 */
function buildHashedUserData(payload) {
  const attr = payload.contact?.attributionSource || {};

  const hashed = {};

  if (payload.email) hashed.em = hashEmail(payload.email);
  if (payload.phone) hashed.ph = hashPhone(payload.phone);
  if (payload.first_name) hashed.fn = hashName(payload.first_name);
  if (payload.last_name) hashed.ln = hashName(payload.last_name);
  if (payload.city) hashed.ct = hashCity(payload.city);
  if (payload.state) hashed.st = hashState(payload.state);
  if (payload.postal_code) hashed.zp = hashZip(payload.postal_code);
  if (payload.country) hashed.country = hashCountry(payload.country);
  if (payload.contact_id) hashed.external_id = hashExternalId(payload.contact_id);

  // Raw (unhashed) attribution signals
  if (attr.ip) hashed.client_ip_address = attr.ip;
  if (attr.userAgent) hashed.client_user_agent = attr.userAgent;
  if (attr.fbp) hashed.fbp = attr.fbp;

  // fbc: use existing fbc value if not expired, or construct from fbclid if fresh
  if (attr.fbc) {
    const fbcTs = getFbcTimestamp(attr.fbc);
    if (fbcTs && isWithin90Days(fbcTs)) {
      hashed.fbc = attr.fbc;
    }
    // Skip expired fbc values — Meta rejects them
  } else if (attr.fbclid) {
    // Use contact creation date for the fbc timestamp (not Date.now())
    const contactCreated = payload.date_created ? new Date(payload.date_created).getTime() : null;
    if (contactCreated && isWithin90Days(contactCreated)) {
      const fbcTimestamp = Math.floor(contactCreated / 1000);
      hashed.fbc = `fb.1.${fbcTimestamp}.${attr.fbclid}`;
    }
    // Skip if contact is older than 90 days — fbclid is expired
  }

  return hashed;
}

module.exports = {
  sha256,
  hashEmail,
  hashPhone,
  hashName,
  hashCity,
  hashState,
  hashZip,
  hashCountry,
  hashExternalId,
  buildHashedUserData,
  isWithin90Days,
  getFbcTimestamp
};
