/**
 * ConstraintProblem – discrete constraint satisfaction with backtracking.
 * Returns { status, solution, stats, diagnostics }
 */

export class ConstraintProblem {
  constructor(options = {}) {
    this.domains = new Map();
    this.constraints = [];
    this.queries = [];
    this.maxBacktrackingNodes = options.maxBacktrackingNodes ?? 1000;
    this.maxSolutions = options.maxSolutions ?? 1;
    this._diagnostics = [];
  }

  domain(name, values) {
    this.domains.set(name, Array.from(values));
    return this;
  }

  exactlyOne(varGroup, valueGroup) {
    // Each variable in varGroup gets exactly one value from valueGroup,
    // and each value in valueGroup is used by at most one variable.
    this.constraints.push({ type: 'exactlyOne', varGroup: String(varGroup), valueGroup: String(valueGroup) });
    return this;
  }

  atMostOne(varGroup, valueGroup) {
    this.constraints.push({ type: 'atMostOne', varGroup: String(varGroup), valueGroup: String(valueGroup) });
    return this;
  }

  require(varName, value) {
    this.constraints.push({ type: 'require', var: String(varName), value });
    return this;
  }

  forbid(varName, value) {
    this.constraints.push({ type: 'forbid', var: String(varName), value });
    return this;
  }

  implies(varIf, valIf, varThen, valThen) {
    this.constraints.push({ type: 'implies', varIf: String(varIf), valIf, varThen: String(varThen), valThen });
    return this;
  }

  before(left, right, orderingVar) {
    // left and right are objects like { person: 'alice' }
    // orderingVar is the name of the numeric variable representing position
    this.constraints.push({ type: 'before', left, right, orderingVar: String(orderingVar) });
    return this;
  }

  nextTo(left, right, orderingVar) {
    this.constraints.push({ type: 'nextTo', left, right, orderingVar: String(orderingVar) });
    return this;
  }

  query(name) {
    this.queries.push(name);
    return this;
  }

  solve() {
    const stats = { backtrackingNodes: 0, solutionsFound: 0, constraintChecks: 0 };

    // Normalize exactlyOne / atMostOne into concrete variable domains and constraints
    const normalizedVars = new Map();
    const normalizedConstraints = [];

    for (const [varName, values] of this.domains) {
      normalizedVars.set(varName, values);
    }

    // Expand exactlyOne / atMostOne into concrete variables if needed
    for (const c of this.constraints) {
      if (c.type === 'exactlyOne' || c.type === 'atMostOne') {
        // These are high-level; for a simple solver we expand them by requiring
        // the caller to have declared individual variables.
        // We treat them as all-different constraints over the value group.
        const vars = Array.from(normalizedVars.keys()).filter((v) => v.startsWith(c.varGroup) || v.includes(c.varGroup));
        if (vars.length === 0) {
          this._diagnostics.push(`No variables found for group ${c.varGroup}`);
          return { status: 'invalid_program', solution: null, stats, diagnostics: this._diagnostics };
        }
        normalizedConstraints.push({ type: 'allDifferent', vars });
        if (c.type === 'exactlyOne') {
          // Each var must take a value from the group
          for (const v of vars) {
            const domain = normalizedVars.get(v);
            if (!domain) {
              this._diagnostics.push(`Variable ${v} missing domain`);
              return { status: 'invalid_program', solution: null, stats, diagnostics: this._diagnostics };
            }
          }
        }
      } else {
        normalizedConstraints.push(c);
      }
    }

    // Quick contradiction: empty domain
    for (const [name, values] of normalizedVars) {
      if (values.length === 0) {
        this._diagnostics.push(`Empty domain for ${name}`);
        return { status: 'unsat_early', solution: null, stats, diagnostics: this._diagnostics };
      }
    }

    // Quick contradiction: require + forbid same pair
    const requires = new Set();
    const forbids = new Set();
    for (const c of normalizedConstraints) {
      if (c.type === 'require') {
        requires.add(`${c.var}=${JSON.stringify(c.value)}`);
      }
      if (c.type === 'forbid') {
        forbids.add(`${c.var}=${JSON.stringify(c.value)}`);
      }
    }
    for (const r of requires) {
      if (forbids.has(r)) {
        this._diagnostics.push(`Contradiction: require and forbid ${r}`);
        return { status: 'unsat_early', solution: null, stats, diagnostics: this._diagnostics };
      }
    }

    const varNames = Array.from(normalizedVars.keys());
    const solutions = [];

    const search = (index, assignment) => {
      if (stats.backtrackingNodes >= this.maxBacktrackingNodes) {
        return;
      }
      stats.backtrackingNodes += 1;

      if (index >= varNames.length) {
        stats.solutionsFound += 1;
        solutions.push({ ...assignment });
        return;
      }

      const v = varNames[index];
      const domain = normalizedVars.get(v);
      for (const val of domain) {
        assignment[v] = val;
        stats.constraintChecks += 1;
        if (this._checkPartial(assignment, normalizedConstraints, normalizedVars)) {
          search(index + 1, assignment);
          if (solutions.length >= this.maxSolutions) {
            return;
          }
        }
        delete assignment[v];
      }
    };

    search(0, {});

    if (solutions.length === 0) {
      return {
        status: 'unsat_early',
        solution: null,
        stats,
        diagnostics: this._diagnostics,
      };
    }

    return {
      status: 'solved',
      solution: this.maxSolutions === 1 ? solutions[0] : solutions,
      stats,
      diagnostics: this._diagnostics,
    };
  }

  _checkPartial(assignment, constraints, domains) {
    for (const c of constraints) {
      switch (c.type) {
        case 'require': {
          if (c.var in assignment && assignment[c.var] !== c.value) {
            return false;
          }
          break;
        }
        case 'forbid': {
          if (c.var in assignment && assignment[c.var] === c.value) {
            return false;
          }
          break;
        }
        case 'implies': {
          if (c.varIf in assignment && c.varThen in assignment) {
            if (assignment[c.varIf] === c.valIf && assignment[c.varThen] !== c.valThen) {
              return false;
            }
          }
          break;
        }
        case 'allDifferent': {
          const vals = [];
          for (const v of c.vars) {
            if (v in assignment) {
              vals.push(assignment[v]);
            }
          }
          const set = new Set(vals);
          if (set.size !== vals.length) {
            return false;
          }
          break;
        }
        case 'before': {
          // left and right identify variables via keys matching assignment keys
          const leftVar = Object.keys(c.left)[0];
          const rightVar = Object.keys(c.right)[0];
          const leftVal = c.left[leftVar];
          const rightVal = c.right[rightVar];
          const lv = Object.entries(assignment).find(([k, v]) => k.startsWith(c.orderingVar) && v === leftVal);
          const rv = Object.entries(assignment).find(([k, v]) => k.startsWith(c.orderingVar) && v === rightVal);
          if (lv && rv) {
            // Simplistic: if orderingVar is numeric, compare raw values
            const leftPos = Number(lv[0].split('_').pop() ?? lv[0]);
            const rightPos = Number(rv[0].split('_').pop() ?? rv[0]);
            if (leftPos >= rightPos) {
              return false;
            }
          }
          break;
        }
        case 'nextTo': {
          // Simplistic next-to using numeric suffix of orderingVar names
          const leftVar = Object.keys(c.left)[0];
          const rightVar = Object.keys(c.right)[0];
          const leftVal = c.left[leftVar];
          const rightVal = c.right[rightVar];
          const lv = Object.entries(assignment).find(([k, v]) => k.startsWith(c.orderingVar) && v === leftVal);
          const rv = Object.entries(assignment).find(([k, v]) => k.startsWith(c.orderingVar) && v === rightVal);
          if (lv && rv) {
            const leftPos = Number(lv[0].split('_').pop() ?? lv[0]);
            const rightPos = Number(rv[0].split('_').pop() ?? rv[0]);
            if (Math.abs(leftPos - rightPos) !== 1) {
              return false;
            }
          }
          break;
        }
        default:
          break;
      }
    }
    return true;
  }
}
