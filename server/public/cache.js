import {
  clearNotice,
  el,
  escapeHtml,
  fetchJson,
  formatDate,
  loadAuthContext,
  notify,
  renderSystemContext,
} from './shared.js';

const state = {
  auth: null,
  summary: null,
  items: [],
  selectedId: null,
  query: '',
};

function canDeleteCache() {
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

function renderSummary() {
  const summary = state.summary || {};
  el('cache-summary').innerHTML = [
    summaryTile('Entries', summary.total_entry_count || 0),
    summaryTile('Hits', summary.total_hits || 0),
    summaryTile('Profiles', summary.profile_count || 0),
    summaryTile('Promoted requests', summary.promoted_request_count || 0),
  ].join('');
}

function renderList() {
  const container = el('cache-list');
  const items = state.items || [];
  el('cache-filtered-count').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
  if (items.length === 0) {
    container.innerHTML = '<div class="muted small">No cache entries match the current filter.</div>';
    renderDetails(null);
    return;
  }
  if (!state.selectedId || !items.some((item) => item.entry_id === state.selectedId)) {
    state.selectedId = items[0].entry_id;
  }
  container.innerHTML = items.map((item) => `
    <button class="cache-list-item ${item.entry_id === state.selectedId ? 'active' : ''}" type="button" data-entry-id="${escapeHtml(item.entry_id)}">
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
  const selected = items.find((item) => item.entry_id === state.selectedId) || null;
  renderDetails(selected);
}

async function renderDetails(item) {
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
        <button id="delete-cache-entry" class="secondary" type="button" ${canDeleteCache() ? '' : 'disabled'}>Delete entry</button>
      </div>
    `;
    const deleteButton = el('delete-cache-entry');
    if (deleteButton) {
      deleteButton.addEventListener('click', async () => {
        try {
          await fetchJson(`/api/cache/${encodeURIComponent(entry.entry_id)}`, {
            method: 'DELETE',
          });
          notify('Cache entry deleted.');
          await loadCache();
        } catch (error) {
          notify(error.message, 'error');
        }
      });
    }
  } catch (error) {
    container.innerHTML = `<div class="muted small">${escapeHtml(error.message)}</div>`;
  }
}

async function loadCache() {
  const params = new URLSearchParams();
  if (state.query) {
    params.set('q', state.query);
  }
  const data = await fetchJson(`/api/cache?${params.toString()}`);
  state.summary = data.summary || {};
  state.items = data.items || [];
  renderSummary();
  renderList();
}

function attachHandlers() {
  el('cache-refresh').addEventListener('click', () => {
    loadCache().catch((error) => notify(error.message, 'error'));
  });
  el('cache-search').addEventListener('input', (event) => {
    state.query = event.target.value.trim();
    loadCache().catch((error) => notify(error.message, 'error'));
  });
  el('cache-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-entry-id]');
    if (!button) {
      return;
    }
    state.selectedId = button.dataset.entryId;
    renderList();
  });
}

async function init() {
  clearNotice();
  state.auth = await loadAuthContext();
  renderSystemContext(el('cache-system-context'), {
    session_origin: state.auth?.caller?.session_origin,
    can_edit_global_state: state.auth?.caller?.role === 'admin',
  });
  attachHandlers();
  await loadCache();
}

init().catch((error) => notify(error.message, 'error'));
