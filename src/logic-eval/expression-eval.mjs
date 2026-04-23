/**
 * Bounded expression evaluator for the logic-eval DSL.
 * Supports path references, comparisons, small collection operators,
 * and elementary logic. This is NOT general JavaScript.
 */

const EXPR_OPS = new Set([
  'ref', 'eq', 'neq', 'gt', 'lt', 'gte', 'lte',
  'and', 'or', 'not',
  'count', 'path', 'add', 'sub', 'mul', 'div',
  'in', 'contains',
]);

function isExpr(value) {
  return Array.isArray(value) && value.length > 0 && EXPR_OPS.has(value[0]);
}

export function evaluateExpression(expr, ctx) {
  if (expr === undefined || expr === null) {
    return expr;
  }

  if (!isExpr(expr)) {
    // Literal value (string, number, boolean, object, array)
    return expr;
  }

  const [op, ...args] = expr;

  switch (op) {
    case 'ref': {
      const path = String(args[0] ?? '');
      return resolvePath(path, ctx);
    }
    case 'eq': {
      const [left, right] = args;
      return evaluateExpression(left, ctx) === evaluateExpression(right, ctx);
    }
    case 'neq': {
      const [left, right] = args;
      return evaluateExpression(left, ctx) !== evaluateExpression(right, ctx);
    }
    case 'gt': {
      const [left, right] = args;
      return Number(evaluateExpression(left, ctx)) > Number(evaluateExpression(right, ctx));
    }
    case 'lt': {
      const [left, right] = args;
      return Number(evaluateExpression(left, ctx)) < Number(evaluateExpression(right, ctx));
    }
    case 'gte': {
      const [left, right] = args;
      return Number(evaluateExpression(left, ctx)) >= Number(evaluateExpression(right, ctx));
    }
    case 'lte': {
      const [left, right] = args;
      return Number(evaluateExpression(left, ctx)) <= Number(evaluateExpression(right, ctx));
    }
    case 'and': {
      return args.every((arg) => evaluateExpression(arg, ctx));
    }
    case 'or': {
      return args.some((arg) => evaluateExpression(arg, ctx));
    }
    case 'not': {
      return !evaluateExpression(args[0], ctx);
    }
    case 'count': {
      const val = evaluateExpression(args[0], ctx);
      if (Array.isArray(val)) {
        return val.length;
      }
      if (typeof val === 'string') {
        return val.length;
      }
      if (val && typeof val === 'object') {
        return Object.keys(val).length;
      }
      return 0;
    }
    case 'path': {
      // ['path', baseExpr, start, end] or ['path', baseExpr, start]
      const arr = evaluateExpression(args[0], ctx);
      if (!Array.isArray(arr) && typeof arr !== 'string') {
        return undefined;
      }
      const start = Number(evaluateExpression(args[1], ctx));
      const end = args[2] !== undefined ? Number(evaluateExpression(args[2], ctx)) : undefined;
      if (end !== undefined) {
        return arr.slice(start, end);
      }
      return arr[start];
    }
    case 'add': {
      return Number(evaluateExpression(args[0], ctx)) + Number(evaluateExpression(args[1], ctx));
    }
    case 'sub': {
      return Number(evaluateExpression(args[0], ctx)) - Number(evaluateExpression(args[1], ctx));
    }
    case 'mul': {
      return Number(evaluateExpression(args[0], ctx)) * Number(evaluateExpression(args[1], ctx));
    }
    case 'div': {
      const divisor = Number(evaluateExpression(args[1], ctx));
      if (divisor === 0) {
        throw new Error('Division by zero in expression');
      }
      return Number(evaluateExpression(args[0], ctx)) / divisor;
    }
    case 'in': {
      const item = evaluateExpression(args[0], ctx);
      const collection = evaluateExpression(args[1], ctx);
      if (Array.isArray(collection)) {
        return collection.includes(item);
      }
      if (typeof collection === 'string') {
        return collection.includes(String(item));
      }
      return false;
    }
    case 'contains': {
      const haystack = evaluateExpression(args[0], ctx);
      const needle = evaluateExpression(args[1], ctx);
      if (Array.isArray(haystack)) {
        return haystack.includes(needle);
      }
      if (typeof haystack === 'string') {
        return haystack.includes(String(needle));
      }
      return false;
    }
    default: {
      throw new Error(`Unsupported expression operator: ${op}`);
    }
  }
}

function resolvePath(path, ctx) {
  if (typeof path !== 'string') {
    return undefined;
  }

  // Strip leading $ if present
  const cleanPath = path.startsWith('$') ? path.slice(1) : path;
  if (!cleanPath) {
    return undefined;
  }

  const segments = cleanPath.split('.');
  let current = undefined;

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const bracketIndex = segment.indexOf('[');

    if (i === 0) {
      // First segment resolves against context registers
      const name = bracketIndex >= 0 ? segment.slice(0, bracketIndex) : segment;
      current = ctx.getRegister(name);
    } else {
      const name = bracketIndex >= 0 ? segment.slice(0, bracketIndex) : segment;
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        current = current[name];
      } else {
        return undefined;
      }
    }

    if (bracketIndex >= 0) {
      const bracketEnd = segment.indexOf(']', bracketIndex);
      if (bracketEnd === -1) {
        return undefined;
      }
      const indexStr = segment.slice(bracketIndex + 1, bracketEnd);
      const index = Number(indexStr);
      if (Array.isArray(current) || typeof current === 'string') {
        current = current[index];
      } else if (current && typeof current === 'object') {
        current = current[indexStr];
      } else {
        return undefined;
      }
    }

    if (current === undefined) {
      return undefined;
    }
  }

  return current;
}

export { isExpr };
