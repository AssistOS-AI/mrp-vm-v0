import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../../server/index.mjs';
import { createTempRuntimeRoot } from '../fixtures/runtime-root.mjs';

async function createSession(baseUrl, isAdmin = false) {
  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ is_admin: isAdmin }),
  });
  return response.json();
}

async function waitForOutcome(baseUrl, sessionId, requestId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/requests/${requestId}`, {
      headers: {
        'x-session-id': sessionId,
      },
    });
    const payload = await response.json();
    if (payload.outcome) {
      return payload;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for request outcome.');
}

test('server exposes native session and request APIs plus /chat', async () => {
  const rootDir = await createTempRuntimeRoot();
  const server = createServer({ rootDir, runtimeOptions: { deterministic: {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const session = await createSession(baseUrl);

    const listed = await fetch(`${baseUrl}/api/sessions`, {
      headers: { 'x-session-id': session.session_id },
    }).then((response) => response.json());
    assert.equal(listed.sessions.length, 1);

    const requestResponse = await fetch(`${baseUrl}/api/sessions/${session.session_id}/requests`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-id': session.session_id,
      },
      body: JSON.stringify({
        request: 'Say hello',
      }),
    });
    assert.equal(requestResponse.status, 202);
    const started = await requestResponse.json();

    const request = await waitForOutcome(baseUrl, session.session_id, started.request_id);
    assert.match(String(request.outcome.response), /writerLLM:/);

    const plan = await fetch(`${baseUrl}/api/sessions/${session.session_id}/requests/${started.request_id}/plan`, {
      headers: { 'x-session-id': session.session_id },
    }).then((response) => response.text());
    assert.match(plan, /@response/);

    const state = await fetch(`${baseUrl}/api/sessions/${session.session_id}/requests/${started.request_id}/state`, {
      headers: { 'x-session-id': session.session_id },
    }).then((response) => response.json());
    assert.ok(Array.isArray(state.family_state));

    const trace = await fetch(`${baseUrl}/api/sessions/${session.session_id}/requests/${started.request_id}/trace`, {
      headers: { 'x-session-id': session.session_id },
    }).then((response) => response.json());
    assert.ok(trace.events.some((event) => event.event === 'request_started'));

    const sessionKuUpsert = await fetch(`${baseUrl}/api/sessions/${session.session_id}/kb`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-id': session.session_id,
      },
      body: JSON.stringify({
        file_name: 'session-note.sop',
        sop_text: '@ku_session_note text\nhello\n@ku_session_note:meta json\n{"rev":1,"ku_type":"content","scope":"session","status":"active","title":"hello","summary":"note","priority":1,"trust":"trusted","domains":["runtime"],"commands":["kb"],"interpreters":[],"tags":[],"input_patterns":[]}\n',
      }),
    });
    assert.equal(sessionKuUpsert.status, 201);

    const sessionKus = await fetch(`${baseUrl}/api/sessions/${session.session_id}/kb`, {
      headers: { 'x-session-id': session.session_id },
    }).then((response) => response.json());
    assert.ok(sessionKus.items.some((item) => item.ku_id === 'ku_session_note'));

    const config = await fetch(`${baseUrl}/api/config`).then((response) => response.json());
    assert.equal(config.default_llm, 'write');
    assert.equal(config.provider, 'fake');
    assert.equal(config.interpreter_mappings.plannerLLM, 'plan');

    const completion = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-id': session.session_id,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Say hi from compatibility mode.' }],
      }),
    }).then((response) => response.json());
    assert.match(String(completion.choices[0].message.content), /writerLLM:/);

    const sessionDetails = await fetch(`${baseUrl}/api/sessions/${session.session_id}`, {
      headers: { 'x-session-id': session.session_id },
    }).then((response) => response.json());
    assert.equal(sessionDetails.session_id, session.session_id);

    const chatPage = await fetch(`${baseUrl}/chat`).then((response) => response.text());
    assert.match(chatPage, /Ask MRP-VM/);
    assert.match(chatPage, /Plan/);
    assert.match(chatPage, /Trace/);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
