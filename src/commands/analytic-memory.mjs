import { createEmptyEffects } from '../runtime/effects.mjs';

function resolveAggregate(functionName, values) {
  const numericValues = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  switch (functionName) {
    case 'count':
      return values.length;
    case 'sum':
      return numericValues.reduce((sum, value) => sum + value, 0);
    case 'average':
      return numericValues.length === 0 ? null : numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
    case 'min':
      return numericValues.length === 0 ? null : Math.min(...numericValues);
    case 'max':
      return numericValues.length === 0 ? null : Math.max(...numericValues);
    default:
      throw new Error(`Unsupported analytic aggregate: ${functionName}`);
  }
}

function wildcardToRegex(pattern) {
  return new RegExp(`^${pattern.split('.').map((segment) => (segment === '*' ? '[^.]+?' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('\\.')}$`);
}

function parseValue(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }
  const number = Number(trimmed);
  if (!Number.isNaN(number)) {
    return number;
  }
  return trimmed;
}

export async function executeAnalyticMemory(context) {
  const effects = createEmptyEffects();
  const lines = context.body.split('\n').map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    let match = /^store\s+(.+)\s+under\s+([A-Za-z0-9.*_]+)$/.exec(line);
    if (match) {
      context.runtime.analyticStore.setValue(match[2], parseValue(match[1]));
      continue;
    }

    match = /^append\s+(.+)\s+under\s+([A-Za-z0-9.*_]+)$/.exec(line);
    if (match) {
      const current = context.runtime.analyticStore.getValue(match[2]) ?? [];
      const next = Array.isArray(current) ? [...current, parseValue(match[1])] : [current, parseValue(match[1])];
      context.runtime.analyticStore.setValue(match[2], next);
      continue;
    }

    match = /^merge\s+(.+)\s+under\s+([A-Za-z0-9.*_]+)$/.exec(line);
    if (match) {
      const current = context.runtime.analyticStore.getValue(match[2]) ?? {};
      context.runtime.analyticStore.setValue(match[2], {
        ...current,
        ...parseValue(match[1]),
      });
      continue;
    }

    match = /^derive\s+([A-Za-z0-9.*_]+)\s*=\s*([a-z]+)\(([A-Za-z0-9.*_]+)\)$/.exec(line);
    if (match) {
      const regex = wildcardToRegex(match[3]);
      const values = context.runtime.analyticStore
        .listEntries()
        .filter((entry) => regex.test(entry.key))
        .map((entry) => entry.value);
      context.runtime.analyticStore.setValue(match[1], resolveAggregate(match[2], values));
      continue;
    }

    match = /^rollup\s+([A-Za-z0-9.*_]+)\s+using\s+([a-z]+)\(([A-Za-z0-9.*_]+)\)(?:\s+and\s+([a-z]+)\(([A-Za-z0-9.*_]+)\))?$/.exec(line);
    if (match) {
      const prefix = match[1];
      const regexA = wildcardToRegex(`${prefix}.${match[3]}`);
      const valuesA = context.runtime.analyticStore.listEntries().filter((entry) => regexA.test(entry.key)).map((entry) => entry.value);
      const summary = {
        [match[2]]: resolveAggregate(match[2], valuesA),
      };
      if (match[4]) {
        const regexB = wildcardToRegex(`${prefix}.${match[5]}`);
        const valuesB = context.runtime.analyticStore.listEntries().filter((entry) => regexB.test(entry.key)).map((entry) => entry.value);
        summary[match[4]] = resolveAggregate(match[4], valuesB);
      }
      context.runtime.analyticStore.setValue(`${prefix}.summary`, summary);
      continue;
    }

    match = /^export\s+([A-Za-z0-9.*_]+)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(line);
    if (match) {
      const value = context.runtime.analyticStore.getValue(match[1]);
      effects.emittedVariants.push({
        familyId: match[2],
        value,
        meta: {
          origin: 'analytic-memory',
        },
      });
      continue;
    }

    throw new Error(`Unsupported analytic-memory instruction: ${line}`);
  }

  const checkpoint = await context.runtime.analyticStore.checkpoint(context.sessionId, {
    request_id: context.requestId,
    epoch_id: context.epochNumber,
    origin: 'analytic-memory',
  });

  context.runtime.pendingAnalyticCheckpoint = checkpoint;

  if (effects.emittedVariants.length === 0) {
    effects.emittedVariants.push({
      familyId: context.targetFamily,
      value: {
        keys: context.runtime.analyticStore.listEntries().map((entry) => entry.key),
      },
      meta: {
        origin: 'analytic-memory',
      },
    });
  }

  return effects;
}
