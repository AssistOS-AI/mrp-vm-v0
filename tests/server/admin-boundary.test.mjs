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

test('admin-only server endpoints enforce bootstrap-admin and user boundaries', async () => {
  const rootDir = await createTempRuntimeRoot();
  const server = createServer({ rootDir, allowFakeLlm: true, runtimeOptions: { deterministic: {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const adminSession = await createSession(baseUrl, false);
    const userSession = await createSession(baseUrl, false);

    assert.equal(adminSession.effective_role, 'admin');
    assert.equal(adminSession.auth_mode, 'bootstrap_admin');
    assert.equal(userSession.effective_role, 'user');

    await fetch(`${baseUrl}/api/sessions/${userSession.session_id}/kb`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-id': userSession.session_id,
      },
      body: JSON.stringify({
        file_name: 'promote-me.sop',
        sop_text: '@ku_promote_me text\nhello\n@ku_promote_me:meta json\n{"rev":1,"ku_type":"content","scope":"session","status":"active","title":"hello","summary":"note","priority":1,"trust":"trusted","domains":["runtime"],"commands":["kb"],"interpreters":[],"tags":[],"input_patterns":[]}\n',
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

test('bootstrap admin key can be created before any server key exists', async () => {
  const rootDir = await createTempRuntimeRoot();
  const server = createServer({ rootDir, allowFakeLlm: true, runtimeOptions: { deterministic: {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const bootstrapResponse = await fetch(`${baseUrl}/api/auth/bootstrap-key`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        label: 'Bootstrap admin',
      }),
    });
    assert.equal(bootstrapResponse.status, 201);
    const bootstrapPayload = await bootstrapResponse.json();
    assert.equal(bootstrapPayload.record.role, 'admin');
    assert.match(String(bootstrapPayload.api_key), /^key_/);

    const authContext = await fetch(`${baseUrl}/api/auth/context`, {
      headers: {
        'x-api-key': bootstrapPayload.api_key,
      },
    }).then((response) => response.json());
    assert.equal(authContext.caller.role, 'admin');
    assert.equal(authContext.caller.auth_mode, 'api_key');

    const createdSession = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': bootstrapPayload.api_key,
      },
      body: JSON.stringify({}),
    }).then((response) => response.json());
    assert.equal(createdSession.effective_role, 'admin');

    const secondBootstrap = await fetch(`${baseUrl}/api/auth/bootstrap-key`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        label: 'Another bootstrap',
      }),
    });
    assert.equal(secondBootstrap.status, 403);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
