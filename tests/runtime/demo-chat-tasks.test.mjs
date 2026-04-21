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
        '@tracks fastLLM',
        'Extract the cutover workstreams, parallel checks, and constraints into compact structured text.',
        '',
        '@timeline writerLLM',
        'Using $tracks, produce a clear pre-cutover, cutover, and post-cutover timeline plus an operator announcement.',
        '',
        '@response template-eval',
        'Workstreams:',
        '$tracks',
        '',
        'Timeline:',
        '$timeline',
        '',
        'Operator announcement:',
        'Use the execution timeline above to coordinate the migration window and keep rollback available for the first 45 minutes.',
      ].join('\n')],
      fastLLM: [[
        'Workstreams:',
        '- Traffic and connectivity — Owner: networking lead',
        '- Application readiness — Owner: platform lead',
        '- Customer communications — Owner: support lead',
        '- Billing verification — Owner: analytics lead',
        '',
        'Parallel checks:',
        '- Lower DNS TTL before the window',
        '- Warm caches in Region B',
        '- Validate billing lag after initial traffic shift',
        '- Prepare rollback switch for the first 45 minutes',
      ].join('\n')],
      writerLLM: [[
        'Pre-cutover:',
        '- Confirm TTL reduction, cache warm-up, and rollback command ownership.',
        'Cutover:',
        '- Shift traffic gradually, validate health checks, and keep rollback callable for 45 minutes.',
        'Post-cutover:',
        '- Confirm billing health, customer traffic stability, and support updates.',
        '',
        'Operator announcement:',
        '- Migration window has started; traffic will shift progressively while rollback remains immediately available for the first 45 minutes.',
      ].join('\n')],
    },
    expected: [/Workstreams:/, /Parallel checks:/, /Timeline:/, /Operator announcement:/],
    planMinDeclarations: 4,
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
        '@findings fastLLM',
        'Return the audit findings as strict JSON grouped by likely implementation area.',
        '',
        '@plan_shape js-eval',
        'const data = JSON.parse($findings);',
        'return [',
        '  `Track count: ${data.tracks.length}` ,',
        '  `Quick wins: ${data.tracks.filter((track) => track.quickWin).map((track) => track.name).join(", ")}` ,',
        '  "Parallel work:" ,',
        '  ...data.parallel.map((item) => `- ${item}`),',
        '  "Release gate: actor identity must be present in export traces and unowned interpreters must be assigned." ,',
        '].join("\\n");',
        '',
        '@summary writerLLM',
        'Using $findings and $plan_shape, produce implementation tracks, quick wins, and a short leadership summary.',
        '',
        '@response template-eval',
        'Tracks:',
        '$summary',
        '',
        '$plan_shape',
      ].join('\n')],
      fastLLM: [JSON.stringify({
        tracks: [
          { name: 'Access hardening', quickWin: true, findings: ['admin endpoint rate limiting'] },
          { name: 'Trace auditability', quickWin: true, findings: ['actor identity missing from export logs'] },
          { name: 'Interpreter ownership', quickWin: false, findings: ['unowned production interpreters'] },
          { name: 'Policy guidance', quickWin: false, findings: ['default export KU too vague'] },
        ],
        parallel: [
          'rate limiting implementation',
          'actor identity logging fix',
          'interpreter ownership inventory',
        ],
      })],
      writerLLM: ['Quick wins: Access hardening and Trace auditability should land first because they close immediate exposure and make exports auditable. Deeper fixes are Interpreter ownership and Policy guidance. Leadership summary: the program can start in parallel, but release closure should wait for owner assignment and trace actor coverage.'],
    },
    expected: [/Tracks:/, /Quick wins:/, /Parallel work:/, /Release gate:/],
    planMinDeclarations: 4,
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
        '@problem fastLLM',
        'Extract the capacities and target into JSON.',
        '',
        '@number_theory js-eval',
        'const data = JSON.parse($problem);',
        'const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);',
        'return `gcd = ${gcd(gcd(data.a, data.b), data.c)}, reachable = ${data.target <= data.a + data.b + data.c}, target = ${data.target}`;',
        '',
        '@solution deepLLM',
        'Using $problem and $number_theory, provide the minimal steps, correctness argument, and generalization.',
        '',
        '@response template-eval',
        'Solvability summary: $number_theory',
        '',
        '$solution',
      ].join('\n')],
      fastLLM: [JSON.stringify({ a: 8, b: 5, c: 3, target: 4 })],
      deepLLM: [[
        'Secvență de pași:',
        '1. (8,0,0) → (3,5,0)',
        '2. (3,5,0) → (3,2,3)',
        '3. (3,2,3) → (6,2,0)',
        '4. (6,2,0) → (6,0,2)',
        '5. (6,0,2) → (1,5,2)',
        '6. (1,5,2) → (1,4,3)',
        '7. (1,4,3) → (4,4,0)',
        '',
        'Justificare: stările sunt atinse prin turnări complete, iar 4L apare fără a încălca regulile.',
        'Generalizare: problema este rezolvabilă când ținta T este compatibilă cu invariantul dat de gcd(a,b,c) și cu volumul total disponibil.',
      ].join('\n')],
    },
    expected: [/gcd = 1/, /\(8,0,0\)/, /\(4,4,0\)/, /Generalizare:/],
    planMinDeclarations: 4,
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
