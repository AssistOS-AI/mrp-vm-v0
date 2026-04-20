import test from 'node:test';
import assert from 'node:assert/strict';
import { MRPVM } from '../../../src/index.mjs';
import { executeLogicEval } from '../../../src/commands/logic-eval.mjs';
import { createTempRuntimeRoot } from '../../fixtures/runtime-root.mjs';

test('logic-eval runs line-oriented rules and emits set actions', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, { deterministic: {} });
  runtime.stateStore.emitVariant('input', 'ok', { created_epoch: 0 });

  const effects = await executeLogicEval({
    runtime,
    targetFamily: 'response',
    body: [
      'when exists input',
      'then set ~response = "accepted" with {"origin":"logic-eval"}',
    ].join('\n'),
  });

  assert.equal(effects.emittedVariants[0].familyId, 'response');
  assert.equal(effects.emittedVariants[0].value, 'accepted');
});
