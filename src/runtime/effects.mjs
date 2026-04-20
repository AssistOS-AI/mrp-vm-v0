export function createEmptyEffects() {
  return {
    emittedVariants: [],
    metadataUpdates: [],
    withdrawals: [],
    declarationInsertions: [],
    failure: null,
  };
}

export function hasStructuralEffects(effects) {
  return effects.emittedVariants.length > 0
    || effects.metadataUpdates.length > 0
    || effects.withdrawals.length > 0
    || effects.declarationInsertions.length > 0;
}
