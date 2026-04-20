import vm from 'node:vm';
import { rewriteJsReferences } from '../lang/references.mjs';
import { createEmptyEffects } from '../runtime/effects.mjs';
import { createFailureRecord } from '../utils/errors.mjs';

function createSopRef(runtime, collector, token, tools) {
  const raw = token.slice(1);
  const [familyId, variantId] = raw.split(':');
  let currentTargetId = variantId ? `${familyId}:${variantId}` : null;

  function resolveCurrent() {
    if (currentTargetId) {
      return runtime.stateStore.getVariant(currentTargetId);
    }
    const family = runtime.stateStore.getFamily(familyId);
    if (!family) {
      return null;
    }
    return runtime.stateStore.representativeCache.get(familyId)
      ?? family.variants.find((variant) => variant.meta.status === 'active')
      ?? null;
  }

  const base = {
    get() {
      return resolveCurrent()?.value;
    },
    meta() {
      return resolveCurrent()?.meta ?? {};
    },
    exists() {
      return Boolean(resolveCurrent());
    },
    set(value, meta = {}) {
      const emitted = {
        familyId,
        value,
        meta: {
          ...meta,
          origin: 'js-eval',
          created_epoch: tools.epochNumber,
        },
      };
      collector.emittedVariants.push(emitted);
      currentTargetId = `${familyId}:pending-${collector.emittedVariants.length}`;
      return value;
    },
    patchMeta(patch) {
      const target = resolveCurrent();
      if (!target) {
        throw new Error(`Cannot patch metadata for missing target ${token}.`);
      }
      collector.metadataUpdates.push({
        targetId: target.id,
        patch,
      });
      return patch;
    },
    withdraw(reason = 'withdrawn') {
      const target = resolveCurrent();
      if (!target) {
        throw new Error(`Cannot withdraw missing target ${token}.`);
      }
      collector.withdrawals.push({
        targetId: target.id,
        reason,
      });
      return true;
    },
    family() {
      return familyId;
    },
    id() {
      const target = resolveCurrent();
      return target?.id ?? currentTargetId ?? familyId;
    },
  };

  return new Proxy(base, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver);
      }
      const value = target.get();
      if (value && (typeof value === 'object' || Array.isArray(value))) {
        return value[property];
      }
      return undefined;
    },
    set(target, property, value) {
      const current = target.get();
      if (!(current && (typeof current === 'object' || Array.isArray(current)))) {
        throw new Error(`Property assignment is unsupported for non-object reference ${token}.`);
      }
      const next = Array.isArray(current) ? [...current] : { ...current };
      next[property] = value;
      target.set(next, { origin: 'js-eval' });
      return true;
    },
  });
}

export async function executeJsEval(context) {
  const effects = createEmptyEffects();
  const values = {};
  const refs = {};

  for (const reference of context.node.dependencies) {
    if (reference.kind === '$') {
      const resolved = await context.runtime.stateStore.resolveReference(reference, {
        sessionId: context.sessionId,
        requestId: context.requestId,
        epochNumber: context.epochNumber,
      });
      values[reference.raw] = resolved?.rendered ?? '';
    }
    if (reference.kind === '~') {
      refs[reference.raw] = createSopRef(context.runtime, effects, reference.raw, {
        epochNumber: context.epochNumber,
      });
    }
  }

  const source = rewriteJsReferences(context.body, (token) => {
    if (token.startsWith('$')) {
      return `__sop_values[${JSON.stringify(token)}]`;
    }
    return `__sop_refs[${JSON.stringify(token)}]`;
  });

  const helper = {
    ref(id) {
      return createSopRef(context.runtime, effects, `~${id}`, {
        epochNumber: context.epochNumber,
      });
    },
    emit(id, value) {
      effects.emittedVariants.push({
        familyId: id,
        value,
        meta: {
          origin: 'js-eval',
        },
      });
      return value;
    },
    fail(reason) {
      effects.failure = createFailureRecord({
        kind: 'execution_error',
        message: reason,
        origin: 'js-eval',
        familyId: context.targetFamily,
        repairable: true,
      });
      throw new Error(reason);
    },
    insertDeclarations(text, meta = {}) {
      effects.declarationInsertions.push({
        text,
        meta: {
          ...meta,
          source_interpreter: 'js-eval',
        },
      });
      return true;
    },
    now() {
      return context.runtime.tools.now();
    },
  };

  const sandbox = {
    __sop_values: values,
    __sop_refs: refs,
    sop: helper,
  };

  vm.createContext(sandbox);

  try {
    const script = new vm.Script(`(async () => {\n${source}\n})()`);
    const result = await script.runInContext(sandbox, {
      timeout: 1_000,
    });
    if (result !== undefined && effects.emittedVariants.length === 0 && !effects.failure) {
      effects.emittedVariants.push({
        familyId: context.targetFamily,
        value: result,
        meta: {
          origin: 'js-eval',
        },
      });
    }
    return effects;
  } catch (error) {
    if (!effects.failure) {
      effects.failure = createFailureRecord({
        kind: 'execution_error',
        message: error.message,
        origin: 'js-eval',
        familyId: context.targetFamily,
        repairable: true,
      });
    }
    return effects;
  }
}
