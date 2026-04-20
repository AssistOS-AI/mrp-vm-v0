import { createEmptyEffects } from '../runtime/effects.mjs';
import { createFailureRecord } from '../utils/errors.mjs';

function parseLiteral(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (trimmed === 'null') {
    return null;
  }
  const number = Number(trimmed);
  if (!Number.isNaN(number)) {
    return number;
  }
  return trimmed;
}

function resolveFamilyValue(runtime, familyId) {
  const family = runtime.stateStore.getFamily(familyId);
  if (!family) {
    return undefined;
  }
  const representative = runtime.stateStore.representativeCache.get(familyId) ?? family.variants.find((variant) => variant.meta.status === 'active');
  return representative?.value;
}

function evaluatePredicate(runtime, expression) {
  let match = /^exists\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(expression);
  if (match) {
    return resolveFamilyValue(runtime, match[1]) !== undefined;
  }

  match = /^not exists\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(expression);
  if (match) {
    return resolveFamilyValue(runtime, match[1]) === undefined;
  }

  match = /^contains\s+([A-Za-z_][A-Za-z0-9_]*)\s+"([^"]*)"$/.exec(expression);
  if (match) {
    const value = resolveFamilyValue(runtime, match[1]);
    return Array.isArray(value) ? value.includes(match[2]) : String(value ?? '').includes(match[2]);
  }

  match = /^matches\s+([A-Za-z_][A-Za-z0-9_]*)\s+"([^"]*)"$/.exec(expression);
  if (match) {
    const value = String(resolveFamilyValue(runtime, match[1]) ?? '');
    return new RegExp(match[2]).test(value);
  }

  match = /^value\s+([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(expression);
  if (match) {
    const current = resolveFamilyValue(runtime, match[1]);
    const expected = parseLiteral(match[3]);
    switch (match[2]) {
      case '==': return current === expected;
      case '!=': return current !== expected;
      case '>': return Number(current) > Number(expected);
      case '<': return Number(current) < Number(expected);
      case '>=': return Number(current) >= Number(expected);
      case '<=': return Number(current) <= Number(expected);
      default: return false;
    }
  }

  match = /^any\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)\s+where\s+(.+)$/.exec(expression);
  if (match) {
    const values = resolveFamilyValue(runtime, match[2]);
    if (!Array.isArray(values)) {
      return false;
    }
    return values.some((item) => String(item).includes(match[3]));
  }

  match = /^all\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)\s+where\s+(.+)$/.exec(expression);
  if (match) {
    const values = resolveFamilyValue(runtime, match[2]);
    if (!Array.isArray(values)) {
      return false;
    }
    return values.every((item) => String(item).includes(match[3]));
  }

  throw new Error(`Unsupported predicate: ${expression}`);
}

function parseRules(body) {
  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
  const rules = [];
  let currentRule = null;

  for (const line of lines) {
    if (line.startsWith('use ')) {
      continue;
    }
    if (line.startsWith('when ')) {
      if (currentRule) {
        rules.push(currentRule);
      }
      currentRule = {
        predicates: [{ operator: 'and', expression: line.slice(5).trim() }],
        action: null,
      };
      continue;
    }
    if (line.startsWith('and ') || line.startsWith('or ')) {
      if (!currentRule) {
        throw new Error('Predicate continuation without a preceding when block.');
      }
      currentRule.predicates.push({
        operator: line.startsWith('and ') ? 'and' : 'or',
        expression: line.slice(4).trim(),
      });
      continue;
    }
    if (line.startsWith('then ')) {
      if (!currentRule) {
        throw new Error('then block without a preceding when block.');
      }
      currentRule.action = line.slice(5).trim();
      rules.push(currentRule);
      currentRule = null;
      continue;
    }
    throw new Error(`Unsupported logic-eval line: ${line}`);
  }

  if (currentRule) {
    rules.push(currentRule);
  }

  return rules;
}

function applyAction(action, runtime, effects) {
  let match = /^set\s+~([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)(?:\s+with\s+(.+))?$/.exec(action);
  if (match) {
    effects.emittedVariants.push({
      familyId: match[1],
      value: parseLiteral(match[2]),
      meta: match[3] ? JSON.parse(match[3]) : { origin: 'logic-eval' },
    });
    return;
  }

  match = /^patch-meta\s+~([A-Za-z_][A-Za-z0-9_:]*)\s+with\s+(.+)$/.exec(action);
  if (match) {
    effects.metadataUpdates.push({
      targetId: match[1].includes(':') ? match[1] : `${match[1]}:meta`,
      patch: JSON.parse(match[2]),
    });
    return;
  }

  match = /^score\s+~([A-Za-z_][A-Za-z0-9_:]*)\s*=\s*([0-9.]+)\s+because\s+"([^"]+)"$/.exec(action);
  if (match) {
    effects.metadataUpdates.push({
      targetId: match[1],
      patch: {
        score: Number(match[2]),
        reason: match[3],
      },
    });
    return;
  }

  match = /^withdraw\s+~([A-Za-z_][A-Za-z0-9_:]*)\s+because\s+"([^"]+)"$/.exec(action);
  if (match) {
    effects.withdrawals.push({
      targetId: match[1],
      reason: match[2],
    });
    return;
  }

  match = /^emit error for ~([A-Za-z_][A-Za-z0-9_]*) reason "([^"]+)"$/.exec(action);
  if (match) {
    effects.failure = createFailureRecord({
      kind: 'execution_error',
      message: match[2],
      origin: 'logic-eval',
      familyId: match[1],
      repairable: true,
    });
    return;
  }

  match = /^insert declarations """([\s\S]*)"""$/.exec(action);
  if (match) {
    effects.declarationInsertions.push({
      text: match[1],
      meta: {
        source_interpreter: 'logic-eval',
      },
    });
    return;
  }

  throw new Error(`Unsupported logic-eval action: ${action}`);
}

export async function executeLogicEval(context) {
  const effects = createEmptyEffects();
  const rules = parseRules(context.body);

  for (const rule of rules) {
    let result = null;
    for (const predicate of rule.predicates) {
      const value = evaluatePredicate(context.runtime, predicate.expression);
      if (result === null) {
        result = value;
        continue;
      }
      result = predicate.operator === 'and' ? result && value : result || value;
    }

    if (result) {
      applyAction(rule.action, context.runtime, effects);
    }
  }

  if (effects.emittedVariants.length === 0 && !effects.failure && effects.declarationInsertions.length === 0) {
    effects.emittedVariants.push({
      familyId: context.targetFamily,
      value: {
        matched_rules: rules.length,
      },
      meta: {
        origin: 'logic-eval',
      },
    });
  }

  return effects;
}
