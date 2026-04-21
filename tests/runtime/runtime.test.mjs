import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ExternalInterpreterRegistry, MRPVM } from '../../src/index.mjs';
import { createTempRuntimeRoot } from '../fixtures/runtime-root.mjs';

test('runtime submits a request end-to-end and persists trace and state', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, {
    deterministic: {},
    manualOverrides: {
      forceFakeLlm: true,
    },
  });
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

test('runtime persists an execution_error outcome when an interpreter throws', async () => {
  const rootDir = await createTempRuntimeRoot();
  const externalInterpreters = new ExternalInterpreterRegistry();
  for (const profile of ['plannerLLM', 'writerLLM']) {
    externalInterpreters.register({
      name: profile,
      purpose: profile,
      input_contract: ['instruction'],
      output_shapes: profile === 'plannerLLM' ? ['sop_proposal'] : ['plain_value'],
      cost_class: 'normal',
      can_insert_declarations: profile === 'plannerLLM',
      can_refuse: true,
      uses_llm_adapter: false,
      capability_profile: 'default',
      trace_requirements: ['interpreter_invoked'],
    }, async () => {
      throw new Error('boom');
    });
  }

  const runtime = new MRPVM(rootDir, {
    deterministic: {},
    manualOverrides: {
      forceFakeLlm: true,
    },
    externalInterpreters,
  });

  const outcome = await runtime.submitRequest({
    requestText: 'trigger failure',
  });

  assert.equal(outcome.stop_reason, 'execution_error');
  assert.equal(outcome.error.message, 'boom');
  const persisted = await runtime.inspectRequestPublic(outcome.request_id);
  assert.equal(persisted.outcome.stop_reason, 'execution_error');
});
