export function renderChatApp() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MRP-VM Chat</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 0; background: #0b1020; color: #e6edf3; }
    .layout { display: grid; grid-template-columns: 320px 1fr; min-height: 100vh; }
    .sidebar { padding: 16px; border-right: 1px solid #283046; background: #11182c; overflow: auto; }
    .main { display: grid; grid-template-rows: auto auto 1fr; gap: 12px; padding: 16px; min-height: 100vh; }
    .panel { border: 1px solid #283046; border-radius: 10px; background: #11182c; padding: 12px; }
    .panel h2, .panel h3 { margin-top: 0; }
    .row { display: flex; gap: 8px; }
    .row > * { flex: 1; }
    .stack { display: grid; gap: 8px; }
    .two-col { display: grid; grid-template-columns: 1.2fr .8fr; gap: 12px; }
    .triple { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; min-height: 360px; }
    textarea, input, select { width: 100%; background: #0b1020; color: inherit; border: 1px solid #283046; border-radius: 8px; padding: 8px; }
    button { background: #2f81f7; color: white; border: 0; border-radius: 8px; padding: 10px 12px; cursor: pointer; }
    button.secondary { background: #283046; }
    pre { white-space: pre-wrap; word-break: break-word; margin: 0; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { padding: 6px 0; border-bottom: 1px solid #20283a; }
    .muted { color: #9ca7b8; }
    .status { font-weight: 700; }
    .trace-item { margin-bottom: 10px; border-bottom: 1px solid #20283a; padding-bottom: 8px; }
    .conversation { display: grid; gap: 10px; max-height: 320px; overflow: auto; }
    .message { border: 1px solid #20283a; border-radius: 10px; padding: 10px; background: #0f1527; }
    .message.user { border-color: #2f81f7; }
    .message.assistant { border-color: #2ea043; }
    .message h4 { margin: 0 0 6px; font-size: 0.95rem; }
    .request-link { width: 100%; text-align: left; }
    label { display: grid; gap: 4px; }
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
        <div class="stack">
          <label>Default LLM
            <input id="default-llm" value="">
          </label>
          <label>Fast profile model
            <input id="fast-llm-model" value="">
          </label>
          <label>Deep profile model
            <input id="deep-llm-model" value="">
          </label>
          <label>Writer profile model
            <input id="writer-llm-model" value="">
          </label>
          <label>Planner profile model
            <input id="planner-llm-model" value="">
          </label>
          <label>Step budget
            <input id="step-budget" type="number" value="64">
          </label>
          <label>Planning budget
            <input id="planning-budget" type="number" value="4">
          </label>
          <label><input id="admin-flag" type="checkbox"> create admin session</label>
          <div class="row">
            <button id="save-config">Save Config</button>
            <button id="reload-config" class="secondary">Reload</button>
          </div>
        </div>
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
        <p class="muted">This chat uses the native session/request API. The conversation view is paired with plan, state, and trace so the runtime stays inspectable.</p>
      </section>
      <section class="two-col">
        <div class="panel">
          <h3>Conversation</h3>
          <div id="conversation-panel" class="conversation muted">No messages yet.</div>
        </div>
        <div class="panel">
          <strong>Latest outcome:</strong> <span id="latest-outcome" class="status">idle</span>
          <p class="muted" id="provider-summary" style="margin-bottom:0;">Provider not loaded.</p>
        </div>
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
  <script type="module">
    const state = {
      sessionId: null,
      currentRequestId: null,
      eventSource: null,
    };

    const el = (id) => document.getElementById(id);

    function headersWithSession(baseHeaders = {}) {
      const headers = new Headers(baseHeaders);
      if (state.sessionId) {
        headers.set('x-session-id', state.sessionId);
      }
      return headers;
    }

    function setStatus(text) {
      el('latest-outcome').textContent = text;
    }

    function renderSessionList(items) {
      const list = el('session-list');
      list.innerHTML = '';
      for (const item of items) {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.textContent = item.session_id + (item.is_admin ? ' (admin)' : '');
        button.className = 'secondary request-link';
        button.onclick = () => selectSession(item.session_id);
        li.appendChild(button);
        list.appendChild(li);
      }
    }

    function renderConversation(items) {
      const container = el('conversation-panel');
      if (!items || items.length === 0) {
        container.className = 'conversation muted';
        container.textContent = 'No messages yet.';
        return;
      }
      container.className = 'conversation';
      container.innerHTML = '';
      for (const item of items) {
        if (item.request_text) {
          const user = document.createElement('div');
          user.className = 'message user';
          user.innerHTML = '<h4>User</h4>';
          const userBody = document.createElement('pre');
          userBody.textContent = item.request_text;
          user.appendChild(userBody);
          container.appendChild(user);
        }
        const assistant = document.createElement('div');
        assistant.className = 'message assistant';
        assistant.innerHTML = '<h4>Assistant</h4>';
        const assistantBody = document.createElement('pre');
        assistantBody.textContent = item.response == null ? '(no response yet)' : String(item.response);
        assistant.appendChild(assistantBody);
        container.appendChild(assistant);
      }
    }

    function renderRequestHistory(items) {
      const list = el('request-history');
      list.innerHTML = '';
      for (const item of items) {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.className = 'secondary request-link';
        button.textContent = item.request_id + ' - ' + item.stop_reason;
        button.onclick = async () => {
          state.currentRequestId = item.request_id;
          await refreshRequestPanels();
        };
        li.appendChild(button);
        list.appendChild(li);
      }
    }

    async function fetchJson(url, options = {}) {
      const response = await fetch(url, {
        ...options,
        headers: headersWithSession(options.headers || {}),
      });
      if (!response.ok) {
        const payload = await response.text();
        throw new Error(payload || ('HTTP ' + response.status));
      }
      return response.json();
    }

    async function loadConfig() {
      const config = await fetchJson('/api/config');
      el('default-llm').value = config.default_llm || '';
      el('fast-llm-model').value = config.interpreter_mappings?.fastLLM || '';
      el('deep-llm-model').value = config.interpreter_mappings?.deepLLM || '';
      el('writer-llm-model').value = config.interpreter_mappings?.writerLLM || '';
      el('planner-llm-model').value = config.interpreter_mappings?.plannerLLM || '';
      el('provider-summary').textContent = 'Provider: ' + config.provider + ' | default model: ' + config.default_llm;
    }

    async function saveConfig() {
      try {
        const config = await fetchJson('/api/config', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            default_llm: el('default-llm').value,
            interpreter_mappings: {
              fastLLM: el('fast-llm-model').value,
              deepLLM: el('deep-llm-model').value,
              writerLLM: el('writer-llm-model').value,
              plannerLLM: el('planner-llm-model').value,
            },
          }),
        });
        el('provider-summary').textContent = 'Provider: ' + config.provider + ' | default model: ' + config.default_llm;
        setStatus('config_saved');
      } catch (error) {
        setStatus('config_error');
      }
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
      renderConversation(details.request_history || []);
      el('plan-panel').textContent = details.plan_snapshot || 'No active plan.';
      el('state-panel').textContent = JSON.stringify(details.family_state || [], null, 2);
    }

    async function createSession() {
      const created = await fetchJson('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          is_admin: el('admin-flag').checked,
        }),
      });
      await refreshSessions();
      await selectSession(created.session_id);
    }

    async function refreshRequestPanels() {
      if (!state.sessionId || !state.currentRequestId) {
        return;
      }
      const [plan, statePayload, request] = await Promise.all([
        fetch('/api/sessions/' + state.sessionId + '/requests/' + state.currentRequestId + '/plan', {
          headers: headersWithSession(),
        }).then((response) => response.text()),
        fetchJson('/api/sessions/' + state.sessionId + '/requests/' + state.currentRequestId + '/state'),
        fetchJson('/api/sessions/' + state.sessionId + '/requests/' + state.currentRequestId),
      ]);
      el('plan-panel').textContent = plan || 'No plan.';
      el('state-panel').textContent = JSON.stringify(statePayload.family_state || [], null, 2);
      setStatus(request.outcome?.response == null ? request.status : String(request.outcome.response));
      if (request.outcome) {
        await selectSession(state.sessionId);
      }
    }

    function appendTrace(event) {
      const container = el('trace-panel');
      if (container.classList.contains('muted')) {
        container.classList.remove('muted');
        container.innerHTML = '';
      }
      const wrapper = document.createElement('div');
      wrapper.className = 'trace-item';
      const title = document.createElement('strong');
      title.textContent = event.event;
      const body = document.createElement('pre');
      body.textContent = JSON.stringify(event, null, 2);
      wrapper.appendChild(title);
      wrapper.appendChild(body);
      container.prepend(wrapper);
    }

    function openTraceStream(requestId) {
      if (state.eventSource) {
        state.eventSource.close();
      }
      const source = new EventSource('/api/sessions/' + state.sessionId + '/requests/' + requestId + '/stream');
      state.eventSource = source;
      const trackedEvents = ['request_started', 'epoch_opened', 'variant_emitted', 'metadata_updated', 'declarations_inserted', 'planning_stopped', 'request_stopped', 'family_resolved', 'failure_recorded'];
      for (const eventName of trackedEvents) {
        source.addEventListener(eventName, async (message) => {
          const event = JSON.parse(message.data);
          appendTrace(event);
          if (event.event === 'request_started') {
            setStatus('executing');
          }
          if (['variant_emitted', 'metadata_updated', 'declarations_inserted', 'planning_stopped', 'failure_recorded', 'request_stopped', 'family_resolved'].includes(event.event)) {
            await refreshRequestPanels();
          }
        });
      }
    }

    async function submitRequest() {
      if (!state.sessionId) {
        await createSession();
      }
      const files = Array.from(el('attachment-input').files || []);
      let response;
      if (files.length > 0) {
        const formData = new FormData();
        formData.set('request', el('request-input').value);
        formData.set('budgets', JSON.stringify({
          steps_remaining: Number(el('step-budget').value),
          planning_remaining: Number(el('planning-budget').value),
        }));
        for (const file of files) {
          formData.append('file', file, file.name);
        }
        response = await fetch('/api/sessions/' + state.sessionId + '/requests', {
          method: 'POST',
          headers: headersWithSession(),
          body: formData,
        }).then((result) => result.json());
      } else {
        response = await fetchJson('/api/sessions/' + state.sessionId + '/requests', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            request: el('request-input').value,
            budgets: {
              steps_remaining: Number(el('step-budget').value),
              planning_remaining: Number(el('planning-budget').value),
            },
          }),
        });
      }
      state.currentRequestId = response.request_id;
      setStatus('executing');
      openTraceStream(response.request_id);
      await refreshRequestPanels();
      el('attachment-input').value = '';
    }

    el('new-session').onclick = createSession;
    el('refresh-sessions').onclick = refreshSessions;
    el('submit-request').onclick = submitRequest;
    el('save-config').onclick = saveConfig;
    el('reload-config').onclick = loadConfig;
    await loadConfig();
    await refreshSessions();
  </script>
</body>
</html>`;
}
