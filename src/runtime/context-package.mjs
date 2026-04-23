import { canonicalText, toSummaryText } from '../utils/text.mjs';
import { deriveFamilyExecutionStatus } from './state-store.mjs';

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
  const status = deriveFamilyExecutionStatus(family);
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

  const directDependencies = node.dependencies.length === 0
    ? []
    : node.dependencies.map((reference) => {
      const resolvedVariant = resolvedDependencies.get(reference.raw) ?? null;
      return {
        raw: reference.raw,
        family_id: reference.familyId,
        variant_id: reference.variantId ?? null,
        target_id: resolvedVariant?.id ?? null,
        value_summary: resolvedVariant ? toSummaryText(resolvedVariant.rendered, 220) : '[missing]',
      };
    });

  const resolvedFamilyState = [...involvedFamilies].map((familyId) => {
    const family = stateStore.getFamily(familyId);
    const representative = family ? stateStore.representativeCache.get(familyId) : null;
    return {
      family_id: familyId,
      status: family ? deriveFamilyExecutionStatus(family) : 'missing',
      representative_id: representative?.id ?? null,
      variants: family?.variants?.length ?? 0,
    };
  });

  const selectedKnowledgeUnits = kbResult.selected.map((entry) => ({
    ku_id: entry.kuId,
    scope: entry.scope,
    rev: entry.meta.rev,
    title: entry.meta.title ?? entry.kuId,
    summary: entry.meta.summary ?? '',
    ku_type: entry.meta.ku_type ?? 'content',
    commands: entry.meta.commands ?? [],
    interpreters: entry.meta.interpreters ?? [],
    tags: entry.meta.tags ?? [],
  }));

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
    sections: {
      task: {
        target_family: node.targetFamily,
        body: node.declaration.body || '[empty declaration body]',
      },
      user_request: requestText || '[missing request text]',
      direct_dependencies: directDependencies,
      resolved_family_state: resolvedFamilyState,
      knowledge_units: selectedKnowledgeUnits,
      analytic_summaries: analytics.map((entry) => ({
        key: entry.key,
        value_summary: toSummaryText(entry.value),
      })),
      planning_notes: planningNotes.map((entry) => toSummaryText(entry)),
    },
    selectedItems: kbResult.selected.map((entry) => ({
      kind: 'ku',
      id: entry.kuId,
      rev: entry.meta.rev,
    })),
    prunedItems: kbResult.pruned,
    byteCount: Buffer.byteLength(markdown, 'utf8'),
  };
}
