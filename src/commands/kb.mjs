export async function executeKbCommand(context) {
  const {
    runtime,
    request,
    body,
  } = context;

  const retrieval = await runtime.retrieveKnowledge(request.kbSnapshot, {
    callerName: 'kb',
    retrievalMode: 'explicit_kb_query',
    requestText: body,
    queryTokens: [body],
    desiredKuTypes: [],
    byteBudget: 4_096,
  });

  return {
    emittedVariants: [{
      familyId: context.targetFamily,
      value: retrieval.selected.map((entry) => ({
        kuId: entry.kuId,
        summary: entry.meta.summary,
        content: entry.content,
        usage: entry.usage ?? null,
        usage_reference: entry.usage_reference ?? `~${entry.kuId}`,
        aspect_ids: entry.aspect_ids ?? [],
        index_state: entry.index_state ?? null,
      })),
      meta: {
        origin: 'kb',
        retrieval_mode: retrieval.mode ?? runtime.getKbRetrievalMode?.() ?? 'naive_symbolic',
        snapshot_version: retrieval.explanation?.snapshotVersion ?? null,
        active_aspects: retrieval.explanation?.activeAspects ?? [],
        pruned: retrieval.pruned ?? [],
      },
    }],
    metadataUpdates: [],
    withdrawals: [],
    declarationInsertions: [],
    failure: null,
  };
}
