import { createEmptyEffects } from '../runtime/effects.mjs';

const REQUIRED_GROUPS = {
  new_session_request: 'planning_init_core',
  continuing_session_request: 'planning_continue_core',
  error_triggered_repair: 'planning_repair_core',
};

export async function executePlanning(context) {
  const effects = createEmptyEffects();
  const requiredGroup = REQUIRED_GROUPS[context.mode];
  if (!requiredGroup) {
    throw new Error(`Unknown planning mode: ${context.mode}`);
  }

  const kbResult = context.runtime.kbStore.retrieve(context.request.kbSnapshot, {
    callerName: 'planning',
    retrievalMode: 'planning_bootstrap',
    desiredKuTypes: ['prompt_asset'],
    requiredPromptGroups: [requiredGroup],
    requestText: context.request.requestText,
    domainHints: context.request.domainHints ?? [],
    byteBudget: 8_192,
  });

  if (!kbResult.selected.some((entry) => entry.meta.mandatory_group === requiredGroup)) {
    effects.failure = {
      kind: 'resolution_error',
      message: `Missing required planning prompt group: ${requiredGroup}`,
      origin: 'planning',
      repairable: false,
    };
    return effects;
  }

  const adapterEffects = await context.runtime.externalInterpreters.invoke('plannerLLM', {
    body: context.request.requestText,
    targetFamily: context.targetFamily,
    promptAssets: kbResult.selected,
    expectedOutputMode: 'sop_proposal',
    traceContext: {
      session_id: context.sessionId,
      request_id: context.requestId,
      epoch_id: context.epochNumber,
      mode: context.mode,
    },
    contextPackage: {
      markdown: JSON.stringify({
        mode: context.mode,
        current_plan: context.request.planText ?? null,
        request_text: context.request.requestText,
        session_summary: context.request.sessionSummary ?? {},
        budgets: context.request.budgets,
      }, null, 2),
    },
  });

  if (adapterEffects.failure) {
    return adapterEffects;
  }

  if (adapterEffects.declarationInsertions.length > 0) {
    effects.declarationInsertions.push(...adapterEffects.declarationInsertions);
    return effects;
  }

  if (adapterEffects.emittedVariants.length > 0) {
    effects.declarationInsertions.push({
      text: String(adapterEffects.emittedVariants[0].value),
      meta: {
        source_interpreter: 'plannerLLM',
      },
    });
  }

  return effects;
}
