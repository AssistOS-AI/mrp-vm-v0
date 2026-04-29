import { RuleProblem as SharedRuleProblem } from './solvers/rule-problem.mjs';
import { ConstraintProblem as SharedConstraintProblem } from './solvers/constraint-problem.mjs';
import { GraphProblem as SharedGraphProblem } from './solvers/graph-problem.mjs';
import { SearchProblem as SharedSearchProblem } from './solvers/search-problem.mjs';
import { ReasoningResult } from './result.mjs';

function normalizeRef(term) {
  if (Array.isArray(term)) {
    return term;
  }
  if (typeof term === 'string' && !term.startsWith('$')) {
    return ['ref', `$${term}`];
  }
  return term;
}

function buildDiagnosticsResult(status, message) {
  return new ReasoningResult({
    status,
    solution: null,
    diagnostics: [message],
    stats: {},
  });
}

function estimateDomainProduct(domains) {
  let product = 1;
  for (const values of domains.values()) {
    product *= values.length;
  }
  return product;
}

export class RuleProblem {
  constructor(name = 'rule-problem', options = {}) {
    this.name = String(name);
    this.options = options;
    this.solver = new SharedRuleProblem(options);
  }

  fact(predicate, ...args) {
    this.solver.fact(String(predicate), args);
    return this;
  }

  addFact(predicate, ...args) {
    return this.fact(predicate, ...args);
  }

  rule(headPredicate, headArgs, body = []) {
    this.solver.rule(
      { predicate: String(headPredicate), args: headArgs.map(String) },
      body.map((entry) => ({
        predicate: String(entry.predicate),
        args: (entry.args ?? []).map(String),
      })),
    );
    return this;
  }

  addRule(headPredicate, headArgs, body = []) {
    if (headPredicate && typeof headPredicate === 'object' && !Array.isArray(headPredicate)) {
      return this.rule(headPredicate.predicate, headPredicate.args ?? [], headArgs ?? []);
    }
    return this.rule(headPredicate, headArgs, body);
  }

  queryFact(predicate, ...args) {
    this.solver.queryFact(String(predicate), args);
    return this;
  }

  askFact(predicate, ...args) {
    return this.queryFact(predicate, ...args);
  }

  query(predicate, ...args) {
    return this.queryFact(predicate, ...args);
  }

  queryAll(predicate) {
    this.solver.queryAll(String(predicate));
    return this;
  }

  askAll(predicate) {
    return this.queryAll(predicate);
  }

  solve() {
    return new ReasoningResult(this.solver.solve(), 'rule');
  }
}

export class ConstraintProblem {
  constructor(name = 'constraint-problem', options = {}) {
    this.name = String(name);
    this.domains = new Map();
    this.constraints = [];
    this.queryVars = [];
    this.maxBacktrackingNodes = options.maxBacktrackingNodes ?? 1_000;
    this.maxSolutions = options.maxSolutions ?? 1;
    this.maxDomainProduct = options.maxDomainProduct ?? 100_000;
  }

  variable(name, ...values) {
    this.domains.set(String(name), values.flat());
    return this;
  }

  addVariable(name, ...values) {
    return this.variable(name, ...values);
  }

  domain(name, ...values) {
    return this.variable(name, ...values);
  }

  equals(variableName, value) {
    this.constraints.push({ type: 'require', variableName: String(variableName), value });
    return this;
  }

  require(variableName, value) {
    return this.equals(variableName, value);
  }

  notEquals(variableName, value) {
    this.constraints.push({ type: 'forbid', variableName: String(variableName), value });
    return this;
  }

  forbid(variableName, value) {
    return this.notEquals(variableName, value);
  }

  allDifferent(...variables) {
    this.constraints.push({ type: 'allDifferent', variables: variables.map(String) });
    return this;
  }

  sameAs(left, right) {
    this.constraints.push({ type: 'sameAs', left: String(left), right: String(right) });
    return this;
  }

  differentFrom(left, right) {
    return this.allDifferent(left, right);
  }

  different(left, right) {
    return this.differentFrom(left, right);
  }

  implies(conditionVariable, conditionValue, consequenceVariable, consequenceValue) {
    this.constraints.push({
      type: 'implies',
      conditionVariable: String(conditionVariable),
      conditionValue,
      consequenceVariable: String(consequenceVariable),
      consequenceValue,
    });
    return this;
  }

  queryAssignment(...variables) {
    this.queryVars = variables.map(String);
    return this;
  }

  limitDomainProduct(value) {
    this.maxDomainProduct = Number(value);
    return this;
  }

  limitBacktrackingNodes(value) {
    this.maxBacktrackingNodes = Number(value);
    return this;
  }

  limitSolutions(value) {
    this.maxSolutions = Number(value);
    return this;
  }

  _buildSolver(maxSolutionsOverride) {
    const solver = new SharedConstraintProblem({
      maxBacktrackingNodes: this.maxBacktrackingNodes,
      maxSolutions: maxSolutionsOverride,
    });

    for (const [name, values] of this.domains.entries()) {
      solver.domain(name, values);
    }

    for (const constraint of this.constraints) {
      switch (constraint.type) {
        case 'require':
          solver.require(constraint.variableName, constraint.value);
          break;
        case 'forbid':
          solver.forbid(constraint.variableName, constraint.value);
          break;
        case 'implies':
          solver.implies(
            constraint.conditionVariable,
            constraint.conditionValue,
            constraint.consequenceVariable,
            constraint.consequenceValue,
          );
          break;
        case 'allDifferent':
          solver.constraints.push({ type: 'allDifferent', vars: constraint.variables });
          break;
        case 'sameAs': {
          const leftDomain = this.domains.get(constraint.left);
          const rightDomain = this.domains.get(constraint.right);
          if (!leftDomain || !rightDomain) {
            throw new Error(`sameAs requires declared variables ${constraint.left} and ${constraint.right}.`);
          }
          const sharedValues = [...new Set([...leftDomain, ...rightDomain])];
          for (const value of sharedValues) {
            solver.implies(constraint.left, value, constraint.right, value);
            solver.implies(constraint.right, value, constraint.left, value);
          }
          break;
        }
        default:
          break;
      }
    }

    return solver;
  }

  _solve(maxSolutionsOverride) {
    const domainProduct = estimateDomainProduct(this.domains);
    if (domainProduct > this.maxDomainProduct) {
      return buildDiagnosticsResult('too_complex', `Domain product ${domainProduct} exceeds ${this.maxDomainProduct}.`);
    }

    try {
      const solver = this._buildSolver(maxSolutionsOverride);
      return new ReasoningResult(solver.solve(), 'constraint');
    } catch (error) {
      return buildDiagnosticsResult('invalid_program', error.message);
    }
  }

  solveOne() {
    return this._solve(1);
  }

  solveAll() {
    return this._solve(this.maxSolutions);
  }
}

export class GraphProblem {
  constructor(name = 'graph-problem', options = {}) {
    this.name = String(name);
    this.mode = 'directed';
    this.nodes = new Set();
    this.edges = [];
    this.maxNodes = options.maxNodes ?? 1_000;
    this.maxEdges = options.maxEdges ?? 5_000;
    this.maxExpansions = options.maxExpansions ?? 10_000;
    this.query = null;
  }

  directed() {
    this.mode = 'directed';
    return this;
  }

  setDirected() {
    return this.directed();
  }

  undirected() {
    this.mode = 'undirected';
    return this;
  }

  setUndirected() {
    return this.undirected();
  }

  node(name) {
    this.nodes.add(String(name));
    return this;
  }

  addNode(name) {
    return this.node(name);
  }

  edge(from, to, weight = 1) {
    this.edges.push({ from: String(from), to: String(to), weight: Number(weight) });
    if (this.mode === 'undirected') {
      this.edges.push({ from: String(to), to: String(from), weight: Number(weight) });
    }
    return this;
  }

  addEdge(from, to, weight = 1) {
    return this.edge(from, to, weight);
  }

  queryPath(from, to) {
    this.query = { type: 'path', from: String(from), to: String(to) };
    return this;
  }

  findPath(from, to) {
    return this.queryPath(from, to);
  }

  queryTopologicalOrder() {
    this.query = { type: 'topologicalOrder' };
    return this;
  }

  findTopologicalOrder() {
    return this.queryTopologicalOrder();
  }

  limitNodes(value) {
    this.maxNodes = Number(value);
    return this;
  }

  limitEdges(value) {
    this.maxEdges = Number(value);
    return this;
  }

  limitExpansions(value) {
    this.maxExpansions = Number(value);
    return this;
  }

  reachableWithin(from, to, maxSteps) {
    const start = String(from);
    const goal = String(to);
    const steps = Number(maxSteps);
    const queue = [{ node: start, depth: 0 }];
    const visited = new Set([start]);
    const adjacency = new Map([...this.nodes].map((node) => [node, []]));
    for (const edge of this.edges) {
      adjacency.get(edge.from)?.push(edge.to);
    }
    while (queue.length > 0) {
      const current = queue.shift();
      if (current.node === goal && current.depth <= steps) {
        return true;
      }
      if (current.depth >= steps) {
        continue;
      }
      for (const next of adjacency.get(current.node) ?? []) {
        if (visited.has(next)) {
          continue;
        }
        visited.add(next);
        queue.push({ node: next, depth: current.depth + 1 });
      }
    }
    return false;
  }

  solve() {
    const solver = new SharedGraphProblem({
      maxNodes: this.maxNodes,
      maxEdges: this.maxEdges,
      maxExpansions: this.maxExpansions,
    });
    for (const node of this.nodes) {
      solver.node(node);
    }
    for (const edge of this.edges) {
      solver.edge(edge.from, edge.to, edge.weight);
    }
    if (this.query?.type === 'path') {
      solver.findPath(this.query.from, this.query.to);
    } else if (this.query?.type === 'topologicalOrder') {
      solver.findTopologicalOrder();
    }
    return new ReasoningResult(solver.solve(), 'graph');
  }
}

export class SearchProblem {
  constructor(name = 'search-problem', options = {}) {
    this.name = String(name);
    this.initial = null;
    this.goal = null;
    this.actions = [];
    this.strategyName = options.strategy ?? 'bfs';
    this.maxDepth = options.maxDepth ?? 20;
    this.maxFrontier = options.maxFrontier ?? 1_000;
    this.maxVisitedStates = options.maxVisitedStates ?? 5_000;
  }

  initialState(state) {
    this.initial = state;
    return this;
  }

  setInitialState(state) {
    return this.initialState(state);
  }

  goalState(state) {
    this.goal = state;
    return this;
  }

  setGoalState(state) {
    return this.goalState(state);
  }

  action(name, definition = {}) {
    this.actions.push({ name: String(name), ...definition });
    return this;
  }

  addAction(name, definition = {}) {
    return this.action(name, definition);
  }

  strategy(name) {
    this.strategyName = String(name);
    return this;
  }

  limitDepth(value) {
    this.maxDepth = Number(value);
    return this;
  }

  solvePlan() {
    const solver = new SharedSearchProblem({
      maxDepth: this.maxDepth,
      maxFrontier: this.maxFrontier,
      maxVisitedStates: this.maxVisitedStates,
    });
    solver.initialState(this.initial);
    solver.goalState(this.goal);
    solver.strategy(this.strategyName);
    for (const action of this.actions) {
      solver.action(action.name, action);
    }
    solver.query('findPlan');
    return new ReasoningResult(solver.solve(), 'search');
  }

  solve() {
    return this.solvePlan();
  }
}

export class NumericProblem {
  constructor(name = 'numeric-problem', options = {}) {
    this.name = String(name);
    this.variables = new Map();
    this.constraints = [];
    this.queryNames = [];
    this.maxDomainProduct = options.maxDomainProduct ?? 10_000;
    this.maxEvaluations = options.maxEvaluations ?? 10_000;
  }

  int(name, min, max) {
    const values = [];
    for (let value = Number(min); value <= Number(max); value += 1) {
      values.push(value);
    }
    this.variables.set(String(name), values);
    return this;
  }

  addInt(name, min, max) {
    return this.int(name, min, max);
  }

  number(name, ...values) {
    this.variables.set(String(name), values.map(Number));
    return this;
  }

  addVariable(name, ...values) {
    if (values.length === 2 && values.every((value) => Number.isFinite(Number(value)))) {
      return this.int(name, values[0], values[1]);
    }
    return this.number(name, ...values);
  }

  eq(left, right) {
    this.constraints.push(['eq', normalizeRef(left), normalizeRef(right)]);
    return this;
  }

  lt(left, right) {
    this.constraints.push(['lt', normalizeRef(left), normalizeRef(right)]);
    return this;
  }

  lessThan(left, right) {
    return this.lt(left, right);
  }

  gt(left, right) {
    this.constraints.push(['gt', normalizeRef(left), normalizeRef(right)]);
    return this;
  }

  greaterThan(left, right) {
    return this.gt(left, right);
  }

  add(...terms) {
    return ['add', ...terms.map(normalizeRef)];
  }

  sub(left, right) {
    return ['sub', normalizeRef(left), normalizeRef(right)];
  }

  mul(left, right) {
    return ['mul', normalizeRef(left), normalizeRef(right)];
  }

  queryValue(name) {
    this.queryNames = [String(name)];
    return this;
  }

  limitDomainProduct(value) {
    this.maxDomainProduct = Number(value);
    return this;
  }

  limitEvaluations(value) {
    this.maxEvaluations = Number(value);
    return this;
  }

  _evaluate(expr, assignment) {
    if (!Array.isArray(expr)) {
      if (typeof expr === 'string' && expr.startsWith('$')) {
        return assignment[expr.slice(1)];
      }
      return expr;
    }
    const [op, ...args] = expr;
    switch (op) {
      case 'ref':
        return assignment[String(args[0]).replace(/^\$/, '')];
      case 'eq':
        return this._evaluate(args[0], assignment) === this._evaluate(args[1], assignment);
      case 'lt':
        return Number(this._evaluate(args[0], assignment)) < Number(this._evaluate(args[1], assignment));
      case 'gt':
        return Number(this._evaluate(args[0], assignment)) > Number(this._evaluate(args[1], assignment));
      case 'add':
        return args.reduce((sum, entry) => sum + Number(this._evaluate(entry, assignment)), 0);
      case 'sub':
        return Number(this._evaluate(args[0], assignment)) - Number(this._evaluate(args[1], assignment));
      case 'mul':
        return Number(this._evaluate(args[0], assignment)) * Number(this._evaluate(args[1], assignment));
      case 'and':
        return args.every((entry) => this._evaluate(entry, assignment));
      case 'or':
        return args.some((entry) => this._evaluate(entry, assignment));
      case 'not':
        return !this._evaluate(args[0], assignment);
      default:
        throw new Error(`Unsupported numeric operator ${op}.`);
    }
  }

  solveOne() {
    const domainProduct = estimateDomainProduct(this.variables);
    if (domainProduct > this.maxDomainProduct) {
      return buildDiagnosticsResult('too_complex', `Domain product ${domainProduct} exceeds ${this.maxDomainProduct}.`);
    }

    const variableNames = [...this.variables.keys()];
    const assignment = {};
    let evaluations = 0;
    let solved = null;

    const search = (index) => {
      if (solved || evaluations >= this.maxEvaluations) {
        return;
      }
      if (index >= variableNames.length) {
        evaluations += 1;
        if (this.constraints.every((entry) => this._evaluate(entry, assignment))) {
          solved = { ...assignment };
        }
        return;
      }
      const name = variableNames[index];
      for (const value of this.variables.get(name) ?? []) {
        assignment[name] = value;
        search(index + 1);
      }
      delete assignment[name];
    };

    search(0);

    if (!solved) {
      return buildDiagnosticsResult(evaluations >= this.maxEvaluations ? 'too_complex' : 'unsat_early', 'No bounded numeric solution found.');
    }

    return new ReasoningResult({
      status: 'solved',
      solution: solved,
      diagnostics: [],
      stats: {
        evaluations,
      },
    }, 'numeric');
  }

  solve() {
    return this.solveOne();
  }
}
