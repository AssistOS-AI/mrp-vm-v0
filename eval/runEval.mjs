import process from 'node:process';
import path from 'node:path';
import { MRPVM, createRuntimeConfig, evaluateConfiguredRuntime, listAchillesModels } from '../src/index.mjs';
import { createTempRuntimeRoot } from '../tests/fixtures/runtime-root.mjs';
import { REASONING_DEMO_CASES, validateReasoningCaseOutput } from './reasoning-cases.mjs';

function formatDuration(durationMs) {
  const value = Number(durationMs);
  if (!Number.isFinite(value) || value < 0) {
    return 'n/a';
  }
  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }
  return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
}

function formatMessage(result) {
  if (result.response_equal) {
    return 'PASS';
  }
  return result.comparison_message || result.stop_reason || 'FAILED';
}

function summarizeFailure(event) {
  const failure = event.failure ?? {};
  return failure.message
    ?? event.error_message
    ?? `${event.failure_kind ?? 'execution_error'} from ${event.originating_component ?? failure.origin ?? 'unknown'}`;
}

function createEvalLogger(options = {}) {
  const verbose = options.verbose !== false;
  const activeSteps = new Map();
  const caseSeen = new Set();

  return {
    onCaseStart({ testCase, caseIndex, totalCases }) {
      console.log(`\n[${caseIndex + 1}/${totalCases}] ${testCase.id} - ${testCase.title}`);
      console.log(`  classes: ${(testCase.reasoning_classes ?? []).join(', ')}`);
    },
    onTraceEvent({ testCase, event }) {
      if (!verbose) {
        return;
      }
      if (event.event === 'request_started' && !caseSeen.has(testCase.id)) {
        caseSeen.add(testCase.id);
        const budgets = event.budgets ?? {};
        console.log(`  start: request=${event.request_id} steps=${budgets.steps_remaining ?? '?'} planning=${budgets.planning_remaining ?? '?'}`);
        return;
      }
      if (event.event === 'planning_triggered') {
        console.log(`  planning: ${event.mode ?? event.trigger_reason ?? 'started'}`);
        return;
      }
      if (event.event === 'planning_stopped') {
        const sopLength = String(event.planned_declarations ?? '').length;
        const declarationCount = (String(event.planned_declarations ?? '').match(/^@/gm) ?? []).length;
        console.log(`  planning done: sop=${sopLength} chars, decls=${declarationCount}`);
        return;
      }
      if (event.event === 'command_invoked' || event.event === 'interpreter_invoked') {
        const name = event.command_id ?? event.interpreter_id ?? 'unknown';
        activeSteps.set(event.declaration_id, {
          name,
          startedAt: Date.now(),
        });
        console.log(`  -> ${event.event === 'command_invoked' ? 'command' : 'interpreter'} ${name} for @${event.target_family}`);
        return;
      }
      if (event.event === 'variant_emitted' || event.event === 'declarations_inserted' || event.event === 'failure_recorded') {
        const active = activeSteps.get(event.declaration_id);
        const duration = event.execution_timing?.duration_ms ?? (active ? Date.now() - active.startedAt : null);
        if (event.event === 'variant_emitted') {
          console.log(`  <- ${active?.name ?? event.source_component ?? 'step'} emitted ${event.family_ids?.join(', ') || event.target_family} in ${formatDuration(duration)}`);
        } else if (event.event === 'declarations_inserted') {
          const inserted = Array.isArray(event.inserted_texts) ? event.inserted_texts.join('\n\n') : '';
          const decls = (inserted.match(/^@/gm) ?? []).length;
          console.log(`  <- ${active?.name ?? event.insertion_source ?? 'step'} inserted ${decls} decls in ${formatDuration(duration)}`);
        } else {
          console.log(`  !! ${active?.name ?? event.originating_component ?? 'step'} failed in ${formatDuration(duration)}: ${summarizeFailure(event)}`);
        }
        activeSteps.delete(event.declaration_id);
        return;
      }
      if (event.event === 'request_stopped') {
        console.log(`  stop: ${event.stop_reason}${event.error_message ? ` - ${event.error_message}` : ''}`);
      }
    },
    onCaseFinish({ result }) {
      console.log(`  summary: ${result.declaration_count} decls, ${result.sop_length} chars SOP, ${result.trace_events} invocations, ${formatDuration(result.duration_ms)}`);
    },
  };
}

async function main() {
  const baseDir = process.cwd();
  const verbose = !process.argv.includes('--quiet');
  const runtimeConfig = createRuntimeConfig({
    baseDir,
    env: process.env,
  });

  if (!runtimeConfig.dependencies?.achillesAgentLib) {
    throw new Error('AchillesAgentLib could not be resolved. Install it before running eval/runEval.mjs.');
  }

  const models = await listAchillesModels(runtimeConfig);
  const configuredModels = models.filter((entry) => !entry.apiKeyEnv || process.env[entry.apiKeyEnv]);
  if (!configuredModels.length) {
    throw new Error('No credential-backed Achilles models were discovered for eval/runEval.mjs.');
  }

  console.log(`Running ${REASONING_DEMO_CASES.length} shared reasoning cases with adapter ${runtimeConfig.llm.adapter}.`);
  console.log(`Progress logging: ${verbose ? 'verbose' : 'compact'}\n`);
  const logger = createEvalLogger({ verbose });

  const metrics = await evaluateConfiguredRuntime({
    onCaseStart: logger.onCaseStart,
    onTraceEvent: logger.onTraceEvent,
    onCaseFinish: logger.onCaseFinish,
    createRuntime: async () => {
      const rootDir = await createTempRuntimeRoot();
      const caseRuntimeConfig = createRuntimeConfig({
        baseDir,
        env: process.env,
        manualOverrides: {
          dataDir: path.join(rootDir, 'data'),
        },
      });
      return new MRPVM(rootDir, { runtimeConfig: caseRuntimeConfig });
    },
    createBaseline: async (testCase) => ({
      response: testCase.expected_summary,
    }),
    compareResponses: async ({ testCase, runtimeOutcome }) => {
      const responseText = String(runtimeOutcome.response ?? '');
      const validation = validateReasoningCaseOutput(testCase, responseText);
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
        steps_remaining: 40,
        planning_remaining: 6,
      },
    })),
  });

  console.log('');
  for (const result of metrics.results) {
    console.log(`${result.response_equal ? 'PASS' : 'FAIL'} ${result.id} (${result.stop_reason}) - ${formatMessage(result)}`);
  }
  console.log('');
  console.log(`Summary: ${metrics.matching_responses}/${metrics.total_cases} cases matched expected reasoning outputs.`);

  if (metrics.matching_responses !== metrics.total_cases) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
