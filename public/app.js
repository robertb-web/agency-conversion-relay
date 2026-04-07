/* Conversion Relay Dashboard — Frontend App */

const App = (() => {
  let currentPage = 1;
  let totalEvents = 0;
  const PAGE_LIMIT = 50;
  let clients = [];
  let editingClientId = null;
  let healthRefreshTimer = null;

  // --- Navigation ---
  function navigate(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');
    document.querySelector(`[data-page="${page}"]`).classList.add('active');

    if (page === 'health') loadHealth();
    else if (page === 'events') { loadClients(); loadEvents(1); }
    else if (page === 'clients') loadClients();
  }

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.page));
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  // --- API helper ---
  async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    if (res.status === 401) { window.location.href = '/login.html'; return null; }
    return res.json();
  }

  // --- Health page ---
  async function loadHealth() {
    const [stats, events] = await Promise.all([
      api('/stats'),
      api('/events?limit=10&page=1')
    ]);

    if (!stats || !events) return;

    document.getElementById('stat-today').textContent = stats.total_today ?? '—';
    document.getElementById('stat-week').textContent = stats.total_week ?? '—';
    document.getElementById('stat-month').textContent = stats.total_month ?? '—';

    if (stats.last_event) {
      const d = new Date(stats.last_event);
      document.getElementById('stat-last').textContent = d.toLocaleTimeString();
      document.getElementById('stat-last-ago').textContent = timeAgo(d);
    }

    const s = stats.api_stats || {};
    renderApiStat('meta', s.meta_success || 0, s.meta_error || 0);
    renderApiStat('ga4', s.ga4_success || 0, s.ga4_error || 0);
    renderApiStat('gads', s.gads_success || 0, s.gads_error || 0);

    renderEventsTable('health-events-body', events.rows || [], true);
  }

  function renderApiStat(key, success, error) {
    const total = success + error;
    const rate = total > 0 ? Math.round((success / total) * 100) : 100;
    const color = rate >= 95 ? 'var(--green)' : rate >= 80 ? 'var(--yellow)' : 'var(--red)';
    document.getElementById(`${key}-rate`).textContent = `${rate}%`;
    document.getElementById(`${key}-rate`).style.color = color;
    document.getElementById(`${key}-counts`).textContent = `${success} ok / ${error} err`;
  }

  // --- Events page ---
  async function loadEvents(page = 1) {
    currentPage = page;
    const clientId = document.getElementById('filter-client')?.value;
    const eventType = document.getElementById('filter-event')?.value;
    const status = document.getElementById('filter-status')?.value;
    const startDate = document.getElementById('filter-start')?.value;
    const endDate = document.getElementById('filter-end')?.value;

    const params = new URLSearchParams({ page, limit: PAGE_LIMIT });
    if (clientId) params.set('clientId', clientId);
    if (eventType) params.set('eventType', eventType);
    if (status) params.set('status', status);
    if (startDate) params.set('startDate', startDate + 'T00:00:00.000Z');
    if (endDate) params.set('endDate', endDate + 'T23:59:59.999Z');

    document.getElementById('events-body').innerHTML = `<tr><td colspan="9" class="loader">Loading…</td></tr>`;
    const data = await api(`/events?${params}`);
    if (!data) return;

    totalEvents = data.total;
    renderEventsTable('events-body', data.rows || [], false);

    const totalPages = Math.ceil(totalEvents / PAGE_LIMIT);
    document.getElementById('page-info').textContent = `Page ${currentPage} of ${Math.max(totalPages, 1)} (${totalEvents} total)`;
    document.getElementById('prev-btn').disabled = currentPage <= 1;
    document.getElementById('next-btn').disabled = currentPage >= totalPages;
  }

  function renderEventsTable(tbodyId, rows, compact) {
    const tbody = document.getElementById(tbodyId);
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${compact ? 8 : 9}" class="empty">No events yet</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const time = new Date(r.timestamp);
      const timeStr = compact
        ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : time.toLocaleString();
      return `<tr>
        <td style="white-space:nowrap;color:var(--text-muted);font-size:0.78rem">${timeStr}</td>
        <td>${r.client_name || '—'}</td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.contact_name || r.contact_email || '—'}</td>
        <td style="font-size:0.8rem">${r.ghl_workflow_name || r.event_type || '—'}</td>
        <td>${badge(r.meta_status)}</td>
        <td>${badge(r.ga4_status)}</td>
        <td>${badge(r.google_ads_status)}</td>
        <td>${qualityBadge(r.data_quality)}</td>
        ${compact ? '' : `<td><button class="btn btn-secondary btn-sm" onclick="App.viewEvent(${r.id})">View</button></td>`}
      </tr>`;
    }).join('');
  }

  function prevPage() { if (currentPage > 1) loadEvents(currentPage - 1); }
  function nextPage() { if (currentPage * PAGE_LIMIT < totalEvents) loadEvents(currentPage + 1); }

  function clearFilters() {
    ['filter-client', 'filter-event', 'filter-status'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    ['filter-start', 'filter-end'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    loadEvents(1);
  }

  async function viewEvent(id) {
    const event = await api(`/events/${id}`);
    if (!event) return;

    let payload = {};
    try { payload = JSON.parse(event.raw_payload); } catch (e) { }

    const html = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;font-size:0.83rem">
        <div><strong style="color:var(--text-muted)">Time:</strong> ${new Date(event.timestamp).toLocaleString()}</div>
        <div><strong style="color:var(--text-muted)">Client:</strong> ${event.client_name}</div>
        <div><strong style="color:var(--text-muted)">Contact:</strong> ${event.contact_name || event.contact_email || '—'}</div>
        <div><strong style="color:var(--text-muted)">Event Type:</strong> ${event.event_type}</div>
        <div><strong style="color:var(--text-muted)">Workflow:</strong> ${event.ghl_workflow_name || '—'}</div>
        <div><strong style="color:var(--text-muted)">Data Quality:</strong> ${qualityBadge(event.data_quality)}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">
        <div class="card" style="padding:12px">
          <div style="font-size:0.72rem;color:var(--text-muted);font-weight:600;margin-bottom:6px">META CAPI</div>
          <div>${badge(event.meta_status)}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:6px;word-break:break-all">${event.meta_response || '—'}</div>
        </div>
        <div class="card" style="padding:12px">
          <div style="font-size:0.72rem;color:var(--text-muted);font-weight:600;margin-bottom:6px">GA4</div>
          <div>${badge(event.ga4_status)}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:6px;word-break:break-all">${event.ga4_response || '—'}</div>
        </div>
        <div class="card" style="padding:12px">
          <div style="font-size:0.72rem;color:var(--text-muted);font-weight:600;margin-bottom:6px">GOOGLE ADS</div>
          <div>${badge(event.google_ads_status)}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:6px;word-break:break-all">${event.google_ads_response || '—'}</div>
        </div>
      </div>
      <div>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px;font-weight:600">RAW PAYLOAD</div>
        <div class="payload-viewer">${JSON.stringify(payload, null, 2)}</div>
      </div>
    `;
    document.getElementById('event-detail-content').innerHTML = html;
    openModal('event-modal');
  }

  // --- Shopify helpers ---
  function toggleClientType() {
    const type = document.getElementById('f-client-type').value;
    const ghlFields = document.getElementById('ghl-fields');
    const shopifyFields = document.getElementById('shopify-fields');
    if (type === 'ghl') {
      ghlFields.style.display = '';
      shopifyFields.style.display = 'none';
    } else if (type === 'shopify') {
      ghlFields.style.display = 'none';
      shopifyFields.style.display = '';
    } else {
      ghlFields.style.display = '';
      shopifyFields.style.display = '';
    }
  }

  function generateShopifyInfo() {
    const clientId = document.getElementById('client-id').value;
    const webhookUrlEl = document.getElementById('f-shopify-webhook-url');
    const snippetEl = document.getElementById('f-shopify-snippet');

    if (clientId) {
      webhookUrlEl.value = `${window.location.origin}/webhook/shopify/${clientId}`;
    } else {
      webhookUrlEl.value = '(save client first)';
    }

    snippetEl.value = `<!-- Agency Conversion Relay: Meta fbp/fbc Capture -->\n<script>\n(function(){\n  function gc(n){var m=document.cookie.match('(^|;)\\\\s*'+n+'=([^;]*)');return m?decodeURIComponent(m[2]):'';}\n  function run(){\n    var fbp=gc('_fbp'),fbc=gc('_fbc'),attrs={};\n    if(fbp)attrs['_fbp']=fbp;\n    if(fbc)attrs['_fbc']=fbc;\n    var p=new URLSearchParams(window.location.search);\n    var g=p.get('gclid');if(g)attrs['_gclid']=g;\n    var f=p.get('fbclid');\n    if(f&&!fbc)attrs['_fbc']='fb.1.'+Date.now()+'.'+f;\n    if(Object.keys(attrs).length===0)return;\n    fetch('/cart/update.js',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({attributes:attrs})}).catch(function(){});\n  }\n  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',run);}else{run();}\n})();\n</script>`;
  }

  document.getElementById('f-client-type').addEventListener('change', () => {
    toggleClientType();
    generateShopifyInfo();
  });

  // --- Clients page ---
  async function loadClients() {
    const data = await api('/clients');
    if (!data) return;
    clients = data;

    // Populate client filter dropdown
    const filterEl = document.getElementById('filter-client');
    if (filterEl) {
      const current = filterEl.value;
      filterEl.innerHTML = '<option value="">All Clients</option>' +
        clients.map(c => `<option value="${c.id}" ${c.id == current ? 'selected' : ''}>${escHtml(c.display_name)}</option>`).join('');
    }

    const container = document.getElementById('clients-list');
    if (!container) return;

    if (!clients.length) {
      container.innerHTML = `<div class="empty">No clients configured. Click "Add Client" to get started.</div>`;
      return;
    }

    container.innerHTML = clients.map(c => `
      <div class="card" style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;margin-bottom:12px">
        <div>
          <div style="font-weight:600;font-size:0.95rem">${escHtml(c.display_name)}</div>
          <div style="font-size:0.78rem;color:var(--text-muted);margin-top:3px">${c.ghl_location_id ? `Location ID: <code>${escHtml(c.ghl_location_id)}</code>` : ''}${c.shopify_domain ? `${c.ghl_location_id ? ' · ' : ''}Shopify: <code>${escHtml(c.shopify_domain)}</code>` : ''}</div>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
            ${(c.client_type === 'shopify') ? '<span class="badge badge-medium">Shopify</span>' : (c.client_type === 'both') ? '<span class="badge badge-medium">GHL + Shopify</span>' : '<span class="badge badge-normal">GHL</span>'}
            ${c.meta_pixel_id ? `<span class="badge badge-success">Meta ✓</span>` : `<span class="badge badge-skipped">Meta —</span>`}
            ${c.ga4_measurement_id ? `<span class="badge badge-success">GA4 ✓</span>` : `<span class="badge badge-skipped">GA4 —</span>`}
            ${c.google_ads_customer_id ? `<span class="badge badge-success">Google Ads ✓</span>` : `<span class="badge badge-skipped">Ads —</span>`}
            ${c.active ? `<span class="badge badge-high">Active</span>` : `<span class="badge badge-error">Inactive</span>`}
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" onclick="App.openClientModal(${c.id})">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="App.deleteClient(${c.id}, '${escHtml(c.display_name)}')">Delete</button>
        </div>
      </div>
    `).join('');
  }

  function openClientModal(id) {
    editingClientId = id;
    const form = document.getElementById('client-form');
    form.reset();
    document.getElementById('test-results').style.display = 'none';

    if (id) {
      document.getElementById('client-modal-title').textContent = 'Edit Client';
      api(`/clients/${id}`).then(client => {
        if (!client) return;
        // Ignore stale responses if the modal was reopened for a different client
        if (editingClientId !== id) return;
        document.getElementById('client-id').value = client.id;
        document.getElementById('f-display-name').value = client.display_name || '';
        document.getElementById('f-location-id').value = client.ghl_location_id || '';
        document.getElementById('f-meta-pixel').value = client.meta_pixel_id || '';
        document.getElementById('f-meta-test-code').value = client.meta_test_event_code || '';
        document.getElementById('f-override-domain').value = client.override_domain || '';
        document.getElementById('f-ga4-id').value = client.ga4_measurement_id || '';
        document.getElementById('f-gads-customer').value = client.google_ads_customer_id || '';
        document.getElementById('f-gads-action-id').value = client.google_ads_conversion_action_id || '';
        document.getElementById('f-oauth-id').value = client.oauth_client_id || '';
        document.getElementById('f-active').value = client.active ? '1' : '0';
        try {
          const mappings = JSON.parse(client.event_mappings || '{}');
          if (Object.keys(mappings).length) {
            document.getElementById('f-event-mappings').value = JSON.stringify(mappings, null, 2);
          }
        } catch (e) { }
        // Sensitive fields are masked — leave password inputs empty to preserve
        document.getElementById('f-client-type').value = client.client_type || 'ghl';
        document.getElementById('f-shopify-domain').value = client.shopify_domain || '';
        document.getElementById('f-shopify-secret').value = '';
        toggleClientType();
        generateShopifyInfo();
      });
      document.getElementById('test-conn-btn').style.display = 'inline-flex';
    } else {
      document.getElementById('client-modal-title').textContent = 'Add Client';
      document.getElementById('client-id').value = '';
      document.getElementById('f-client-type').value = 'ghl';
      document.getElementById('f-shopify-domain').value = '';
      document.getElementById('f-shopify-secret').value = '';
      document.getElementById('f-shopify-webhook-url').value = '';
      document.getElementById('f-shopify-snippet').value = '';
      toggleClientType();
      document.getElementById('test-conn-btn').style.display = 'none';
    }

    openModal('client-modal');
  }

  document.getElementById('client-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('save-client-btn');
    btn.disabled = true;

    let eventMappings = '{}';
    const mappingInput = document.getElementById('f-event-mappings').value.trim();
    if (mappingInput) {
      try { JSON.parse(mappingInput); eventMappings = mappingInput; }
      catch (e) { showToast('Event mappings JSON is invalid', 'error'); btn.disabled = false; return; }
    }

    const data = {
      display_name: document.getElementById('f-display-name').value,
      ghl_location_id: document.getElementById('f-location-id').value,
      client_type: document.getElementById('f-client-type').value,
      shopify_domain: document.getElementById('f-shopify-domain').value,
      shopify_webhook_secret: document.getElementById('f-shopify-secret').value,
      meta_pixel_id: document.getElementById('f-meta-pixel').value,
      meta_capi_token: document.getElementById('f-meta-token').value,
      meta_test_event_code: document.getElementById('f-meta-test-code').value,
      override_domain: document.getElementById('f-override-domain').value,
      ga4_measurement_id: document.getElementById('f-ga4-id').value,
      ga4_api_secret: document.getElementById('f-ga4-secret').value,
      google_ads_customer_id: document.getElementById('f-gads-customer').value,
      google_ads_conversion_action_id: document.getElementById('f-gads-action-id').value,
      google_ads_developer_token: document.getElementById('f-gads-dev-token').value,
      oauth_client_id: document.getElementById('f-oauth-id').value,
      oauth_client_secret: document.getElementById('f-oauth-secret').value,
      google_ads_refresh_token: document.getElementById('f-refresh-token').value,
      event_mappings: eventMappings,
      active: document.getElementById('f-active').value === '1' ? 1 : 0
    };

    const id = document.getElementById('client-id').value;
    const method = id ? 'PUT' : 'POST';
    const path = id ? `/clients/${id}` : '/clients';

    const result = await api(path, { method, body: JSON.stringify(data) });
    btn.disabled = false;

    if (result?.error) {
      showToast(result.error, 'error');
    } else {
      showToast(id ? 'Client updated!' : 'Client created!', 'success');
      closeModal('client-modal');
      loadClients();
    }
  });

  async function deleteClient(id, name) {
    if (!confirm(`Delete client "${name}"? This cannot be undone.`)) return;
    const result = await api(`/clients/${id}`, { method: 'DELETE' });
    if (result?.error) { showToast(result.error, 'error'); return; }
    showToast('Client deleted', 'success');
    loadClients();
  }

  async function testConnection() {
    const id = document.getElementById('client-id').value;
    if (!id) { showToast('Save the client first before testing', 'error'); return; }

    const resultsEl = document.getElementById('test-results');
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = `<div class="test-result loading">Testing connections…</div>`;

    const results = await api(`/clients/${id}/test`, { method: 'POST' });
    if (!results) return;

    const fmt = (key, label) => {
      const r = results[key];
      if (!r) return '';
      if (r.skipped) return `<div style="margin-bottom:6px"><strong>${label}:</strong> <span class="badge badge-skipped">Not configured</span></div>`;
      if (r.success) return `<div style="margin-bottom:6px"><strong>${label}:</strong> <span class="badge badge-success">Connected ✓</span></div>`;
      return `<div style="margin-bottom:6px"><strong>${label}:</strong> <span class="badge badge-error">Failed</span> <span style="font-size:0.75rem;color:var(--text-muted)">${escHtml(r.error || '')}</span></div>`;
    };

    const allOk = Object.values(results).every(r => r.success || r.skipped);
    resultsEl.innerHTML = `
      <div class="test-result ${allOk ? 'success' : 'error'}">
        ${fmt('meta', 'Meta CAPI')}
        ${fmt('ga4', 'GA4')}
        ${fmt('google_ads', 'Google Ads')}
      </div>
    `;
  }

  // --- Modals ---
  function openModal(id) { document.getElementById(id).classList.add('open'); }
  function closeModal(id) { document.getElementById(id).classList.remove('open'); }

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // --- Badge helpers ---
  function badge(status) {
    const map = {
      success: 'badge-success',
      error: 'badge-error',
      skipped: 'badge-skipped'
    };
    return `<span class="badge ${map[status] || 'badge-normal'}">${status || '—'}</span>`;
  }

  function qualityBadge(q) {
    const map = { high: 'badge-high', normal: 'badge-normal', medium: 'badge-medium', low: 'badge-low' };
    return `<span class="badge ${map[q] || 'badge-normal'}">${q || '—'}</span>`;
  }

  // --- Toast ---
  function showToast(msg, type = 'success') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast ${type} show`;
    setTimeout(() => el.classList.remove('show'), 3000);
  }

  // --- Utils ---
  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function timeAgo(date) {
    const secs = Math.floor((Date.now() - date) / 1000);
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    return `${Math.floor(secs / 86400)}d ago`;
  }

  // --- Init ---
  function init() {
    // Verify auth
    fetch('/auth/me').then(r => {
      if (r.status === 401) window.location.href = '/login.html';
    });

    loadHealth();
    // Auto-refresh health every 30s
    healthRefreshTimer = setInterval(() => {
      if (document.getElementById('page-health').classList.contains('active')) loadHealth();
    }, 30000);
  }

  init();

  return {
    navigate,
    loadHealth,
    loadEvents,
    prevPage,
    nextPage,
    clearFilters,
    viewEvent,
    loadClients,
    openClientModal,
    deleteClient,
    testConnection,
    openModal,
    closeModal
  };
})();
