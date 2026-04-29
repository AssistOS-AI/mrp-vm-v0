/**
 * NumericProblem – bounded variables and simple arithmetic constraints.
 * Returns { status, solution, stats, diagnostics }
 */

export class NumericProblem {
  constructor(options = {}) {
    this.variables = new Map();
    this.constraints = [];
    this.objectiveExpr = null;
    this.queries = [];
    this.maxProductOfDomains = options.maxProductOfDomains ?? 10000;
    this.maxEvaluations = options.maxEvaluations ?? 10000;
    this._diagnostics = [];
  }

  variable(name, min, max) {
    const lo = Number(min);
    const hi = Number(max);
    if (lo > hi) {
      throw new Error(`Invalid interval for ${name}: ${lo} > ${hi}`);
    }
    this.variables.set(name, { min: lo, max: hi });
    return this;
  }

  constraint(expr) {
    // expr is an expression array to be evaluated against an assignment
    this.constraints.push(expr);
    return this;
  }

  objective(expr) {
    this.objectiveExpr = expr;
    return this;
  }

  query(name) {
    this.queries.push(name);
    return this;
  }

  solve() {
    const stats = { evaluations: 0, combinations: 0 };
    const varNames = Array.from(this.variables.keys());

    // Quick contradiction: empty or invalid intervals
    let product = 1;
    for (const [name, spec] of this.variables) {
      const size = spec.max - spec.min + 1;
      if (size <= 0) {
        this._diagnostics.push(`Empty interval for ${name}`);
        return { status: 'unsat_early', solution: null, stats, diagnostics: this._diagnostics };
      }
      product *= size;
    }

    if (product > this.maxProductOfDomains) {
      this._diagnostics.push(`Domain product ${product} exceeds max ${this.maxProductOfDomains}`);
      return { status: 'too_complex', solution: null, stats, diagnostics: this._diagnostics };
    }

    const solutions = [];

    const evaluate = (assignment) => {
      // Build a tiny context for expression evaluation
      const ctx = { getRegister: (n) => assignment[n] };
      for (const c of this.constraints) {
        stats.evaluations += 1;
        if (!this._evalExpr(c, ctx)) {
          return false;
        }
      }
      return true;
    };

    const search = (index, assignment) => {
      if (stats.combinations >= this.maxEvaluations) {
        return;
      }
      if (index >= varNames.length) {
        stats.combinations += 1;
        if (evaluate(assignment)) {
          const sol = { ...assignment };
          if (this.objectiveExpr) {
            const ctx = { getRegister: (n) => assignment[n] };
            sol._objective = this._evalExpr(this.objectiveExpr, ctx);
          }
          solutions.push(sol);
        }
        return;
      }
      const name = varNames[index];
      const { min, max } = this.variables.get(name);
      for (let v = min; v <= max; v += 1) {
        assignment[name] = v;
        search(index + 1, assignment);
      }
      delete assignment[name];
    };

    search(0, {});

    if (solutions.length === 0) {
      return { status: 'unsat_early', solution: null, stats, diagnostics: this._diagnostics };
    }

    // If objective present, pick optimal
    let best = solutions[0];
    if (this.objectiveExpr) {
      for (const sol of solutions) {
        if (sol._objective < best._objective) {
          best = sol;
        }
      }
    }

    return {
      status: 'solved',
      solution: best,
      stats,
      diagnostics: this._diagnostics,
    };
  }

  _evalExpr(expr, ctx) {
    if (!Array.isArray(expr)) {
      if (typeof expr === 'string' && expr.startsWith('$')) {
        return ctx.getRegister(expr.slice(1));
      }
      return expr;
    }
    const [op, ...args] = expr;
    switch (op) {
      case 'ref':
        return ctx.getRegister(String(args[0] ?? '').replace(/^\$/, ''));
      case 'eq':
        return this._evalExpr(args[0], ctx) === this._evalExpr(args[1], ctx);
      case 'neq':
        return this._evalExpr(args[0], ctx) !== this._evalExpr(args[1], ctx);
      case 'gt':
        return Number(this._evalExpr(args[0], ctx)) > Number(this._evalExpr(args[1], ctx));
      case 'lt':
        return Number(this._evalExpr(args[0], ctx)) < Number(this._evalExpr(args[1], ctx));
      case 'gte':
        return Number(this._evalExpr(args[0], ctx)) >= Number(this._evalExpr(args[1], ctx));
      case 'lte':
        return Number(this._evalExpr(args[0], ctx)) <= Number(this._evalExpr(args[1], ctx));
      case 'add':
        return Number(this._evalExpr(args[0], ctx)) + Number(this._evalExpr(args[1], ctx));
      case 'sub':
        return Number(this._evalExpr(args[0], ctx)) - Number(this._evalExpr(args[1], ctx));
      case 'mul':
        return Number(this._evalExpr(args[0], ctx)) * Number(this._evalExpr(args[1], ctx));
      case 'div': {
        const d = Number(this._evalExpr(args[1], ctx));
        return d === 0 ? Infinity : Number(this._evalExpr(args[0], ctx)) / d;
      }
      case 'and':
        return args.every((a) => this._evalExpr(a, ctx));
      case 'or':
        return args.some((a) => this._evalExpr(a, ctx));
      case 'not':
        return !this._evalExpr(args[0], ctx);
      default:
        throw new Error(`Unsupported numeric expression operator: ${op}`);
    }
  }
}
