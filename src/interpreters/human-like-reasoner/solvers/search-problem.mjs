/**
 * SearchProblem – finite state-space search (plans).
 * Returns { status, solution, stats, diagnostics }
 */

export class SearchProblem {
  constructor(options = {}) {
    this.initial = null;
    this.goal = null;
    this.actions = [];
    this.strategyName = 'bfs';
    this._maxDepth = options.maxDepth ?? 20;
    this._maxFrontier = options.maxFrontier ?? 1000;
    this._maxVisitedStates = options.maxVisitedStates ?? 5000;
    this.queryType = 'findPlan';
    this._diagnostics = [];
  }

  initialState(state) {
    this.initial = state;
    return this;
  }

  goalState(state) {
    this.goal = state;
    return this;
  }

  action(name, definition = {}) {
    // definition can include precondition and effect functions,
    // or for simple cases we allow known action names that the solver interprets.
    this.actions.push({ name: String(name), ...definition });
    return this;
  }

  strategy(name) {
    this.strategyName = String(name);
    return this;
  }

  maxDepth(n) {
    this._maxDepth = Number(n);
    return this;
  }

  query(type) {
    this.queryType = type;
    return this;
  }

  _stateKey(state) {
    return JSON.stringify(state);
  }

  _goalReached(state) {
    if (this.goal === null) {
      return false;
    }
    for (const key of Object.keys(this.goal)) {
      if (state[key] !== this.goal[key]) {
        return false;
      }
    }
    return true;
  }

  _applicableActions(state) {
    const applicable = [];
    for (const action of this.actions) {
      if (action.precondition) {
        if (action.precondition(state)) {
          applicable.push(action);
        }
      } else if (action.apply) {
        // If no explicit precondition, try applying and see if it changes state
        applicable.push(action);
      } else {
        // For known generic actions (fillA, emptyA, pourAToB, etc.)
        applicable.push(action);
      }
    }
    return applicable;
  }

  _applyAction(state, action) {
    if (action.apply) {
      return action.apply(state);
    }
    // Built-in water-jug-like semantics based on action name patterns
    return this._applyBuiltIn(state, action.name);
  }

  _applyBuiltIn(state, name) {
    const newState = { ...state };
    // Generic fill/empty/pour for any keys a, b, c...
    const keys = Object.keys(state);
    if (name === 'fillA' && keys.includes('a')) {
      newState.a = (newState.capA ?? 3);
    } else if (name === 'fillB' && keys.includes('b')) {
      newState.b = (newState.capB ?? 5);
    } else if (name === 'emptyA' && keys.includes('a')) {
      newState.a = 0;
    } else if (name === 'emptyB' && keys.includes('b')) {
      newState.b = 0;
    } else if (name === 'pourAToB' && keys.includes('a') && keys.includes('b')) {
      const capB = newState.capB ?? 5;
      const transfer = Math.min(newState.a, capB - newState.b);
      newState.a -= transfer;
      newState.b += transfer;
    } else if (name === 'pourBToA' && keys.includes('a') && keys.includes('b')) {
      const capA = newState.capA ?? 3;
      const transfer = Math.min(newState.b, capA - newState.a);
      newState.b -= transfer;
      newState.a += transfer;
    } else {
      // Unknown built-in: no-op
    }
    return newState;
  }

  solve() {
    const stats = { nodesExpanded: 0, frontierMax: 0, statesVisited: 0, depthMax: 0 };

    if (this.initial === null) {
      this._diagnostics.push('Missing initial state');
      return { status: 'invalid_program', solution: null, stats, diagnostics: this._diagnostics };
    }
    if (this.goal === null) {
      this._diagnostics.push('Missing goal state');
      return { status: 'invalid_program', solution: null, stats, diagnostics: this._diagnostics };
    }
    if (this.actions.length === 0) {
      this._diagnostics.push('No actions defined');
      return { status: 'invalid_program', solution: null, stats, diagnostics: this._diagnostics };
    }

    // Quick contradiction: goal incompatible with trivial invariants
    // (simplistic: if goal demands a value not reachable by any action effect)
    // Skipped for minimal implementation; rely on search limits.

    const visited = new Set();
    const frontier = [];
    frontier.push({ state: this.initial, plan: [], depth: 0 });
    visited.add(this._stateKey(this.initial));
    stats.statesVisited += 1;

    while (frontier.length > 0) {
      if (frontier.length > this._maxFrontier) {
        this._diagnostics.push('Frontier size exceeded');
        return { status: 'too_complex', solution: null, stats, diagnostics: this._diagnostics };
      }
      if (stats.statesVisited >= this._maxVisitedStates) {
        this._diagnostics.push('Visited states limit exceeded');
        return { status: 'too_complex', solution: null, stats, diagnostics: this._diagnostics };
      }

      let node;
      if (this.strategyName === 'bfs') {
        node = frontier.shift();
      } else if (this.strategyName === 'dfs') {
        node = frontier.pop();
      } else {
        node = frontier.shift();
      }

      stats.nodesExpanded += 1;
      stats.depthMax = Math.max(stats.depthMax, node.depth);

      if (this._goalReached(node.state)) {
        return {
          status: 'solved',
          solution: { plan: node.plan, finalState: node.state },
          stats,
          diagnostics: this._diagnostics,
        };
      }

      if (node.depth >= this._maxDepth) {
        continue;
      }

      for (const action of this._applicableActions(node.state)) {
        const nextState = this._applyAction(node.state, action);
        const key = this._stateKey(nextState);
        if (visited.has(key)) {
          continue;
        }
        visited.add(key);
        stats.statesVisited += 1;
        frontier.push({
          state: nextState,
          plan: [...node.plan, action.name],
          depth: node.depth + 1,
        });
      }
    }

    return { status: 'unsat_early', solution: null, stats, diagnostics: this._diagnostics };
  }
}
