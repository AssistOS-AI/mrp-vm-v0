import test from 'node:test';
import assert from 'node:assert/strict';
import { MRPVM } from '../../../src/index.mjs';
import { executeJsEval } from '../../../src/commands/js-eval.mjs';
import { createTempRuntimeRoot } from '../../fixtures/runtime-root.mjs';

test('js-eval resolves $ references and emits return value', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, { deterministic: {} });
  runtime.stateStore.emitVariant('input', 'hello world', { created_epoch: 0 });

  const effects = await executeJsEval({
    runtime,
    targetFamily: 'response',
    body: 'return $input.toUpperCase();',
    node: {
      dependencies: [{ kind: '$', familyId: 'input', variantId: null, raw: '$input' }],
    },
    sessionId: 's1',
    requestId: 'r1',
    epochNumber: 1,
  });

  assert.equal(effects.emittedVariants[0].value, 'HELLO WORLD');
});

test('js-eval ~ref property writes emit fresh variants', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, { deterministic: {} });
  runtime.stateStore.emitVariant('draft', { title: 'old' }, { created_epoch: 0 });

  const effects = await executeJsEval({
    runtime,
    targetFamily: 'draft',
    body: '~draft.title = "new";',
    node: {
      dependencies: [{ kind: '~', familyId: 'draft', variantId: null, raw: '~draft' }],
    },
    sessionId: 's1',
    requestId: 'r1',
    epochNumber: 1,
  });

  assert.equal(effects.emittedVariants[0].value.title, 'new');
});
