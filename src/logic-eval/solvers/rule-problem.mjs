/**
 * RuleProblem – finite forward-chaining deduction.
 * Returns { status, solution: { facts, answers }, stats, diagnostics }
 */

export class RuleProblem {
  constructor(options = {}) {
    this.facts = [];
    this.rules = [];
    this.queries = [];
    this.maxIterations = options.maxIterations ?? 100;
    this.maxDerivedFacts = options.maxDerivedFacts ?? 500;
    this._diagnostics = [];
  }

  fact(predicate, args) {
    this.facts.push({ predicate, args: args.map(String) });
    return this;
  }

  rule(head, body) {
    this.rules.push({
      head: { predicate: head.predicate, args: head.args.map(String) },
      body: body.map((b) => ({ predicate: b.predicate, args: b.args.map(String) })),
    });
    return this;
  }

  queryFact(predicate, args) {
    this.queries.push({ type: 'fact', predicate, args: args.map(String) });
    return this;
  }

  queryAll(predicate) {
    this.queries.push({ type: 'all', predicate });
    return this;
  }

  _unify(pattern, fact, binding) {
    const newBinding = { ...binding };
    for (let i = 0; i < pattern.args.length; i += 1) {
      const p = pattern.args[i];
      const f = fact.args[i];
      if (p.startsWith('?')) {
        if (p in newBinding) {
          if (newBinding[p] !== f) {
            return null;
          }
        } else {
          newBinding[p] = f;
        }
      } else if (p !== f) {
        return null;
      }
    }
    return newBinding;
  }

  _applyBinding(pattern, binding) {
    return {
      predicate: pattern.predicate,
      args: pattern.args.map((a) => (a.startsWith('?') ? binding[a] : a)),
    };
  }

  solve() {
    const stats = { iterations: 0, derivedFacts: 0, rulesFired: 0 };
    const known = new Set(this.facts.map((f) => JSON.stringify(f)));
    const factsList = [...this.facts];

    let changed = true;
    while (changed && stats.iterations < this.maxIterations && known.size < this.maxDerivedFacts) {
      changed = false;
      stats.iterations += 1;

      for (const rule of this.rules) {
        const newFacts = this._fireRule(rule, factsList);
        for (const nf of newFacts) {
          const key = JSON.stringify(nf);
          if (!known.has(key)) {
            known.add(key);
            factsList.push(nf);
            stats.derivedFacts += 1;
            stats.rulesFired += 1;
            changed = true;
          }
        }
      }
    }

    if (stats.iterations >= this.maxIterations) {
      this._diagnostics.push('Reached max iterations');
      return {
        status: 'too_complex',
        solution: { facts: factsList, answers: [] },
        stats,
        diagnostics: this._diagnostics,
      };
    }

    if (known.size >= this.maxDerivedFacts) {
      this._diagnostics.push('Reached max derived facts');
      return {
        status: 'too_complex',
        solution: { facts: factsList, answers: [] },
        stats,
        diagnostics: this._diagnostics,
      };
    }

    const answers = [];
    for (const q of this.queries) {
      if (q.type === 'fact') {
        const exists = factsList.some(
          (f) => f.predicate === q.predicate && f.args.length === q.args.length && f.args.every((a, i) => a === q.args[i]),
        );
        answers.push({ query: q, result: exists });
      } else if (q.type === 'all') {
        const matches = factsList.filter((f) => f.predicate === q.predicate);
        answers.push({ query: q, result: matches });
      }
    }

    return {
      status: 'solved',
      solution: { facts: factsList, answers },
      stats,
      diagnostics: this._diagnostics,
    };
  }

  _fireRule(rule, factsList) {
    const results = [];
    this._matchBody(rule.body, 0, {}, factsList, (binding) => {
      results.push(this._applyBinding(rule.head, binding));
    });
    return results;
  }

  _matchBody(body, index, binding, factsList, onMatch) {
    if (index >= body.length) {
      onMatch(binding);
      return;
    }
    const pattern = body[index];
    for (const fact of factsList) {
      if (fact.predicate !== pattern.predicate) {
        continue;
      }
      const unified = this._unify(pattern, fact, binding);
      if (unified) {
        this._matchBody(body, index + 1, unified, factsList, onMatch);
      }
    }
  }
}
