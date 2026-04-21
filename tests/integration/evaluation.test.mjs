import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateConfiguredRuntime, MRPVM } from '../../src/index.mjs';
import { createTempRuntimeRoot } from '../fixtures/runtime-root.mjs';

test('evaluation harness compares configured runtime instances against a baseline', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/request-basic.json', import.meta.url), 'utf8'));
  const rootDir = await createTempRuntimeRoot();

  const metrics = await evaluateConfiguredRuntime({
    createRuntime: async () => new MRPVM(rootDir, {
      deterministic: {},
      manualOverrides: {
        forceFakeLlm: true,
      },
    }),
    createBaseline: async (testCase) => ({
      response: `${testCase.expected_response_prefix}${testCase.request}`,
    }),
    cases: [fixture],
  });

  assert.equal(metrics.total_cases, 1);
  assert.equal(metrics.matching_responses, 1);
  assert.equal(metrics.results[0].stop_reason, 'completed');
});
