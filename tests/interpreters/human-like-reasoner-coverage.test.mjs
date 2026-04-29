import test from 'node:test';
import assert from 'node:assert/strict';
import { MRPVM } from '../../src/index.mjs';
import { executeHumanLikeReasoner } from '../../src/interpreters/human-like-reasoner/index.mjs';
import { createTempRuntimeRoot } from '../fixtures/runtime-root.mjs';

function buildContext(runtime, program) {
  return {
    runtime,
    targetFamily: 'answer',
    body: JSON.stringify({
      problem: 'test problem',
      program,
    }),
    node: { dependencies: [] },
    resolvedDependencies: new Map(),
    contextPackage: { markdown: '' },
    kbResult: { selected: [] },
    promptAssets: [],
    request: { requestText: 'test problem' },
  };
}

async function runInlineProgram(program) {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, { deterministic: {} });
  const effects = await executeHumanLikeReasoner(buildContext(runtime, program));
  assert.equal(effects.failure, null);
  return String(effects.emittedVariants[0].value ?? '');
}

test('HumanLikeReasoner coverage: RuleProblem example stays useful and explicit', async () => {
  const text = await runInlineProgram([
    'const ctx = new ExecutionContext();',
    'const rules = new RuleProblem("access");',
    'rules.fact("admin", "Alice");',
    'rules.rule("user", ["?x"], [{ predicate: "admin", args: ["?x"] }]);',
    'rules.queryFact("user", "Alice");',
    'const result = rules.solve();',
    'ctx.assert(result.isSolved(), "Expected solved rule closure.");',
    'const answers = result.toJSON().solution.answers;',
    'const text = ctx.text("answer");',
    'text.sentence("Rule result: Alice is a user = " + answers[0].result);',
    'ctx.emit("answer", text.toString());',
  ].join('\n'));

  assert.match(text, /Rule result: Alice is a user = true/);
});

test('HumanLikeReasoner coverage: common RuleProblem aliases still work', async () => {
  const text = await runInlineProgram([
    'const ctx = new ExecutionContext();',
    'const rules = new RuleProblem("access");',
    'rules.addFact("admin", "Alice");',
    'rules.addRule("user", ["?x"], [{ predicate: "admin", args: ["?x"] }]);',
    'rules.askFact("user", "Alice");',
    'const result = rules.solve();',
    'ctx.assert(result.isSolved(), "Expected solved rule closure.");',
    'const answers = result.toJSON().solution.answers;',
    'ctx.emit("answer", "Alias rule result: " + answers[0].result);',
  ].join('\n'));

  assert.match(text, /Alias rule result: true/);
});

test('HumanLikeReasoner coverage: GraphProblem example finds a path', async () => {
  const text = await runInlineProgram([
    'const ctx = new ExecutionContext();',
    'const graph = new GraphProblem("tiny");',
    'graph.node("A");',
    'graph.node("B");',
    'graph.node("C");',
    'graph.edge("A", "B");',
    'graph.edge("B", "C");',
    'graph.queryPath("A", "C");',
    'const result = graph.solve();',
    'ctx.assert(result.isSolved(), "Expected a graph path.");',
    'const text = ctx.text("answer");',
    'text.sentence("Graph path: " + result.path().join(" -> "));',
    'ctx.emit("answer", text.toString());',
  ].join('\n'));

  assert.match(text, /Graph path: A -> B -> C/);
});

test('HumanLikeReasoner coverage: NumericProblem example solves a bounded sum', async () => {
  const text = await runInlineProgram([
    'const ctx = new ExecutionContext();',
    'const numeric = new NumericProblem("sum");',
    'numeric.int("x", 0, 7);',
    'numeric.int("y", 0, 7);',
    'numeric.eq(numeric.add("x", "y"), 7);',
    'numeric.gt("x", 2);',
    'numeric.lt("y", 5);',
    'const result = numeric.solveOne();',
    'ctx.assert(result.isSolved(), "Expected a bounded numeric solution.");',
    'const text = ctx.text("answer");',
    'text.sentence("Numeric solution: x=" + result.value("x") + ", y=" + result.value("y"));',
    'ctx.emit("answer", text.toString());',
  ].join('\n'));

  assert.match(text, /Numeric solution: x=\d, y=\d/);
});

test('HumanLikeReasoner coverage: result aliases and text sections stay compatible', async () => {
  const text = await runInlineProgram([
    'const ctx = new ExecutionContext();',
    'const numeric = new NumericProblem("sum");',
    'numeric.addVariable("x", 1, 3);',
    'numeric.addVariable("y", 1, 3);',
    'numeric.eq(numeric.add("x", "y"), 4);',
    'const result = numeric.solve();',
    'ctx.assert(result.isSolved(), "Expected a numeric solution.");',
    'const text = ctx.text("answer");',
    'text.section("Values", "x=" + result.getValue("x") + ", y=" + result.get("y"));',
    'ctx.emit("answer", text.toString());',
  ].join('\n'));

  assert.match(text, /Values: x=\d, y=\d/);
});

test('HumanLikeReasoner coverage: SearchProblem example finds a small jug plan', async () => {
  const text = await runInlineProgram([
    'const ctx = new ExecutionContext();',
    'const search = new SearchProblem("jugs");',
    'search.initialState({ a: 0, b: 0, capA: 3, capB: 5 });',
    'search.goalState({ b: 4 });',
    'search.action("fillB");',
    'search.action("pourBToA");',
    'search.action("emptyA");',
    'search.action("pourAToB");',
    'search.action("fillA");',
    'search.action("emptyB");',
    'const result = search.solvePlan();',
    'ctx.assert(result.isSolved(), "Expected a bounded search plan.");',
    'const text = ctx.text("answer");',
    'text.sentence("Search plan: " + result.plan().join(" -> "));',
    'ctx.emit("answer", text.toString());',
  ].join('\n'));

  assert.match(text, /Search plan:/);
  assert.match(text, /fillB/);
});

test('HumanLikeReasoner coverage: bounded arrow helpers are allowed', async () => {
  const text = await runInlineProgram([
    'const ctx = new ExecutionContext();',
    'const numeric = new NumericProblem("sum");',
    'numeric.int("x", 1, 3);',
    'numeric.int("y", 1, 3);',
    'numeric.eq(numeric.add("x", "y"), 4);',
    'const result = numeric.solve();',
    'const summary = ["x", "y"].map((name) => name + "=" + result.value(name)).join(", ");',
    'ctx.emit("answer", "Arrow helper result: " + summary);',
  ].join('\n'));

  assert.match(text, /Arrow helper result: x=\d, y=\d/);
});
