import { RuleProblem } from './solvers/rule-problem.mjs';
import { ConstraintProblem } from './solvers/constraint-problem.mjs';
import { GraphProblem } from './solvers/graph-problem.mjs';
import { SearchProblem } from './solvers/search-problem.mjs';
import { NumericProblem } from './solvers/numeric-problem.mjs';
import { ExecutionContext } from './execution-context.mjs';
import { PreflightAnalyzer, VERDICTS } from './preflight-analyzer.mjs';
import { QuestionGenerator } from './question-generator.mjs';

const SOLVER_CLASSES = {
  RuleProblem,
  ConstraintProblem,
  GraphProblem,
  SearchProblem,
  NumericProblem,
};

/**
 * SolverProgram – interprets an array of DSL steps inside an ExecutionContext.
 */
export class SolverProgram {
  constructor(steps) {
    this.steps = steps;
  }

  async run(ctx) {
    const solvers = new Map();
    for (let i = 0; i < this.steps.length; i += 1) {
      const step = this.steps[i];
      await this._executeStep(step, ctx, solvers);
    }
    return ctx._registers.final;
  }

  async _executeStep(step, ctx, solvers) {
    switch (step.op) {
      case 'set': {
        ctx.set(step.name, step.value);
        break;
      }
      case 'get': {
        // get as a step is a no-op unless storing into a variable
        if (step.into) {
          ctx.set(step.into, ctx.get(step.ref));
        }
        break;
      }
      case 'has': {
        if (step.into) {
          ctx.set(step.into, ctx.has(step.name));
        }
        break;
      }
      case 'append': {
        ctx.append(step.name, step.value);
        break;
      }
      case 'extend': {
        ctx.extend(step.name, step.value);
        break;
      }
      case 'project': {
        ctx.project(step.name, step.from, step.selector);
        break;
      }
      case 'filter': {
        ctx.filter(step.name, step.from, step.predicate);
        break;
      }
      case 'map': {
        ctx.map(step.name, step.from, step.mapper);
        break;
      }
      case 'unique': {
        ctx.unique(step.name, step.from);
        break;
      }
      case 'sort': {
        ctx.sort(step.name, step.from, step.key);
        break;
      }
      case 'count': {
        ctx.count(step.name, step.from);
        break;
      }
      case 'assert': {
        ctx.assert(step.expr, step.message);
        break;
      }
      case 'assume': {
        ctx.assume(step.label, step.value);
        break;
      }
      case 'storeResult': {
        const result = ctx.result(step.name);
        ctx.storeResult(step.name, result);
        break;
      }
      case 'setFinal': {
        ctx.setFinal(step.value);
        break;
      }
      case 'createSolver': {
        const Cls = SOLVER_CLASSES[step.className];
        if (!Cls) {
          throw new Error(`Unknown solver class: ${step.className}`);
        }
        solvers.set(step.varName, new Cls(step.options));
        break;
      }
      case 'solverCall': {
        const solver = solvers.get(step.varName);
        if (!solver) {
          throw new Error(`Solver ${step.varName} not created`);
        }
        const method = solver[step.method];
        if (typeof method !== 'function') {
          throw new Error(`Solver ${step.varName} has no method ${step.method}`);
        }
        const args = step.args ?? [];
        const result = method.apply(solver, args);
        // Some methods are chainable; store result only if the step requests it
        if (step.storeAs !== undefined) {
          ctx._registers.vars[step.storeAs] = result;
        }
        break;
      }
      case 'solverSolve': {
        const solver = solvers.get(step.varName);
        if (!solver) {
          throw new Error(`Solver ${step.varName} not created`);
        }
        const result = solver.solve();
        ctx.storeResult(step.resultName ?? step.varName, result);
        break;
      }
      case 'if': {
        const condition = ctx.get(step.condition);
        if (condition) {
          for (const s of step.then ?? []) {
            await this._executeStep(s, ctx, solvers);
          }
        } else if (step.else) {
          for (const s of step.else) {
            await this._executeStep(s, ctx, solvers);
          }
        }
        break;
      }
      case 'return': {
        ctx.setFinal(step.value);
        break;
      }
      default: {
        throw new Error(`Unsupported program step: ${step.op}`);
      }
    }
  }
}

/**
 * solveText – public API for the logic-eval symbolic solver.
 * @param {object} llmAdapter – object with async invoke(payload)
 * @param {string} text – natural language problem
 * @param {object} options – optional overrides
 * @returns {Promise<string>} final text answer
 */
export async function solveText(llmAdapter, text, options = {}) {
  // Phase 1: generate or receive program
  let programSteps;
  let genDiagnostics = [];

  if (options.programSteps) {
    programSteps = options.programSteps;
  } else {
    const generatorProfile = options.generatorProfile ?? 'logicGeneratorLLM';
    const genPayload = {
      profile: generatorProfile,
      instruction: text,
      expected_output_mode: 'json_value',
    };
    const genResult = await llmAdapter.invoke(genPayload);
    const raw = genResult.value ?? genResult;
    if (raw && typeof raw === 'object') {
      if (raw.status === 'QUESTIONS') {
        return {
          status: 'needs_clarification',
          questions: raw.questions ?? [],
          text: 'The problem needs clarification before it can be solved.',
        };
      }
      if (raw.status === 'FAIL') {
        return {
          status: 'failed',
          text: raw.reason ?? 'The problem could not be formalized.',
        };
      }
      if (Array.isArray(raw.steps)) {
        programSteps = raw.steps;
      } else if (Array.isArray(raw)) {
        programSteps = raw;
      } else {
        genDiagnostics.push('Generator returned unrecognized shape');
        programSteps = [];
      }
    } else {
      genDiagnostics.push('Generator returned non-object');
      programSteps = [];
    }
  }

  // Phase 2: preflight analysis
  const preflight = PreflightAnalyzer.analyze(programSteps);
  if (preflight.verdict === VERDICTS.INVALID_PROGRAM) {
    // Single local regeneration attempt if diagnostics available
    if (!options.programSteps && options.allowRegeneration !== false) {
      const regenPayload = {
        profile: options.generatorProfile ?? 'logicGeneratorLLM',
        instruction: `Repair this program. Problem: ${text}\nDiagnostic: ${preflight.reason}`,
        expected_output_mode: 'json_value',
      };
      const regenResult = await llmAdapter.invoke(regenPayload);
      const raw = regenResult.value ?? regenResult;
      if (raw && Array.isArray(raw.steps ?? raw)) {
        programSteps = raw.steps ?? raw;
        const secondPreflight = PreflightAnalyzer.analyze(programSteps);
        if (secondPreflight.verdict === VERDICTS.INVALID_PROGRAM) {
          return {
            status: 'invalid_program',
            text: `Program invalid after regeneration: ${secondPreflight.reason}`,
          };
        }
        if (secondPreflight.verdict !== VERDICTS.EXECUTE) {
          preflight.verdict = secondPreflight.verdict;
          preflight.missing = secondPreflight.missing;
          preflight.reason = secondPreflight.reason;
        } else {
          preflight.verdict = VERDICTS.EXECUTE;
        }
      } else {
        return {
          status: 'invalid_program',
          text: `Program invalid: ${preflight.reason}`,
        };
      }
    } else {
      return {
        status: 'invalid_program',
        text: `Program invalid: ${preflight.reason}`,
      };
    }
  }

  if (preflight.verdict === VERDICTS.NEEDS_CLARIFICATION) {
    const questions = QuestionGenerator.generate(preflight.missing ?? []);
    return {
      status: 'needs_clarification',
      questions,
      text: questions.map((q) => q.text).join('\n'),
    };
  }

  if (preflight.verdict === VERDICTS.UNSAT_EARLY) {
    return {
      status: 'unsat_early',
      text: `Contradiction detected: ${preflight.reason}`,
    };
  }

  if (preflight.verdict === VERDICTS.TOO_COMPLEX) {
    return {
      status: 'too_complex',
      text: `Problem exceeds configured limits: ${preflight.reason}`,
    };
  }

  // Phase 3: execution
  const ctx = new ExecutionContext({ problem: text });
  const program = new SolverProgram(programSteps);
  try {
    await program.run(ctx);
  } catch (execError) {
    return {
      status: 'failed',
      text: `Execution failed: ${execError.message}`,
    };
  }

  const finalResult = ctx._registers.final;

  // Phase 4: formatting
  if (options.formatResult) {
    const formatted = await options.formatResult(finalResult, ctx);
    return {
      status: finalResult?.status ?? 'solved',
      text: formatted,
      result: finalResult,
    };
  }

  const formatterProfile = options.formatterProfile ?? 'formatterLLM';
  const fmtPayload = {
    profile: formatterProfile,
    instruction: JSON.stringify({ problem: text, result: finalResult }),
    expected_output_mode: 'plain_value',
  };
  const fmtResult = await llmAdapter.invoke(fmtPayload);
  return {
    status: finalResult?.status ?? 'solved',
    text: fmtResult.value ?? String(fmtResult),
    result: finalResult,
  };
}
