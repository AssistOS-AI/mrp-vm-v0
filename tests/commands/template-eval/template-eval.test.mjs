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
    body: 'Title: {{report.title}}\nItems: {{join report.items ", "}}',
  });

  assert.match(effects.emittedVariants[0].value, /Title: Hello/);
  assert.match(effects.emittedVariants[0].value, /Items: a, b/);
});
