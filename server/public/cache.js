import {
  clearNotice,
  el,
  escapeHtml,
  fetchJson,
  formatDate,
  loadAuthContext,
  notify,
  reportClientError,
  renderSystemContext,
} from './shared.js';

const state = {
  auth: null,
  sharedSummary: null,
  sharedItems: [],
  pendingSummary: null,
  pendingItems: [],
  activeTab: 'shared',
  selectedKey: null,
  query: '',
};

function canManageCache() {
  return state.auth?.caller?.role === 'admin';
}

function summaryTile(label, value) {
  return `<div class="kb-summary-tile"><div class="count">${escapeHtml(String(value ?? 0))}</div><div class="label">${escapeHtml(label)}</div></div>`;
}

function stringify(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (value == null) {
    return '';
  }
  return JSON.stringify(value, null, 2);
}

function activeItems() {
  return state.activeTab === 'pending' ? (state.pendingItems || []) : (state.sharedItems || []);
}

function itemKey(item) {
  return state.activeTab === 'pending'
    ? `${item.session_id}:${item.request_id}`
    : item.entry_id;
}

function renderSummary() {
  if (state.activeTab === 'pending') {
    const summary = state.pendingSummary || {};
    el('cache-summary').innerHTML = [
      summaryTile('Pending requests', summary.pending_request_count || 0),
      summaryTile('Promotable', summary.promotable_request_count || 0),
      summaryTile('Captured calls', summary.pending_candidate_count || 0),
      summaryTile('Promotable calls', summary.promotable_candidate_count || 0),
    ].join('');
    return;
  }
  const summary = state.sharedSummary || {};
  el('cache-summary').innerHTML = [
    summaryTile('Entries', summary.total_entry_count || 0),
    summaryTile('Hits', summary.total_hits || 0),
    summaryTile('Profiles', summary.profile_count || 0),
    summaryTile('Promoted requests', summary.promoted_request_count || 0),
  ].join('');
}

function renderList() {
  const container = el('cache-list');
  const items = activeItems();
  el('cache-list-title').textContent = state.activeTab === 'pending' ? 'Pending request captures' : 'Stored LLM calls';
  el('cache-filtered-count').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
  if (!items.length) {
    container.innerHTML = state.activeTab === 'pending'
      ? '<div class="muted small">No pending request captures match the current filter.</div>'
      : '<div class="muted small">No cache entries match the current filter.</div>';
    renderDetails(null);
    return;
  }
  if (!state.selectedKey || !items.some((item) => itemKey(item) === state.selectedKey)) {
    state.selectedKey = itemKey(items[0]);
  }
  container.innerHTML = state.activeTab === 'pending'
    ? items.map((item) => `
      <button class="cache-list-item ${itemKey(item) === state.selectedKey ? 'active' : ''}" type="button" data-cache-key="${escapeHtml(itemKey(item))}">
        <div class="between">
          <div class="stack compact">
            <strong>${escapeHtml(item.request_id)}</strong>
            <div class="muted small">${escapeHtml(item.session_id)}</div>
          </div>
          <div class="row wrap">
            <span class="badge ${item.can_promote ? 'status-active' : ''}">${escapeHtml(item.can_promote ? 'promotable' : 'pending')}</span>
            <span class="badge">${escapeHtml(String(item.promotable_count ?? 0))} promotable</span>
          </div>
        </div>
        <div class="row wrap">
          ${(item.profiles || []).map((profile) => `<span class="badge">${escapeHtml(profile)}</span>`).join('')}
          ${item.stop_reason ? `<span class="badge">${escapeHtml(item.stop_reason)}</span>` : ''}
        </div>
        <div class="muted small">${escapeHtml(item.request_text || 'No request text')}</div>
      </button>
    `).join('')
    : items.map((item) => `
      <button class="cache-list-item ${itemKey(item) === state.selectedKey ? 'active' : ''}" type="button" data-cache-key="${escapeHtml(itemKey(item))}">
        <div class="between">
          <div class="stack compact">
            <strong>${escapeHtml(item.profile || 'llm')}</strong>
            <div class="muted small">${escapeHtml(item.instruction_preview || 'No instruction')}</div>
          </div>
          <div class="row wrap">
            <span class="badge">${escapeHtml(String(item.hit_count ?? 0))} hits</span>
          </div>
        </div>
        <div class="row wrap">
          <span class="badge">${escapeHtml(item.expected_output_mode || 'plain_value')}</span>
          ${item.model_class ? `<span class="badge">${escapeHtml(item.model_class)}</span>` : ''}
          <span class="badge">${escapeHtml(String(item.prompt_asset_count ?? 0))} prompt asset${item.prompt_asset_count === 1 ? '' : 's'}</span>
        </div>
        <div class="muted small">${escapeHtml(item.response_preview || 'No response preview')}</div>
      </button>
    `).join('');
  renderDetails(items.find((item) => itemKey(item) === state.selectedKey) || null);
}

async function renderSharedDetails(item) {
  const container = el('cache-detail');
  if (!item) {
    container.innerHTML = '<div class="muted small">Select a cache entry to inspect its request, response, and source request history.</div>';
    return;
  }
  try {
    const entry = await fetchJson(`/api/cache/${encodeURIComponent(item.entry_id)}`);
    const sourceRequests = Array.isArray(entry.source_requests) ? entry.source_requests : [];
    container.innerHTML = `
      <div class="stack compact">
        <div class="between">
          <div class="stack compact">
            <strong>${escapeHtml(entry.profile || 'llm')}</strong>
            <div class="muted small">${escapeHtml(entry.entry_id)}</div>
          </div>
          <div class="row wrap">
            <span class="badge">${escapeHtml(entry.expected_output_mode || 'plain_value')}</span>
            ${entry.model_class ? `<span class="badge">${escapeHtml(entry.model_class)}</span>` : ''}
            <span class="badge">${escapeHtml(String(entry.hit_count ?? 0))} hits</span>
          </div>
        </div>
        <div class="row wrap">
          <span class="badge">${escapeHtml(formatDate(entry.created_at))}</span>
          ${entry.last_hit_at ? `<span class="badge">last hit ${escapeHtml(formatDate(entry.last_hit_at))}</span>` : ''}
          ${entry.last_promoted_at ? `<span class="badge">promoted ${escapeHtml(formatDate(entry.last_promoted_at))}</span>` : ''}
        </div>
      </div>
      <div class="inset-card stack compact">
        <h4>Instruction</h4>
        <pre>${escapeHtml(entry.instruction || '')}</pre>
      </div>
      <div class="inset-card stack compact">
        <h4>Context package</h4>
        <pre>${escapeHtml(entry.context_package || '')}</pre>
      </div>
      <div class="inset-card stack compact">
        <h4>Response</h4>
        <pre>${escapeHtml(stringify(entry.response?.value))}</pre>
      </div>
      <div class="inset-card stack compact">
        <h4>Prompt assets</h4>
        ${entry.prompt_assets?.length
          ? `<pre>${escapeHtml(stringify(entry.prompt_assets))}</pre>`
          : '<div class="muted small">No prompt assets were captured for this entry.</div>'}
      </div>
      <div class="inset-card stack compact">
        <h4>Source requests</h4>
        ${sourceRequests.length
          ? sourceRequests.map((request) => `
            <div class="cache-source-request">
              <div class="row wrap">
                <span class="badge">${escapeHtml(request.session_id || 'session')}</span>
                <span class="badge">${escapeHtml(request.request_id || 'request')}</span>
                ${request.model ? `<span class="badge">${escapeHtml(request.model)}</span>` : ''}
                ${request.model_tier ? `<span class="badge">${escapeHtml(request.model_tier)}</span>` : ''}
              </div>
              <div class="muted small">${escapeHtml(formatDate(request.promoted_at))}</div>
            </div>
          `).join('')
          : '<div class="muted small">No source request history recorded.</div>'}
      </div>
      <div class="settings-inline-actions">
        <button id="delete-cache-entry" class="secondary" type="button" ${canManageCache() ? '' : 'disabled'}>Delete entry</button>
      </div>
    `;
    const deleteButton = el('delete-cache-entry');
    if (deleteButton) {
      deleteButton.addEventListener('click', async () => {
        try {
          await fetchJson(`/api/cache/${encodeURIComponent(entry.entry_id)}`, { method: 'DELETE' });
          notify('Cache entry deleted.');
          await loadCache();
        } catch (error) {
          reportClientError(error, 'cache.delete-entry');
        }
      });
    }
  } catch (error) {
    reportClientError(error, 'cache.render-shared-details');
    container.innerHTML = `<div class="muted small">${escapeHtml(error.message)}</div>`;
  }
}

async function renderPendingDetails(item) {
  const container = el('cache-detail');
  if (!item) {
    container.innerHTML = '<div class="muted small">Select a pending request capture to inspect promotable LLM calls.</div>';
    return;
  }
  container.innerHTML = `
    <div class="stack compact">
      <div class="between">
        <div class="stack compact">
          <strong>${escapeHtml(item.request_id)}</strong>
          <div class="muted small">${escapeHtml(item.session_id)}</div>
        </div>
        <div class="row wrap">
          <span class="badge ${item.can_promote ? 'status-active' : ''}">${escapeHtml(item.can_promote ? 'promotable' : 'pending')}</span>
          ${item.stop_reason ? `<span class="badge">${escapeHtml(item.stop_reason)}</span>` : ''}
        </div>
      </div>
      <div class="row wrap">
        ${(item.profiles || []).map((profile) => `<span class="badge">${escapeHtml(profile)}</span>`).join('')}
        <span class="badge">${escapeHtml(String(item.candidate_count ?? 0))} captured</span>
        <span class="badge">${escapeHtml(String(item.promotable_count ?? 0))} promotable</span>
      </div>
      <div class="muted small">${escapeHtml(formatDate(item.updated_at || item.created_at))}</div>
    </div>
    <div class="inset-card stack compact">
      <h4>Request</h4>
      <pre>${escapeHtml(item.request_text || '')}</pre>
    </div>
    <div class="inset-card stack compact">
      <h4>Response preview</h4>
      <pre>${escapeHtml(item.response_preview || '')}</pre>
    </div>
    <div class="inset-card stack compact">
      <h4>Captured calls</h4>
      ${Array.isArray(item.items) && item.items.length
        ? item.items.map((entry, index) => `
          <div class="cache-source-request">
            <div class="row wrap">
              <span class="badge">${escapeHtml(entry.profile || 'llm')}</span>
              <span class="badge">${escapeHtml(entry.source || 'provider')}</span>
              ${entry.model ? `<span class="badge">${escapeHtml(entry.model)}</span>` : ''}
            </div>
            <div class="muted small">Call ${index + 1}</div>
            <pre>${escapeHtml(stringify(entry.response?.value || entry.response || ''))}</pre>
          </div>
        `).join('')
        : '<div class="muted small">No request-local captures were recorded.</div>'}
    </div>
    <div class="settings-inline-actions">
      <button id="promote-cache-request" type="button" ${canManageCache() && item.can_promote ? '' : 'disabled'}>Promote request</button>
    </div>
  `;
  const promoteButton = el('promote-cache-request');
  if (promoteButton) {
    promoteButton.addEventListener('click', async () => {
      try {
        await fetchJson('/api/cache/pending/promote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            session_id: item.session_id,
            request_id: item.request_id,
          }),
        });
        notify('Pending request promoted into the shared cache.');
        await loadCache();
      } catch (error) {
        reportClientError(error, 'cache.promote-pending');
      }
    });
  }
}

async function renderDetails(item) {
  if (state.activeTab === 'pending') {
    await renderPendingDetails(item);
    return;
  }
  await renderSharedDetails(item);
}

async function loadSharedCache() {
  const params = new URLSearchParams();
  if (state.query) {
    params.set('q', state.query);
  }
  const data = await fetchJson(`/api/cache?${params.toString()}`);
  state.sharedSummary = data.summary || {};
  state.sharedItems = data.items || [];
}

async function loadPendingCache() {
  if (!canManageCache()) {
    state.pendingSummary = {
      pending_request_count: 0,
      promotable_request_count: 0,
      pending_candidate_count: 0,
      promotable_candidate_count: 0,
    };
    state.pendingItems = [];
    return;
  }
  const params = new URLSearchParams();
  if (state.query) {
    params.set('q', state.query);
  }
  const data = await fetchJson(`/api/cache/pending?${params.toString()}`);
  state.pendingSummary = data.summary || {};
  state.pendingItems = data.items || [];
}

function activateCacheTab(tab) {
  state.activeTab = tab === 'pending' ? 'pending' : 'shared';
  state.selectedKey = null;
  document.querySelectorAll('[data-cache-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.cacheTab === state.activeTab);
  });
  renderSummary();
  renderList();
}

async function loadCache() {
  await Promise.all([loadSharedCache(), loadPendingCache()]);
  renderSummary();
  renderList();
}

function attachHandlers() {
  el('cache-refresh').addEventListener('click', () => {
    loadCache().catch((error) => reportClientError(error, 'cache.refresh'));
  });
  el('cache-search').addEventListener('input', (event) => {
    state.query = event.target.value.trim();
    loadCache().catch((error) => reportClientError(error, 'cache.search'));
  });
  el('cache-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-cache-key]');
    if (!button) {
      return;
    }
    state.selectedKey = button.dataset.cacheKey;
    renderList();
  });
  document.querySelectorAll('[data-cache-tab]').forEach((button) => {
    button.addEventListener('click', () => activateCacheTab(button.dataset.cacheTab));
  });
}

async function init() {
  clearNotice();
  state.auth = await loadAuthContext();
  renderSystemContext(el('cache-system-context'), {
    session_origin: state.auth?.caller?.session_origin,
    can_edit_global_state: state.auth?.caller?.role === 'admin',
  });
  if (!canManageCache()) {
    el('cache-tab-pending').disabled = true;
  }
  attachHandlers();
  await loadCache();
}

init().catch((error) => reportClientError(error, 'cache.init'));
