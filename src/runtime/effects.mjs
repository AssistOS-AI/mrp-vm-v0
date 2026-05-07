export function createEmptyEffects() {
  return {
    emittedVariants: [],
    metadataUpdates: [],
    withdrawals: [],
    declarationInsertions: [],
    failure: null,
  };
}

export function hasStructuralMetadataUpdates(metadataUpdates = []) {
  return metadataUpdates.some((entry) => entry?.structuralImpact !== false);
}

export function hasStructuralEffects(effects) {
  return effects.emittedVariants.length > 0
    || hasStructuralMetadataUpdates(effects.metadataUpdates)
    || effects.withdrawals.length > 0
    || effects.declarationInsertions.length > 0;
}
