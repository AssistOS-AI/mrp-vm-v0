import { createEmptyEffects } from '../runtime/effects.mjs';
import { toSummaryText } from '../utils/text.mjs';

function baseScore(variant) {
  let score = Number(variant.meta.score ?? 0);
  score += variant.meta.trust === 'canonical' ? 20 : variant.meta.trust === 'trusted' ? 10 : 0;
  score += variant.meta.priority ?? 0;
  score += typeof variant.value === 'string' ? Math.min(variant.value.length, 40) / 10 : 1;
  return score;
}

export async function executeCredibilityCommand(context) {
  const effects = createEmptyEffects();
  const family = context.runtime.stateStore.getFamily(context.targetFamily);
  if (!family) {
    return effects;
  }

  const candidates = family.variants.filter((variant) => variant.meta.status !== 'withdrawn');
  if (candidates.length <= 1) {
    return effects;
  }

  const scored = candidates.map((variant) => ({
    variant,
    score: baseScore(variant),
  })).sort((left, right) => right.score - left.score);

  const winner = scored[0];
  const maxScore = winner.score || 1;

  for (const item of scored) {
    effects.metadataUpdates.push({
      targetId: item.variant.id,
      patch: {
        score: item.score,
        score_pct: Number(((item.score / maxScore) * 100).toFixed(2)),
        reason: `heuristic comparison against ${context.targetFamily}`,
        confidence: 'baseline',
      },
    });
  }

  for (const item of scored.slice(1)) {
    effects.metadataUpdates.push({
      targetId: item.variant.id,
      patch: {
        withdrawn: true,
        status: 'withdrawn',
        reason: `Credibility preferred ${winner.variant.id}`,
      },
    });
  }

  if (context.body.includes('gather more evidence')) {
    effects.declarationInsertions.push({
      text: `@${context.targetFamily}_evidence writerLLM\nNeed more evidence for ${context.targetFamily}: ${toSummaryText(context.body)}`,
      meta: {
        source_interpreter: 'credibility',
      },
    });
  }

  return effects;
}

export async function resolvePluralFamily(runtime, familyId, candidates, context = {}) {
  const commandContext = {
    ...context,
    runtime,
    targetFamily: familyId,
    body: context.reason ?? `Resolve ambiguity for ${familyId}`,
  };
  const effects = await executeCredibilityCommand(commandContext);
  runtime.applyEffects(effects, {
    sessionId: context.sessionId,
    requestId: context.requestId,
    epochNumber: context.epochNumber,
    source: 'credibility',
  });

  return candidates
    .map((variant) => runtime.stateStore.getVariant(variant.id))
    .filter(Boolean)
    .sort((left, right) => {
      const leftScore = Number(left.meta.score ?? 0);
      const rightScore = Number(right.meta.score ?? 0);
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return right.version - left.version;
    })[0] ?? candidates[0];
}
