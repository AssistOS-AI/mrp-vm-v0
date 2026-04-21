import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../../server/index.mjs';
import { createTempRuntimeRoot } from '../fixtures/runtime-root.mjs';

async function createSession(baseUrl) {
  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  return response.json();
}

test('SSE stream replays buffered DS014 events for a request', async () => {
  const rootDir = await createTempRuntimeRoot();
  const server = createServer({ rootDir, allowFakeLlm: true, runtimeOptions: { deterministic: {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const session = await createSession(baseUrl);

    const started = await fetch(`${baseUrl}/api/sessions/${session.session_id}/requests`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-id': session.session_id,
      },
      body: JSON.stringify({ request: 'Stream hello' }),
    }).then((response) => response.json());

    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/sessions/${session.session_id}/requests/${started.request_id}/stream`, {
      headers: {
        'x-session-id': session.session_id,
      },
      signal: controller.signal,
    });

    const reader = response.body.getReader();
    const chunks = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(Buffer.from(value).toString('utf8'));
      const body = chunks.join('');
      if (body.includes('event: request_started') && body.includes('event: request_stopped')) {
        break;
      }
    }
    controller.abort();

    const body = chunks.join('');
    assert.match(body, /event: request_started/);
    assert.match(body, /event: request_stopped/);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
