import test from 'node:test';
import assert from 'node:assert/strict';
import { MRPVM } from '../../src/index.mjs';
import { loadDemoTasks } from '../../server/demo-catalog.mjs';
import { createTempRuntimeRoot } from '../fixtures/runtime-root.mjs';

const DEMO_TASKS = await loadDemoTasks(process.cwd());
const DEMO_TASK_MAP = Object.fromEntries(DEMO_TASKS.map((item) => [item.id, item]));

const SCENARIOS = {
  'migration-cutover': {
    scriptedSequences: {
      plannerLLM: [[
        '@dependency_order logic-eval',
        JSON.stringify({
          result_mode: 'structured',
          program_steps: [
            { op: 'createSolver', varName: 'g', className: 'GraphProblem', options: {} },
            { op: 'solverCall', varName: 'g', method: 'node', args: ['lower_dns_ttl'] },
            { op: 'solverCall', varName: 'g', method: 'node', args: ['warm_region_b_cache'] },
            { op: 'solverCall', varName: 'g', method: 'node', args: ['shift_canary'] },
            { op: 'solverCall', varName: 'g', method: 'node', args: ['verify_billing_drain'] },
            { op: 'solverCall', varName: 'g', method: 'node', args: ['shift_half_traffic'] },
            { op: 'solverCall', varName: 'g', method: 'node', args: ['shift_full_traffic'] },
            { op: 'solverCall', varName: 'g', method: 'node', args: ['publish_operator_update'] },
            { op: 'solverCall', varName: 'g', method: 'node', args: ['rollback_window_close'] },
            { op: 'solverCall', varName: 'g', method: 'edge', args: ['lower_dns_ttl', 'shift_canary'] },
            { op: 'solverCall', varName: 'g', method: 'edge', args: ['warm_region_b_cache', 'shift_canary'] },
            { op: 'solverCall', varName: 'g', method: 'edge', args: ['shift_canary', 'verify_billing_drain'] },
            { op: 'solverCall', varName: 'g', method: 'edge', args: ['shift_canary', 'shift_half_traffic'] },
            { op: 'solverCall', varName: 'g', method: 'edge', args: ['verify_billing_drain', 'shift_full_traffic'] },
            { op: 'solverCall', varName: 'g', method: 'edge', args: ['shift_half_traffic', 'shift_full_traffic'] },
            { op: 'solverCall', varName: 'g', method: 'edge', args: ['shift_canary', 'publish_operator_update'] },
            { op: 'solverCall', varName: 'g', method: 'edge', args: ['shift_full_traffic', 'rollback_window_close'] },
            { op: 'solverCall', varName: 'g', method: 'findTopologicalOrder', args: [] },
            { op: 'solverSolve', varName: 'g', resultName: 'order' },
            { op: 'setFinal', value: ['ref', 'results.order.solution.order'] },
          ],
        }),
        '',
        '@briefing writerLLM',
        'Using $dependency_order, produce sections Dependency order, Parallel checks, Rollback window, and Operator announcement for the cutover request.',
        '',
        '@response template-eval',
        '$briefing',
      ].join('\n')],
      writerLLM: [[
        'Dependency order:',
        '- lower_dns_ttl',
        '- warm_region_b_cache',
        '- shift_canary',
        '- verify_billing_drain',
        '- shift_half_traffic',
        '- publish_operator_update',
        '- shift_full_traffic',
        '- rollback_window_close',
        '',
        'Parallel checks:',
        '- verify_billing_drain and shift_half_traffic can proceed in parallel after shift_canary.',
        '- publish_operator_update can also start once shift_canary is complete.',
        '',
        'Rollback window:',
        '- Rollback remains available until rollback_window_close; do not close that window before shift_full_traffic completes.',
        '',
        'Operator announcement:',
        '- Canary shift is the gate. After it succeeds, parallel checks may proceed while rollback remains open until the final cutover close step.',
      ].join('\n')],
    },
    expected: [/Dependency order:/, /Parallel checks:/, /Rollback window:/, /Operator announcement:/],
    planMinDeclarations: 3,
  },
  'ops-budget': {
    scriptedSequences: {
      plannerLLM: [[
        '@line_items fastLLM',
        'Return the budget line items as strict JSON with name, amount, and kind fields.',
        '',
        '@totals js-eval',
        'const items = JSON.parse($line_items);',
        'const grossBudget = items.filter((item) => item.kind === "cost").reduce((sum, item) => sum + item.amount, 0);',
        'const savings = items.filter((item) => item.kind === "saving").reduce((sum, item) => sum + item.amount, 0);',
        'const netBudget = grossBudget - savings;',
        'return [',
        '  "Line items:" ,',
        '  ...items.map((item) => `- ${item.name}: ${item.amount}`),',
        '  `Gross budget: ${grossBudget}` ,',
        '  `Savings: ${savings}` ,',
        '  `Net budget: ${netBudget}` ,',
        '].join("\\n");',
        '',
        '@summary writerLLM',
        'Using $totals, produce a short recommendation and one operational risk if training is cut.',
        '',
        '@response template-eval',
        '$totals',
        '',
        'Recommendation:',
        '$summary',
        '',
        'Risk note:',
        '- Cutting training increases the chance of slower incident coordination and weaker game-day follow-through.',
      ].join('\n')],
      fastLLM: [JSON.stringify([
        { name: 'On-call uplift', amount: 6480, kind: 'cost' },
        { name: 'Observability licenses', amount: 3780, kind: 'cost' },
        { name: 'Game-day program', amount: 4800, kind: 'cost' },
        { name: 'Training fund', amount: 3600, kind: 'cost' },
        { name: 'Retired pager contract', amount: 2500, kind: 'saving' },
      ])],
      writerLLM: ['Fund the full plan. The net budget is manageable relative to the operational resilience gained, and the training line should stay intact because it reduces avoidable incident drag during escalation.'],
    },
    expected: [/Line items:/, /Gross budget: 18660/, /Net budget: 16160/, /Risk note:/],
    planMinDeclarations: 4,
  },
  'security-remediation': {
    scriptedSequences: {
      plannerLLM: [[
        '@owner_assignment logic-eval',
        JSON.stringify({
          result_mode: 'structured',
          program_steps: [
            { op: 'createSolver', varName: 'assignment', className: 'ConstraintProblem', options: { maxSolutions: 1 } },
            { op: 'solverCall', varName: 'assignment', method: 'domain', args: ['rate_limit_admin_endpoint', ['platform']] },
            { op: 'solverCall', varName: 'assignment', method: 'domain', args: ['export_actor_identity', ['platform', 'runtime']] },
            { op: 'solverCall', varName: 'assignment', method: 'domain', args: ['interpreter_owner_registry', ['runtime', 'security']] },
            { op: 'solverCall', varName: 'assignment', method: 'domain', args: ['export_policy_operator_guidance', ['runtime']] },
            { op: 'solverCall', varName: 'assignment', method: 'require', args: ['rate_limit_admin_endpoint', 'platform'] },
            { op: 'solverCall', varName: 'assignment', method: 'require', args: ['export_policy_operator_guidance', 'runtime'] },
            { op: 'solverCall', varName: 'assignment', method: 'implies', args: ['export_actor_identity', 'runtime', 'interpreter_owner_registry', 'security'] },
            { op: 'solverCall', varName: 'assignment', method: 'query', args: ['owner_assignment'] },
            { op: 'solverSolve', varName: 'assignment', resultName: 'owners' },
            { op: 'setFinal', value: ['ref', 'results.owners.solution'] },
          ],
        }),
        '',
        '@summary writerLLM',
        'Using $owner_assignment, produce sections Owner assignment, Quick wins, Parallel work, Release gate, and Leadership summary.',
        '',
        '@response template-eval',
        'Owner assignment:',
        '$summary',
      ].join('\n')],
      writerLLM: [[
        '- rate_limit_admin_endpoint -> platform',
        '- export_actor_identity -> runtime',
        '- interpreter_owner_registry -> security',
        '- export_policy_operator_guidance -> runtime',
        '',
        'Quick wins:',
        '- rate_limit_admin_endpoint',
        '- export_actor_identity',
        '',
        'Parallel work:',
        '- platform can close rate limiting while security documents interpreter ownership in parallel.',
        '',
        'Release gate:',
        '- Export traces must record actor identity and every production interpreter must have an owner.',
        '',
        'Leadership summary:',
        '- The assignment is valid and keeps the highest-risk findings moving first.',
      ].join('\n')],
    },
    expected: [/Owner assignment:/, /Quick wins:/, /Leadership summary:/],
    planMinDeclarations: 3,
  },
  'js-review-batcher': {
    scriptedSequences: {
      plannerLLM: [[
        '@requirements deepLLM',
        'Explain the allocation strategy and edge-case expectations.',
        '',
        '@javascript codeGeneratorLLM',
        'Generate the JavaScript utility allocateReviewBatches(items, reviewers, maxPerReviewer).',
        '',
        '@sample js-eval',
        'const items = ["parser", "trace-ui", "kb-browser", "settings-auth", "planner-fixes", "runtime-tests"];',
        'const reviewers = ["Ana", "Mihai", "Ioana"];',
        'const maxPerReviewer = 2;',
        'const batches = [];',
        'let index = 0;',
        'for (const reviewer of reviewers) {',
        '  const assigned = items.slice(index, index + maxPerReviewer);',
        '  batches.push(`${reviewer}: ${assigned.join(", ")}`);',
        '  index += maxPerReviewer;',
        '}',
        'const overflow = items.slice(index);',
        'return [`Sample output:`, ...batches.map((line) => `- ${line}`), `Overflow: ${overflow.length ? overflow.join(", ") : "none"}`].join("\\n");',
        '',
        '@response template-eval',
        'Strategy:',
        '$requirements',
        '',
        'JavaScript:',
        '$javascript',
        '',
        '$sample',
      ].join('\n')],
      deepLLM: ['Assign items in stable input order, cap each reviewer at maxPerReviewer, and surface overflow instead of hiding unassigned work. Edge case: if reviewers is empty, all work should remain overflow.'],
      codeGeneratorLLM: [[
        'function allocateReviewBatches(items, reviewers, maxPerReviewer) {',
        '  const batches = [];',
        '  let index = 0;',
        '  for (const reviewer of reviewers) {',
        '    const assigned = items.slice(index, index + maxPerReviewer);',
        '    batches.push({ reviewer, items: assigned });',
        '    index += maxPerReviewer;',
        '  }',
        '  return { batches, overflow: items.slice(index) };',
        '}',
      ].join('\n')],
    },
    expected: [/allocateReviewBatches/, /Sample output:/, /Ana: parser, trace-ui/, /Overflow: none/],
    planMinDeclarations: 4,
  },
  'water-jug-proof': {
    scriptedSequences: {
      plannerLLM: [[
        '@solution logic-eval',
        JSON.stringify({
          result_mode: 'structured',
          program_steps: [
            { op: 'createSolver', varName: 'g', className: 'GraphProblem', options: {} },
            { op: 'solverCall', varName: 'g', method: 'node', args: ['(8,0,0)'] },
            { op: 'solverCall', varName: 'g', method: 'node', args: ['(3,5,0)'] },
            { op: 'solverCall', varName: 'g', method: 'node', args: ['(3,2,3)'] },
            { op: 'solverCall', varName: 'g', method: 'node', args: ['(6,2,0)'] },
            { op: 'solverCall', varName: 'g', method: 'node', args: ['(6,0,2)'] },
            { op: 'solverCall', varName: 'g', method: 'node', args: ['(1,5,2)'] },
            { op: 'solverCall', varName: 'g', method: 'node', args: ['(1,4,3)'] },
            { op: 'solverCall', varName: 'g', method: 'node', args: ['(4,4,0)'] },
            { op: 'solverCall', varName: 'g', method: 'edge', args: ['(8,0,0)', '(3,5,0)'] },
            { op: 'solverCall', varName: 'g', method: 'edge', args: ['(3,5,0)', '(3,2,3)'] },
            { op: 'solverCall', varName: 'g', method: 'edge', args: ['(3,2,3)', '(6,2,0)'] },
            { op: 'solverCall', varName: 'g', method: 'edge', args: ['(6,2,0)', '(6,0,2)'] },
            { op: 'solverCall', varName: 'g', method: 'edge', args: ['(6,0,2)', '(1,5,2)'] },
            { op: 'solverCall', varName: 'g', method: 'edge', args: ['(1,5,2)', '(1,4,3)'] },
            { op: 'solverCall', varName: 'g', method: 'edge', args: ['(1,4,3)', '(4,4,0)'] },
            { op: 'solverCall', varName: 'g', method: 'findPath', args: ['(8,0,0)', '(4,4,0)'] },
            { op: 'solverSolve', varName: 'g', resultName: 'path' },
            { op: 'setFinal', value: ['ref', 'results.path.solution.path'] },
          ],
        }),
        '',
        '@explanation writerLLM',
        'Using $solution, provide sections Reachability, Minimal sequence, Minimality argument, and Generalization for the classic 8L-5L-3L puzzle.',
        '',
        '@response template-eval',
        '$explanation',
      ].join('\n')],
      writerLLM: [[
        'Reachability:',
        '- The goal is reachable.',
        '',
        'Minimal sequence:',
        '- (8,0,0)',
        '- (3,5,0)',
        '- (3,2,3)',
        '- (6,2,0)',
        '- (6,0,2)',
        '- (1,5,2)',
        '- (1,4,3)',
        '- (4,4,0)',
        '',
        'Minimality argument:',
        '- The graph path is already the first successful route from the initial state to a state containing exactly 4L.',
        '',
        'Generalization:',
        '- A target T is reachable when it matches the invariant induced by the container capacities and the available transfers.',
      ].join('\n')],
    },
    expected: [/Reachability:/, /\(8,0,0\)/, /\(4,4,0\)/, /Generalization:/],
    planMinDeclarations: 3,
  },
  'customer-escalation': {
    scriptedSequences: {
      plannerLLM: [[
        '@communication fastLLM',
        'Extract the customer-facing obligations, promised update window, and external message constraints.',
        '',
        '@cadence js-eval',
        'return [',
        '  "Parallel actions:" ,',
        '  "- Support sends the promised update" ,',
        '  "- Engineering validates the feature-flag hypothesis" ,',
        '  "- Operations confirms regional blast radius" ,',
        '  "60-minute cadence:" ,',
        '  "- 0-20 min: acknowledge impact and share active investigation" ,',
        '  "- 20-40 min: confirm feature-flag evidence and mitigation path" ,',
        '  "- 40-60 min: publish recovery or rollback decision" ,',
        '].join("\\n");',
        '',
        '@investigation writerLLM',
        'Using $communication and $cadence, produce the investigation track and a short external update.',
        '',
        '@response template-eval',
        'Communication track:',
        '$communication',
        '',
        'Investigation track:',
        '$investigation',
        '',
        '$cadence',
      ].join('\n')],
      fastLLM: [[
        '- Customer communication owner: support lead',
        '- Promised update deadline: 20 minutes',
        '- Status page is still green, so external wording must acknowledge investigation without overstating the blast radius',
        '- External update must mention eu-central order creation impact and active mitigation',
      ].join('\n')],
      writerLLM: [[
        '- Feature-flag validation — Owner: application engineer — inspect the latest eu-central flag changes and compare failing order paths.',
        '- Regional scope check — Owner: operations lead — confirm whether the issue is isolated to eu-central order creation.',
        '- External update: We are investigating order-creation failures affecting one enterprise customer in eu-central and will provide the next update within 20 minutes.',
      ].join('\n')],
    },
    expected: [/Communication track:/, /Investigation track:/, /Parallel actions:/, /60-minute cadence:/],
    planMinDeclarations: 4,
  },
};

async function runScenario(taskId) {
  const rootDir = await createTempRuntimeRoot();
  const scenario = SCENARIOS[taskId];
  const runtime = new MRPVM(rootDir, {
    deterministic: {},
    fakeAdapterConfig: {
      scriptedSequences: scenario.scriptedSequences,
    },
  });
  const outcome = await runtime.submitRequest({
    requestText: DEMO_TASK_MAP[taskId].prompt,
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

test('chat demo task catalog stays focused and complex', () => {
  assert.ok(DEMO_TASKS.length > 0, 'Expected at least one demo task.');
  assert.ok(DEMO_TASKS.length <= 6, 'Expected no more than six demo tasks.');
  for (const item of DEMO_TASKS) {
    assert.ok(item.title.length >= 12, `Expected a descriptive title for ${item.id}.`);
    assert.ok(item.prompt.length >= 300, `Expected a substantial prompt for ${item.id}.`);
    assert.match(item.prompt, /Requirements:|Cerințe:/, `Expected explicit requirements in ${item.id}.`);
    assert.match(item.prompt, /Output sections:|Formatul răspunsului:/, `Expected explicit output formatting in ${item.id}.`);
  }
});

for (const task of DEMO_TASKS) {
  test(`demo task "${task.id}" executes as a multi-step showcase`, async () => {
    const scenario = SCENARIOS[task.id];
    assert.ok(scenario, `Missing scripted scenario for ${task.id}.`);
    const { outcome, inspection } = await runScenario(task.id);

    assert.equal(outcome.stop_reason, 'completed');
    const responseText = String(outcome.response ?? '');
    for (const pattern of scenario.expected) {
      assert.match(responseText, pattern);
    }

    const declarationCount = (inspection.plan_snapshot.match(/^@/gm) ?? []).length;
    assert.ok(
      declarationCount >= scenario.planMinDeclarations,
      `Expected at least ${scenario.planMinDeclarations} declarations for ${task.id}, got ${declarationCount}.`,
    );

    assert.ok(
      /template-eval/.test(inspection.plan_snapshot),
      `Expected ${task.id} to end through template-eval assembly.`,
    );
  });
}
