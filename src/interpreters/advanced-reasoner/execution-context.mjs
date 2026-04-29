import { ReasonerResponse } from './reasoner-response.mjs';

function serializeResult(result) {
  if (result && typeof result.toJSON === 'function') {
    return result.toJSON();
  }
  return result;
}

export class ReturnResponseSignal extends Error {
  constructor(response) {
    super('AdvancedReasoner returned a structured response.');
    this.name = 'ReturnResponseSignal';
    this.response = response;
  }
}

export class AdvancedExecutionContext {
  constructor(input = {}, options = {}) {
    this.maxTraceLength = options.maxTraceLength ?? 256;
    this.state = {
      input,
      vars: new Map(),
      results: new Map(),
      assumptions: new Map(),
      trace: [],
      response: null,
    };
  }

  input() {
    return this.state.input;
  }

  has(name) {
    return this.state.vars.has(String(name));
  }

  set(name, value) {
    this.state.vars.set(String(name), value);
    this.addTrace(`set ${name}`);
    return value;
  }

  get(name) {
    return this.state.vars.get(String(name));
  }

  storeResult(name, result) {
    this.state.results.set(String(name), result);
    this.addTrace(`stored result ${name}`);
    return result;
  }

  result(name) {
    return this.state.results.get(String(name));
  }

  assume(label, value) {
    this.state.assumptions.set(String(label), value);
    this.addTrace(`assume ${label}`);
    return value;
  }

  assert(condition, message = 'Assertion failed.') {
    if (!condition) {
      throw new Error(String(message));
    }
    this.addTrace(`assert ${message}`);
    return true;
  }

  addTrace(message) {
    if (this.state.trace.length < this.maxTraceLength) {
      this.state.trace.push(String(message));
    }
    return message;
  }

  trace() {
    return [...this.state.trace];
  }

  returnResponse(response) {
    if (this.state.response) {
      throw new Error('AdvancedReasoner response was already returned.');
    }
    const normalized = ReasonerResponse.from(response);
    this.state.response = normalized;
    this.addTrace(`return ${normalized.status}`);
    throw new ReturnResponseSignal(normalized);
  }

  finalize() {
    if (!this.state.response) {
      throw new Error('AdvancedReasoner program did not call ctx.returnResponse(...).');
    }
    return {
      response: this.state.response.toJSON(),
      assumptions: Object.fromEntries(this.state.assumptions.entries()),
      trace: [...this.state.trace],
      vars: Object.fromEntries(this.state.vars.entries()),
      results: Object.fromEntries(
        [...this.state.results.entries()].map(([name, result]) => [name, serializeResult(result)]),
      ),
    };
  }
}
