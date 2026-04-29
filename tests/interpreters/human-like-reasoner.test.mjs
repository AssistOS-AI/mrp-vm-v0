import test from 'node:test';
import assert from 'node:assert/strict';
import { MRPVM } from '../../src/index.mjs';
import { executeHumanLikeReasoner } from '../../src/interpreters/human-like-reasoner/index.mjs';
import { createTempRuntimeRoot } from '../fixtures/runtime-root.mjs';

function buildContext(runtime, body) {
  return {
    runtime,
    targetFamily: 'answer',
    body,
    node: { dependencies: [] },
    resolvedDependencies: new Map(),
    contextPackage: { markdown: '' },
    kbResult: { selected: [] },
    promptAssets: [],
    request: {
      requestText: typeof body === 'string' ? body : JSON.stringify(body),
    },
  };
}

test('HumanLikeReasoner executes an inline bounded program for a simple assignment problem', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, { deterministic: {} });
  const program = [
    'const ctx = new ExecutionContext();',
    'const assignment = new ConstraintProblem("colors");',
    'assignment.variable("Ana", "red", "blue");',
    'assignment.variable("Ben", "red", "blue");',
    'assignment.allDifferent("Ana", "Ben");',
    'assignment.equals("Ana", "red");',
    'const result = assignment.solveOne();',
    'ctx.assert(result.isSolved(), "Expected a solved assignment.");',
    'const colors = result.assignment();',
    'const text = ctx.text("answer");',
    'text.sentence("Ana chose " + colors.get("Ana"));',
    'text.sentence("Ben chose " + colors.get("Ben"));',
    'ctx.emit("answer", text.toString());',
  ].join('\n');

  const effects = await executeHumanLikeReasoner(buildContext(runtime, JSON.stringify({
    problem: 'Ana and Ben choose different colors red and blue. Ana chooses red. What does Ben choose?',
    program,
  })));

  assert.equal(effects.failure, null);
  assert.equal(effects.emittedVariants[0].meta.source_interpreter, 'HumanLikeReasoner');
  assert.match(String(effects.emittedVariants[0].value), /Ana chose red/);
  assert.match(String(effects.emittedVariants[0].value), /Ben chose blue/);
});

test('HumanLikeReasoner generates and executes a mixed constraint-plus-graph reasoning program', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, {
    deterministic: {},
    fakeAdapterConfig: {
      scriptedSequences: {
        logicGeneratorLLM: [[
          'const ctx = new ExecutionContext();',
          'const assignment = new ConstraintProblem("labs");',
          'assignment.variable("Ana", "Lab1", "Lab2", "Lab3");',
          'assignment.variable("Ben", "Lab1", "Lab2", "Lab3");',
          'assignment.variable("Cara", "Lab1", "Lab2", "Lab3");',
          'assignment.allDifferent("Ana", "Ben", "Cara");',
          'assignment.notEquals("Ana", "Lab2");',
          'assignment.equals("Ben", "Lab3");',
          'const assignmentResult = assignment.solveOne();',
          'ctx.assert(assignmentResult.isSolved(), "Expected a solved assignment.");',
          'ctx.storeResult("assignment", assignmentResult);',
          'const graph = new GraphProblem("corridors");',
          'graph.directed();',
          'graph.node("Lab1");',
          'graph.node("Lab2");',
          'graph.node("Lab3");',
          'graph.node("Server");',
          'graph.edge("Lab1", "Lab2");',
          'graph.edge("Lab2", "Server");',
          'graph.edge("Lab3", "Lab1");',
          'const labs = assignmentResult.assignment();',
          'const anaCanInspect = graph.reachableWithin(labs.get("Ana"), "Server", 2);',
          'const benCanInspect = graph.reachableWithin(labs.get("Ben"), "Server", 2);',
          'const caraCanInspect = graph.reachableWithin(labs.get("Cara"), "Server", 2);',
          'const eligible = [];',
          'if (anaCanInspect) { eligible.push("Ana"); }',
          'if (benCanInspect) { eligible.push("Ben"); }',
          'if (caraCanInspect) { eligible.push("Cara"); }',
          'const text = ctx.text("answer");',
          'text.sentence("Ana is assigned to " + labs.get("Ana") + ", Ben is assigned to " + labs.get("Ben") + ", and Cara is assigned to " + labs.get("Cara"));',
          'text.sentence("Eligible technicians: " + eligible.join(", "));',
          'ctx.emit("answer", text.toString());',
        ].join('\n')],
      },
    },
  });

  const effects = await executeHumanLikeReasoner(buildContext(runtime, 'Three technicians Ana, Ben, and Cara are assigned to three labs. Ana is not in Lab2. Ben is in Lab3. Lab1 connects to Lab2, Lab2 connects to Server, and Lab3 connects to Lab1. Who can inspect the server within two steps?'));

  assert.equal(effects.failure, null);
  const text = String(effects.emittedVariants[0].value);
  assert.match(text, /Ana is assigned to/);
  assert.match(text, /Eligible technicians:/);
  assert.match(text, /Ben/);
});
