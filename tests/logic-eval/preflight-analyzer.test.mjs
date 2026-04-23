import test from 'node:test';
import assert from 'node:assert/strict';
import { PreflightAnalyzer, VERDICTS } from '../../src/logic-eval/preflight-analyzer.mjs';

test('PreflightAnalyzer approves a valid program', () => {
  const steps = [
    { op: 'createSolver', varName: 'g', className: 'GraphProblem', options: {} },
    { op: 'solverCall', varName: 'g', method: 'node', args: ['A'] },
    { op: 'solverCall', varName: 'g', method: 'node', args: ['B'] },
    { op: 'solverCall', varName: 'g', method: 'edge', args: ['A', 'B'] },
    { op: 'solverCall', varName: 'g', method: 'findPath', args: ['A', 'B'] },
    { op: 'solverSolve', varName: 'g', resultName: 'pathResult' },
    { op: 'setFinal', value: { answer: ['ref', 'results.pathResult.solution.path'] } },
  ];
  const result = PreflightAnalyzer.analyze(steps);
  assert.equal(result.verdict, VERDICTS.EXECUTE);
});

test('PreflightAnalyzer rejects unsupported op', () => {
  const steps = [
    { op: 'hack', value: 1 },
    { op: 'setFinal', value: 1 },
  ];
  const result = PreflightAnalyzer.analyze(steps);
  assert.equal(result.verdict, VERDICTS.INVALID_PROGRAM);
});

test('PreflightAnalyzer rejects unknown solver class', () => {
  const steps = [
    { op: 'createSolver', varName: 's', className: 'MagicSolver', options: {} },
    { op: 'setFinal', value: 1 },
  ];
  const result = PreflightAnalyzer.analyze(steps);
  assert.equal(result.verdict, VERDICTS.INVALID_PROGRAM);
});

test('PreflightAnalyzer detects missing setFinal', () => {
  const steps = [
    { op: 'createSolver', varName: 's', className: 'RuleProblem', options: {} },
  ];
  const result = PreflightAnalyzer.analyze(steps);
  assert.equal(result.verdict, VERDICTS.INVALID_PROGRAM);
});

test('PreflightAnalyzer detects missing obligations', () => {
  const steps = [
    { op: 'createSolver', varName: 's', className: 'RuleProblem', options: {} },
    // no facts/rules or queries
    { op: 'solverSolve', varName: 's', resultName: 'r' },
    { op: 'setFinal', value: 1 },
  ];
  const result = PreflightAnalyzer.analyze(steps);
  assert.equal(result.verdict, VERDICTS.NEEDS_CLARIFICATION);
  assert.ok(result.missing.length > 0);
});

test('PreflightAnalyzer detects missing graph query', () => {
  const steps = [
    { op: 'createSolver', varName: 'g', className: 'GraphProblem', options: {} },
    { op: 'solverCall', varName: 'g', method: 'node', args: ['A'] },
    { op: 'solverCall', varName: 'g', method: 'edge', args: ['A', 'B'] },
    { op: 'solverSolve', varName: 'g', resultName: 'r' },
    { op: 'setFinal', value: 1 },
  ];
  const result = PreflightAnalyzer.analyze(steps);
  assert.equal(result.verdict, VERDICTS.NEEDS_CLARIFICATION);
});

test('PreflightAnalyzer checks nested if blocks', () => {
  const steps = [
    {
      op: 'if',
      condition: true,
      then: [
        { op: 'createSolver', varName: 's', className: 'NumericProblem', options: {} },
        { op: 'solverCall', varName: 's', method: 'variable', args: ['x', 1, 2] },
        { op: 'solverCall', varName: 's', method: 'constraint', args: [['eq', ['ref', '$x'], 1]] },
        { op: 'solverCall', varName: 's', method: 'query', args: ['val'] },
        { op: 'solverSolve', varName: 's', resultName: 'r' },
      ],
      else: [],
    },
    { op: 'setFinal', value: 1 },
  ];
  const result = PreflightAnalyzer.analyze(steps);
  assert.equal(result.verdict, VERDICTS.EXECUTE);
});
