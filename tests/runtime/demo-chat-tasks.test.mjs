import test from 'node:test';
import assert from 'node:assert/strict';
import { MRPVM } from '../../src/index.mjs';
import { REASONING_DEMO_CASES, listChatDemoTasks, validateReasoningCaseOutput } from '../../eval/reasoning-cases.mjs';
import { loadDemoTasks } from '../../server/demo-catalog.mjs';
import { createTempRuntimeRoot } from '../fixtures/runtime-root.mjs';

const DEMO_TASKS = await loadDemoTasks(process.cwd());
const SHARED_TASKS = listChatDemoTasks();
const CASE_MAP = new Map(REASONING_DEMO_CASES.map((entry) => [entry.id, entry]));

async function runScenario(caseDef) {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, {
    deterministic: {},
    fakeAdapterConfig: {
      scriptedSequences: caseDef.fakeScenario.scriptedSequences,
    },
  });
  const outcome = await runtime.submitRequest({
    requestText: caseDef.prompt,
    budgets: {
      steps_remaining: 32,
      planning_remaining: 5,
    },
  });
  const inspection = await runtime.inspectRequestPublic(outcome.request_id);
  return {
    outcome,
    inspection,
  };
}

test('chat demo task catalog exposes all shared demo classes', () => {
  assert.deepEqual(DEMO_TASKS, SHARED_TASKS);
  assert.ok(DEMO_TASKS.length >= 23, 'Expected at least 23 shared demo cases.');
  const catalogClasses = new Set(DEMO_TASKS.flatMap((item) => item.reasoning_classes ?? []));
  for (const label of [
    'rule',
    'constraint',
    'graph',
    'search',
    'numeric',
    'mixed',
    'abductive',
    'belief_revision',
    'probabilistic',
    'causal',
    'argumentation',
    'legal',
    'ethical',
    'scientific',
    'analogical',
    'creative',
    'optimization',
    'formal_proof_routing',
    'smt',
    'pragmatic',
    'document_planning',
  ]) {
    assert.ok(catalogClasses.has(label), `Expected demo coverage for ${label}.`);
  }
  for (const item of DEMO_TASKS) {
    assert.ok(item.title.length >= 12, `Expected a descriptive title for ${item.id}.`);
    assert.ok(item.summary.length >= 20, `Expected a meaningful summary for ${item.id}.`);
    assert.ok(item.prompt.length >= 300, `Expected a substantial prompt for ${item.id}.`);
    assert.ok(Array.isArray(item.reasoning_classes) && item.reasoning_classes.length > 0, `Expected reasoning classes for ${item.id}.`);
    assert.match(item.prompt, /Requirements:/, `Expected explicit requirements in ${item.id}.`);
    assert.match(item.prompt, /Output sections:/, `Expected explicit output formatting in ${item.id}.`);
  }
});

for (const task of DEMO_TASKS) {
  test(`demo task "${task.id}" executes as a multi-step showcase`, async () => {
    const caseDef = CASE_MAP.get(task.id);
    assert.ok(caseDef, `Missing shared case for ${task.id}.`);
    const { outcome, inspection } = await runScenario(caseDef);

    assert.equal(outcome.stop_reason, 'completed');
    const responseText = String(outcome.response ?? '');
    const validation = validateReasoningCaseOutput(caseDef, responseText);
    assert.equal(validation.ok, true, `Expected ${task.id} to satisfy shared validation: ${validation.failures.join(' ')}`);

    const declarationCount = (inspection.plan_snapshot.match(/^@/gm) ?? []).length;
    assert.ok(
      declarationCount >= caseDef.fakeScenario.planMinDeclarations,
      `Expected at least ${caseDef.fakeScenario.planMinDeclarations} declarations for ${task.id}, got ${declarationCount}.`,
    );

    assert.ok(
      /template-eval/.test(inspection.plan_snapshot),
      `Expected ${task.id} to end through template-eval assembly.`,
    );
  });
}
