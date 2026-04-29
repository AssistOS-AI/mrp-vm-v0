function clone(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => clone(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  }
  return value;
}

export class AdvancedReasoningResult {
  constructor(raw = {}, kind = 'advanced') {
    this.raw = raw ?? {};
    this.kind = kind;
  }

  status() {
    return this.raw.status ?? 'reasoned';
  }

  isSolved() {
    return this.status() === 'solved' || this.status() === 'reasoned';
  }

  isPartial() {
    return this.status() === 'partial';
  }

  needsEngine() {
    return this.status() === 'needs_engine';
  }

  needsClarification() {
    return this.status() === 'needs_clarification';
  }

  needsReview() {
    return this.status() === 'needs_review';
  }

  isInconclusive() {
    return this.status() === 'inconclusive';
  }

  hasError() {
    return this.status() === 'error';
  }

  text() {
    return this.raw.text ?? '';
  }

  summaryText() {
    return this.raw.summary ?? this.raw.text ?? '';
  }

  bestExplanationText() {
    return this.raw.bestExplanationText ?? this.raw.text ?? '';
  }

  posterior(variableName) {
    if (!variableName) {
      return clone(this.raw.posterior ?? {});
    }
    return clone(this.raw.posterior?.[String(variableName)] ?? {});
  }

  posteriorText(variableName) {
    if (this.raw.posteriorText?.[String(variableName)]) {
      return this.raw.posteriorText[String(variableName)];
    }
    const distribution = this.posterior(variableName);
    const entries = Object.entries(distribution);
    if (entries.length === 0) {
      return this.raw.text ?? '';
    }
    return `${variableName}: ${entries.map(([value, probability]) => `${value}=${Number(probability).toFixed(3)}`).join(', ')}`;
  }

  cautionText() {
    return this.raw.cautionText ?? this.raw.text ?? '';
  }

  certainty() {
    return this.raw.certainty ?? 'unknown';
  }

  evidenceQuality() {
    return this.raw.evidenceQuality ?? 'not_available';
  }

  assumptionRisk() {
    return this.raw.assumptionRisk ?? 'medium';
  }

  promotion() {
    return this.raw.promotion ?? 'no';
  }

  engineReason() {
    return this.raw.reason ?? '';
  }

  requiredInputs() {
    return [...(this.raw.requiredInputs ?? [])];
  }

  openQuestions() {
    return [...(this.raw.openQuestions ?? [])];
  }

  nextChecks() {
    return this.openQuestions();
  }

  acceptedArguments() {
    return [...(this.raw.acceptedArguments ?? [])];
  }

  unresolvedConflicts() {
    return [...(this.raw.unresolvedConflicts ?? [])];
  }

  bestMappings() {
    return [...(this.raw.bestMappings ?? [])];
  }

  chosenOption() {
    return this.raw.chosenOption ?? null;
  }

  bestArtifact() {
    return this.raw.bestArtifact ?? null;
  }

  revisionNotes() {
    return [...(this.raw.revisionNotes ?? [])];
  }

  trace() {
    return [...(this.raw.trace ?? [])];
  }

  toJSON() {
    return clone(this.raw);
  }
}
