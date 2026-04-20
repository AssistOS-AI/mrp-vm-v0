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

test('admin-only server endpoints reject non-admin sessions and accept admin sessions', async () => {
  const rootDir = await createTempRuntimeRoot();
  const server = createServer({ rootDir, runtimeOptions: { deterministic: {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const userSession = await createSession(baseUrl, false);
    const adminSession = await createSession(baseUrl, true);

    await fetch(`${baseUrl}/api/sessions/${userSession.session_id}/kb`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-id': userSession.session_id,
      },
      body: JSON.stringify({
        file_name: 'promote-me.sop',
        sop_text: 'ku_promote_me = "hello"\nku_promote_me:meta = {"rev":1,"ku_type":"content","scope":"session","status":"active","title":"hello","summary":"note","priority":1,"trust":"trusted","domains":["runtime"],"commands":["kb"],"interpreters":[],"tags":[],"input_patterns":[]}\n',
      }),
    });

    const rejected = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-session-id': userSession.session_id,
      },
      body: JSON.stringify({ default_llm: 'deepLLM' }),
    });
    assert.equal(rejected.status, 403);

    const rejectedPromotion = await fetch(`${baseUrl}/api/kb/promote`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-id': userSession.session_id,
      },
      body: JSON.stringify({
        session_id: userSession.session_id,
        file_name: 'promote-me.sop',
      }),
    });
    assert.equal(rejectedPromotion.status, 403);

    const accepted = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-session-id': adminSession.session_id,
      },
      body: JSON.stringify({ default_llm: 'deepLLM' }),
    });
    assert.equal(accepted.status, 200);
    const config = await accepted.json();
    assert.equal(config.default_llm, 'deepLLM');

    const acceptedPromotion = await fetch(`${baseUrl}/api/kb/promote`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-id': adminSession.session_id,
      },
      body: JSON.stringify({
        session_id: userSession.session_id,
        file_name: 'promote-me.sop',
        target_file_name: 'global-promoted.sop',
      }),
    });
    assert.equal(acceptedPromotion.status, 200);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
