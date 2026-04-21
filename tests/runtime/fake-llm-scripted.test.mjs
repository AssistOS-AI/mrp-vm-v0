import test from 'node:test';
import assert from 'node:assert/strict';
import { MRPVM } from '../../src/index.mjs';
import { createTempRuntimeRoot } from '../fixtures/runtime-root.mjs';

test('fake LLM adapter can be scripted for multi-step planning', async () => {
  const rootDir = await createTempRuntimeRoot();
  const request = [
    'Ai trei recipiente cu capacități de 8L, 5L și 3L.',
    'Recipientul de 8L este plin cu apă, celelalte două sunt goale.',
    'Obiectiv: obține exact 4L de apă într-unul dintre recipiente.',
    'Cerințe: secvență de pași, stări după fiecare pas, concluzie.',
  ].join('\n');

  const scriptedPlan = [
    '@solution deepLLM',
    'Rezolvă problema pas cu pas și returnează răspunsul în formatul cerut.',
    '',
    '@response template-eval',
    '$solution',
  ].join('\n');

  const scriptedSolution = [
    'Secvență de pași:',
    '1. (8,0,0) → (3,5,0)',
    '2. (3,5,0) → (3,2,3)',
    '3. (3,2,3) → (6,2,0)',
    '4. (6,2,0) → (6,0,2)',
    '5. (6,0,2) → (1,5,2)',
    '6. (1,5,2) → (1,4,3)',
    '7. (1,4,3) → (4,4,0)',
    '',
    'Concluzie finală: 4L se află în recipientul de 8L și 5L.',
  ].join('\n');

  const runtime = new MRPVM(rootDir, {
    deterministic: {},
    fakeAdapterConfig: {
      scriptedSequences: {
        plannerLLM: [scriptedPlan],
        deepLLM: [scriptedSolution],
      },
    },
  });

  const outcome = await runtime.submitRequest({ requestText: request });
  assert.equal(outcome.stop_reason, 'completed');
  assert.match(String(outcome.response), /Secvență de pași/);
  assert.match(String(outcome.response), /4L/);

  const inspection = await runtime.inspectRequestPublic(outcome.request_id);
  assert.match(inspection.plan_snapshot, /@solution deepLLM/);
  assert.match(inspection.plan_snapshot, /@response template-eval/);
});

test('planning reroutes invalid prose logic-eval steps to an LLM interpreter', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, {
    deterministic: {},
    fakeAdapterConfig: {
      scriptedSequences: {
        plannerLLM: [[
          '@analysis deepLLM',
          'Explain the user problem precisely using the original request and constraints.',
          '',
          '@validation logic-eval',
          'Validate the answer in prose using $analysis and explain why it is correct.',
          '',
          '@response template-eval',
          '$validation',
        ].join('\n')],
        deepLLM: ['Problem analysis'],
        writerLLM: ['Validated final answer'],
      },
    },
  });

  const outcome = await runtime.submitRequest({
    requestText: 'Solve the water jug problem with capacities 8L, 5L, and 3L.',
  });

  assert.equal(outcome.stop_reason, 'completed');
  assert.equal(String(outcome.response), 'Validated final answer');

  const inspection = await runtime.inspectRequestPublic(outcome.request_id);
  assert.match(inspection.plan_snapshot, /@validation writerLLM/);
  assert.doesNotMatch(inspection.plan_snapshot, /@validation logic-eval/);
});

test('planning reroutes invalid prose js-eval steps to a reasoning interpreter', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, {
    deterministic: {},
    fakeAdapterConfig: {
      scriptedSequences: {
        plannerLLM: [[
          '@parsed fastLLM',
          'Extract the core facts from the request.',
          '',
          '@solver js-eval',
          'Compute the exact answer from $parsed and explain the steps in prose.',
          '',
          '@response template-eval',
          '$solver',
        ].join('\n')],
        fastLLM: ['Parsed request'],
        deepLLM: ['Exact step-by-step answer'],
      },
    },
  });

  const outcome = await runtime.submitRequest({
    requestText: 'Solve the water jug problem with capacities 8L, 5L, and 3L.',
  });

  assert.equal(outcome.stop_reason, 'completed');
  assert.equal(String(outcome.response), 'Exact step-by-step answer');

  const inspection = await runtime.inspectRequestPublic(outcome.request_id);
  assert.match(inspection.plan_snapshot, /@solver deepLLM/);
  assert.doesNotMatch(inspection.plan_snapshot, /@solver js-eval/);
});
