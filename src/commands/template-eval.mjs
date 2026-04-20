import { createEmptyEffects } from '../runtime/effects.mjs';

function resolvePath(pathExpression, context) {
  const segments = pathExpression.split('.');
  let current = context;
  for (const segment of segments) {
    if (current == null) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function renderHelpers(expression, context) {
  const joinMatch = /^join\s+(.+)\s+"([^"]*)"$/.exec(expression);
  if (joinMatch) {
    const value = resolvePath(joinMatch[1].trim(), context);
    if (!Array.isArray(value)) {
      throw new Error(`join helper expects an array for ${joinMatch[1]}.`);
    }
    return value.join(joinMatch[2]);
  }

  const defaultMatch = /^default\s+(.+)\s+"([^"]*)"$/.exec(expression);
  if (defaultMatch) {
    const value = resolvePath(defaultMatch[1].trim(), context);
    return value == null || value === '' ? defaultMatch[2] : String(value);
  }

  const truncateMatch = /^truncate\s+(.+)\s+([0-9]+)$/.exec(expression);
  if (truncateMatch) {
    const value = String(resolvePath(truncateMatch[1].trim(), context) ?? '');
    const maxLength = Number(truncateMatch[2]);
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
  }

  const dateMatch = /^formatDate\s+(.+)$/.exec(expression);
  if (dateMatch) {
    const value = resolvePath(dateMatch[1].trim(), context);
    return new Date(value).toISOString();
  }

  const numberMatch = /^formatNumber\s+(.+)$/.exec(expression);
  if (numberMatch) {
    const value = Number(resolvePath(numberMatch[1].trim(), context));
    return Number.isFinite(value) ? value.toLocaleString('en-US') : '';
  }

  return null;
}

function renderTemplate(source, context) {
  let output = source;

  output = output.replace(/\{\{#if\s+(.+?)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g, (_match, expression, truthy, falsy) => {
    const value = resolvePath(expression.trim(), context);
    return value ? renderTemplate(truthy, context) : renderTemplate(falsy ?? '', context);
  });

  output = output.replace(/\{\{#each\s+(.+?)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_match, expression, itemName, body) => {
    const value = resolvePath(expression.trim(), context);
    if (!Array.isArray(value)) {
      throw new Error(`Loop source ${expression} is not list-like.`);
    }
    return value.map((item) => renderTemplate(body, {
      ...context,
      [itemName]: item,
    })).join('');
  });

  output = output.replace(/\{\{\s*(.+?)\s*\}\}/g, (_match, expression) => {
    const helperValue = renderHelpers(expression.trim(), context);
    if (helperValue !== null) {
      return helperValue;
    }
    const value = resolvePath(expression.trim(), context);
    if (value === undefined) {
      throw new Error(`Missing required placeholder: ${expression}`);
    }
    return String(value);
  });

  return output;
}

export async function executeTemplateEval(context) {
  const effects = createEmptyEffects();
  const templateContext = context.runtime.createTemplateContext();
  const rendered = renderTemplate(context.body, templateContext);
  effects.emittedVariants.push({
    familyId: context.targetFamily,
    value: rendered,
    meta: {
      origin: 'template-eval',
    },
  });
  return effects;
}
