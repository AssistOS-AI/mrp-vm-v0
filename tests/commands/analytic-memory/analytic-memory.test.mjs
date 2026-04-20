import test from 'node:test';
import assert from 'node:assert/strict';
import { MRPVM } from '../../../src/index.mjs';
import { executeAnalyticMemory } from '../../../src/commands/analytic-memory.mjs';
import { createTempRuntimeRoot } from '../../fixtures/runtime-root.mjs';

test('analytic-memory stores, derives, and exports aggregates', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, { deterministic: {} });

  const effects = await executeAnalyticMemory({
    runtime,
    targetFamily: 'analytics',
    body: [
      'store 3 under chapter.1.risk',
      'store 5 under chapter.2.risk',
      'derive book.risk = average(chapter.*.risk)',
      'export book.risk as response',
    ].join('\n'),
    sessionId: 's1',
    requestId: 'r1',
    epochNumber: 1,
  });

  assert.equal(runtime.analyticStore.getValue('book.risk'), 4);
  assert.equal(effects.emittedVariants[0].familyId, 'response');
  assert.equal(effects.emittedVariants[0].value, 4);
});
