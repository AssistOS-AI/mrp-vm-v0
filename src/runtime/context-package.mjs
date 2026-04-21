import { canonicalText, toSummaryText } from '../utils/text.mjs';

function renderDependency(reference, resolvedVariant) {
  const label = reference.variantId
    ? `${reference.familyId}:${reference.variantId}`
    : reference.familyId;
  const variantId = resolvedVariant ? resolvedVariant.id : 'unresolved';
  const value = resolvedVariant ? resolvedVariant.rendered : '[missing]';
  return `- ${reference.raw} -> ${variantId}\n\n${value}`;
}

function renderFamilyState(stateStore, familyId) {
  const family = stateStore.getFamily(familyId);
  if (!family) {
    return `- ${familyId}: missing`;
  }
  const representative = stateStore.representativeCache.get(familyId);
  const status = family.familyMeta.status ?? 'pending';
  const representativeLabel = representative ? representative.id : 'none';
  return `- ${familyId}: status=${status}, representative=${representativeLabel}, variants=${family.variants.length}`;
}

function renderKnowledgeUnit(entry) {
  const appliedTo = [
    ...(entry.meta.commands ?? []),
    ...(entry.meta.interpreters ?? []),
  ].filter(Boolean);
  const summary = entry.meta.summary
    ? `Selection summary: ${entry.meta.summary}`
    : 'Selection summary: [missing]';
  const scopeLine = `Scope: ${entry.scope} | Type: ${entry.meta.ku_type ?? 'content'}`;
  const appliesLine = appliedTo.length > 0
    ? `Applies to: ${appliedTo.join(', ')}`
    : null;
  return [
    `## ${entry.meta.title || entry.kuId}`,
    summary,
    scopeLine,
    appliesLine,
    '',
    entry.content,
  ].filter(Boolean).join('\n');
}

export function buildContextPackage(input) {
  const {
    node,
    requestText = '',
    resolvedDependencies,
    stateStore,
    kbResult,
    analytics = [],
    planningNotes = [],
  } = input;

  const directDependencySection = node.dependencies.length === 0
    ? '- none'
    : node.dependencies
      .map((reference) => renderDependency(reference, resolvedDependencies.get(reference.raw) ?? null))
      .join('\n\n');

  const involvedFamilies = new Set(node.dependencies.map((reference) => reference.familyId));
  involvedFamilies.add(node.targetFamily);
  const resolvedFamilyStateSection = [...involvedFamilies]
    .map((familyId) => renderFamilyState(stateStore, familyId))
    .join('\n');

  const knowledgeUnitSection = kbResult.selected.length === 0
    ? '- none'
    : kbResult.selected.map(renderKnowledgeUnit).join('\n\n');

  const analyticSection = analytics.length === 0
    ? '- none'
    : analytics.map((entry) => `- ${entry.key}: ${canonicalText(entry.value)}`).join('\n');

  const planningNotesSection = planningNotes.length === 0
    ? '- none'
    : planningNotes.map((entry) => `- ${toSummaryText(entry)}`).join('\n');

  const markdown = [
    '# Task',
    `Target family: ${node.targetFamily}`,
    '',
    node.declaration.body || '[empty declaration body]',
    '',
    '# User Request',
    requestText || '[missing request text]',
    '',
    '# Direct Dependencies',
    directDependencySection,
    '',
    '# Resolved Family State',
    resolvedFamilyStateSection,
    '',
    '# Knowledge Units',
    knowledgeUnitSection,
    '',
    '# Analytic Summaries',
    analyticSection,
    '',
    '# Planning Notes',
    planningNotesSection,
    '',
  ].join('\n');

  return {
    markdown,
    selectedItems: kbResult.selected.map((entry) => ({
      kind: 'ku',
      id: entry.kuId,
      rev: entry.meta.rev,
    })),
    prunedItems: kbResult.pruned,
    byteCount: Buffer.byteLength(markdown, 'utf8'),
  };
}
