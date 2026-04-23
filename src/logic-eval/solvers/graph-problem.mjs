/**
 * GraphProblem – reachability, paths, and orderings.
 * Returns { status, solution, stats, diagnostics }
 */

export class GraphProblem {
  constructor(options = {}) {
    this.nodes = new Set();
    this.edges = [];
    this.queryType = null;
    this.queryArgs = null;
    this.maxNodes = options.maxNodes ?? 1000;
    this.maxEdges = options.maxEdges ?? 5000;
    this.maxExpansions = options.maxExpansions ?? 10000;
    this._diagnostics = [];
  }

  node(id) {
    this.nodes.add(String(id));
    return this;
  }

  edge(from, to, weight = 1) {
    this.edges.push({ from: String(from), to: String(to), weight: Number(weight) });
    return this;
  }

  undirectedEdge(from, to, weight = 1) {
    this.edge(from, to, weight);
    this.edge(to, from, weight);
    return this;
  }

  findPath(from, to) {
    this.queryType = 'path';
    this.queryArgs = { from: String(from), to: String(to) };
    return this;
  }

  findShortestPath(from, to) {
    this.queryType = 'shortestPath';
    this.queryArgs = { from: String(from), to: String(to) };
    return this;
  }

  findReachableFrom(from) {
    this.queryType = 'reachable';
    this.queryArgs = { from: String(from) };
    return this;
  }

  findTopologicalOrder() {
    this.queryType = 'topologicalOrder';
    this.queryArgs = {};
    return this;
  }

  solve() {
    const stats = { expansions: 0, nodesVisited: 0, edgesVisited: 0 };

    if (this.nodes.size > this.maxNodes) {
      this._diagnostics.push(`Node count ${this.nodes.size} exceeds max ${this.maxNodes}`);
      return { status: 'too_complex', solution: null, stats, diagnostics: this._diagnostics };
    }
    if (this.edges.length > this.maxEdges) {
      this._diagnostics.push(`Edge count ${this.edges.length} exceeds max ${this.maxEdges}`);
      return { status: 'too_complex', solution: null, stats, diagnostics: this._diagnostics };
    }

    // Quick contradiction: query on nonexistent nodes
    if (this.queryArgs?.from && !this.nodes.has(this.queryArgs.from)) {
      this._diagnostics.push(`Source node ${this.queryArgs.from} does not exist`);
      return { status: 'unsat_early', solution: null, stats, diagnostics: this._diagnostics };
    }
    if (this.queryArgs?.to && !this.nodes.has(this.queryArgs.to)) {
      this._diagnostics.push(`Target node ${this.queryArgs.to} does not exist`);
      return { status: 'unsat_early', solution: null, stats, diagnostics: this._diagnostics };
    }

    const adj = new Map();
    for (const n of this.nodes) {
      adj.set(n, []);
    }
    for (const e of this.edges) {
      adj.get(e.from).push(e);
      stats.edgesVisited += 1;
    }

    switch (this.queryType) {
      case 'path':
        return this._solvePath(adj, stats);
      case 'shortestPath':
        return this._solveShortestPath(adj, stats);
      case 'reachable':
        return this._solveReachable(adj, stats);
      case 'topologicalOrder':
        return this._solveTopological(adj, stats);
      default:
        this._diagnostics.push('No query set on GraphProblem');
        return { status: 'invalid_program', solution: null, stats, diagnostics: this._diagnostics };
    }
  }

  _solvePath(adj, stats) {
    const { from, to } = this.queryArgs;
    const visited = new Set();
    const queue = [[from]];
    while (queue.length > 0) {
      if (stats.expansions >= this.maxExpansions) {
        this._diagnostics.push('Reached max expansions');
        return { status: 'too_complex', solution: null, stats, diagnostics: this._diagnostics };
      }
      const path = queue.shift();
      const node = path[path.length - 1];
      if (node === to) {
        return {
          status: 'solved',
          solution: { path, cost: path.length - 1 },
          stats,
          diagnostics: this._diagnostics,
        };
      }
      if (visited.has(node)) {
        continue;
      }
      visited.add(node);
      stats.nodesVisited += 1;
      for (const e of adj.get(node) ?? []) {
        stats.expansions += 1;
        if (!visited.has(e.to)) {
          queue.push([...path, e.to]);
        }
      }
    }
    return { status: 'unsat_early', solution: null, stats, diagnostics: this._diagnostics };
  }

  _solveShortestPath(adj, stats) {
    const { from, to } = this.queryArgs;
    const dist = new Map();
    const prev = new Map();
    const unvisited = new Set(this.nodes);
    for (const n of this.nodes) {
      dist.set(n, Infinity);
    }
    dist.set(from, 0);

    while (unvisited.size > 0) {
      if (stats.expansions >= this.maxExpansions) {
        this._diagnostics.push('Reached max expansions');
        return { status: 'too_complex', solution: null, stats, diagnostics: this._diagnostics };
      }
      let u = null;
      let minDist = Infinity;
      for (const n of unvisited) {
        if (dist.get(n) < minDist) {
          minDist = dist.get(n);
          u = n;
        }
      }
      if (u === null || minDist === Infinity) {
        break;
      }
      unvisited.delete(u);
      stats.nodesVisited += 1;

      if (u === to) {
        const path = [];
        let cur = to;
        while (cur !== undefined) {
          path.unshift(cur);
          cur = prev.get(cur);
        }
        return {
          status: 'solved',
          solution: { path, cost: dist.get(to) },
          stats,
          diagnostics: this._diagnostics,
        };
      }

      for (const e of adj.get(u) ?? []) {
        stats.expansions += 1;
        const alt = dist.get(u) + e.weight;
        if (alt < dist.get(e.to)) {
          dist.set(e.to, alt);
          prev.set(e.to, u);
        }
      }
    }

    return { status: 'unsat_early', solution: null, stats, diagnostics: this._diagnostics };
  }

  _solveReachable(adj, stats) {
    const { from } = this.queryArgs;
    const visited = new Set();
    const queue = [from];
    visited.add(from);
    while (queue.length > 0) {
      if (stats.expansions >= this.maxExpansions) {
        this._diagnostics.push('Reached max expansions');
        return { status: 'too_complex', solution: null, stats, diagnostics: this._diagnostics };
      }
      const node = queue.shift();
      stats.nodesVisited += 1;
      for (const e of adj.get(node) ?? []) {
        stats.expansions += 1;
        if (!visited.has(e.to)) {
          visited.add(e.to);
          queue.push(e.to);
        }
      }
    }
    return {
      status: 'solved',
      solution: { reachable: Array.from(visited) },
      stats,
      diagnostics: this._diagnostics,
    };
  }

  _solveTopological(adj, stats) {
    const inDegree = new Map();
    for (const n of this.nodes) {
      inDegree.set(n, 0);
    }
    for (const e of this.edges) {
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    }

    const queue = [];
    for (const [n, d] of inDegree) {
      if (d === 0) {
        queue.push(n);
      }
    }

    const order = [];
    while (queue.length > 0) {
      if (stats.expansions >= this.maxExpansions) {
        this._diagnostics.push('Reached max expansions');
        return { status: 'too_complex', solution: null, stats, diagnostics: this._diagnostics };
      }
      const n = queue.shift();
      order.push(n);
      stats.nodesVisited += 1;
      for (const e of adj.get(n) ?? []) {
        stats.expansions += 1;
        const newDegree = inDegree.get(e.to) - 1;
        inDegree.set(e.to, newDegree);
        if (newDegree === 0) {
          queue.push(e.to);
        }
      }
    }

    if (order.length !== this.nodes.size) {
      this._diagnostics.push('Graph contains a cycle');
      return { status: 'unsat_early', solution: null, stats, diagnostics: this._diagnostics };
    }

    return {
      status: 'solved',
      solution: { order },
      stats,
      diagnostics: this._diagnostics,
    };
  }
}
