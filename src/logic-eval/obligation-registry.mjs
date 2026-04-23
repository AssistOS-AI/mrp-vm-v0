/**
 * ObligationRegistry – static description of minimum requirements per solver class.
 */

const REGISTRY = {
  RuleProblem: {
    requiredFields: ['facts', 'rules', 'queries'],
    obligations: [
      'At least one fact or rule must be declared.',
      'Queries must specify a predicate.',
    ],
    quickContradictions: [
      'Incompatible arities for the same predicate.',
      'Undeclared predicates in rules or queries.',
      'Impossible references (unknown predicate names).',
    ],
    limits: {
      maxIterations: { default: 100, max: 10000 },
      maxDerivedFacts: { default: 500, max: 50000 },
    },
  },
  ConstraintProblem: {
    requiredFields: ['domains', 'constraints', 'queries'],
    obligations: [
      'All variables must have finite domains.',
      'Cardinality or uniqueness relations must be consistent.',
    ],
    quickContradictions: [
      'Empty domains.',
      'Impossible cardinalities.',
      'Simultaneous require and forbid on the same instance.',
      'Strict cyclic orderings.',
    ],
    limits: {
      maxBacktrackingNodes: { default: 1000, max: 100000 },
      maxSolutions: { default: 1, max: 1000 },
    },
  },
  GraphProblem: {
    requiredFields: ['nodes', 'edges', 'query'],
    obligations: [
      'Nodes and edges must be declared before query.',
      'Query must be one of the supported graph queries.',
    ],
    quickContradictions: [
      'Query references nonexistent nodes.',
      'Topological order requested on a cyclic graph.',
    ],
    limits: {
      maxNodes: { default: 1000, max: 50000 },
      maxEdges: { default: 5000, max: 200000 },
      maxExpansions: { default: 10000, max: 500000 },
    },
  },
  SearchProblem: {
    requiredFields: ['initialState', 'goalState', 'actions', 'strategy'],
    obligations: [
      'Initial state and goal state must be objects.',
      'At least one action must be defined.',
      'Strategy must be bfs or dfs.',
    ],
    quickContradictions: [
      'Goal incompatible with trivial invariants (e.g., goal key absent from all actions).',
      'Total absence of actions that can progress toward the goal.',
    ],
    limits: {
      maxDepth: { default: 20, max: 1000 },
      maxFrontier: { default: 1000, max: 50000 },
      maxVisitedStates: { default: 5000, max: 500000 },
    },
  },
  NumericProblem: {
    requiredFields: ['variables', 'constraints'],
    obligations: [
      'All variables must have finite intervals [min, max].',
      'Constraints must be well-formed arithmetic expressions.',
    ],
    quickContradictions: [
      'Incompatible intervals (min > max).',
      'References to undeclared variables in constraints.',
      'Evidently inconsistent inequalities.',
    ],
    limits: {
      maxProductOfDomains: { default: 10000, max: 1000000 },
      maxEvaluations: { default: 10000, max: 1000000 },
    },
  },
};

export class ObligationRegistry {
  static get(contractName) {
    return REGISTRY[contractName] ?? null;
  }

  static listContracts() {
    return Object.keys(REGISTRY);
  }

  static checkObligations(contractName, solverConfig, solverCalls) {
    const contract = REGISTRY[contractName];
    if (!contract) {
      return { valid: false, missing: [`Unknown solver contract: ${contractName}`] };
    }

    const missing = [];

    // Check that required structural calls were made
    const callMethods = new Set(solverCalls.map((c) => c.method));
    for (const field of contract.requiredFields) {
      if (field === 'query') {
        if (!callMethods.has('query') && !callMethods.has('findPath') && !callMethods.has('findShortestPath') && !callMethods.has('findReachableFrom') && !callMethods.has('findTopologicalOrder')) {
          missing.push(`Missing query for ${contractName}`);
        }
      } else if (field === 'constraints') {
        if (!callMethods.has('constraint') && !callMethods.has('require') && !callMethods.has('forbid') && !callMethods.has('implies') && !callMethods.has('exactlyOne') && !callMethods.has('atMostOne') && !callMethods.has('before') && !callMethods.has('nextTo')) {
          missing.push(`Missing constraints for ${contractName}`);
        }
      } else if (field === 'actions') {
        if (!callMethods.has('action')) {
          missing.push(`Missing actions for ${contractName}`);
        }
      } else if (field === 'edges') {
        if (!callMethods.has('edge') && !callMethods.has('undirectedEdge')) {
          missing.push(`Missing edges for ${contractName}`);
        }
      } else if (field === 'nodes') {
        if (!callMethods.has('node')) {
          missing.push(`Missing nodes for ${contractName}`);
        }
      } else if (field === 'rules') {
        if (!callMethods.has('rule') && !callMethods.has('fact')) {
          missing.push(`Missing rules or facts for ${contractName}`);
        }
      } else if (field === 'facts') {
        if (!callMethods.has('fact') && !callMethods.has('rule')) {
          missing.push(`Missing facts or rules for ${contractName}`);
        }
      } else if (field === 'domains') {
        if (!callMethods.has('domain')) {
          missing.push(`Missing domains for ${contractName}`);
        }
      } else if (field === 'variables') {
        if (!callMethods.has('variable')) {
          missing.push(`Missing variables for ${contractName}`);
        }
      } else if (field === 'initialState') {
        if (!callMethods.has('initialState')) {
          missing.push(`Missing initialState for ${contractName}`);
        }
      } else if (field === 'goalState') {
        if (!callMethods.has('goalState')) {
          missing.push(`Missing goalState for ${contractName}`);
        }
      } else if (field === 'strategy') {
        if (!callMethods.has('strategy')) {
          missing.push(`Missing strategy for ${contractName}`);
        }
      }
    }

    // Check limits
    if (solverConfig && contract.limits) {
      for (const [limitName, spec] of Object.entries(contract.limits)) {
        const val = solverConfig[limitName];
        if (val !== undefined && val > spec.max) {
          missing.push(`Limit ${limitName}=${val} exceeds maximum ${spec.max} for ${contractName}`);
        }
      }
    }

    return { valid: missing.length === 0, missing };
  }
}
