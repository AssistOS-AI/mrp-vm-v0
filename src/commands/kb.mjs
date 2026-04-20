export async function executeKbCommand(context) {
  const {
    runtime,
    request,
    body,
  } = context;

  const retrieval = runtime.kbStore.retrieve(request.kbSnapshot, {
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
      })),
      meta: {
        origin: 'kb',
      },
    }],
    metadataUpdates: [],
    withdrawals: [],
    declarationInsertions: [],
    failure: null,
  };
}
