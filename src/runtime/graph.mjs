import { parsePlan } from '../lang/parser.mjs';

function topologicalSort(nodes, edges) {
  const incoming = new Map();
  const outgoing = new Map();

  for (const node of nodes) {
    incoming.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const edge of edges) {
    outgoing.get(edge.from).push(edge.to);
    incoming.set(edge.to, incoming.get(edge.to) + 1);
  }

  const queue = [...nodes.filter((node) => incoming.get(node.id) === 0)]
    .sort((left, right) => left.order - right.order);
  const ordered = [];

  while (queue.length > 0) {
    const current = queue.shift();
    ordered.push(current);

    for (const nextId of outgoing.get(current.id)) {
      incoming.set(nextId, incoming.get(nextId) - 1);
      if (incoming.get(nextId) === 0) {
        const node = nodes.find((entry) => entry.id === nextId);
        queue.push(node);
        queue.sort((left, right) => left.order - right.order);
      }
    }
  }

  if (ordered.length !== nodes.length) {
    throw new Error('Static cycle detected in SOP declaration graph.');
  }

  return ordered;
}

export function compileGraph(planText) {
  const parsed = parsePlan(planText);
  const targetToNodes = new Map();
  const nodes = parsed.declarations.map((declaration, index) => {
    const node = {
      id: declaration.declaration_id,
      declaration,
      order: index,
      targetFamily: declaration.target,
      dependencies: declaration.references.map((reference) => ({
        kind: reference.kind,
        familyId: reference.family,
        variantId: reference.variant,
        raw: reference.raw,
      })),
      predecessorIds: [],
      externalDependencies: [],
      topologicalLevel: 0,
    };

    const list = targetToNodes.get(declaration.target) ?? [];
    list.push(node.id);
    targetToNodes.set(declaration.target, list);
    return node;
  });

  const edges = [];
  for (const node of nodes) {
    for (const dependency of node.dependencies) {
      const producers = targetToNodes.get(dependency.familyId) ?? [];
      if (producers.length === 0 || dependency.variantId) {
        node.externalDependencies.push(dependency);
        continue;
      }

      for (const producerId of producers) {
        if (producerId === node.id) {
          throw new Error(`Self-cycle detected for family ${dependency.familyId}.`);
        }
        edges.push({ from: producerId, to: node.id });
      }
      node.predecessorIds.push(...producers);
    }
  }

  const ordered = topologicalSort(nodes, edges);
  const levelByNode = new Map();
  for (const node of ordered) {
    const level = node.predecessorIds.length === 0
      ? 0
      : Math.max(...node.predecessorIds.map((id) => levelByNode.get(id) ?? 0)) + 1;
    levelByNode.set(node.id, level);
    node.topologicalLevel = level;
  }

  const strata = [];
  for (const node of ordered) {
    const level = node.topologicalLevel;
    if (!strata[level]) {
      strata[level] = [];
    }
    strata[level].push(node);
  }

  return {
    parsed,
    nodes,
    edges,
    strata: strata.filter(Boolean),
  };
}
