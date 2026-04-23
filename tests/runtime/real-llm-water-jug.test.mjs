import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { MRPVM, createRuntimeConfig, listAchillesModels } from '../../src/index.mjs';
import { loadDemoTasks } from '../../server/demo-catalog.mjs';
import { createTempRuntimeRoot } from '../fixtures/runtime-root.mjs';

test('real LLM solves the water jug problem', async (t) => {
  const rootDir = await createTempRuntimeRoot();
  let runtimeConfig = null;
  try {
    runtimeConfig = createRuntimeConfig({
      baseDir: process.cwd(),
      env: process.env,
      manualOverrides: {
        dataDir: path.join(rootDir, 'data'),
      },
    });
  } catch (error) {
    t.skip(`AchillesAgentLib not configured: ${error.message}`);
    return;
  }

  if (!runtimeConfig.dependencies?.achillesAgentLib) {
    t.skip('AchillesAgentLib not configured.');
    return;
  }

  const models = await listAchillesModels(runtimeConfig);
  const configuredModels = models.filter((entry) => !entry.apiKeyEnv || process.env[entry.apiKeyEnv]);
  if (!configuredModels.length) {
    t.skip('AchillesAgentLib was resolved, but no credential-backed models were discovered.');
    return;
  }

  const runtime = new MRPVM(rootDir, { runtimeConfig });
  const request = (await loadDemoTasks(process.cwd())).find((item) => item.id === 'water-jug-proof')?.prompt;
  assert.ok(request, 'Expected shared water-jug demo fixture.');

  const outcome = await runtime.submitRequest({
    requestText: request,
    budgets: {
      steps_remaining: 40,
      planning_remaining: 6,
    },
  });

  const inspection = await runtime.inspectRequestPublic(outcome.request_id);
  const responseText = String(outcome.response ?? '');
  const familyTexts = (inspection.family_state ?? []).flatMap((family) => (
    family.variants ?? []
  )).map((variant) => String(variant.value ?? variant.rendered ?? ''));
  const searchableText = [responseText, ...familyTexts].join('\n');
  assert.ok(searchableText.trim(), 'Expected the real LLM flow to emit either a final response or intermediate family outputs.');
  const states = searchableText.match(/\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/g) ?? [];
  assert.ok(states.length >= 2, 'Expected at least two state transitions in the emitted outputs.');
  assert.match(searchableText, /4\s*(L|litri)/i);
  const declarationCount = (inspection.plan_snapshot.match(/^@/gm) ?? []).length;
  assert.ok(declarationCount >= 2, 'Expected a multi-step SOP plan.');

  const tracePath = path.join(rootDir, 'data', 'sessions', outcome.session_id, 'trace', 'session.jsonl');
  const traceContent = await readFile(tracePath, 'utf8');
  console.log('\n--- TRACE START ---\n');
  console.log(traceContent.trim());
  console.log('\n--- TRACE END ---\n');
});
