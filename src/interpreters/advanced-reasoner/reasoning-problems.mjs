function ensureObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function ensureString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function ensureIdObject(value, label) {
  const input = ensureObject(value, label);
  return {
    ...input,
    id: ensureString(input.id, `${label}.id`),
  };
}

function cloneValue(value) {
  if (value == null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].map(([key, entry]) => [key, cloneValue(entry)]));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]),
    );
  }
  return value;
}

function toArray(value) {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function toNumberMap(entries) {
  return Object.fromEntries(entries.map(([key, value]) => [key, Number(value)]));
}

function uniqueStrings(values) {
  return [...new Set(toArray(values).map((entry) => String(entry).trim()).filter(Boolean))];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function strengthWeight(value) {
  return {
    weak: 0.8,
    medium: 1.2,
    strong: 1.8,
    critical: 2.4,
  }[String(value ?? 'medium')] ?? 1.2;
}

function priorWeight(value) {
  return {
    low: 0.6,
    medium: 1,
    high: 1.4,
  }[String(value ?? 'medium')] ?? 1;
}

function reliabilityWeight(value) {
  return {
    low: 0.7,
    medium: 1,
    high: 1.3,
    assumed_exact: 1.4,
  }[String(value ?? 'medium')] ?? 1;
}

function qualityWeight(value) {
  return {
    weak: 0.7,
    moderate: 1,
    strong: 1.4,
  }[String(value ?? 'moderate')] ?? 1;
}

function severityWeight(value) {
  return {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  }[String(value ?? 'medium')] ?? 2;
}

function likelihoodWeight(value) {
  return {
    low: 0.7,
    medium: 1,
    high: 1.3,
  }[String(value ?? 'medium')] ?? 1;
}

function scoreToCertainty(bestScore, margin, contradictions = 0) {
  if (bestScore >= 4.5 && margin >= 1.8 && contradictions === 0) {
    return 'high';
  }
  if (bestScore >= 3.2 && margin >= 1.2 && contradictions <= 1) {
    return 'medium_high';
  }
  if (bestScore >= 2) {
    return 'medium';
  }
  if (bestScore > 0.8) {
    return 'low';
  }
  return 'unknown';
}

function scoreToEvidence(weight) {
  if (weight >= 3.5) {
    return 'strong';
  }
  if (weight >= 2) {
    return 'moderate';
  }
  if (weight > 0) {
    return 'weak';
  }
  return 'incomplete';
}

function scoreToAssumptionRisk(weight) {
  if (weight >= 2.5) {
    return 'high';
  }
  if (weight >= 1.2) {
    return 'medium';
  }
  return 'low';
}

function domainProduct(domains) {
  return domains.reduce((product, values) => product * values.length, 1);
}

function formatProbability(value) {
  return Number(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function formatDistribution(distribution) {
  return Object.entries(distribution)
    .map(([value, probability]) => `${value}=${formatProbability(probability)}`)
    .join(', ');
}

function expandDomain(spec) {
  if (Array.isArray(spec)) {
    return [...spec];
  }
  if (!spec || typeof spec !== 'object') {
    return [];
  }
  if (Array.isArray(spec.values)) {
    return [...spec.values];
  }
  if (Number.isInteger(spec.min) && Number.isInteger(spec.max)) {
    const output = [];
    for (let value = spec.min; value <= spec.max; value += spec.step ?? 1) {
      output.push(value);
    }
    return output;
  }
  return [];
}

function evaluateNumericExpression(expression, assignment) {
  if (typeof expression === 'number') {
    return expression;
  }
  if (typeof expression === 'string') {
    if (Object.hasOwn(assignment, expression)) {
      return assignment[expression];
    }
    const numeric = Number(expression);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    throw new Error(`Unknown expression token: ${expression}`);
  }
  if (typeof expression === 'boolean') {
    return Number(expression);
  }
  const node = ensureObject(expression, 'expression');
  const type = node.type ?? node.op;
  switch (type) {
    case 'const':
      return Number(node.value);
    case 'var':
      return assignment[node.id];
    case 'add':
      return evaluateNumericExpression(node.left, assignment) + evaluateNumericExpression(node.right, assignment);
    case 'sub':
      return evaluateNumericExpression(node.left, assignment) - evaluateNumericExpression(node.right, assignment);
    case 'mul':
      return evaluateNumericExpression(node.left, assignment) * evaluateNumericExpression(node.right, assignment);
    case 'neg':
      return -evaluateNumericExpression(node.value, assignment);
    case 'sum':
      return toArray(node.terms).reduce((sum, term) => sum + evaluateNumericExpression(term, assignment), 0);
    default:
      throw new Error(`Unsupported numeric expression type: ${type}`);
  }
}

function evaluateFormula(expression, assignment) {
  if (typeof expression === 'boolean') {
    return expression;
  }
  const node = ensureObject(expression, 'formula');
  const type = node.type ?? node.op;
  switch (type) {
    case 'eq':
      return evaluateNumericExpression(node.left, assignment) === evaluateNumericExpression(node.right, assignment);
    case 'neq':
      return evaluateNumericExpression(node.left, assignment) !== evaluateNumericExpression(node.right, assignment);
    case 'le':
      return evaluateNumericExpression(node.left, assignment) <= evaluateNumericExpression(node.right, assignment);
    case 'lt':
      return evaluateNumericExpression(node.left, assignment) < evaluateNumericExpression(node.right, assignment);
    case 'ge':
      return evaluateNumericExpression(node.left, assignment) >= evaluateNumericExpression(node.right, assignment);
    case 'gt':
      return evaluateNumericExpression(node.left, assignment) > evaluateNumericExpression(node.right, assignment);
    case 'and':
      return toArray(node.terms).every((term) => evaluateFormula(term, assignment));
    case 'or':
      return toArray(node.terms).some((term) => evaluateFormula(term, assignment));
    case 'not':
      return !evaluateFormula(node.term, assignment);
    default:
      throw new Error(`Unsupported formula type: ${type}`);
  }
}

function enumerateAssignments(variableSpecs, visitor, limits = {}) {
  const names = variableSpecs.map((entry) => entry.id);
  let evaluations = 0;
  const maxEvaluations = limits.maxEvaluations ?? Infinity;
  let stopped = false;

  function walk(index, assignment) {
    if (stopped || evaluations >= maxEvaluations) {
      return;
    }
    if (index >= variableSpecs.length) {
      evaluations += 1;
      if (visitor({ ...assignment }) === false) {
        stopped = true;
      }
      return;
    }

    const current = variableSpecs[index];
    for (const value of current.domain) {
      assignment[current.id] = value;
      walk(index + 1, assignment);
      if (stopped || evaluations >= maxEvaluations) {
        return;
      }
    }
  }

  walk(0, {});
  return evaluations;
}

function propositionMatches(observation, pattern) {
  if (pattern == null) {
    return false;
  }
  if (typeof pattern === 'string') {
    return JSON.stringify(observation).toLowerCase().includes(pattern.toLowerCase());
  }
  if (typeof pattern !== 'object' || typeof observation !== 'object' || !observation) {
    return observation === pattern;
  }
  return Object.entries(pattern).every(([key, value]) => propositionMatches(observation[key], value));
}

class AdvancedReasoningResult {
  constructor(data = {}) {
    this.data = data;
  }

  status() {
    return this.data.status ?? 'reasoned';
  }

  certainty() {
    return this.data.certainty ?? 'unknown';
  }

  evidenceQuality() {
    return this.data.evidenceQuality ?? 'incomplete';
  }

  assumptionRisk() {
    return this.data.assumptionRisk ?? 'medium';
  }

  openWorldRisk() {
    return this.data.openWorldRisk ?? 'medium';
  }

  formalizationQuality() {
    return this.data.formalizationQuality ?? 'partial';
  }

  trace() {
    return [...(this.data.trace ?? [])];
  }

  summaryText() {
    return this.data.text ?? '';
  }

  bestExplanationText() {
    return this.data.bestExplanationText ?? this.summaryText();
  }

  nextChecks() {
    return [...(this.data.nextChecks ?? this.data.openQuestions ?? [])];
  }

  openQuestions() {
    return [...(this.data.openQuestions ?? [])];
  }

  needsEngine() {
    return this.status() === 'needs_engine';
  }

  engineReason() {
    return this.data.reason ?? '';
  }

  cautionText() {
    return this.data.text ?? '';
  }

  requiredInputs() {
    return [...(this.data.requiredInputs ?? [])];
  }

  acceptedArguments() {
    return [...(this.data.acceptedArguments ?? [])];
  }

  unresolvedConflicts() {
    return [...(this.data.unresolvedConflicts ?? [])];
  }

  posterior(variableId) {
    return this.data.posteriors?.[variableId] ?? null;
  }

  posteriorText(variableId) {
    const posterior = this.posterior(variableId);
    if (!posterior) {
      return `No posterior is available for ${variableId}.`;
    }
    return `Posterior for ${variableId}: ${formatDistribution(posterior)}.`;
  }

  bestAssignment() {
    return new Map(Object.entries(this.data.assignment ?? {}));
  }

  objectiveValue() {
    return this.data.objectiveValue ?? null;
  }

  topFrame() {
    return this.data.topFrame ?? null;
  }

  questions() {
    return [...(this.data.questions ?? this.data.openQuestions ?? [])];
  }

  model() {
    return new Map(Object.entries(this.data.model ?? {}));
  }

  toJSON() {
    return cloneValue(this.data);
  }
}

export class AbductiveReasoningProblem {
  constructor(name = 'abductive-reasoning-problem') {
    this.name = String(name);
    this.hypotheses = new Map();
    this.observations = new Map();
    this.relations = [];
    this.requirements = [];
    this.predictions = [];
  }

  hypothesis(obj) {
    const hypothesis = ensureIdObject(obj, 'hypothesis');
    this.hypotheses.set(hypothesis.id, {
      ...hypothesis,
      prior: String(hypothesis.prior ?? 'medium'),
    });
    return this;
  }

  observation(obj) {
    const observation = ensureIdObject(obj, 'observation');
    this.observations.set(observation.id, {
      ...observation,
      reliability: String(observation.reliability ?? 'medium'),
    });
    return this;
  }

  predicts(obj) {
    const prediction = ensureObject(obj, 'predicts');
    this.predictions.push({
      hypothesis: ensureString(prediction.hypothesis, 'predicts.hypothesis'),
      pattern: prediction.pattern,
      strength: String(prediction.strength ?? 'medium'),
    });
    return this;
  }

  supports(obj) {
    const relation = ensureObject(obj, 'supports');
    this.relations.push({
      kind: 'supports',
      observation: ensureString(relation.observation, 'supports.observation'),
      hypothesis: ensureString(relation.hypothesis, 'supports.hypothesis'),
      strength: String(relation.strength ?? 'medium'),
    });
    return this;
  }

  weakens(obj) {
    const relation = ensureObject(obj, 'weakens');
    this.relations.push({
      kind: 'weakens',
      observation: ensureString(relation.observation, 'weakens.observation'),
      hypothesis: ensureString(relation.hypothesis, 'weakens.hypothesis'),
      strength: String(relation.strength ?? 'medium'),
    });
    return this;
  }

  contradicts(obj) {
    const relation = ensureObject(obj, 'contradicts');
    this.relations.push({
      kind: 'contradicts',
      observation: ensureString(relation.observation, 'contradicts.observation'),
      hypothesis: ensureString(relation.hypothesis, 'contradicts.hypothesis'),
      strength: String(relation.strength ?? 'strong'),
    });
    return this;
  }

  requires(obj) {
    const requirement = ensureObject(obj, 'requires');
    this.requirements.push({
      hypothesis: ensureString(requirement.hypothesis, 'requires.hypothesis'),
      assumption: ensureString(requirement.assumption, 'requires.assumption'),
      cost: String(requirement.cost ?? 'medium'),
    });
    return this;
  }

  evaluate() {
    if (this.hypotheses.size === 0) {
      return new AdvancedReasoningResult({
        status: 'needs_clarification',
        text: 'No bounded candidate hypotheses were supplied.',
        certainty: 'unknown',
        evidenceQuality: 'absent',
        assumptionRisk: 'low',
        openWorldRisk: 'high',
        formalizationQuality: 'weak',
        openQuestions: ['Which candidate explanations should be compared?'],
        trace: ['Abduction requires an explicit candidate set.'],
      });
    }

    if (this.observations.size === 0) {
      return new AdvancedReasoningResult({
        status: 'needs_clarification',
        text: 'No observations were supplied to discriminate among hypotheses.',
        certainty: 'unknown',
        evidenceQuality: 'absent',
        assumptionRisk: 'low',
        openWorldRisk: 'medium',
        formalizationQuality: 'weak',
        openQuestions: ['Which observations or measurements should the explanation account for?'],
        trace: ['Abduction requires observations.'],
      });
    }

    const ranking = [];
    const trace = [];
    for (const hypothesis of this.hypotheses.values()) {
      let score = priorWeight(hypothesis.prior);
      let evidenceWeight = 0;
      let contradictionPenalty = 0;
      let assumptionPenalty = 0;
      const explainedObservations = new Set();
      const localNotes = [];

      for (const relation of this.relations.filter((entry) => entry.hypothesis === hypothesis.id)) {
        const observation = this.observations.get(relation.observation);
        const weight = strengthWeight(relation.strength) * reliabilityWeight(observation?.reliability);
        explainedObservations.add(relation.observation);
        if (relation.kind === 'supports') {
          score += weight;
          evidenceWeight += weight;
          localNotes.push(`support ${relation.observation}`);
        } else if (relation.kind === 'weakens') {
          score -= weight * 0.8;
          contradictionPenalty += weight * 0.4;
          localNotes.push(`weakening ${relation.observation}`);
        } else if (relation.kind === 'contradicts') {
          score -= weight * 1.3;
          contradictionPenalty += weight;
          localNotes.push(`contradiction ${relation.observation}`);
        }
      }

      for (const prediction of this.predictions.filter((entry) => entry.hypothesis === hypothesis.id)) {
        const matched = [...this.observations.values()].some((observation) => propositionMatches(observation.proposition, prediction.pattern));
        const weight = strengthWeight(prediction.strength);
        if (matched) {
          score += weight * 0.5;
          evidenceWeight += weight * 0.5;
          localNotes.push(`matched prediction ${JSON.stringify(prediction.pattern)}`);
        } else {
          score -= weight * 0.3;
          localNotes.push(`unmatched prediction ${JSON.stringify(prediction.pattern)}`);
        }
      }

      for (const requirement of this.requirements.filter((entry) => entry.hypothesis === hypothesis.id)) {
        const cost = priorWeight(requirement.cost) * 0.6;
        assumptionPenalty += cost;
        score -= cost;
      }

      const unexplainedCount = Math.max(0, this.observations.size - explainedObservations.size);
      score -= unexplainedCount * 0.2;

      ranking.push({
        id: hypothesis.id,
        description: hypothesis.description,
        score,
        evidenceWeight,
        contradictionPenalty,
        assumptionPenalty,
        unexplainedCount,
      });
      trace.push(`Hypothesis ${hypothesis.id}: ${localNotes.join(', ') || 'no explicit support relations'} -> score ${score.toFixed(2)}.`);
    }

    ranking.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
    const best = ranking[0];
    const runnerUp = ranking[1] ?? null;
    const margin = best.score - (runnerUp?.score ?? 0);
    const certainty = scoreToCertainty(best.score, margin, best.contradictionPenalty);
    const evidenceQuality = scoreToEvidence(best.evidenceWeight);
    const assumptionRisk = scoreToAssumptionRisk(best.assumptionPenalty);
    const openQuestions = [];
    if (runnerUp && margin < 1.2) {
      openQuestions.push(`What additional observation would distinguish ${best.id} from ${runnerUp.id}?`);
    }
    if (best.unexplainedCount > 0) {
      openQuestions.push(`Which remaining observations are still unexplained by ${best.id}?`);
    }

    return new AdvancedReasoningResult({
      status: certainty === 'unknown' ? 'inconclusive' : 'reasoned',
      text: runnerUp
        ? `Best explanation: ${best.description} (${best.id}) outranks ${runnerUp.description} (${runnerUp.id}) by ${margin.toFixed(2)} score points.`
        : `Best explanation: ${best.description} (${best.id}).`,
      bestExplanationText: runnerUp
        ? `${best.description} is the strongest bounded explanation, ahead of ${runnerUp.description}.`
        : `${best.description} is the strongest bounded explanation.`,
      rankedHypotheses: ranking,
      certainty,
      evidenceQuality,
      assumptionRisk,
      openWorldRisk: this.hypotheses.size < 3 ? 'medium' : 'low',
      formalizationQuality: 'partial',
      openQuestions,
      nextChecks: openQuestions,
      trace,
    });
  }
}

export class ProbabilisticReasoningProblem {
  constructor(name = 'probabilistic-reasoning-problem') {
    this.name = String(name);
    this.variables = new Map();
    this.priors = new Map();
    this.conditionals = new Map();
    this.evidenceMap = new Map();
    this.querySpec = null;
  }

  variable(obj) {
    const variable = ensureIdObject(obj, 'variable');
    if (!Array.isArray(variable.domain) || variable.domain.length === 0) {
      throw new Error('variable.domain must be a non-empty array.');
    }
    this.variables.set(variable.id, {
      ...variable,
      domain: [...variable.domain],
    });
    return this;
  }

  prior(obj) {
    const prior = ensureObject(obj, 'prior');
    this.priors.set(ensureString(prior.variable, 'prior.variable'), {
      distribution: toNumberMap(Object.entries(ensureObject(prior.distribution, 'prior.distribution'))),
      source: String(prior.source ?? 'given'),
    });
    return this;
  }

  conditional(obj) {
    const conditional = ensureObject(obj, 'conditional');
    this.conditionals.set(ensureString(conditional.child, 'conditional.child'), {
      parents: uniqueStrings(conditional.parents),
      table: cloneValue(ensureObject(conditional.table, 'conditional.table')),
      source: String(conditional.source ?? 'given'),
    });
    return this;
  }

  evidence(obj) {
    const evidence = ensureObject(obj, 'evidence');
    this.evidenceMap.set(ensureString(evidence.variable, 'evidence.variable'), {
      value: evidence.value,
      reliability: String(evidence.reliability ?? 'medium'),
    });
    return this;
  }

  query(obj) {
    const query = ensureObject(obj, 'query');
    this.querySpec = {
      variable: ensureString(query.variable, 'query.variable'),
      values: query.values ? [...query.values] : null,
    };
    return this;
  }

  infer(config = {}) {
    if (!this.querySpec) {
      return new AdvancedReasoningResult({
        status: 'needs_clarification',
        text: 'No posterior query was defined.',
        certainty: 'unknown',
        evidenceQuality: 'absent',
        assumptionRisk: 'low',
        openWorldRisk: 'low',
        formalizationQuality: 'weak',
        openQuestions: ['Which variable should be queried?'],
        trace: ['Probabilistic inference requires a query target.'],
      });
    }

    const variableSpecs = [...this.variables.values()].map((variable) => ({
      id: variable.id,
      domain: [...variable.domain],
    }));
    const jointStates = domainProduct(variableSpecs.map((entry) => entry.domain));
    if (jointStates > (config.maxJointStates ?? 512)) {
      return new AdvancedReasoningResult({
        status: 'needs_engine',
        text: `Local exact enumeration would require ${jointStates} joint states, which exceeds the configured bound.`,
        certainty: 'low',
        evidenceQuality: 'incomplete',
        assumptionRisk: 'low',
        openWorldRisk: 'low',
        formalizationQuality: 'partial',
        reason: 'Exact enumeration exceeds the configured joint-state budget.',
        requiredInputs: ['bounded variable set or a probabilistic engine'],
        trace: [`Joint state count ${jointStates} exceeded the local bound.`],
      });
    }

    const missing = [];
    for (const variable of this.variables.values()) {
      if (!this.priors.has(variable.id) && !this.conditionals.has(variable.id)) {
        missing.push(`distribution for ${variable.id}`);
      }
    }
    if (missing.length > 0) {
      return new AdvancedReasoningResult({
        status: 'needs_clarification',
        text: 'Probabilistic inference requires explicit priors or conditional probabilities.',
        certainty: 'unknown',
        evidenceQuality: 'incomplete',
        assumptionRisk: 'low',
        openWorldRisk: 'low',
        formalizationQuality: 'weak',
        openQuestions: missing,
        trace: ['At least one variable lacked a probability model.'],
      });
    }

    const trace = [`Enumerating ${jointStates} joint states.`];
    const queryValues = this.querySpec.values ?? [...(this.variables.get(this.querySpec.variable)?.domain ?? [])];
    const distribution = Object.fromEntries(queryValues.map((value) => [value, 0]));
    let totalMass = 0;

    function tableKey(parents, assignment) {
      return parents.map((parent) => `${parent}=${assignment[parent]}`).join('|');
    }

    function probabilityForVariable(problem, variableId, assignment) {
      const value = assignment[variableId];
      const conditional = problem.conditionals.get(variableId);
      if (conditional) {
        const key = tableKey(conditional.parents, assignment);
        const row = conditional.table[key];
        if (!row || !Object.hasOwn(row, value)) {
          throw new Error(`Missing conditional entry for ${variableId} with key ${key}.`);
        }
        return Number(row[value]);
      }
      const prior = problem.priors.get(variableId);
      if (!prior || !Object.hasOwn(prior.distribution, value)) {
        throw new Error(`Missing prior entry for ${variableId}=${value}.`);
      }
      return Number(prior.distribution[value]);
    }

    enumerateAssignments(variableSpecs, (assignment) => {
      for (const [variableId, evidence] of this.evidenceMap.entries()) {
        if (assignment[variableId] !== evidence.value) {
          return;
        }
      }
      let probability = 1;
      for (const variable of variableSpecs) {
        probability *= probabilityForVariable(this, variable.id, assignment);
      }
      totalMass += probability;
      distribution[assignment[this.querySpec.variable]] += probability;
    });

    if (totalMass <= 0) {
      return new AdvancedReasoningResult({
        status: 'inconclusive',
        text: 'The supplied evidence is inconsistent with the bounded probability model.',
        certainty: 'unknown',
        evidenceQuality: 'conflicting',
        assumptionRisk: 'low',
        openWorldRisk: 'low',
        formalizationQuality: 'partial',
        trace,
      });
    }

    for (const value of Object.keys(distribution)) {
      distribution[value] /= totalMass;
    }

    const values = Object.values(distribution);
    const bestProbability = Math.max(...values);
    const certainty = bestProbability >= 0.85
      ? 'high'
      : bestProbability >= 0.7
        ? 'medium_high'
        : bestProbability >= 0.55
          ? 'medium'
          : 'low';
    const evidenceQuality = this.evidenceMap.size > 0 ? 'strong' : 'moderate';
    trace.push(`Posterior for ${this.querySpec.variable}: ${formatDistribution(distribution)}.`);

    return new AdvancedReasoningResult({
      status: 'reasoned',
      text: `Posterior for ${this.querySpec.variable}: ${formatDistribution(distribution)}.`,
      posteriors: {
        [this.querySpec.variable]: distribution,
      },
      certainty,
      evidenceQuality,
      assumptionRisk: 'low',
      openWorldRisk: 'low',
      formalizationQuality: 'complete',
      trace,
    });
  }
}

export class CausalReasoningProblem {
  constructor(name = 'causal-reasoning-problem') {
    this.name = String(name);
    this.variables = new Map();
    this.edges = [];
    this.associations = [];
    this.observedChanges = [];
    this.confounders = [];
    this.interventions = [];
    this.claims = [];
  }

  variable(obj) {
    const variable = ensureIdObject(obj, 'variable');
    this.variables.set(variable.id, variable);
    return this;
  }

  edge(obj) {
    const edge = ensureObject(obj, 'edge');
    this.edges.push({
      from: ensureString(edge.from, 'edge.from'),
      to: ensureString(edge.to, 'edge.to'),
      relation: String(edge.relation ?? 'causal'),
      source: String(edge.source ?? 'given'),
      confidence: String(edge.confidence ?? 'assumed'),
    });
    return this;
  }

  association(obj) {
    const association = ensureObject(obj, 'association');
    this.associations.push({
      x: ensureString(association.x, 'association.x'),
      y: ensureString(association.y, 'association.y'),
      description: association.description ? String(association.description) : '',
      source: String(association.source ?? 'given'),
    });
    return this;
  }

  observedChange(obj) {
    const change = ensureObject(obj, 'observedChange');
    this.observedChanges.push({
      variable: ensureString(change.variable, 'observedChange.variable'),
      before: change.before,
      after: change.after,
      timeWindow: change.timeWindow ?? null,
    });
    return this;
  }

  confounderCandidate(obj) {
    const confounder = ensureObject(obj, 'confounderCandidate');
    this.confounders.push({
      variable: ensureString(confounder.variable, 'confounderCandidate.variable'),
      reason: ensureString(confounder.reason, 'confounderCandidate.reason'),
      observed: confounder.observed ?? 'unknown',
    });
    return this;
  }

  intervention(obj) {
    const intervention = ensureObject(obj, 'intervention');
    this.interventions.push({
      variable: ensureString(intervention.variable, 'intervention.variable'),
      value: intervention.value,
      design: String(intervention.design ?? 'observational'),
    });
    return this;
  }

  claim(obj) {
    const claim = ensureObject(obj, 'claim');
    this.claims.push({
      treatment: ensureString(claim.treatment, 'claim.treatment'),
      outcome: ensureString(claim.outcome, 'claim.outcome'),
      claimType: String(claim.claimType ?? 'association'),
    });
    return this;
  }

  assess(config = {}) {
    const claim = this.claims[0];
    if (!claim) {
      return new AdvancedReasoningResult({
        status: 'needs_clarification',
        text: 'No causal claim was provided.',
        certainty: 'unknown',
        evidenceQuality: 'absent',
        assumptionRisk: 'low',
        openWorldRisk: 'medium',
        formalizationQuality: 'weak',
        openQuestions: ['Which treatment and outcome should be assessed?'],
        trace: ['Causal reasoning requires an explicit claim.'],
      });
    }

    const trace = [];
    const randomized = this.interventions.some(
      (entry) => entry.variable === claim.treatment && entry.design === 'randomized',
    );
    const confounders = this.confounders.filter((entry) => entry.variable !== claim.treatment && entry.variable !== claim.outcome);
    const directCausalEdge = this.edges.some(
      (edge) => edge.from === claim.treatment && edge.to === claim.outcome && edge.relation === 'causal',
    );
    const association = this.associations.find(
      (entry) => entry.x === claim.treatment && entry.y === claim.outcome,
    );

    if (claim.claimType !== 'causal_effect' && config.requiredStandard !== 'causal_effect') {
      trace.push('Classified request as association-level reasoning.');
      return new AdvancedReasoningResult({
        status: 'reasoned',
        text: association?.description
          ? `Association summary: ${association.description}.`
          : `A bounded association between ${claim.treatment} and ${claim.outcome} was recorded.`,
        certainty: 'medium',
        evidenceQuality: association ? 'moderate' : 'weak',
        assumptionRisk: 'medium',
        openWorldRisk: 'medium',
        formalizationQuality: 'partial',
        trace,
      });
    }

    trace.push(`Evaluating causal effect claim ${claim.treatment} -> ${claim.outcome}.`);
    if (randomized && confounders.length === 0 && (directCausalEdge || !config.allowLocalDAGCheck)) {
      trace.push('A randomized intervention and no explicit confounders were supplied.');
      return new AdvancedReasoningResult({
        status: 'reasoned',
        text: `The bounded record supports a cautious causal reading from ${claim.treatment} to ${claim.outcome} because a randomized intervention was supplied and no competing confounder is currently modeled.`,
        certainty: directCausalEdge ? 'medium_high' : 'medium',
        evidenceQuality: 'moderate',
        assumptionRisk: 'medium',
        openWorldRisk: 'medium',
        formalizationQuality: directCausalEdge ? 'complete' : 'partial',
        trace,
      });
    }

    const openQuestions = [];
    if (!randomized) {
      openQuestions.push(`Was ${claim.treatment} randomized or otherwise assigned independently of confounders?`);
    }
    if (confounders.length > 0) {
      openQuestions.push(`Can ${confounders.map((entry) => entry.variable).join(', ')} be adjusted for or ruled out as confounders?`);
    }
    if (!directCausalEdge && config.allowLocalDAGCheck) {
      openQuestions.push('Is a causal graph available for the treatment, outcome, and candidate confounders?');
    }

    trace.push('Local causal identification is insufficient, so the task is routed conservatively.');
    return new AdvancedReasoningResult({
      status: 'needs_engine',
      text: association?.description
        ? `No reliable causal conclusion follows from the bounded facts alone. ${association.description}.`
        : `No reliable causal conclusion follows from the bounded facts alone for ${claim.treatment} and ${claim.outcome}.`,
      certainty: 'low',
      evidenceQuality: confounders.length > 0 ? 'weak' : 'incomplete',
      assumptionRisk: 'high',
      openWorldRisk: 'medium',
      formalizationQuality: 'partial',
      reason: confounders.length > 0
        ? `Potential confounders remain unresolved: ${confounders.map((entry) => entry.variable).join(', ')}.`
        : 'A causal design or identification strategy was not supplied.',
      requiredInputs: [
        'treatment variable',
        'outcome variable',
        'candidate confounders',
        'causal graph or causal assumptions',
        'dataset or summary statistics',
      ],
      openQuestions,
      trace,
    });
  }
}

export class ArgumentationProblem {
  constructor(name = 'argumentation-problem') {
    this.name = String(name);
    this.arguments = new Map();
    this.relations = [];
    this.evidenceLinks = [];
  }

  argument(obj) {
    const argument = ensureIdObject(obj, 'argument');
    this.arguments.set(argument.id, argument);
    return this;
  }

  relation(obj) {
    const relation = ensureObject(obj, 'relation');
    this.relations.push({
      from: ensureString(relation.from, 'relation.from'),
      to: ensureString(relation.to, 'relation.to'),
      type: String(relation.type ?? 'supports'),
      strength: String(relation.strength ?? 'medium'),
      validated: relation.validated ?? true,
      source: String(relation.source ?? 'given'),
    });
    return this;
  }

  evidence(obj) {
    const evidence = ensureObject(obj, 'evidence');
    this.evidenceLinks.push({
      argument: ensureString(evidence.argument, 'evidence.argument'),
      sourceRef: ensureString(evidence.sourceRef, 'evidence.sourceRef'),
      quality: String(evidence.quality ?? 'moderate'),
    });
    return this;
  }

  evaluate() {
    if (this.arguments.size === 0) {
      return new AdvancedReasoningResult({
        status: 'needs_clarification',
        text: 'No arguments were supplied.',
        certainty: 'unknown',
        evidenceQuality: 'absent',
        assumptionRisk: 'low',
        openWorldRisk: 'medium',
        formalizationQuality: 'weak',
        openQuestions: ['Which arguments or positions should be compared?'],
        trace: ['Argumentation requires explicit arguments.'],
      });
    }

    const attackersOf = new Map();
    const attacksFrom = new Map();
    for (const argumentId of this.arguments.keys()) {
      attackersOf.set(argumentId, []);
      attacksFrom.set(argumentId, new Set());
    }
    for (const relation of this.relations.filter((entry) => entry.type === 'attacks')) {
      attackersOf.get(relation.to)?.push(relation.from);
      attacksFrom.get(relation.from)?.add(relation.to);
    }

    const accepted = new Set();
    let changed = true;
    while (changed) {
      changed = false;
      for (const argumentId of this.arguments.keys()) {
        if (accepted.has(argumentId)) {
          continue;
        }
        const attackers = attackersOf.get(argumentId) ?? [];
        const defended = attackers.every((attacker) => [...accepted].some((entry) => attacksFrom.get(entry)?.has(attacker)));
        if (defended) {
          accepted.add(argumentId);
          changed = true;
        }
      }
    }

    const unresolved = [...this.arguments.keys()].filter((argumentId) => !accepted.has(argumentId));
    const acceptedArguments = [...accepted].map((argumentId) => this.arguments.get(argumentId));
    const unvalidatedRelations = this.relations.filter((relation) => relation.validated === false).length;
    const certainty = unresolved.length === 0 && unvalidatedRelations === 0
      ? 'medium_high'
      : unresolved.length <= 1
        ? 'medium'
        : 'low';
    const evidenceQuality = this.evidenceLinks.length > 0 ? 'moderate' : 'incomplete';
    const trace = [
      `Accepted arguments: ${acceptedArguments.map((entry) => entry.id).join(', ') || 'none'}.`,
      `Unresolved arguments: ${unresolved.join(', ') || 'none'}.`,
    ];

    return new AdvancedReasoningResult({
      status: unresolved.length > 0 ? 'partial' : 'reasoned',
      text: acceptedArguments.length > 0
        ? `Accepted arguments under grounded semantics: ${acceptedArguments.map((entry) => entry.claim).join('; ')}.`
        : 'No argument is accepted without additional support or validation.',
      certainty,
      evidenceQuality,
      assumptionRisk: unvalidatedRelations > 0 ? 'high' : 'medium',
      openWorldRisk: 'medium',
      formalizationQuality: 'partial',
      acceptedArguments,
      unresolvedConflicts: unresolved.map((argumentId) => this.arguments.get(argumentId)),
      trace,
    });
  }
}

export class BeliefRevisionProblem {
  constructor(name = 'belief-revision-problem') {
    this.name = String(name);
    this.beliefs = new Map();
    this.assumptions = new Map();
    this.derivations = new Map();
    this.evidenceItems = new Map();
    this.contradictions = [];
  }

  belief(obj) {
    const belief = ensureIdObject(obj, 'belief');
    this.beliefs.set(belief.id, belief);
    return this;
  }

  assumption(obj) {
    const assumption = ensureIdObject(obj, 'assumption');
    this.assumptions.set(assumption.id, {
      ...assumption,
      retractable: assumption.retractable !== false,
      priority: String(assumption.priority ?? 'medium'),
    });
    return this;
  }

  derive(obj) {
    const derivation = ensureIdObject(obj, 'derive');
    this.derivations.set(derivation.id, {
      ...derivation,
      dependencies: uniqueStrings(derivation.dependencies),
    });
    return this;
  }

  evidence(obj) {
    const evidence = ensureIdObject(obj, 'evidence');
    this.evidenceItems.set(evidence.id, evidence);
    return this;
  }

  contradiction(obj) {
    const contradiction = ensureObject(obj, 'contradiction');
    this.contradictions.push({
      left: ensureString(contradiction.left, 'contradiction.left'),
      right: ensureString(contradiction.right, 'contradiction.right'),
      type: String(contradiction.type ?? 'inconsistency'),
    });
    return this;
  }

  revise() {
    if (this.contradictions.length === 0) {
      return new AdvancedReasoningResult({
        status: 'reasoned',
        text: 'No explicit contradiction was supplied, so no belief revision is needed.',
        certainty: 'medium_high',
        evidenceQuality: 'structural',
        assumptionRisk: 'low',
        openWorldRisk: 'low',
        formalizationQuality: 'partial',
        trace: ['No contradiction sets were declared.'],
      });
    }

    const retractable = [...this.assumptions.values()].filter((entry) => entry.retractable);
    retractable.sort((left, right) => priorWeight(left.priority) - priorWeight(right.priority));
    const chosen = retractable[0] ?? null;
    const trace = [`Detected ${this.contradictions.length} contradiction set(s).`];

    if (!chosen) {
      return new AdvancedReasoningResult({
        status: 'needs_engine',
        text: 'Contradictions were detected, but no retractable assumptions were supplied for bounded repair.',
        certainty: 'low',
        evidenceQuality: 'conflicting',
        assumptionRisk: 'high',
        openWorldRisk: 'medium',
        formalizationQuality: 'partial',
        reason: 'Belief revision needs retractable assumptions or a larger truth-maintenance engine.',
        requiredInputs: ['retractable assumptions', 'dependency graph'],
        trace,
      });
    }

    trace.push(`Selected retractable assumption ${chosen.id}.`);
    return new AdvancedReasoningResult({
      status: 'partial',
      text: `A minimal bounded repair is to retract assumption ${chosen.id}: ${chosen.proposition ?? chosen.id}.`,
      certainty: 'medium',
      evidenceQuality: 'conflicting',
      assumptionRisk: 'medium',
      openWorldRisk: 'medium',
      formalizationQuality: 'partial',
      resolvedParts: [chosen],
      unresolvedParts: [...this.contradictions],
      trace,
    });
  }
}

export class LegalReasoningProblem {
  constructor(name = 'legal-reasoning-problem') {
    this.name = String(name);
    this.jurisdictions = new Map();
    this.sources = new Map();
    this.norms = new Map();
    this.facts = new Map();
    this.issues = new Map();
  }

  jurisdiction(obj) {
    const jurisdiction = ensureIdObject(obj, 'jurisdiction');
    this.jurisdictions.set(jurisdiction.id, jurisdiction);
    return this;
  }

  source(obj) {
    const source = ensureIdObject(obj, 'source');
    this.sources.set(source.id, source);
    return this;
  }

  norm(obj) {
    const norm = ensureIdObject(obj, 'norm');
    this.norms.set(norm.id, norm);
    return this;
  }

  fact(obj) {
    const fact = ensureIdObject(obj, 'fact');
    this.facts.set(fact.id, fact);
    return this;
  }

  issue(obj) {
    const issue = ensureIdObject(obj, 'issue');
    this.issues.set(issue.id, issue);
    return this;
  }

  assessApplicability(config = {}) {
    const issue = this.issues.get(config.issue) ?? [...this.issues.values()][0];
    if (!issue) {
      return new AdvancedReasoningResult({
        status: 'needs_clarification',
        text: 'No legal issue was supplied.',
        certainty: 'unknown',
        evidenceQuality: 'absent',
        assumptionRisk: 'medium',
        openWorldRisk: 'medium',
        formalizationQuality: 'weak',
        openQuestions: ['Which issue or norm should be assessed?'],
        trace: ['Legal reasoning requires an explicit issue.'],
      });
    }

    const disputedFacts = [...this.facts.values()].filter((entry) => entry.disputed);
    if (config.allowNormativeConclusion || config.requireReview || disputedFacts.length > 0) {
      return new AdvancedReasoningResult({
        status: 'needs_review',
        text: `A bounded applicability scan is possible for ${issue.question}, but normative or disputed elements remain.`,
        certainty: 'low',
        evidenceQuality: disputedFacts.length > 0 ? 'conflicting' : 'moderate',
        assumptionRisk: 'high',
        openWorldRisk: 'medium',
        formalizationQuality: 'partial',
        reason: `Issue ${issue.id} requires expert legal review before promotion.`,
        trace: [`Issue ${issue.id} marked for review.`],
      });
    }

    return new AdvancedReasoningResult({
      status: 'partial',
      text: `Issue ${issue.id} can be checked structurally against the supplied facts, but bounded legal reasoning does not replace review.`,
      certainty: 'medium',
      evidenceQuality: 'moderate',
      assumptionRisk: 'medium',
      openWorldRisk: 'medium',
      formalizationQuality: 'partial',
      trace: [`Issue ${issue.id} assessed structurally.`],
    });
  }
}

export class ScientificSynthesisProblem {
  constructor(name = 'scientific-synthesis-problem') {
    this.name = String(name);
    this.claims = new Map();
    this.studies = new Map();
    this.findings = [];
    this.limitations = [];
    this.qualities = new Map();
  }

  claim(obj) {
    const claim = ensureIdObject(obj, 'claim');
    this.claims.set(claim.id, claim);
    return this;
  }

  study(obj) {
    const study = ensureIdObject(obj, 'study');
    this.studies.set(study.id, study);
    return this;
  }

  finding(obj) {
    const finding = ensureObject(obj, 'finding');
    this.findings.push({
      study: ensureString(finding.study, 'finding.study'),
      claim: ensureString(finding.claim, 'finding.claim'),
      direction: String(finding.direction ?? 'supports'),
      strength: String(finding.strength ?? 'moderate'),
    });
    return this;
  }

  limitation(obj) {
    const limitation = ensureObject(obj, 'limitation');
    this.limitations.push({
      study: ensureString(limitation.study, 'limitation.study'),
      type: String(limitation.type ?? 'general'),
      description: ensureString(limitation.description, 'limitation.description'),
    });
    return this;
  }

  quality(obj) {
    const quality = ensureObject(obj, 'quality');
    this.qualities.set(ensureString(quality.study, 'quality.study'), String(quality.level ?? 'moderate'));
    return this;
  }

  synthesize(config = {}) {
    const claim = this.claims.get(config.claim) ?? [...this.claims.values()][0];
    if (!claim) {
      return new AdvancedReasoningResult({
        status: 'needs_clarification',
        text: 'No scientific claim was supplied.',
        certainty: 'unknown',
        evidenceQuality: 'absent',
        assumptionRisk: 'low',
        openWorldRisk: 'medium',
        formalizationQuality: 'weak',
        openQuestions: ['Which claim should be synthesized?'],
        trace: ['Scientific synthesis requires a claim.'],
      });
    }

    let support = 0;
    let contradiction = 0;
    for (const finding of this.findings.filter((entry) => entry.claim === claim.id)) {
      const weight = qualityWeight(this.qualities.get(finding.study)) * strengthWeight(finding.strength);
      if (finding.direction === 'supports') {
        support += weight;
      } else {
        contradiction += weight;
      }
    }
    const limitations = this.limitations.filter((entry) => this.findings.some((finding) => finding.study === entry.study));
    const certainty = scoreToCertainty(support - contradiction, Math.abs(support - contradiction), contradiction);
    return new AdvancedReasoningResult({
      status: contradiction > 0 ? 'partial' : 'reasoned',
      text: `Evidence for ${claim.statement ?? claim.id}: support=${support.toFixed(2)}, contradiction=${contradiction.toFixed(2)}.`,
      certainty,
      evidenceQuality: scoreToEvidence(support + contradiction),
      assumptionRisk: limitations.length > 0 ? 'medium' : 'low',
      openWorldRisk: 'medium',
      formalizationQuality: 'partial',
      openQuestions: config.includeNextEvidence ? ['Which additional study would reduce the main limitation?'] : [],
      trace: [`Scientific synthesis scored support=${support.toFixed(2)} contradiction=${contradiction.toFixed(2)}.`],
    });
  }
}

export class OptimizationReasoningProblem {
  constructor(name = 'optimization-reasoning-problem') {
    this.name = String(name);
    this.variables = new Map();
    this.constraints = [];
    this.objectiveSpec = null;
  }

  decisionVariable(obj) {
    const variable = ensureIdObject(obj, 'decisionVariable');
    const domain = expandDomain(variable.domain);
    if (domain.length === 0) {
      throw new Error('decisionVariable.domain must be a finite list or integer range.');
    }
    this.variables.set(variable.id, {
      ...variable,
      domain,
      type: String(variable.type ?? 'finite'),
    });
    return this;
  }

  constraint(obj) {
    const constraint = ensureIdObject(obj, 'constraint');
    this.constraints.push({
      ...constraint,
      kind: String(constraint.kind ?? 'linear'),
    });
    return this;
  }

  objective(obj) {
    const objective = ensureObject(obj, 'objective');
    this.objectiveSpec = {
      direction: String(objective.direction ?? 'minimize'),
      expression: objective.expression,
      kind: String(objective.kind ?? 'linear'),
    };
    return this;
  }

  classify() {
    const variableList = [...this.variables.values()];
    const allFinite = variableList.every((entry) => entry.type === 'finite');
    const allInteger = variableList.every((entry) => entry.type === 'integer' || entry.type === 'finite');
    const hasNonLinear = this.objectiveSpec?.kind && !['linear', 'cardinality'].includes(this.objectiveSpec.kind);
    if (allFinite && !hasNonLinear) {
      return 'finite_enumeration';
    }
    if (allInteger && !hasNonLinear) {
      return 'milp_candidate';
    }
    return 'optimization_engine';
  }

  recommendEngine() {
    const profile = this.classify();
    if (profile === 'finite_enumeration') {
      return 'HumanLikeReasoner';
    }
    if (profile === 'milp_candidate') {
      return 'OptimizationEngine';
    }
    return 'OptimizationEngine';
  }

  tryTinySolve(config = {}) {
    const variableSpecs = [...this.variables.values()].map((entry) => ({
      id: entry.id,
      domain: [...entry.domain],
    }));
    const product = domainProduct(variableSpecs.map((entry) => entry.domain));
    const maxDomainProduct = config.maxDomainProduct ?? 256;
    if (product > maxDomainProduct) {
      return new AdvancedReasoningResult({
        status: 'needs_engine',
        text: `Local optimization would require exploring ${product} assignments, which exceeds the configured bound.`,
        certainty: 'low',
        evidenceQuality: 'structural',
        assumptionRisk: 'low',
        openWorldRisk: 'low',
        formalizationQuality: 'complete',
        reason: 'The bounded search space exceeds the local enumeration budget.',
        requiredInputs: ['smaller domain product or an optimization engine'],
        trace: [`Domain product ${product} exceeded local bound ${maxDomainProduct}.`],
      });
    }

    let bestAssignment = null;
    let bestObjective = null;
    let feasibleCount = 0;
    const maximize = (this.objectiveSpec?.direction ?? 'minimize') === 'maximize';
    enumerateAssignments(variableSpecs, (assignment) => {
      const feasible = this.constraints.every((constraint) => evaluateFormula(constraint.expression, assignment));
      if (!feasible) {
        return;
      }
      feasibleCount += 1;
      const objectiveValue = this.objectiveSpec
        ? evaluateNumericExpression(this.objectiveSpec.expression, assignment)
        : 0;
      if (
        bestAssignment == null
        || (maximize ? objectiveValue > bestObjective : objectiveValue < bestObjective)
      ) {
        bestAssignment = { ...assignment };
        bestObjective = objectiveValue;
      }
    }, { maxEvaluations: config.maxEvaluations ?? 4_096 });

    if (!bestAssignment) {
      return new AdvancedReasoningResult({
        status: 'inconclusive',
        text: 'No feasible assignment satisfied the bounded optimization model.',
        certainty: 'medium',
        evidenceQuality: 'structural',
        assumptionRisk: 'low',
        openWorldRisk: 'low',
        formalizationQuality: 'complete',
        trace: ['No feasible assignment was found.'],
      });
    }

    return new AdvancedReasoningResult({
      status: 'solved',
      text: `Feasible optimum found with ${Object.entries(bestAssignment).map(([key, value]) => `${key}=${value}`).join(', ')} and objective ${bestObjective}.`,
      certainty: 'high',
      evidenceQuality: 'structural',
      assumptionRisk: 'low',
      openWorldRisk: 'low',
      formalizationQuality: 'complete',
      assignment: bestAssignment,
      objectiveValue: bestObjective,
      trace: [`Evaluated ${feasibleCount} feasible assignment(s).`],
    });
  }
}

export class FormalProofRoutingProblem {
  constructor(name = 'formal-proof-routing-problem') {
    this.name = String(name);
    this.statements = new Map();
    this.assumptions = new Map();
    this.definitions = new Map();
    this.lemmas = new Map();
  }

  statement(obj) {
    const statement = ensureIdObject(obj, 'statement');
    this.statements.set(statement.id, statement);
    return this;
  }

  assumption(obj) {
    const assumption = ensureIdObject(obj, 'assumption');
    this.assumptions.set(assumption.id, assumption);
    return this;
  }

  definition(obj) {
    const definition = ensureIdObject(obj, 'definition');
    this.definitions.set(definition.id, definition);
    return this;
  }

  lemma(obj) {
    const lemma = ensureIdObject(obj, 'lemma');
    this.lemmas.set(lemma.id, lemma);
    return this;
  }

  classifyLogic() {
    const hints = [...this.statements.values()].map((entry) => `${entry.domain ?? ''} ${entry.informalText ?? ''}`.toLowerCase()).join(' ');
    if (/[<>]=?|arithmetic|integer|numeric/.test(hints)) {
      return 'arithmetic';
    }
    if (/type|program/.test(hints)) {
      return 'type_theoretic';
    }
    return 'first_order';
  }

  prepare(config = {}) {
    const logic = this.classifyLogic();
    if (logic === 'arithmetic' && config.targetSystem === 'SMTEngine' && config.allowInformalSketch) {
      return new AdvancedReasoningResult({
        status: 'partial',
        text: 'The theorem-like task appears arithmetic and can be prepared for SMT translation.',
        certainty: 'medium',
        evidenceQuality: 'structural',
        assumptionRisk: 'medium',
        openWorldRisk: 'low',
        formalizationQuality: 'partial',
        trace: [`Classified proof task as ${logic}.`],
      });
    }
    return new AdvancedReasoningResult({
      status: 'needs_engine',
      text: `The proof task was classified as ${logic} and should be routed to a proof-capable engine.`,
      certainty: 'low',
      evidenceQuality: 'structural',
      assumptionRisk: 'medium',
      openWorldRisk: 'low',
      formalizationQuality: 'partial',
      reason: `Formal proof obligations of type ${logic} exceed the local v0 proof checker.`,
      requiredInputs: ['formal statement', 'formal assumptions', 'target proof system'],
      trace: [`Classified proof task as ${logic}.`],
    });
  }
}

export class SMTReasoningProblem {
  constructor(name = 'smt-reasoning-problem') {
    this.name = String(name);
    this.sorts = new Map();
    this.consts = new Map();
    this.funcs = new Map();
    this.assertions = [];
    this.querySpec = null;
  }

  sort(obj) {
    const sort = ensureIdObject(obj, 'sort');
    this.sorts.set(sort.id, sort);
    return this;
  }

  const(obj) {
    const constant = ensureIdObject(obj, 'const');
    this.consts.set(constant.id, {
      ...constant,
      sort: ensureString(constant.sort, 'const.sort'),
    });
    return this;
  }

  func(obj) {
    const func = ensureIdObject(obj, 'func');
    this.funcs.set(func.id, func);
    return this;
  }

  assert(expr) {
    this.assertions.push(expr);
    return this;
  }

  query(obj) {
    const query = ensureObject(obj, 'query');
    this.querySpec = {
      type: String(query.type ?? 'sat'),
    };
    return this;
  }

  prepareOrSolve(config = {}) {
    if (this.funcs.size > 0 || [...this.consts.values()].some((entry) => entry.sort !== 'Int' && entry.sort !== 'Bool')) {
      return new AdvancedReasoningResult({
        status: 'needs_engine',
        text: 'The SMT task uses functions or non-local sorts that exceed the bounded arithmetic fragment.',
        certainty: 'low',
        evidenceQuality: 'structural',
        assumptionRisk: 'low',
        openWorldRisk: 'low',
        formalizationQuality: 'partial',
        reason: 'Only tiny Int/Bool fragments are solved locally in v0.',
        requiredInputs: ['SMT-LIB encoding', 'SMTEngine'],
        trace: ['Detected unsupported SMT constructs.'],
      });
    }

    const limit = config.localLinearIntegerLimit ?? 4;
    const variableSpecs = [...this.consts.values()].map((entry) => ({
      id: entry.id,
      domain: entry.sort === 'Bool' ? [false, true] : Array.from({ length: limit * 2 + 1 }, (_, index) => index - limit),
    }));
    const product = domainProduct(variableSpecs.map((entry) => entry.domain));
    if (product > 1_024) {
      return new AdvancedReasoningResult({
        status: 'needs_engine',
        text: 'The local SMT search space exceeds the bounded fragment.',
        certainty: 'low',
        evidenceQuality: 'structural',
        assumptionRisk: 'low',
        openWorldRisk: 'low',
        formalizationQuality: 'partial',
        reason: 'Too many bounded assignments for local SMT enumeration.',
        requiredInputs: ['SMTEngine'],
        trace: [`SMT domain product ${product} exceeded the local bound.`],
      });
    }

    let model = null;
    enumerateAssignments(variableSpecs, (assignment) => {
      const satisfied = this.assertions.every((assertion) => evaluateFormula(assertion, assignment));
      if (satisfied) {
        model = { ...assignment };
        return false;
      }
      return undefined;
    }, { maxEvaluations: 4_096 });

    if (!model) {
      return new AdvancedReasoningResult({
        status: 'solved',
        text: 'The bounded SMT fragment is unsatisfiable within the supplied local integer range.',
        certainty: 'high',
        evidenceQuality: 'structural',
        assumptionRisk: 'low',
        openWorldRisk: 'low',
        formalizationQuality: 'complete',
        trace: ['No satisfying assignment was found locally.'],
      });
    }

    return new AdvancedReasoningResult({
      status: 'solved',
      text: this.querySpec?.type === 'model'
        ? `A satisfying model was found: ${Object.entries(model).map(([key, value]) => `${key}=${value}`).join(', ')}.`
        : 'The bounded SMT fragment is satisfiable.',
      certainty: 'high',
      evidenceQuality: 'structural',
      assumptionRisk: 'low',
      openWorldRisk: 'low',
      formalizationQuality: 'complete',
      model,
      trace: ['A satisfying assignment was found locally.'],
    });
  }
}

export class PragmaticInterpretationProblem {
  constructor(name = 'pragmatic-interpretation-problem') {
    this.name = String(name);
    this.utterances = new Map();
    this.frames = new Map();
    this.contextEvidenceItems = [];
    this.impacts = [];
  }

  utterance(obj) {
    const utterance = ensureIdObject(obj, 'utterance');
    this.utterances.set(utterance.id, utterance);
    return this;
  }

  frame(obj) {
    const frame = ensureIdObject(obj, 'frame');
    this.frames.set(frame.id, {
      ...frame,
      assumptions: uniqueStrings(frame.assumptions),
      consequences: uniqueStrings(frame.consequences),
    });
    return this;
  }

  contextEvidence(obj) {
    const evidence = ensureIdObject(obj, 'contextEvidence');
    this.contextEvidenceItems.push({
      ...evidence,
      supportsFrame: ensureString(evidence.supportsFrame, 'contextEvidence.supportsFrame'),
      strength: String(evidence.strength ?? 'medium'),
    });
    return this;
  }

  impact(obj) {
    const impact = ensureObject(obj, 'impact');
    this.impacts.push({
      frame: ensureString(impact.frame, 'impact.frame'),
      affectsAction: Boolean(impact.affectsAction),
      severity: String(impact.severity ?? 'medium'),
    });
    return this;
  }

  rankFrames(config = {}) {
    if (this.frames.size === 0) {
      return new AdvancedReasoningResult({
        status: 'needs_clarification',
        text: 'No candidate pragmatic frames were supplied.',
        certainty: 'unknown',
        evidenceQuality: 'absent',
        assumptionRisk: 'low',
        openWorldRisk: 'medium',
        formalizationQuality: 'weak',
        questions: ['Which interpretations are under consideration?'],
        trace: ['Pragmatic interpretation requires explicit frames.'],
      });
    }

    const ranking = [...this.frames.values()].map((frame) => {
      const evidenceScore = this.contextEvidenceItems
        .filter((entry) => entry.supportsFrame === frame.id)
        .reduce((sum, entry) => sum + strengthWeight(entry.strength), 0);
      const impactScore = this.impacts
        .filter((entry) => entry.frame === frame.id && entry.affectsAction)
        .reduce((sum, entry) => sum + severityWeight(entry.severity) * 0.15, 0);
      return {
        frame,
        score: evidenceScore + impactScore,
      };
    }).sort((left, right) => right.score - left.score || left.frame.id.localeCompare(right.frame.id));

    const best = ranking[0];
    const runnerUp = ranking[1] ?? null;
    const margin = best.score - (runnerUp?.score ?? 0);
    const requiresClarification = Boolean(
      config.requireClarificationIfClose
      && runnerUp
      && margin <= (config.closenessThreshold ?? 0.6)
      && this.impacts.some((entry) => entry.affectsAction && (entry.frame === best.frame.id || entry.frame === runnerUp.frame.id)),
    );

    if (requiresClarification) {
      return new AdvancedReasoningResult({
        status: 'needs_clarification',
        text: `The leading interpretations remain too close to choose safely: ${best.frame.interpretation} versus ${runnerUp.frame.interpretation}.`,
        certainty: 'unknown',
        evidenceQuality: scoreToEvidence(best.score + runnerUp.score),
        assumptionRisk: 'medium',
        openWorldRisk: 'medium',
        formalizationQuality: 'partial',
        topFrame: best.frame,
        questions: [
          `Did the speaker mean "${best.frame.interpretation}" or "${runnerUp.frame.interpretation}"?`,
        ],
        trace: [`Top frame margin ${margin.toFixed(2)} triggered clarification.`],
      });
    }

    return new AdvancedReasoningResult({
      status: 'reasoned',
      text: `Best pragmatic frame: ${best.frame.interpretation}.`,
      certainty: margin > 1 ? 'medium_high' : 'medium',
      evidenceQuality: scoreToEvidence(best.score),
      assumptionRisk: 'medium',
      openWorldRisk: 'medium',
      formalizationQuality: 'partial',
      topFrame: best.frame,
      trace: [`Selected frame ${best.frame.id} with score ${best.score.toFixed(2)}.`],
    });
  }
}

export class AnalogicalReasoningProblem {
  constructor(name = 'analogical-reasoning-problem') {
    this.name = String(name);
    this.sourceEntities = new Map();
    this.targetEntities = new Map();
    this.sourceRelations = [];
    this.targetRelations = [];
    this.candidateMappings = [];
  }

  sourceEntity(obj) {
    const entity = ensureIdObject(obj, 'sourceEntity');
    this.sourceEntities.set(entity.id, entity);
    return this;
  }

  targetEntity(obj) {
    const entity = ensureIdObject(obj, 'targetEntity');
    this.targetEntities.set(entity.id, entity);
    return this;
  }

  sourceRelation(obj) {
    const relation = ensureObject(obj, 'sourceRelation');
    this.sourceRelations.push({
      predicate: ensureString(relation.predicate, 'sourceRelation.predicate'),
      args: uniqueStrings(relation.args),
      weight: Number(relation.weight ?? 1),
    });
    return this;
  }

  targetRelation(obj) {
    const relation = ensureObject(obj, 'targetRelation');
    this.targetRelations.push({
      predicate: ensureString(relation.predicate, 'targetRelation.predicate'),
      args: uniqueStrings(relation.args),
      weight: Number(relation.weight ?? 1),
    });
    return this;
  }

  candidateMapping(obj) {
    const mapping = ensureObject(obj, 'candidateMapping');
    this.candidateMappings.push({
      source: ensureString(mapping.source, 'candidateMapping.source'),
      target: ensureString(mapping.target, 'candidateMapping.target'),
      confidence: String(mapping.confidence ?? 'medium'),
      sourceKind: String(mapping.sourceKind ?? mapping.source ?? 'given'),
    });
    return this;
  }

  scoreMappings() {
    const mappingTable = new Map(this.candidateMappings.map((mapping) => [mapping.source, mapping.target]));
    let score = 0;
    for (const relation of this.sourceRelations) {
      const mappedArgs = relation.args.map((arg) => mappingTable.get(arg));
      if (mappedArgs.some((arg) => !arg)) {
        continue;
      }
      const matched = this.targetRelations.some(
        (targetRelation) => targetRelation.predicate === relation.predicate
          && targetRelation.args.length === mappedArgs.length
          && targetRelation.args.every((arg, index) => arg === mappedArgs[index]),
      );
      if (matched) {
        score += relation.weight;
      }
    }

    return new AdvancedReasoningResult({
      status: 'reasoned',
      text: `Analogical mapping preserved ${score.toFixed(2)} units of relational structure.`,
      certainty: score >= 2 ? 'medium_high' : 'medium',
      evidenceQuality: score > 0 ? 'moderate' : 'weak',
      assumptionRisk: 'medium',
      openWorldRisk: 'medium',
      formalizationQuality: 'partial',
      trace: [`Analogical score ${score.toFixed(2)}.`],
    });
  }
}

export class EthicalDeliberationProblem {
  constructor(name = 'ethical-deliberation-problem') {
    this.name = String(name);
    this.stakeholders = new Map();
    this.options = new Map();
    this.values = new Map();
    this.impacts = [];
    this.constraints = new Map();
  }

  stakeholder(obj) {
    const stakeholder = ensureIdObject(obj, 'stakeholder');
    this.stakeholders.set(stakeholder.id, stakeholder);
    return this;
  }

  option(obj) {
    const option = ensureIdObject(obj, 'option');
    this.options.set(option.id, option);
    return this;
  }

  value(obj) {
    const value = ensureIdObject(obj, 'value');
    this.values.set(value.id, value);
    return this;
  }

  impact(obj) {
    const impact = ensureObject(obj, 'impact');
    this.impacts.push({
      option: ensureString(impact.option, 'impact.option'),
      stakeholder: ensureString(impact.stakeholder, 'impact.stakeholder'),
      type: String(impact.type ?? 'harm'),
      severity: String(impact.severity ?? 'medium'),
      likelihood: String(impact.likelihood ?? 'medium'),
    });
    return this;
  }

  constraint(obj) {
    const constraint = ensureIdObject(obj, 'constraint');
    this.constraints.set(constraint.id, {
      ...constraint,
      mustNotViolate: Boolean(constraint.mustNotViolate),
      violatedBy: uniqueStrings(constraint.violatedBy),
    });
    return this;
  }

  compare(config = {}) {
    const optionScores = [...this.options.values()].map((option) => {
      const impacts = this.impacts.filter((entry) => entry.option === option.id);
      const score = impacts.reduce((sum, entry) => {
        const weight = severityWeight(entry.severity) * likelihoodWeight(entry.likelihood);
        return sum + (entry.type === 'benefit' ? weight : -weight);
      }, 0);
      const hardViolation = [...this.constraints.values()].some(
        (constraint) => constraint.mustNotViolate && constraint.violatedBy.includes(option.id),
      );
      return { option, score, impacts, hardViolation };
    }).sort((left, right) => right.score - left.score || left.option.id.localeCompare(right.option.id));

    const best = optionScores[0];
    const highRisk = best?.hardViolation || best?.impacts.some((entry) => severityWeight(entry.severity) >= 3 && entry.type !== 'benefit');
    if (best && config.requireReviewForHighRisk && highRisk) {
      return new AdvancedReasoningResult({
        status: 'needs_review',
        text: `Option ${best.option.description} cannot be promoted without review because high-risk impacts or hard constraints are present.`,
        certainty: 'low',
        evidenceQuality: 'moderate',
        assumptionRisk: 'high',
        openWorldRisk: 'medium',
        formalizationQuality: 'partial',
        reason: 'High-severity ethical impacts require review before promotion.',
        trace: [`Ethical comparison flagged option ${best.option.id} for review.`],
      });
    }

    return new AdvancedReasoningResult({
      status: 'partial',
      text: best
        ? `The bounded comparison currently favors ${best.option.description} with a qualitative score of ${best.score.toFixed(2)}.`
        : 'No ethical option was supplied.',
      certainty: best ? 'medium' : 'unknown',
      evidenceQuality: best ? 'moderate' : 'absent',
      assumptionRisk: best ? 'medium' : 'low',
      openWorldRisk: 'medium',
      formalizationQuality: best ? 'partial' : 'weak',
      trace: best ? [`Ethical comparison favored ${best.option.id}.`] : ['No options supplied.'],
    });
  }
}

export class CreativeEvaluationProblem {
  constructor(name = 'creative-evaluation-problem') {
    this.name = String(name);
    this.artifacts = new Map();
    this.criteria = new Map();
    this.constraints = new Map();
  }

  artifact(obj) {
    const artifact = ensureIdObject(obj, 'artifact');
    this.artifacts.set(artifact.id, artifact);
    return this;
  }

  criterion(obj) {
    const criterion = ensureIdObject(obj, 'criterion');
    this.criteria.set(criterion.id, criterion);
    return this;
  }

  constraint(obj) {
    const constraint = ensureIdObject(obj, 'constraint');
    this.constraints.set(constraint.id, constraint);
    return this;
  }

  evaluate(config = {}) {
    const artifact = [...this.artifacts.values()][0];
    if (!artifact) {
      return new AdvancedReasoningResult({
        status: 'needs_clarification',
        text: 'No creative artifact was supplied.',
        certainty: 'unknown',
        evidenceQuality: 'absent',
        assumptionRisk: 'low',
        openWorldRisk: 'medium',
        formalizationQuality: 'weak',
        openQuestions: ['Which artifact should be evaluated?'],
        trace: ['Creative evaluation requires an artifact.'],
      });
    }

    const content = String(artifact.content ?? artifact.contentRef ?? '');
    const hardFailures = [];
    for (const constraint of this.constraints.values()) {
      if (constraint.checkType === 'length' && Number.isInteger(constraint.maxWords)) {
        const words = content.trim().split(/\s+/).filter(Boolean).length;
        if (words > constraint.maxWords) {
          hardFailures.push(`${constraint.id}: length ${words} > ${constraint.maxWords}`);
        }
      }
    }

    const criterionScore = average(
      [...this.criteria.values()].map((criterion) => {
        const weight = priorWeight(criterion.weight);
        return content.length > 0 ? weight : 0;
      }),
    );
    const trace = [`Creative criterion score ${criterionScore.toFixed(2)}.`];

    return new AdvancedReasoningResult({
      status: hardFailures.length > 0 ? 'partial' : 'reasoned',
      text: hardFailures.length > 0
        ? `Creative artifact satisfies some rubric items but failed ${hardFailures.join('; ')}.`
        : `Creative artifact passed the bounded rubric with average score ${criterionScore.toFixed(2)}.`,
      certainty: hardFailures.length > 0 ? 'medium' : 'medium_high',
      evidenceQuality: 'moderate',
      assumptionRisk: 'medium',
      openWorldRisk: 'medium',
      formalizationQuality: 'partial',
      openQuestions: config.recommendRevision && hardFailures.length > 0 ? ['Which revision should address the failed constraints first?'] : [],
      trace,
    });
  }

  compare(config = {}) {
    const artifactIds = uniqueStrings(config.artifacts);
    if (artifactIds.length < 2) {
      return this.evaluate(config);
    }
    const scored = artifactIds.map((artifactId) => {
      const artifact = this.artifacts.get(artifactId);
      const content = String(artifact?.content ?? '');
      return {
        artifactId,
        score: content.length,
      };
    }).sort((left, right) => right.score - left.score);

    return new AdvancedReasoningResult({
      status: 'partial',
      text: `Creative comparison prefers ${scored[0].artifactId} by bounded structural score.`,
      certainty: 'medium',
      evidenceQuality: 'weak',
      assumptionRisk: 'medium',
      openWorldRisk: 'medium',
      formalizationQuality: 'partial',
      trace: [`Compared ${artifactIds.length} artifacts.`],
    });
  }
}
