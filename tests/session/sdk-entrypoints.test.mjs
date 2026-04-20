import test from 'node:test';
import assert from 'node:assert/strict';
import { closeSession, createRuntime, createSession, inspectSession, submitRequest } from '../../src/index.mjs';
import { createTempRuntimeRoot } from '../fixtures/runtime-root.mjs';

test('SDK entry points create sessions, submit requests, inspect, and close', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = createRuntime(rootDir, { deterministic: {} });
  const session = await createSession(runtime, { isAdmin: true });

  assert.ok(session.session_id);
  assert.equal(session.is_admin, true);

  const started = await submitRequest(session, {
    requestText: 'Provide a concise answer.',
  });
  const outcome = await started.done;
  assert.equal(outcome.stop_reason, 'completed');

  const details = await inspectSession(session);
  assert.equal(details.session_id, session.session_id);
  assert.ok(Array.isArray(details.request_history));

  const closed = await closeSession(session);
  assert.equal(closed.closed, true);
});

test('session executor rejects concurrent active requests', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = createRuntime(rootDir, { deterministic: {} });
  const session = await createSession(runtime, {});

  const first = await submitRequest(session, {
    requestText: 'First request.',
  });

  await assert.rejects(
    () => submitRequest(session, { requestText: 'Second request.' }),
    /active request/i,
  );

  await first.done;
});
