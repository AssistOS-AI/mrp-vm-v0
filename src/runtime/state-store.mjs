import { createVariantId, parseVariantId } from '../utils/ids.mjs';
import { canonicalText } from '../utils/text.mjs';
import { createFailureRecord, isUsableVariant } from '../utils/errors.mjs';

function createFamilyRecord(familyId) {
  return {
    familyId,
    familyMeta: {
      status: 'pending',
    },
    variants: [],
  };
}

export class StateStore {
  constructor(options = {}) {
    this.families = new Map();
    this.representativeCache = new Map();
    this.resolvePluralFamily = options.resolvePluralFamily ?? null;
  }

  ensureFamily(familyId) {
    if (!this.families.has(familyId)) {
      this.families.set(familyId, createFamilyRecord(familyId));
    }
    return this.families.get(familyId);
  }

  markDeclarationPending(familyId) {
    const family = this.ensureFamily(familyId);
    if (!family.familyMeta.status || family.familyMeta.status === 'unknown') {
      family.familyMeta.status = 'pending';
    }
    return family;
  }

  listFamilies() {
    return [...this.families.values()].map((family) => ({
      familyId: family.familyId,
      familyMeta: { ...family.familyMeta },
      variants: family.variants.map((variant) => ({
        id: variant.id,
        value: variant.value,
        meta: { ...variant.meta },
      })),
    }));
  }

  getFamily(familyId) {
    return this.families.get(familyId) ?? null;
  }

  getVariant(variantId) {
    const parsed = parseVariantId(variantId);
    if (!parsed) {
      return null;
    }
    const family = this.getFamily(parsed.familyId);
    if (!family) {
      return null;
    }
    return family.variants.find((variant) => variant.version === parsed.version) ?? null;
  }

  emitVariant(familyId, value, meta = {}) {
    const family = this.ensureFamily(familyId);
    const version = family.variants.length + 1;
    const id = createVariantId(familyId, version);
    const variant = {
      id,
      familyId,
      version,
      value,
      rendered: canonicalText(value),
      meta: {
        status: 'active',
        ...meta,
      },
    };
    family.variants.push(variant);
    family.familyMeta.status = 'active';
    this.representativeCache.delete(familyId);
    return variant;
  }

  patchMetadata(targetId, patch) {
    if (targetId.endsWith(':meta')) {
      const familyId = targetId.slice(0, -5);
      const family = this.ensureFamily(familyId);
      family.familyMeta = {
        ...family.familyMeta,
        ...patch,
      };
      this.representativeCache.delete(familyId);
      return family.familyMeta;
    }

    const variant = this.getVariant(targetId);
    if (!variant) {
      throw new Error(`Cannot patch metadata for unknown target ${targetId}.`);
    }
    variant.meta = {
      ...variant.meta,
      ...patch,
    };
    this.representativeCache.delete(variant.familyId);
    return variant.meta;
  }

  withdraw(targetId, reason = 'withdrawn') {
    return this.patchMetadata(targetId, {
      status: 'withdrawn',
      reason,
      withdrawn: true,
    });
  }

  listUsableVariants(familyId) {
    const family = this.getFamily(familyId);
    if (!family) {
      return [];
    }
    return family.variants.filter(isUsableVariant);
  }

  async resolveRepresentative(familyId, context = {}) {
    if (this.representativeCache.has(familyId)) {
      return this.representativeCache.get(familyId);
    }

    const usable = this.listUsableVariants(familyId);
    if (usable.length === 0) {
      return null;
    }

    let resolved = usable[0];

    if (usable.length > 1) {
      if (!this.resolvePluralFamily) {
        throw new Error(`Plural family ${familyId} requires a credibility resolver.`);
      }
      resolved = await this.resolvePluralFamily(familyId, usable, context);
    }

    this.representativeCache.set(familyId, resolved);
    return resolved;
  }

  async resolveReference(reference, context = {}) {
    if (reference.variantId) {
      const exactId = `${reference.familyId}:${reference.variantId}`;
      const variant = this.getVariant(exactId);
      if (!variant) {
        throw new Error(`Unknown exact reference ${exactId}.`);
      }
      return variant;
    }

    return this.resolveRepresentative(reference.familyId, context);
  }

  recordFailure(familyId, failure, createdEpoch) {
    const failureRecord = createFailureRecord(failure);
    return this.emitVariant(familyId, failureRecord, {
      status: failureRecord.kind === 'contract_refusal' ? 'refused' : 'error',
      error_kind: failureRecord.kind,
      reason: failureRecord.message,
      repairable: failureRecord.repairable,
      origin: failureRecord.origin,
      created_epoch: createdEpoch,
      retry_count: failureRecord.retryCount ?? 0,
    });
  }
}
