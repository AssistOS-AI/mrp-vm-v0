import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { MRPVM } from '../../src/index.mjs';
import { createTempRuntimeRoot } from '../fixtures/runtime-root.mjs';

test('runtime submits a request end-to-end and persists trace and state', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, { deterministic: {} });
  const fixture = JSON.parse(await readFile(new URL('../fixtures/request-basic.json', import.meta.url), 'utf8'));

  const outcome = await runtime.submitRequest({
    requestText: fixture.request,
  });

  assert.equal(outcome.stop_reason, 'completed');
  assert.match(String(outcome.response), new RegExp(`^${fixture.expected_response_prefix}`));

  const tracePath = path.join(rootDir, 'data', 'sessions', outcome.session_id, 'trace', 'session.jsonl');
  const traceContent = await readFile(tracePath, 'utf8');
  assert.match(traceContent, /request_started/);
  assert.match(traceContent, /request_stopped/);

  const inspection = runtime.inspect();
  assert.ok(Array.isArray(inspection.invocationHistory));
  assert.ok(inspection.contextPackage);
});
