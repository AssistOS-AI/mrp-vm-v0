import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
