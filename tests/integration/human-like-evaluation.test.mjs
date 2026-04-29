import test from 'node:test';
import assert from 'node:assert/strict';
import { REASONING_DEMO_CASES, validateReasoningCaseOutput } from '../../eval/reasoning-cases.mjs';
import { evaluateConfiguredRuntime, MRPVM } from '../../src/index.mjs';
import { createTempRuntimeRoot } from '../fixtures/runtime-root.mjs';

test('evaluation harness covers the shared chat reasoning cases', async () => {
  const metrics = await evaluateConfiguredRuntime({
    createRuntime: async (testCase) => {
      const rootDir = await createTempRuntimeRoot();
      return new MRPVM(rootDir, {
        deterministic: {},
        fakeAdapterConfig: {
          scriptedSequences: testCase.fakeScenario.scriptedSequences,
        },
      });
    },
    createBaseline: async (testCase) => ({
      response: testCase.expected_summary,
    }),
    compareResponses: async ({ testCase, runtimeOutcome }) => {
      const validation = validateReasoningCaseOutput(testCase, String(runtimeOutcome.response ?? ''));
      return {
        equal: runtimeOutcome.stop_reason === 'completed' && validation.ok,
        message: runtimeOutcome.stop_reason !== 'completed'
          ? `stop_reason=${runtimeOutcome.stop_reason}`
          : validation.failures.join(' '),
      };
    },
    cases: REASONING_DEMO_CASES.map((entry) => ({
      ...entry,
      request: entry.prompt,
      session_id: `eval-${entry.id}`,
      budgets: {
        steps_remaining: 24,
        planning_remaining: 4,
      },
    })),
  });

  assert.equal(metrics.total_cases, REASONING_DEMO_CASES.length);
  assert.equal(metrics.matching_responses, REASONING_DEMO_CASES.length);
  for (const result of metrics.results) {
    assert.equal(result.response_equal, true, `Expected shared evaluation match for ${result.id}: ${result.comparison_message ?? 'no details'}.`);
    assert.equal(result.stop_reason, 'completed');
  }
});
