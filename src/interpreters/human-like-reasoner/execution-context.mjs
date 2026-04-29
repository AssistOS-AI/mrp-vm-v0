import { canonicalText } from '../../utils/text.mjs';
import { TextBuilder } from './text-builder.mjs';

function ensureFiniteCollection(collection, label, maxCollectionSize) {
  if (!Array.isArray(collection)) {
    throw new Error(`${label} must be an array.`);
  }
  if (collection.length > maxCollectionSize) {
    throw new Error(`${label} exceeds max finite collection size ${maxCollectionSize}.`);
  }
}

function serializeResult(result) {
  if (result && typeof result.toJSON === 'function') {
    return result.toJSON();
  }
  return result;
}

export class HumanLikeExecutionContext {
  constructor(input = {}, options = {}) {
    this.maxCollectionSize = options.maxCollectionSize ?? 256;
    this.state = {
      input,
      vars: new Map(),
      results: new Map(),
      assumptions: new Map(),
      trace: [],
      outputs: new Map(),
    };
  }

  input() {
    return this.state.input;
  }

  set(name, value) {
    this.state.vars.set(String(name), value);
    this.trace(`set ${name}`);
    return value;
  }

  get(name) {
    return this.state.vars.get(String(name));
  }

  has(name) {
    return this.state.vars.has(String(name));
  }

  storeResult(name, result) {
    this.state.results.set(String(name), result);
    this.trace(`stored result ${name}`);
    return result;
  }

  result(name) {
    return this.state.results.get(String(name));
  }

  assert(condition, message = 'Assertion failed.') {
    if (!condition) {
      throw new Error(String(message));
    }
    this.trace(`assert ${message}`);
    return true;
  }

  assume(label, value) {
    this.state.assumptions.set(String(label), value);
    this.trace(`assume ${label}`);
    return value;
  }

  mapFinite(name, collection, mapper) {
    ensureFiniteCollection(collection, String(name), this.maxCollectionSize);
    if (typeof mapper !== 'function') {
      throw new Error('mapFinite mapper must be a function.');
    }
    const result = collection.map((item, index) => mapper(item, index));
    this.set(name, result);
    return result;
  }

  filterFinite(name, collection, predicate) {
    ensureFiniteCollection(collection, String(name), this.maxCollectionSize);
    if (typeof predicate !== 'function') {
      throw new Error('filterFinite predicate must be a function.');
    }
    const result = collection.filter((item, index) => predicate(item, index));
    this.set(name, result);
    return result;
  }

  count(name, collection) {
    if (Array.isArray(collection) || typeof collection === 'string') {
      this.set(name, collection.length);
      return collection.length;
    }
    if (collection && typeof collection === 'object') {
      const value = Object.keys(collection).length;
      this.set(name, value);
      return value;
    }
    this.set(name, 0);
    return 0;
  }

  text(name) {
    const builder = new TextBuilder(name);
    this.set(name, builder);
    return builder;
  }

  emit(target, text) {
    const current = this.state.outputs.get(String(target)) ?? { text: '', meta: {} };
    current.text = typeof text === 'string' ? text : canonicalText(text);
    this.state.outputs.set(String(target), current);
    this.trace(`emit ${target}`);
    return current.text;
  }

  meta(target, key, value) {
    const current = this.state.outputs.get(String(target)) ?? { text: '', meta: {} };
    current.meta[String(key)] = value;
    this.state.outputs.set(String(target), current);
    this.trace(`meta ${target}.${key}`);
    return value;
  }

  trace(message) {
    if (arguments.length === 0) {
      return [...this.state.trace];
    }
    this.state.trace.push(String(message));
    return message;
  }

  addTrace(message) {
    return this.trace(message);
  }

  finalize() {
    return {
      outputs: [...this.state.outputs.entries()].map(([target, payload]) => ({
        target,
        text: payload.text,
        meta: { ...payload.meta },
      })),
      assumptions: Object.fromEntries(this.state.assumptions.entries()),
      trace: [...this.state.trace],
      vars: Object.fromEntries(this.state.vars.entries()),
      results: Object.fromEntries(
        [...this.state.results.entries()].map(([name, result]) => [name, serializeResult(result)]),
      ),
    };
  }
}
