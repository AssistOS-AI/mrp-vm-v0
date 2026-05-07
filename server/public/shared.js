const SESSION_KEY = 'mrpvm.activeSessionId';
const API_KEY = 'mrpvm.apiKey';
const SAVED_API_KEYS = 'mrpvm.savedApiKeys';

export function el(id) {
  return document.getElementById(id);
}

export function getActiveSessionId() {
  return localStorage.getItem(SESSION_KEY);
}

export function setActiveSessionId(sessionId) {
  if (!sessionId) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  localStorage.setItem(SESSION_KEY, sessionId);
}

export function getApiKey() {
  return localStorage.getItem(API_KEY) || '';
}

function readSavedApiKeys() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_API_KEYS) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSavedApiKeys(items) {
  localStorage.setItem(SAVED_API_KEYS, JSON.stringify(items));
}

export function getSavedApiKeys() {
  return readSavedApiKeys();
}

export function rememberApiKey(token, label = '') {
  const normalized = String(token || '').trim();
  if (!normalized) {
    return;
  }
  const existing = readSavedApiKeys().filter((entry) => entry.token !== normalized);
  existing.unshift({
    id: normalized.split('.')[0] || `key_${Date.now()}`,
    label: String(label || normalized.split('.')[0] || 'Saved key'),
    token: normalized,
    saved_at: new Date().toISOString(),
  });
  writeSavedApiKeys(existing.slice(0, 12));
}

export function forgetApiKey(tokenOrId) {
  const normalized = String(tokenOrId || '').trim();
  if (!normalized) {
    return;
  }
  writeSavedApiKeys(readSavedApiKeys().filter((entry) => entry.token !== normalized && entry.id !== normalized));
  if (getApiKey() === normalized) {
    localStorage.removeItem(API_KEY);
  }
}

export function setApiKey(token, options = {}) {
  if (!token) {
    localStorage.removeItem(API_KEY);
    return;
  }
  const normalized = String(token).trim();
  localStorage.setItem(API_KEY, normalized);
  if (options.remember) {
    rememberApiKey(normalized, options.label);
  }
}

function buildHeaders(options = {}) {
  const headers = new Headers(options.headers || {});
  const sessionId = options.sessionId ?? getActiveSessionId();
  if (sessionId && !headers.has('x-session-id')) {
    headers.set('x-session-id', sessionId);
  }
  const apiKey = options.apiKey ?? getApiKey();
  if (apiKey && !headers.has('x-api-key')) {
    headers.set('x-api-key', apiKey);
  }
  return headers;
}

function summarizePayload(value, maxLength = 240) {
  const textValue = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (textValue.length <= maxLength) {
    return textValue;
  }
  return `${textValue.slice(0, maxLength - 3)}...`;
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: buildHeaders(options),
  });
  const raw = await response.text();
  let payload = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      if (response.ok) {
        throw new Error(`Expected JSON response but received: ${summarizePayload(raw)}`);
      }
      throw new Error(summarizePayload(raw) || `HTTP ${response.status}`);
    }
  }
  if (!response.ok) {
    const message = payload?.message || payload?.error || summarizePayload(raw) || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    if (payload?.stack) {
      error.serverStack = payload.stack;
    }
    throw error;
  }
  return payload ?? {};
}

export async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: buildHeaders(options),
  });
  if (!response.ok) {
    const raw = await response.text();
    let payload = null;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }
    }
    const message = payload?.message || payload?.error || raw || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    if (payload?.stack) {
      error.serverStack = payload.stack;
    }
    throw error;
  }
  return response.text();
}

export function formatDate(value) {
  if (!value) {
    return 'unknown';
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function statusClass(status) {
  return `status-${String(status || 'unknown').replace(/[^a-z0-9_-]+/gi, '_').toLowerCase()}`;
}

export function notify(message, type = 'info') {
  const notice = el('page-notice');
  if (!notice) {
    return;
  }
  notice.textContent = message;
  notice.className = `notice visible ${type === 'error' ? 'error' : ''}`.trim();
}

export function formatErrorMessage(error) {
  if (error == null) {
    return 'Unknown client error.';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error.message === 'string' && error.message.trim()) {
    if (error.message === '[object Object]' && error.payload) {
      return formatErrorMessage(error.payload);
    }
    return error.message;
  }
  if (typeof error.message === 'object' && error.message) {
    return formatErrorMessage(error.message);
  }
  if (error.payload) {
    return formatErrorMessage(error.payload);
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function reportClientError(error, context = 'client') {
  const message = formatErrorMessage(error);
  console.error(`[MRP-VM client] ${context}`, {
    message,
    status: error?.status ?? null,
    payload: error?.payload ?? null,
    stack: error?.stack ?? null,
    serverStack: error?.serverStack ?? null,
  });
  if (error?.serverStack) {
    console.error(error.serverStack);
  } else if (error?.stack) {
    console.error(error.stack);
  }
  notify(message, 'error');
  return message;
}

if (typeof window !== 'undefined' && !window.__mrpVmErrorHooksInstalled) {
  window.__mrpVmErrorHooksInstalled = true;
  window.addEventListener('error', (event) => {
    reportClientError(event.error ?? new Error(event.message), 'window.error');
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportClientError(event.reason instanceof Error ? event.reason : new Error(formatErrorMessage(event.reason)), 'window.unhandledrejection');
  });
}

export function clearNotice() {
  const notice = el('page-notice');
  if (!notice) {
    return;
  }
  notice.textContent = '';
  notice.className = 'notice';
}

export async function loadAuthContext() {
  return fetchJson('/api/auth/context', {
    sessionId: getActiveSessionId(),
  });
}

export async function copyText(text) {
  await navigator.clipboard.writeText(String(text ?? ''));
}

export function queryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function basename(filePath) {
  return String(filePath || '').split('/').pop();
}

export function renderSystemContext(container, context = {}) {
  if (!container) {
    return;
  }
  container.innerHTML = [
    context.session_origin ? `<span class="badge">${context.session_origin}</span>` : '',
    `<span class="badge">${context.can_edit_global_state ? 'global settings writable' : 'global settings read-only'}</span>`,
  ].filter(Boolean).join(' ');
}

export function openTraceability(sessionId, requestId) {
  const params = new URLSearchParams({
    session_id: sessionId,
    request_id: requestId,
  });
  window.location.href = `/traceability?${params.toString()}`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
