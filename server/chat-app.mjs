function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderChatApp() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MRP-VM Chat</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, sans-serif; margin: 0; background: #0b1020; color: #e6edf3; }
    .layout { display: grid; grid-template-columns: 320px 1fr; min-height: 100vh; }
    .sidebar { padding: 16px; border-right: 1px solid #283046; background: #11182c; }
    .main { display: grid; grid-template-rows: auto auto 1fr; gap: 12px; padding: 16px; }
    .panel { border: 1px solid #283046; border-radius: 10px; background: #11182c; padding: 12px; }
    .panel h2, .panel h3 { margin-top: 0; }
    .triple { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; min-height: 420px; }
    textarea, input, select { width: 100%; box-sizing: border-box; background: #0b1020; color: inherit; border: 1px solid #283046; border-radius: 8px; padding: 8px; }
    button { background: #2f81f7; color: white; border: 0; border-radius: 8px; padding: 10px 12px; cursor: pointer; }
    button.secondary { background: #283046; }
    .row { display: flex; gap: 8px; }
    .row > * { flex: 1; }
    pre { white-space: pre-wrap; word-break: break-word; margin: 0; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { padding: 6px 0; border-bottom: 1px solid #20283a; }
    .muted { color: #9ca7b8; }
    .trace-item { margin-bottom: 10px; border-bottom: 1px solid #20283a; padding-bottom: 8px; }
    .status { font-weight: 700; }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="panel">
        <h2>Sessions</h2>
        <div class="row">
          <button id="new-session">New Session</button>
          <button id="refresh-sessions" class="secondary">Refresh</button>
        </div>
        <p class="muted">Selected session: <span id="selected-session">none</span></p>
        <ul id="session-list"></ul>
      </div>
      <div class="panel">
        <h3>Options</h3>
        <label>Default LLM
          <input id="default-llm" value="plannerLLM">
        </label>
        <label>Fast profile model
          <input id="fast-llm-model" value="fastLLM">
        </label>
        <label>Deep profile model
          <input id="deep-llm-model" value="deepLLM">
        </label>
        <label>Step budget
          <input id="step-budget" type="number" value="64">
        </label>
        <label>Planning budget
          <input id="planning-budget" type="number" value="4">
        </label>
        <label><input id="admin-flag" type="checkbox"> create admin session</label>
      </div>
      <div class="panel">
        <h3>Request History</h3>
        <ul id="request-history"></ul>
      </div>
    </aside>
    <main class="main">
      <section class="panel">
        <h2>Ask MRP-VM</h2>
        <textarea id="request-input" rows="5" placeholder="Describe the task..."></textarea>
        <div class="row" style="margin-top:8px;">
          <input id="attachment-input" type="file" multiple>
          <button id="submit-request">Submit Request</button>
        </div>
        <p class="muted">The live view is trace-driven. Plan and state panels update from the request trace and inspection endpoints.</p>
      </section>
      <section class="panel">
        <strong>Latest outcome:</strong> <span id="latest-outcome" class="status">idle</span>
      </section>
      <section class="triple">
        <div class="panel">
          <h3>Plan</h3>
          <pre id="plan-panel">No plan loaded.</pre>
        </div>
        <div class="panel">
          <h3>State</h3>
          <pre id="state-panel">No family state loaded.</pre>
        </div>
        <div class="panel">
          <h3>Trace</h3>
          <div id="trace-panel" class="muted">No trace yet.</div>
        </div>
      </section>
    </main>
  </div>
  <script>
    const state = {
      sessionId: null,
      currentRequestId: null,
      eventSource: null,
    };

    const el = (id) => document.getElementById(id);

    function renderSessionList(items) {
      const list = el('session-list');
      list.innerHTML = '';
      for (const item of items) {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.textContent = item.session_id + (item.is_admin ? ' (admin)' : '');
        button.className = 'secondary';
        button.onclick = () => selectSession(item.session_id);
        li.appendChild(button);
        list.appendChild(li);
      }
    }

    function renderRequestHistory(items) {
      const list = el('request-history');
      list.innerHTML = '';
      for (const item of items) {
        const li = document.createElement('li');
        li.textContent = item.request_id + ' - ' + item.stop_reason;
        list.appendChild(li);
      }
    }

    async function fetchJson(url, options = {}) {
      const headers = new Headers(options.headers || {});
      if (state.sessionId) {
        headers.set('x-session-id', state.sessionId);
      }
      const response = await fetch(url, { ...options, headers });
      return response.json();
    }

    async function refreshSessions() {
      const items = await fetchJson('/api/sessions');
      renderSessionList(items.sessions || items);
    }

    async function selectSession(sessionId) {
      state.sessionId = sessionId;
      el('selected-session').textContent = sessionId;
      const details = await fetchJson('/api/sessions/' + sessionId);
      renderRequestHistory(details.request_history || []);
      el('plan-panel').textContent = details.plan_snapshot || 'No active plan.';
      el('state-panel').textContent = JSON.stringify(details.family_state || [], null, 2);
    }

    async function createSession() {
      const payload = {
        is_admin: el('admin-flag').checked,
      };
      const created = await fetchJson('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await refreshSessions();
      await selectSession(created.session_id);
    }

    async function refreshRequestPanels() {
      if (!state.sessionId || !state.currentRequestId) return;
      const [plan, statePayload, request] = await Promise.all([
        fetch('/api/sessions/' + state.sessionId + '/requests/' + state.currentRequestId + '/plan', {
          headers: state.sessionId ? { 'x-session-id': state.sessionId } : {},
        }).then((r) => r.text()),
        fetchJson('/api/sessions/' + state.sessionId + '/requests/' + state.currentRequestId + '/state'),
        fetchJson('/api/sessions/' + state.sessionId + '/requests/' + state.currentRequestId),
      ]);
      el('plan-panel').textContent = plan || 'No plan.';
      el('state-panel').textContent = JSON.stringify(statePayload.family_state || [], null, 2);
      el('latest-outcome').textContent = request.outcome ? JSON.stringify(request.outcome.response) : request.status;
    }

    function appendTrace(event) {
      const container = el('trace-panel');
      if (container.classList.contains('muted')) {
        container.classList.remove('muted');
        container.innerHTML = '';
      }
      const wrapper = document.createElement('div');
      wrapper.className = 'trace-item';
      wrapper.innerHTML = '<strong>' + event.event + '</strong><pre>' + ${JSON.stringify(escapeHtml('@@PAYLOAD@@'))}.replace('@@PAYLOAD@@', '') + '</pre>';
      wrapper.querySelector('pre').textContent = JSON.stringify(event, null, 2);
      container.prepend(wrapper);
    }

    function openTraceStream(requestId) {
      if (state.eventSource) {
        state.eventSource.close();
      }
      const source = new EventSource('/api/sessions/' + state.sessionId + '/requests/' + requestId + '/stream');
      state.eventSource = source;
      source.onmessage = (message) => {
        const event = JSON.parse(message.data);
        appendTrace(event);
      };
      const trackedEvents = ['request_started','epoch_opened','variant_emitted','metadata_updated','declarations_inserted','planning_stopped','request_stopped','family_resolved','failure_recorded'];
      for (const eventName of trackedEvents) {
        source.addEventListener(eventName, async (message) => {
          const event = JSON.parse(message.data);
          appendTrace(event);
          if (['variant_emitted','metadata_updated','declarations_inserted','planning_stopped','failure_recorded','request_stopped','family_resolved'].includes(event.event)) {
            await refreshRequestPanels();
          }
        });
      }
    }

    async function submitRequest() {
      if (!state.sessionId) {
        await createSession();
      }
      const payload = {
        request: el('request-input').value,
        budgets: {
          steps_remaining: Number(el('step-budget').value),
          planning_remaining: Number(el('planning-budget').value),
        },
      };
      const started = await fetchJson('/api/sessions/' + state.sessionId + '/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      state.currentRequestId = started.request_id;
      el('latest-outcome').textContent = 'executing';
      openTraceStream(started.request_id);
      await refreshRequestPanels();
    }

    el('new-session').onclick = createSession;
    el('refresh-sessions').onclick = refreshSessions;
    el('submit-request').onclick = submitRequest;
    refreshSessions();
  </script>
</body>
</html>`;
}
