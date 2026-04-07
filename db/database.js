const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || (process.env.RAILWAY_ENVIRONMENT ? '/data/relay.db' : path.join(__dirname, 'relay.db'));

// Ensure the directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDatabase() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL,
      ghl_location_id TEXT UNIQUE,
      meta_pixel_id TEXT,
      meta_capi_token TEXT,
      ga4_measurement_id TEXT,
      ga4_api_secret TEXT,
      google_ads_customer_id TEXT,
      google_ads_conversion_action_id TEXT,
      google_ads_developer_token TEXT,
      oauth_client_id TEXT,
      oauth_client_secret TEXT,
      google_ads_refresh_token TEXT,
      meta_test_event_code TEXT,
      website_url TEXT,
      event_mappings TEXT DEFAULT '{}',
      health_wellness_mode INTEGER DEFAULT 0,
      shopify_domain TEXT,
      shopify_webhook_secret TEXT,
      client_type TEXT DEFAULT 'ghl',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      client_id INTEGER,
      client_name TEXT,
      contact_name TEXT,
      contact_email TEXT,
      event_type TEXT,
      ghl_workflow_name TEXT,
      meta_status TEXT,
      meta_response TEXT,
      ga4_status TEXT,
      ga4_response TEXT,
      google_ads_status TEXT,
      google_ads_response TEXT,
      data_quality TEXT DEFAULT 'normal',
      raw_payload TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );
  `);

  // Migrations for existing databases
  try { database.exec(`ALTER TABLE clients ADD COLUMN health_wellness_mode INTEGER DEFAULT 0`); } catch (e) {}
  try { database.exec(`ALTER TABLE clients ADD COLUMN meta_test_event_code TEXT`); } catch (e) {}
  try { database.exec(`ALTER TABLE clients ADD COLUMN website_url TEXT`); } catch (e) {}
  try { database.exec(`ALTER TABLE clients ADD COLUMN override_domain TEXT`); } catch (e) {}
  try { database.exec(`ALTER TABLE clients ADD COLUMN shopify_domain TEXT`); } catch (e) {}
  try { database.exec(`ALTER TABLE clients ADD COLUMN shopify_webhook_secret TEXT`); } catch (e) {}
  try { database.exec(`ALTER TABLE clients ADD COLUMN client_type TEXT DEFAULT 'ghl'`); } catch (e) {}

  console.log('Database initialized at', DB_PATH);
}

// --- Client queries ---

function getAllClients() {
  return getDb().prepare(`
    SELECT id, display_name, ghl_location_id, meta_pixel_id,
           ga4_measurement_id, google_ads_customer_id, active, created_at, event_mappings
    FROM clients ORDER BY display_name
  `).all();
}

function getClientByLocationId(locationId) {
  return getDb().prepare('SELECT * FROM clients WHERE ghl_location_id = ? AND active = 1').get(locationId);
}

function getClientById(id) {
  return getDb().prepare('SELECT * FROM clients WHERE id = ?').get(id);
}

function createClient(data) {
  const stmt = getDb().prepare(`
    INSERT INTO clients (
      display_name, ghl_location_id, meta_pixel_id, meta_capi_token,
      ga4_measurement_id, ga4_api_secret, google_ads_customer_id,
      google_ads_conversion_action_id, google_ads_developer_token,
      oauth_client_id, oauth_client_secret, google_ads_refresh_token, meta_test_event_code, event_mappings, override_domain,
      shopify_domain, shopify_webhook_secret, client_type
    ) VALUES (
      @display_name, @ghl_location_id, @meta_pixel_id, @meta_capi_token,
      @ga4_measurement_id, @ga4_api_secret, @google_ads_customer_id,
      @google_ads_conversion_action_id, @google_ads_developer_token,
      @oauth_client_id, @oauth_client_secret, @google_ads_refresh_token, @meta_test_event_code, @event_mappings, @override_domain,
      @shopify_domain, @shopify_webhook_secret, @client_type
    )
  `);
  const result = stmt.run({
    ...data,
    event_mappings: data.event_mappings || '{}'
  });
  return result.lastInsertRowid;
}

function updateClient(id, data) {
  const stmt = getDb().prepare(`
    UPDATE clients SET
      display_name = @display_name,
      ghl_location_id = @ghl_location_id,
      meta_pixel_id = @meta_pixel_id,
      meta_capi_token = @meta_capi_token,
      ga4_measurement_id = @ga4_measurement_id,
      ga4_api_secret = @ga4_api_secret,
      google_ads_customer_id = @google_ads_customer_id,
      google_ads_conversion_action_id = @google_ads_conversion_action_id,
      google_ads_developer_token = @google_ads_developer_token,
      oauth_client_id = @oauth_client_id,
      oauth_client_secret = @oauth_client_secret,
      google_ads_refresh_token = @google_ads_refresh_token,
      meta_test_event_code = @meta_test_event_code,
      event_mappings = @event_mappings,
      override_domain = @override_domain,
      shopify_domain = @shopify_domain,
      shopify_webhook_secret = @shopify_webhook_secret,
      client_type = @client_type,
      active = @active,
      updated_at = datetime('now')
    WHERE id = @id
  `);
  return stmt.run({ ...data, id });
}

function deleteClient(id) {
  return getDb().prepare('DELETE FROM clients WHERE id = ?').run(id);
}

// --- Event log queries ---

function insertEvent(data) {
  const stmt = getDb().prepare(`
    INSERT INTO events (
      timestamp, client_id, client_name, contact_name, contact_email,
      event_type, ghl_workflow_name, meta_status, meta_response,
      ga4_status, ga4_response, google_ads_status, google_ads_response,
      data_quality, raw_payload
    ) VALUES (
      @timestamp, @client_id, @client_name, @contact_name, @contact_email,
      @event_type, @ghl_workflow_name, @meta_status, @meta_response,
      @ga4_status, @ga4_response, @google_ads_status, @google_ads_response,
      @data_quality, @raw_payload
    )
  `);
  return stmt.run(data);
}

function getEvents({ clientId, eventType, status, startDate, endDate, page = 1, limit = 50 } = {}) {
  let where = ['1=1'];
  const params = {};

  if (clientId) { where.push('client_id = @clientId'); params.clientId = clientId; }
  if (eventType) { where.push('event_type = @eventType'); params.eventType = eventType; }
  if (startDate) { where.push('timestamp >= @startDate'); params.startDate = startDate; }
  if (endDate) { where.push('timestamp <= @endDate'); params.endDate = endDate; }
  if (status === 'success') {
    where.push("(meta_status = 'success' OR ga4_status = 'success' OR google_ads_status = 'success')");
  } else if (status === 'failure') {
    where.push("(meta_status = 'error' OR ga4_status = 'error' OR google_ads_status = 'error')");
  }

  const offset = (page - 1) * limit;
  params.limit = limit;
  params.offset = offset;

  const rows = getDb().prepare(`
    SELECT * FROM events WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT @limit OFFSET @offset
  `).all(params);

  const total = getDb().prepare(`
    SELECT COUNT(*) as count FROM events WHERE ${where.join(' AND ')}
  `).get(params);

  return { rows, total: total.count, page, limit };
}

function getStats() {
  const db = getDb();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const total_today = db.prepare("SELECT COUNT(*) as c FROM events WHERE timestamp >= ?").get(todayStart).c;
  const total_week = db.prepare("SELECT COUNT(*) as c FROM events WHERE timestamp >= ?").get(weekStart).c;
  const total_month = db.prepare("SELECT COUNT(*) as c FROM events WHERE timestamp >= ?").get(monthStart).c;

  const last_event = db.prepare("SELECT timestamp FROM events ORDER BY created_at DESC LIMIT 1").get();

  const api_stats = db.prepare(`
    SELECT
      SUM(CASE WHEN meta_status = 'success' THEN 1 ELSE 0 END) as meta_success,
      SUM(CASE WHEN meta_status = 'error' THEN 1 ELSE 0 END) as meta_error,
      SUM(CASE WHEN ga4_status = 'success' THEN 1 ELSE 0 END) as ga4_success,
      SUM(CASE WHEN ga4_status = 'error' THEN 1 ELSE 0 END) as ga4_error,
      SUM(CASE WHEN google_ads_status = 'success' THEN 1 ELSE 0 END) as gads_success,
      SUM(CASE WHEN google_ads_status = 'error' THEN 1 ELSE 0 END) as gads_error
    FROM events WHERE timestamp >= ?
  `).get(monthStart);

  return { total_today, total_week, total_month, last_event: last_event?.timestamp, api_stats };
}

module.exports = {
  getDb,
  initDatabase,
  getAllClients,
  getClientByLocationId,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  insertEvent,
  getEvents,
  getStats
};
