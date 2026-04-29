function toAssignmentMap(solution) {
  if (!solution || Array.isArray(solution) || typeof solution !== 'object') {
    return new Map();
  }
  return new Map(Object.entries(solution));
}

export class ReasoningResult {
  constructor(rawResult = {}, kind = 'generic') {
    this.raw = rawResult ?? {};
    this.kind = kind;
  }

  isSolved() {
    return this.raw.status === 'solved';
  }

  isUnique() {
    return this.isSolved() && !Array.isArray(this.raw.solution);
  }

  hasValue() {
    return this.raw.solution != null;
  }

  isPartial() {
    return this.raw.status === 'partial';
  }

  isTooComplex() {
    return this.raw.status === 'too_complex';
  }

  assignment() {
    return toAssignmentMap(this.raw.solution);
  }

  path() {
    return this.raw.solution?.path ?? [];
  }

  reachable() {
    return this.raw.solution?.reachable ?? [];
  }

  order() {
    return this.raw.solution?.order ?? [];
  }

  plan() {
    return this.raw.solution?.plan ?? [];
  }

  value(name) {
    if (!this.raw.solution || typeof this.raw.solution !== 'object') {
      return undefined;
    }
    return this.raw.solution[name];
  }

  get(name) {
    return this.value(name);
  }

  getValue(name) {
    return this.value(name);
  }

  diagnostics() {
    return this.raw.diagnostics ?? [];
  }

  toJSON() {
    return this.raw;
  }
}
