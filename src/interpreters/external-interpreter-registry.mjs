import { createEmptyEffects } from '../runtime/effects.mjs';

export class ExternalInterpreterRegistry {
  constructor(options = {}) {
    this.interpreters = new Map();
    this.llmAdapter = options.llmAdapter ?? null;
  }

  register(contract, handler = null) {
    this.interpreters.set(contract.name, {
      contract,
      handler,
    });
  }

  has(name) {
    return this.interpreters.has(name);
  }

  getContract(name) {
    return this.interpreters.get(name)?.contract ?? null;
  }

  async invoke(name, context) {
    const entry = this.interpreters.get(name);
    if (!entry) {
      throw new Error(`Unknown external interpreter: ${name}`);
    }

    const { contract, handler } = entry;
    if (handler) {
      return handler(context);
    }

    if (!contract.uses_llm_adapter || !this.llmAdapter) {
      throw new Error(`Interpreter ${name} has no handler and no configured LLM adapter.`);
    }

    const adapterResult = await this.llmAdapter.invoke({
      profile: name,
      model_class: context.modelClass ?? 'medium',
      prompt_assets: context.promptAssets ?? [],
      context_package: context.contextPackage?.markdown ?? '',
      instruction: context.body,
      expected_output_mode: context.expectedOutputMode ?? contract.output_shapes?.[0] ?? 'plain_value',
      input_budget: context.inputBudget ?? {},
      output_budget: context.outputBudget ?? {},
      trace_context: context.traceContext ?? {},
    });

    const effects = createEmptyEffects();
    if (adapterResult.status === 'semantic_refusal') {
      effects.failure = {
        kind: 'contract_refusal',
        message: adapterResult.message ?? `Interpreter ${name} refused the task.`,
        origin: name,
        repairable: true,
      };
      return effects;
    }

    if (adapterResult.status === 'provider_failure') {
      effects.failure = {
        kind: 'provider_failure',
        message: adapterResult.message ?? `Interpreter ${name} failed at provider boundary.`,
        origin: name,
        repairable: true,
      };
      return effects;
    }

    if (adapterResult.output_mode === 'sop_proposal' && contract.can_insert_declarations) {
      effects.declarationInsertions.push({
        text: adapterResult.value,
        meta: {
          source_interpreter: name,
        },
      });
      return effects;
    }

    effects.emittedVariants.push({
      familyId: context.targetFamily,
      value: adapterResult.value,
      meta: {
        origin: name,
        source_interpreter: name,
      },
    });
    return effects;
  }
}
