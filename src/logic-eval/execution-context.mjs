import { evaluateExpression, isExpr } from './expression-eval.mjs';

/**
 * Typed working memory for a single logic-eval request.
 * Registers: input, given, vars, results, assumptions, unknown, conflicts, trace, final.
 */
export class ExecutionContext {
  constructor(input = {}) {
    this._registers = {
      input,
      given: {},
      vars: {},
      results: {},
      assumptions: {},
      unknown: [],
      conflicts: [],
      trace: [],
      final: undefined,
    };
  }

  getRegister(name) {
    if (name in this._registers) {
      return this._registers[name];
    }
    // Fallback to vars for unqualified names
    return this._registers.vars[name];
  }

  _resolve(valueOrExpr) {
    if (isExpr(valueOrExpr)) {
      return evaluateExpression(valueOrExpr, this);
    }
    return valueOrExpr;
  }

  set(name, valueOrExpr) {
    this._registers.vars[name] = this._resolve(valueOrExpr);
    this._registers.trace.push({ op: 'set', name, value: this._registers.vars[name] });
    return this;
  }

  get(refOrExpr) {
    return this._resolve(refOrExpr);
  }

  has(name) {
    return name in this._registers.vars;
  }

  append(name, valueOrExpr) {
    if (!Array.isArray(this._registers.vars[name])) {
      this._registers.vars[name] = [];
    }
    const value = this._resolve(valueOrExpr);
    this._registers.vars[name].push(value);
    this._registers.trace.push({ op: 'append', name, value });
    return this;
  }

  extend(name, listExpr) {
    const list = this._resolve(listExpr);
    if (!Array.isArray(list)) {
      throw new Error(`extend expected array, got ${typeof list}`);
    }
    if (!Array.isArray(this._registers.vars[name])) {
      this._registers.vars[name] = [];
    }
    this._registers.vars[name].push(...list);
    this._registers.trace.push({ op: 'extend', name, added: list.length });
    return this;
  }

  project(name, fromExpr, selectorExpr) {
    const from = this._resolve(fromExpr);
    const selector = this._resolve(selectorExpr);
    let result;

    if (from && typeof from === 'object') {
      if (Array.isArray(from)) {
        if (typeof selector === 'function') {
          result = from.map(selector);
        } else {
          result = from.map((item) => (item && typeof item === 'object' ? item[selector] : undefined));
        }
      } else {
        result = from[selector];
      }
    } else {
      result = undefined;
    }

    this._registers.vars[name] = result;
    this._registers.trace.push({ op: 'project', name, selector });
    return this;
  }

  filter(name, fromExpr, predicateExpr) {
    const from = this._resolve(fromExpr);
    if (!Array.isArray(from)) {
      throw new Error(`filter expected array, got ${typeof from}`);
    }

    const predicate = this._resolve(predicateExpr);
    let result;
    if (typeof predicate === 'function') {
      result = from.filter(predicate);
    } else if (typeof predicate === 'string') {
      result = from.filter((item) => item && typeof item === 'object' && item[predicate]);
    } else {
      throw new Error(`filter predicate must be function or property name`);
    }

    this._registers.vars[name] = result;
    this._registers.trace.push({ op: 'filter', name, count: result.length });
    return this;
  }

  map(name, fromExpr, mapperExpr) {
    const from = this._resolve(fromExpr);
    if (!Array.isArray(from)) {
      throw new Error(`map expected array, got ${typeof from}`);
    }

    const mapper = this._resolve(mapperExpr);
    let result;
    if (typeof mapper === 'function') {
      result = from.map(mapper);
    } else if (typeof mapper === 'string') {
      result = from.map((item) => (item && typeof item === 'object' ? item[mapper] : undefined));
    } else {
      throw new Error(`map mapper must be function or property name`);
    }

    this._registers.vars[name] = result;
    this._registers.trace.push({ op: 'map', name, count: result.length });
    return this;
  }

  unique(name, fromExpr) {
    const from = this._resolve(fromExpr);
    if (!Array.isArray(from)) {
      throw new Error(`unique expected array, got ${typeof from}`);
    }
    const seen = new Set();
    const result = [];
    for (const item of from) {
      const key = typeof item === 'object' ? JSON.stringify(item) : item;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }
    this._registers.vars[name] = result;
    this._registers.trace.push({ op: 'unique', name, count: result.length });
    return this;
  }

  sort(name, fromExpr, keyExpr) {
    const from = this._resolve(fromExpr);
    if (!Array.isArray(from)) {
      throw new Error(`sort expected array, got ${typeof from}`);
    }
    const key = keyExpr !== undefined ? this._resolve(keyExpr) : undefined;
    const result = [...from];
    result.sort((a, b) => {
      let av = a;
      let bv = b;
      if (key !== undefined && a && typeof a === 'object') {
        av = a[key];
      }
      if (key !== undefined && b && typeof b === 'object') {
        bv = b[key];
      }
      if (typeof av === 'number' && typeof bv === 'number') {
        return av - bv;
      }
      return String(av).localeCompare(String(bv));
    });
    this._registers.vars[name] = result;
    this._registers.trace.push({ op: 'sort', name, count: result.length });
    return this;
  }

  count(name, fromExpr) {
    const from = this._resolve(fromExpr);
    let n = 0;
    if (Array.isArray(from)) {
      n = from.length;
    } else if (typeof from === 'string') {
      n = from.length;
    } else if (from && typeof from === 'object') {
      n = Object.keys(from).length;
    }
    this._registers.vars[name] = n;
    this._registers.trace.push({ op: 'count', name, value: n });
    return this;
  }

  assert(expr, message) {
    const value = this._resolve(expr);
    if (!value) {
      const msg = message || 'Assertion failed';
      this._registers.conflicts.push({ type: 'assertion', message: msg });
      throw new Error(msg);
    }
    this._registers.trace.push({ op: 'assert', passed: true });
    return this;
  }

  assume(label, valueOrExpr) {
    const value = this._resolve(valueOrExpr);
    this._registers.assumptions[label] = value;
    this._registers.trace.push({ op: 'assume', label, value });
    return this;
  }

  storeResult(name, result) {
    this._registers.results[name] = result;
    this._registers.trace.push({ op: 'storeResult', name, status: result?.status });
    return this;
  }

  result(name) {
    return this._registers.results[name];
  }

  setFinal(valueOrExpr) {
    this._registers.final = this._resolve(valueOrExpr);
    this._registers.trace.push({ op: 'setFinal', final: this._registers.final });
    return this;
  }

  toInspect() {
    return {
      input: this._registers.input,
      given: this._registers.given,
      vars: this._registers.vars,
      results: this._registers.results,
      assumptions: this._registers.assumptions,
      unknown: this._registers.unknown,
      conflicts: this._registers.conflicts,
      trace: this._registers.trace,
      final: this._registers.final,
    };
  }
}
