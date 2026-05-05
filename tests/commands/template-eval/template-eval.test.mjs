import test from 'node:test';
import assert from 'node:assert/strict';
import { MRPVM } from '../../../src/index.mjs';
import { executeTemplateEval } from '../../../src/commands/template-eval.mjs';
import { createTempRuntimeRoot } from '../../fixtures/runtime-root.mjs';

test('template-eval renders deterministic placeholders and helpers', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, { deterministic: {} });
  runtime.stateStore.emitVariant('report', { title: 'Hello', items: ['a', 'b'] }, { created_epoch: 0 });

  const effects = await executeTemplateEval({
    runtime,
    targetFamily: 'response',
    body: 'Title: $report.title\nItems: {{join report.items ", "}}',
  });

  assert.match(effects.emittedVariants[0].value, /Title: Hello/);
  assert.match(effects.emittedVariants[0].value, /Items: a, b/);
});

test('template-eval can render resolved dependencies and unwrap template_body blocks', async () => {
  const effects = await executeTemplateEval({
    runtime: {
      createTemplateContext() {
        return {};
      },
    },
    resolvedDependencies: new Map([
      ['$room_assignment', {
        familyId: 'room_assignment',
        value: 'Erin -> RoomA',
      }],
      ['$vault_reachability', {
        familyId: 'vault_reachability',
        value: 'Only Erin can inspect the vault',
      }],
    ]),
    targetFamily: 'response',
    body: [
      'template_body: |',
      '  Assignments: $room_assignment',
      '  Reachability: $vault_reachability',
    ].join('\n'),
  });

  assert.equal(
    effects.emittedVariants[0].value,
    'Assignments: Erin -> RoomA\nReachability: Only Erin can inspect the vault',
  );
});

test('template-eval ignores sentence punctuation after a placeholder', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, { deterministic: {} });
  runtime.stateStore.emitVariant('reasoning_input', 'Bounded answer', { created_epoch: 0 });

  const effects = await executeTemplateEval({
    runtime,
    targetFamily: 'response',
    body: 'The result is $reasoning_input.',
  });

  assert.equal(effects.emittedVariants[0].value, 'The result is Bounded answer.');
});
