import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { ExternalInterpreterRegistry, MRPVM } from '../../src/index.mjs';
import { RequestManager } from '../../src/session/request-manager.mjs';
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

  const persistedProbe = new MRPVM(rootDir, { deterministic: {} });
  persistedProbe.sessionId = outcome.session_id;
  const persistedRequest = await persistedProbe.inspectRequestPublic(outcome.request_id);
  const responseFamily = persistedRequest.family_state.find((family) => family.familyId === 'response');
  assert.ok(responseFamily);
  assert.ok((responseFamily.variants ?? []).length >= 1);
  assert.equal(typeof responseFamily.variants[0].value, 'string');
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
  assert.match(String(outcome.error.stack), /boom/);
  const persisted = await runtime.inspectRequestPublic(outcome.request_id);
  assert.equal(persisted.outcome.stop_reason, 'execution_error');
  assert.match(String(persisted.outcome.error.stack), /boom/);
});

test('runtime promotes successful LLM calls into cache and reuses them on identical requests', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, {
    deterministic: {},
    manualOverrides: {
      forceFakeLlm: true,
    },
    fakeAdapterConfig: {
      scriptedSequences: {
        plannerLLM: [
          [
            '@greeting_seed js-eval',
            'return "Say hello from cache."; ',
            '',
            '@greeting_draft writerLLM',
            'Using $greeting_seed, phrase exactly the final answer for the user.',
            '',
            '@response template-eval',
            '$greeting_draft',
          ].join('\n'),
          [
            '@greeting_seed js-eval',
            'return "Say hello from cache."; ',
            '',
            '@greeting_draft writerLLM',
            'Using $greeting_seed, phrase exactly the final answer for the user.',
            '',
            '@response template-eval',
            '$greeting_draft',
          ].join('\n'),
        ],
        writerLLM: [
          'cached answer',
          'uncached answer',
        ],
      },
    },
  });

  const first = await runtime.startRequest({
    requestText: 'Say hello from cache.',
  });
  const firstOutcome = await first.done;
  assert.equal(firstOutcome.stop_reason, 'completed');
  assert.equal(firstOutcome.response, 'cached answer');

  const firstCache = await runtime.inspectRequestLlmCache(firstOutcome.request_id, firstOutcome.session_id);
  assert.equal(firstCache.summary.promotable_count, 2);

  const promoted = await runtime.promoteRequestLlmCache(firstOutcome.request_id, firstOutcome.session_id);
  assert.equal(promoted.promoted_count, 2);

  const second = await runtime.startRequest({
    requestText: 'Say hello from cache.',
  });
  const secondOutcome = await second.done;
  assert.equal(secondOutcome.stop_reason, 'completed');
  assert.equal(secondOutcome.response, 'cached answer');

  const cacheEntries = await runtime.listLlmCacheEntries();
  assert.equal(cacheEntries.length, 2);
  assert.ok(cacheEntries.some((entry) => Number(entry.hit_count ?? 0) > 0));
});

test('runtime completes a js-eval planner step that ends with a final expression instead of an explicit return', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, {
    deterministic: {},
    fakeAdapterConfig: {
      scriptedSequences: {
        plannerLLM: [[
          '@digits js-eval',
          '"1".repeat(10)',
          '',
          '@response template-eval',
          '$digits',
        ].join('\n')],
      },
    },
  });

  const outcome = await runtime.submitRequest({
    requestText: 'scrie de 10 ori 1',
  });

  assert.equal(outcome.stop_reason, 'completed');
  assert.equal(outcome.response, '1111111111');
});

test('runtime does not exhaust the structural-change budget on metadata-only execution effects', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, {
    deterministic: {},
    fakeAdapterConfig: {
      scriptedSequences: {
        plannerLLM: [[
          '@draft js-eval',
          'const message = "hello";',
          '',
          '@response template-eval',
          '$draft',
        ].join('\n')],
      },
    },
  });

  const outcome = await runtime.submitRequest({
    requestText: 'produce a greeting',
    budgets: {
      steps_remaining: 8,
      planning_remaining: 3,
      structural_changes_remaining: 2,
    },
  });

  assert.equal(outcome.stop_reason, 'unknown_outcome');
  assert.equal(outcome.error.code, 'UNKNOWN_OUTCOME');
  assert.equal(outcome.remaining_budgets.structural_changes_remaining, 2);
});

test('runtime uses Explainable Memory by default for KB retrieval metadata', async () => {
  const rootDir = await createTempRuntimeRoot();
  const sessionId = 'session-explainable';
  const sessionFile = path.join(rootDir, 'data', 'sessions', sessionId, 'kb', 'notes.sop');
  await mkdir(path.dirname(sessionFile), { recursive: true });
  await writeFile(sessionFile, [
    '@ku_session_note text',
    'Alpha project note with explainable retrieval guidance.',
    '@ku_session_note:meta json',
    '{"rev":1,"ku_type":"content","scope":"session","status":"active","title":"Alpha note","summary":"Session note","priority":1,"trust":"trusted","domains":["runtime"],"commands":["kb"],"interpreters":[],"tags":["alpha"],"input_patterns":[]}',
  ].join('\n'));

  const runtime = new MRPVM(rootDir, { deterministic: {} });
  const snapshot = await runtime.prepareKbSnapshot(sessionId);
  assert.equal(snapshot.retrievalMode, 'explainable_memory');
  assert.ok(snapshot.explainableMemory);

  const result = await runtime.retrieveKnowledge(snapshot, {
    callerName: 'kb',
    targetCommand: 'kb',
    retrievalMode: 'explicit_kb_query',
    requestText: 'Alpha retrieval guidance',
    queryTokens: ['Alpha retrieval guidance'],
    domainHints: ['runtime'],
    desiredKuTypes: ['content'],
    byteBudget: 4096,
  });

  assert.equal(result.mode, 'explainable_memory');
  assert.ok(result.candidates.some((entry) => entry.kuId === 'ku_session_note'));
  assert.ok(result.selected.some((entry) => entry.aspect_ids.length >= 1));
  assert.ok(result.selected.every((entry) => entry.index_state.indexed));
  const chosen = result.selected.find((entry) => entry.kuId === 'ku_session_note') ?? result.selected[0];
  assert.match(chosen.usage, /Use this KU as/);
  assert.ok(chosen.usage_reference.startsWith('~'));
});

test('runtime reloads persisted Explainable Memory snapshots from disk without JSON parsing failures', async () => {
  const rootDir = await createTempRuntimeRoot();
  const sessionId = 'session-explainable-reload';
  const sessionFile = path.join(rootDir, 'data', 'sessions', sessionId, 'kb', 'notes.sop');
  await mkdir(path.dirname(sessionFile), { recursive: true });
  await writeFile(sessionFile, [
    '@ku_session_note text',
    'Alpha project note with explainable retrieval guidance.',
    '@ku_session_note:meta json',
    '{"rev":1,"ku_type":"content","scope":"session","status":"active","title":"Alpha note","summary":"Session note","priority":1,"trust":"trusted","domains":["runtime"],"commands":["kb"],"interpreters":[],"tags":["alpha"],"input_patterns":[]}',
  ].join('\n'));

  const writer = new MRPVM(rootDir, { deterministic: {} });
  const initialSnapshot = await writer.prepareKbSnapshot(sessionId);
  assert.equal(initialSnapshot.retrievalMode, 'explainable_memory');

  const reader = new MRPVM(rootDir, { deterministic: {} });
  const reloadedSnapshot = await reader.prepareKbSnapshot(sessionId);
  assert.equal(reloadedSnapshot.retrievalMode, 'explainable_memory');

  const result = await reader.retrieveKnowledge(reloadedSnapshot, {
    callerName: 'kb',
    targetCommand: 'kb',
    retrievalMode: 'explicit_kb_query',
    requestText: 'Alpha retrieval guidance',
    queryTokens: ['Alpha retrieval guidance'],
    domainHints: ['runtime'],
    desiredKuTypes: ['content'],
    byteBudget: 4096,
  });

  assert.equal(result.mode, 'explainable_memory');
  assert.ok(result.selected.some((entry) => entry.kuId === 'ku_session_note'));
});

test('request manager loads legacy vundefined variant files for persisted family state', async () => {
  const rootDir = await createTempRuntimeRoot();
  const requestManager = new RequestManager(rootDir);
  const familyDir = path.join(rootDir, 'data', 'sessions', 'session-legacy', 'requests', 'request-legacy', 'state', 'families', 'response');
  await mkdir(familyDir, { recursive: true });
  await writeFile(path.join(familyDir, 'family.meta.json'), `${JSON.stringify({ status: 'completed' }, null, 2)}\n`);
  await writeFile(path.join(familyDir, 'vundefined.value.txt'), 'legacy value\n');
  await writeFile(path.join(familyDir, 'vundefined.meta.json'), `${JSON.stringify({ origin: 'legacy-test' }, null, 2)}\n`);

  const families = await requestManager.loadFamilyState('session-legacy', 'request-legacy');
  assert.equal(families.length, 1);
  assert.equal(families[0].variants.length, 1);
  assert.equal(families[0].variants[0].value, 'legacy value');
});

test('runtime can switch KB retrieval back to naive symbolic mode', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, {
    deterministic: {},
    manualOverrides: {
      kbMode: 'naive_symbolic',
    },
  });

  const snapshot = await runtime.prepareKbSnapshot('session-naive');
  assert.equal(snapshot.retrievalMode, 'naive_symbolic');
  assert.equal(snapshot.explainableMemory, null);

  const result = await runtime.retrieveKnowledge(snapshot, {
    callerName: 'kb',
    retrievalMode: 'explicit_kb_query',
    requestText: 'planning initialization guidance',
    queryTokens: ['planning initialization guidance'],
    desiredKuTypes: ['prompt_asset', 'content'],
    byteBudget: 4096,
  });

  assert.equal(result.mode, 'naive_symbolic');
  assert.equal(result.selected[0].usage_reference, undefined);
});

test('runtime scans recent logs into proposed Explainable Memory aspects', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, {
    deterministic: {},
    manualOverrides: {
      forceFakeLlm: true,
    },
  });

  const outcome = await runtime.submitRequest({
    requestText: 'Need zebra pathway memory guidance and zebra escalation notes.',
  });
  assert.equal(outcome.stop_reason, 'completed');

  const scan = await runtime.scanExplainableMemoryAspects({
    maxSessions: 4,
    maxRequestsPerSession: 4,
    maxProposals: 4,
  });
  assert.ok(scan.generated_count >= 1);
  assert.ok(scan.proposals.some((aspect) => aspect.meta?.status === 'proposed'));

  const status = await runtime.inspectExplainableMemory(outcome.session_id);
  assert.ok((status.proposed_aspects || []).length >= 1);
  assert.ok((status.counts?.proposed_aspect_count || 0) >= 1);
});
