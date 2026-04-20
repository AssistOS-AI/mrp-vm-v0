import test from 'node:test';
import assert from 'node:assert/strict';
import { MRPVM } from '../../../src/index.mjs';
import { executeCredibilityCommand } from '../../../src/commands/credibility.mjs';
import { createTempRuntimeRoot } from '../../fixtures/runtime-root.mjs';

test('credibility scores candidates and withdraws non-winners', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, { deterministic: {} });
  runtime.stateStore.emitVariant('answer', 'short', { created_epoch: 1 });
  runtime.stateStore.emitVariant('answer', 'this one is much more informative', { created_epoch: 1 });

  const effects = await executeCredibilityCommand({
    runtime,
    targetFamily: 'answer',
    body: 'Compare candidates',
  });

  assert.ok(effects.metadataUpdates.some((entry) => entry.patch.score_pct));
  assert.ok(effects.metadataUpdates.some((entry) => entry.patch.status === 'withdrawn'));
});
