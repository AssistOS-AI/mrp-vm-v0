/**
 * PreflightAnalyzer – validates a SolverProgram before execution.
 * Returns one of: EXECUTE, NEEDS_CLARIFICATION, UNSAT_EARLY, INVALID_PROGRAM, TOO_COMPLEX.
 */

import { ObligationRegistry } from './obligation-registry.mjs';

const VERDICTS = {
  EXECUTE: 'EXECUTE',
  NEEDS_CLARIFICATION: 'NEEDS_CLARIFICATION',
  UNSAT_EARLY: 'UNSAT_EARLY',
  INVALID_PROGRAM: 'INVALID_PROGRAM',
  TOO_COMPLEX: 'TOO_COMPLEX',
};

const ALLOWED_OPS = new Set([
  'set', 'get', 'has', 'append', 'extend',
  'project', 'filter', 'map', 'unique', 'sort', 'count',
  'assert', 'assume', 'storeResult', 'result', 'setFinal',
  'createSolver', 'solverCall', 'solverSolve', 'if', 'return',
]);

const ALLOWED_SOLVER_CLASSES = new Set([
  'RuleProblem', 'ConstraintProblem', 'GraphProblem', 'SearchProblem', 'NumericProblem',
]);

export class PreflightAnalyzer {
  static analyze(steps) {
    if (!Array.isArray(steps)) {
      return { verdict: VERDICTS.INVALID_PROGRAM, reason: 'Program steps must be an array', diagnostics: [] };
    }

    const diagnostics = [];
    const solverInstances = new Map(); // varName -> { className, config, calls: [] }
    const variables = new Set();
    let hasFinal = false;
    let complexityScore = 0;

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      if (!step || typeof step !== 'object') {
        diagnostics.push(`Step ${i} is not an object`);
        continue;
      }
      if (!ALLOWED_OPS.has(step.op)) {
        diagnostics.push(`Step ${i}: unsupported op "${step.op}"`);
        continue;
      }

      switch (step.op) {
        case 'createSolver': {
          if (!ALLOWED_SOLVER_CLASSES.has(step.className)) {
            diagnostics.push(`Step ${i}: unknown solver class "${step.className}"`);
          } else {
            solverInstances.set(step.varName, {
              className: step.className,
              config: step.options ?? {},
              calls: [],
            });
            complexityScore += 10;
          }
          break;
        }
        case 'solverCall': {
          const inst = solverInstances.get(step.varName);
          if (!inst) {
            diagnostics.push(`Step ${i}: solver "${step.varName}" not declared`);
          } else {
            inst.calls.push({ method: step.method, args: step.args ?? [] });
          }
          break;
        }
        case 'set':
        case 'storeResult': {
          variables.add(step.name);
          break;
        }
        case 'setFinal': {
          hasFinal = true;
          break;
        }
        case 'if': {
          // Recursively check nested steps
          const thenCheck = this._analyzeBlock(step.then ?? [], variables, solverInstances);
          const elseCheck = this._analyzeBlock(step.else ?? [], variables, solverInstances);
          diagnostics.push(...thenCheck.diagnostics, ...elseCheck.diagnostics);
          complexityScore += thenCheck.complexity + elseCheck.complexity;
          break;
        }
        default:
          break;
      }
    }

    if (diagnostics.length > 0) {
      return { verdict: VERDICTS.INVALID_PROGRAM, reason: diagnostics.join('; '), diagnostics };
    }

    if (!hasFinal) {
      diagnostics.push('Program does not call setFinal');
      return { verdict: VERDICTS.INVALID_PROGRAM, reason: 'Missing setFinal', diagnostics };
    }

    // Check solver obligations
    const allMissing = [];
    for (const [varName, inst] of solverInstances) {
      const check = ObligationRegistry.checkObligations(inst.className, inst.config, inst.calls);
      if (!check.valid) {
        allMissing.push(...check.missing);
      }
      // Rough complexity estimation based on config values
      if (inst.config.maxIterations !== undefined && inst.config.maxIterations > 1000) {
        complexityScore += inst.config.maxIterations / 100;
      }
      if (inst.config.maxBacktrackingNodes !== undefined && inst.config.maxBacktrackingNodes > 10000) {
        complexityScore += inst.config.maxBacktrackingNodes / 1000;
      }
      if (inst.config.maxProductOfDomains !== undefined && inst.config.maxProductOfDomains > 100000) {
        complexityScore += inst.config.maxProductOfDomains / 1000;
      }
    }

    if (allMissing.length > 0) {
      return { verdict: VERDICTS.NEEDS_CLARIFICATION, missing: allMissing, diagnostics };
    }

    // Arbitrary complexity threshold for demonstration
    if (complexityScore > 500) {
      diagnostics.push(`Estimated complexity score ${complexityScore} exceeds threshold`);
      return { verdict: VERDICTS.TOO_COMPLEX, reason: `Complexity score ${complexityScore}`, diagnostics };
    }

    return { verdict: VERDICTS.EXECUTE, diagnostics };
  }

  static _analyzeBlock(steps, variables, solverInstances) {
    const diagnostics = [];
    let complexity = 0;
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      if (!step || typeof step !== 'object') {
        diagnostics.push(`Block step ${i} is not an object`);
        continue;
      }
      if (!ALLOWED_OPS.has(step.op)) {
        diagnostics.push(`Block step ${i}: unsupported op "${step.op}"`);
        continue;
      }
      if (step.op === 'createSolver') {
        if (!ALLOWED_SOLVER_CLASSES.has(step.className)) {
          diagnostics.push(`Block step ${i}: unknown solver class "${step.className}"`);
        } else {
          solverInstances.set(step.varName, {
            className: step.className,
            config: step.options ?? {},
            calls: [],
          });
          complexity += 10;
        }
      }
      if (step.op === 'solverCall') {
        const inst = solverInstances.get(step.varName);
        if (!inst) {
          diagnostics.push(`Block step ${i}: solver "${step.varName}" not declared`);
        } else {
          inst.calls.push({ method: step.method, args: step.args ?? [] });
        }
      }
      if (step.op === 'if') {
        const thenCheck = this._analyzeBlock(step.then ?? [], variables, solverInstances);
        const elseCheck = this._analyzeBlock(step.else ?? [], variables, solverInstances);
        diagnostics.push(...thenCheck.diagnostics, ...elseCheck.diagnostics);
        complexity += thenCheck.complexity + elseCheck.complexity;
      }
    }
    return { diagnostics, complexity };
  }
}

export { VERDICTS };
