import { EventEmitter } from 'node:events';
import { compileGraph } from './graph.mjs';
import { buildContextPackage } from './context-package.mjs';
import { createEmptyEffects, hasStructuralEffects } from './effects.mjs';
import { createDeterministicTools, createLiveTools } from '../utils/deterministic.mjs';
import { createFailureRecord, isUsableVariant } from '../utils/errors.mjs';
import { StateStore } from './state-store.mjs';
import { SessionManager } from '../session/session-manager.mjs';
import { RequestManager } from '../session/request-manager.mjs';
import { KbStore } from '../storage/kb-store.mjs';
import { TraceStore } from '../storage/trace-store.mjs';
import { AnalyticStore } from '../storage/analytic-store.mjs';
import { CommandRegistry } from '../commands/registry.mjs';
import { executePlanning } from '../commands/planning.mjs';
import { executeJsEval } from '../commands/js-eval.mjs';
import { executeLogicEval } from '../commands/logic-eval.mjs';
import { executeTemplateEval } from '../commands/template-eval.mjs';
import { executeAnalyticMemory } from '../commands/analytic-memory.mjs';
import { executeKbCommand } from '../commands/kb.mjs';
import { executeCredibilityCommand, resolvePluralFamily } from '../commands/credibility.mjs';
import { ExternalInterpreterRegistry } from '../interpreters/external-interpreter-registry.mjs';
import { FakeLlmAdapter } from '../interpreters/fake-llm-adapter.mjs';

function cloneBudgets(budgets = {}) {
  return {
    wall_clock_ms: budgets.wall_clock_ms ?? 30_000,
    steps_remaining: budgets.steps_remaining ?? 64,
    planning_remaining: budgets.planning_remaining ?? 4,
    structural_changes_remaining: budgets.structural_changes_remaining ?? 64,
  };
}

function buildDefaultCommandRegistry() {
  const registry = new CommandRegistry();
  registry.register('planning', executePlanning);
  registry.register('js-eval', executeJsEval);
  registry.register('logic-eval', executeLogicEval);
  registry.register('template-eval', executeTemplateEval);
  registry.register('analytic-memory', executeAnalyticMemory);
  registry.register('kb', executeKbCommand);
  registry.register('credibility', executeCredibilityCommand);
  return registry;
}

function buildDefaultExternalRegistry() {
  const registry = new ExternalInterpreterRegistry({
    llmAdapter: new FakeLlmAdapter(),
  });

  for (const profile of ['fastLLM', 'deepLLM', 'codeGeneratorLLM', 'writerLLM', 'plannerLLM']) {
    registry.register({
      name: profile,
      purpose: profile,
      input_contract: ['context_package', 'instruction'],
      output_shapes: profile === 'plannerLLM' ? ['sop_proposal'] : ['plain_value'],
      cost_class: profile === 'deepLLM' ? 'expensive' : 'cheap',
      can_insert_declarations: profile === 'plannerLLM',
      can_refuse: true,
      uses_llm_adapter: true,
      capability_profile: 'default',
      trace_requirements: ['interpreter_invoked'],
    });
  }

  return registry;
}

function createStateStore(runtime) {
  return new StateStore({
    resolvePluralFamily: async (familyId, candidates, context) => resolvePluralFamily(runtime, familyId, candidates, context),
  });
}

export class MRPVM {
  constructor(rootDir, options = {}) {
    this.rootDir = rootDir;
    this.tools = options.deterministic ? createDeterministicTools(options.deterministic) : createLiveTools();
    this.sessionManager = new SessionManager(rootDir, this.tools);
    this.requestManager = new RequestManager(rootDir);
    this.kbStore = new KbStore(rootDir);
    this.traceStore = new TraceStore(rootDir);
    this.analyticStore = new AnalyticStore(rootDir);
    this.commandRegistry = options.commandRegistry ?? buildDefaultCommandRegistry();
    this.externalInterpreters = options.externalInterpreters ?? buildDefaultExternalRegistry();
    this.eventEmitter = new EventEmitter();
    this.sessionId = options.sessionId ?? null;
    this.policyProfile = options.policyProfile ?? 'default';
    this.isAdmin = options.isAdmin ?? false;
    this.closed = false;
    this.activeRequestId = null;
    this.traceEventOrdinal = 0;
    this.traceBufferLimit = options.traceBufferLimit ?? 100;
    this.traceBuffers = new Map();
    this.requestRecords = new Map();
    this.resetRequestState();
  }

  resetRequestState() {
    this.stateStore = createStateStore(this);
    this.invocationHistory = [];
    this.lastContextPackage = null;
    this.currentGraph = null;
    this.currentPlanText = '';
    this.currentEpoch = 0;
    this.pendingAnalyticCheckpoint = null;
  }

  async initializeSession(config = {}) {
    if (this.closed) {
      throw new Error('Cannot initialize a closed session executor.');
    }

    this.sessionId = config.sessionId ?? this.sessionId ?? this.tools.createId('session');
    this.policyProfile = config.policyProfile ?? this.policyProfile ?? 'default';
    this.isAdmin = config.isAdmin ?? this.isAdmin ?? false;
    await this.bootstrapSession(this.sessionId, this.policyProfile, this.isAdmin);
    return this.sessionManager.loadSession(this.sessionId);
  }

  createTemplateContext() {
    const output = {};
    for (const family of this.stateStore.listFamilies()) {
      const representative = this.stateStore.representativeCache.get(family.familyId)
        ?? family.variants.find((variant) => variant.meta.status === 'active');
      output[family.familyId] = representative?.value;
    }
    return output;
  }

  async bootstrapSession(sessionId, policyProfile = 'default', isAdmin = false) {
    const existing = await this.sessionManager.loadSession(sessionId);
    if (existing) {
      return existing;
    }
    return this.sessionManager.createSession(sessionId, policyProfile, isAdmin);
  }

  applyEffects(effects, context) {
    for (const emitted of effects.emittedVariants) {
      this.stateStore.emitVariant(emitted.familyId, emitted.value, {
        created_epoch: context.epochNumber,
        ...emitted.meta,
      });
    }

    for (const update of effects.metadataUpdates) {
      this.stateStore.patchMetadata(update.targetId, update.patch);
    }

    for (const withdrawal of effects.withdrawals) {
      this.stateStore.withdraw(withdrawal.targetId, withdrawal.reason);
    }

    if (effects.failure) {
      this.stateStore.recordFailure(
        effects.failure.familyId ?? context.source,
        effects.failure,
        context.epochNumber,
      );
    }
  }

  async persistState(sessionId, requestId) {
    for (const family of this.stateStore.listFamilies()) {
      await this.requestManager.persistFamily(sessionId, requestId, family);
    }
  }

  async emitTrace(sessionId, eventType, payload) {
    const event = {
      event: eventType,
      event_id: ++this.traceEventOrdinal,
      created_at: this.tools.now(),
      ...payload,
    };
    await this.traceStore.append(sessionId, event);

    const requestId = event.request_id;
    if (requestId) {
      const buffer = this.traceBuffers.get(requestId) ?? [];
      buffer.push(event);
      if (buffer.length > this.traceBufferLimit) {
        buffer.splice(0, buffer.length - this.traceBufferLimit);
      }
      this.traceBuffers.set(requestId, buffer);
    }

    this.eventEmitter.emit('trace', event);
    return event;
  }

  onTrace(listener) {
    this.eventEmitter.on('trace', listener);
  }

  offTrace(listener) {
    this.eventEmitter.off('trace', listener);
  }

  async getTraceEvents(requestId, filters = {}) {
    if (!this.sessionId) {
      return [];
    }
    const events = await this.traceStore.readAll(this.sessionId);
    return events.filter((event) => {
      if (requestId && event.request_id !== requestId) {
        return false;
      }
      if (filters.eventType && event.event !== filters.eventType) {
        return false;
      }
      if (filters.afterEventId && Number(event.event_id ?? 0) <= Number(filters.afterEventId)) {
        return false;
      }
      return true;
    });
  }

  getBufferedTrace(requestId, afterEventId = 0) {
    return (this.traceBuffers.get(requestId) ?? []).filter((event) => Number(event.event_id ?? 0) > Number(afterEventId));
  }

  async buildInvocationContext(node, request, sessionId, requestId, epochNumber, bodyOverride = null) {
    const resolvedDependencies = new Map();
    for (const dependency of node.dependencies) {
      const resolved = await this.stateStore.resolveReference(dependency, {
        sessionId,
        requestId,
        epochNumber,
        reason: `Resolve ${dependency.raw}`,
      });
      if (resolved) {
        resolvedDependencies.set(dependency.raw, resolved);
      }
    }

    const callerName = node.declaration.commands?.[0] ?? 'planning';
    const targetCommand = this.commandRegistry.has(callerName) ? callerName : null;
    const targetInterpreter = this.externalInterpreters.has(callerName) ? callerName : null;

    const kbResult = this.kbStore.retrieve(request.kbSnapshot, {
      callerName,
      retrievalMode: targetCommand ? 'automatic_native_command' : 'automatic_external_interpreter',
      desiredKuTypes: ['content', 'prompt_asset', 'policy_asset', 'template_asset', 'caller_profile'],
      requestText: request.requestText,
      bodyText: bodyOverride ?? node.declaration.body,
      targetCommand,
      targetInterpreter,
      byteBudget: 8_192,
      sessionOverrideAllowed: true,
    });

    const contextPackage = buildContextPackage({
      node,
      resolvedDependencies,
      stateStore: this.stateStore,
      kbResult,
      analytics: this.analyticStore.listEntries(),
      planningNotes: request.planningNotes,
    });

    this.lastContextPackage = contextPackage;
    return {
      runtime: this,
      node,
      targetFamily: node.targetFamily,
      body: bodyOverride ?? node.declaration.body,
      request,
      sessionId,
      requestId,
      epochNumber,
      contextPackage,
      kbResult,
    };
  }

  async executeNode(node, request, sessionId, requestId, epochNumber) {
    const executionRoute = node.declaration.declaration_kind;
    if (executionRoute === 'fallback') {
      let lastEffects = createEmptyEffects();
      for (const commandName of node.declaration.commands) {
        const invocationContext = await this.buildInvocationContext(node, request, sessionId, requestId, epochNumber);
        const effects = await this.invokeRoute(commandName, invocationContext);
        lastEffects = effects;
        const acceptable = effects.emittedVariants.some((entry) => entry.familyId === node.targetFamily) && !effects.failure;
        if (acceptable) {
          return effects;
        }
      }
      return lastEffects;
    }

    if (executionRoute === 'multi_attempt') {
      const merged = createEmptyEffects();
      for (const commandName of node.declaration.commands) {
        const invocationContext = await this.buildInvocationContext(node, request, sessionId, requestId, epochNumber);
        const effects = await this.invokeRoute(commandName, invocationContext);
        merged.emittedVariants.push(...effects.emittedVariants);
        merged.metadataUpdates.push(...effects.metadataUpdates);
        merged.withdrawals.push(...effects.withdrawals);
        merged.declarationInsertions.push(...effects.declarationInsertions);
        if (effects.failure) {
          merged.failure = effects.failure;
        }
      }
      return merged;
    }

    const invocationContext = await this.buildInvocationContext(node, request, sessionId, requestId, epochNumber);
    return this.invokeRoute(node.declaration.commands[0], invocationContext);
  }

  async invokeRoute(name, context) {
    this.invocationHistory.push({
      route: name,
      targetFamily: context.targetFamily,
      body: context.body,
      epochNumber: context.epochNumber,
    });

    await this.emitTrace(context.sessionId, this.commandRegistry.has(name) ? 'command_invoked' : 'interpreter_invoked', {
      session_id: context.sessionId,
      request_id: context.requestId,
      epoch_id: context.epochNumber,
      command_id: this.commandRegistry.has(name) ? name : undefined,
      interpreter_id: this.commandRegistry.has(name) ? undefined : name,
      declaration_id: context.node.id,
      context_summary: {
        byte_count: context.contextPackage.byteCount,
      },
      execution_ordinal: this.tools.nextOrdinal(),
      adapter_profile: this.commandRegistry.has(name) ? undefined : name,
      expected_output_mode: this.commandRegistry.has(name) ? undefined : 'plain_value',
    });

    await this.emitTrace(context.sessionId, 'context_packaged', {
      session_id: context.sessionId,
      request_id: context.requestId,
      epoch_id: context.epochNumber,
      selected_items: context.contextPackage.selectedItems,
      pruned_items: context.contextPackage.prunedItems,
      byte_counts: context.contextPackage.byteCount,
      source_tiers: [
        'Direct Dependencies',
        'Resolved Family State',
        'Knowledge Units',
        'Analytic Summaries',
        'Planning Notes',
      ],
    });

    if (this.commandRegistry.has(name)) {
      return this.commandRegistry.get(name)(context);
    }

    if (this.externalInterpreters.has(name)) {
      return this.externalInterpreters.invoke(name, {
        ...context,
        body: context.body,
        targetFamily: context.targetFamily,
        contextPackage: context.contextPackage,
      });
    }

    return {
      emittedVariants: [],
      metadataUpdates: [],
      withdrawals: [],
      declarationInsertions: [],
      failure: createFailureRecord({
        kind: 'resolution_error',
        message: `Unknown command or interpreter: ${name}`,
        origin: name,
        familyId: context.targetFamily,
        repairable: false,
      }),
    };
  }

  async openEpoch(sessionId, requestId, request, epochNumber) {
    this.currentEpoch = epochNumber;
    this.currentPlanText = request.planText;
    this.currentGraph = compileGraph(request.planText);
    await this.sessionManager.persistPlan(sessionId, requestId, request.planText, epochNumber);
    await this.emitTrace(sessionId, 'epoch_opened', {
      session_id: sessionId,
      request_id: requestId,
      epoch_id: epochNumber,
      frontier_summary: {
        declarations: this.currentGraph.nodes.length,
      },
      ready_node_set: this.currentGraph.strata[0]?.map((node) => node.id) ?? [],
    });
  }

  findReadyNodes(request) {
    const ready = [];
    for (const stratum of this.currentGraph.strata) {
      const stratumReady = stratum.filter((node) => {
        const family = this.stateStore.getFamily(node.targetFamily);
        if (family?.variants.some(isUsableVariant)) {
          return false;
        }

        return node.dependencies.every((dependency) => {
          if (dependency.variantId) {
            const exactId = `${dependency.familyId}:${dependency.variantId}`;
            return Boolean(this.stateStore.getVariant(exactId));
          }
          const depFamily = this.stateStore.getFamily(dependency.familyId);
          if (!depFamily) {
            return false;
          }
          return depFamily.variants.some(isUsableVariant);
        });
      });

      if (stratumReady.length > 0) {
        ready.push(...stratumReady);
        break;
      }
    }
    return ready;
  }

  async maybeRepair(request, sessionId, requestId) {
    if (request.budgets.planning_remaining <= 0) {
      return false;
    }

    request.budgets.planning_remaining -= 1;
    const planningNode = {
      id: 'repair-planning',
      targetFamily: 'response',
      declaration: {
        commands: ['planning'],
        body: request.requestText,
      },
      dependencies: [],
    };
    const planningContext = await this.buildInvocationContext(planningNode, request, sessionId, requestId, this.currentEpoch, request.requestText);
    planningContext.mode = 'error_triggered_repair';
    const effects = await executePlanning(planningContext);
    if (effects.declarationInsertions.length === 0) {
      return false;
    }
    request.planText = `${request.planText.trim()}\n\n${effects.declarationInsertions.map((entry) => entry.text.trim()).join('\n\n')}\n`;
    request.planningNotes.push('Repair planning inserted new declarations.');
    return true;
  }

  async executeRequest(requestId, input) {
    const sessionId = this.sessionId ?? input.sessionId ?? this.tools.createId('session');
    const existingSession = await this.sessionManager.loadSession(sessionId);
    await this.bootstrapSession(sessionId, input.policyProfile ?? this.policyProfile ?? 'default', input.isAdmin ?? this.isAdmin);
    await this.analyticStore.load(sessionId);
    this.resetRequestState();
    this.sessionId = sessionId;

    const request = {
      requestText: input.requestText,
      files: input.files ?? [],
      budgets: cloneBudgets(input.budgets),
      planText: '',
      planningNotes: [],
      sessionSummary: existingSession ?? {},
      kbSnapshot: await this.kbStore.snapshotForRequest(sessionId),
    };

    this.requestRecords.set(requestId, {
      request_id: requestId,
      session_id: sessionId,
      status: 'planning',
      outcome: null,
      plan_snapshot: '',
      family_state: [],
      request_text: request.requestText,
      created_at: this.tools.now(),
    });

    await this.sessionManager.createRequest(sessionId, requestId, {
      session_id: sessionId,
      request_id: requestId,
      user_text: request.requestText,
      file_descriptors: request.files,
      budgets: request.budgets,
      is_admin: this.isAdmin,
    });

    await this.emitTrace(sessionId, 'planning_triggered', {
      session_id: sessionId,
      request_id: requestId,
      mode: existingSession ? 'continuing_session_request' : 'new_session_request',
      trigger_reason: existingSession ? 'continuing_session_request' : 'new_session_request',
      blocked_region_summary: [],
    });
    await this.emitTrace(sessionId, 'request_started', {
      session_id: sessionId,
      request_id: requestId,
      request_metadata: {
        file_count: request.files.length,
        is_admin: this.isAdmin,
      },
      trigger: existingSession ? 'continuing_session_request' : 'new_session_request',
      budgets: request.budgets,
      initial_mode: existingSession ? 'continuing_session_request' : 'new_session_request',
    });

    request.budgets.planning_remaining -= 1;
    const planningNode = {
      id: 'bootstrap-planning',
      targetFamily: 'response',
      declaration: {
        commands: ['planning'],
        body: request.requestText,
      },
      dependencies: [],
    };
    const planningContext = await this.buildInvocationContext(planningNode, request, sessionId, requestId, 0, request.requestText);
    planningContext.mode = existingSession ? 'continuing_session_request' : 'new_session_request';
    const planningEffects = await executePlanning(planningContext);
    if (planningEffects.failure) {
      throw new Error(planningEffects.failure.message);
    }
    request.planText = planningEffects.declarationInsertions.map((entry) => entry.text).join('\n\n');
    if (!request.planText.includes('@response')) {
      request.planText = `@response writerLLM\n${request.requestText}\n`;
    }
    this.requestRecords.get(requestId).plan_snapshot = request.planText;
    await this.emitTrace(sessionId, 'planning_stopped', {
      session_id: sessionId,
      request_id: requestId,
      outcome: 'accepted',
      accepted_actions: ['initial_plan'],
      rejected_actions: [],
    });

    let epochNumber = 1;
    while (request.budgets.steps_remaining > 0 && request.budgets.structural_changes_remaining > 0) {
      await this.openEpoch(sessionId, requestId, request, epochNumber);
      for (const node of this.currentGraph.nodes) {
        this.stateStore.markDeclarationPending(node.targetFamily);
      }

      const readyNodes = this.findReadyNodes(request);
      if (readyNodes.length === 0) {
        const repaired = await this.maybeRepair(request, sessionId, requestId);
        if (!repaired) {
          break;
        }
        epochNumber += 1;
        request.budgets.structural_changes_remaining -= 1;
        continue;
      }

      let structuralChange = false;
      for (const node of readyNodes) {
        request.budgets.steps_remaining -= 1;
        const effects = await this.executeNode(node, request, sessionId, requestId, epochNumber);
        this.applyEffects(effects, {
          sessionId,
          requestId,
          epochNumber,
          source: node.targetFamily,
        });

        if (effects.emittedVariants.length > 0) {
          await this.emitTrace(sessionId, 'variant_emitted', {
            session_id: sessionId,
            request_id: requestId,
            epoch_id: epochNumber,
            emitted_ids: effects.emittedVariants.map((entry) => entry.familyId),
            family_ids: effects.emittedVariants.map((entry) => entry.familyId),
            source_component: node.declaration.commands.join(','),
          });
        }

        if (effects.metadataUpdates.length > 0) {
          await this.emitTrace(sessionId, 'metadata_updated', {
            session_id: sessionId,
            request_id: requestId,
            epoch_id: epochNumber,
            target_ids: effects.metadataUpdates.map((entry) => entry.targetId),
            changed_keys: effects.metadataUpdates.flatMap((entry) => Object.keys(entry.patch)),
            structural_impact: true,
          });
        }

        if (effects.failure) {
          await this.emitTrace(sessionId, 'failure_recorded', {
            session_id: sessionId,
            request_id: requestId,
            epoch_id: epochNumber,
            failure_kind: effects.failure.kind,
            affected_scope: effects.failure.familyId ?? node.targetFamily,
            repairable_flag: effects.failure.repairable,
            originating_component: effects.failure.origin,
          });
        }

        if (effects.declarationInsertions.length > 0) {
          request.planText = `${request.planText.trim()}\n\n${effects.declarationInsertions.map((entry) => entry.text.trim()).join('\n\n')}\n`;
          await this.emitTrace(sessionId, 'declarations_inserted', {
            session_id: sessionId,
            request_id: requestId,
            epoch_id: epochNumber,
            inserted_declaration_hash: effects.declarationInsertions.map((entry) => entry.text.length),
            insertion_source: node.declaration.commands.join(','),
            new_declaration_ids: [],
          });
        }

        structuralChange = structuralChange || hasStructuralEffects(effects);
      }

      if (this.pendingAnalyticCheckpoint) {
        await this.emitTrace(sessionId, 'analytic_memory_updated', {
          session_id: sessionId,
          request_id: requestId,
          epoch_id: epochNumber,
          updated_keys: this.pendingAnalyticCheckpoint.snapshot.map((entry) => entry.key),
          scope: 'session',
          export_flag: true,
          checkpoint_hash: this.pendingAnalyticCheckpoint.hash,
        });
        this.pendingAnalyticCheckpoint = null;
      }

      await this.persistState(sessionId, requestId);
      this.requestRecords.get(requestId).family_state = this.stateStore.listFamilies();
      this.requestRecords.get(requestId).plan_snapshot = request.planText;
      this.requestRecords.get(requestId).status = structuralChange ? 'executing' : 'stopped';

      if (!structuralChange) {
        break;
      }
      request.budgets.structural_changes_remaining -= 1;
      epochNumber += 1;
    }

    const responseVariant = await this.stateStore.resolveRepresentative('response', {
      sessionId,
      requestId,
      epochNumber,
      reason: 'Resolve final response',
    });

    const outcome = {
      session_id: sessionId,
      request_id: requestId,
      response: responseVariant?.value ?? null,
      response_variant_id: responseVariant?.id ?? null,
      stop_reason: responseVariant ? 'completed' : 'unknown_outcome',
      remaining_budgets: request.budgets,
    };

    await this.sessionManager.persistOutcome(sessionId, requestId, outcome);
    await this.sessionManager.appendRequestSummary(sessionId, {
      request_id: requestId,
      created_at: this.tools.now(),
      response: outcome.response,
      stop_reason: outcome.stop_reason,
      request_text: request.requestText,
    });
    await this.emitTrace(sessionId, 'request_stopped', {
      session_id: sessionId,
      request_id: requestId,
      final_outcome: outcome.stop_reason,
      stop_reason: outcome.stop_reason,
      remaining_blocked_regions: [],
    });
    this.requestRecords.set(requestId, {
      ...this.requestRecords.get(requestId),
      status: 'stopped',
      outcome,
      family_state: this.stateStore.listFamilies(),
      plan_snapshot: request.planText,
      completed_at: this.tools.now(),
    });
    return outcome;
  }

  async startRequest(input) {
    if (this.closed) {
      throw new Error('Cannot submit a request to a closed session executor.');
    }
    if (this.activeRequestId) {
      const error = new Error(`Session ${this.sessionId ?? 'unknown'} already has an active request.`);
      error.code = 'ACTIVE_REQUEST';
      throw error;
    }

    if (!this.sessionId) {
      await this.initializeSession({
        sessionId: input.sessionId,
        policyProfile: input.policyProfile,
        isAdmin: input.isAdmin,
      });
    }

    const requestId = this.tools.createId('request');
    this.activeRequestId = requestId;
    const done = this.executeRequest(requestId, input)
      .finally(() => {
        this.activeRequestId = null;
      });

    const record = this.requestRecords.get(requestId) ?? {
      request_id: requestId,
      session_id: this.sessionId,
      status: 'planning',
      outcome: null,
      plan_snapshot: '',
      family_state: [],
      request_text: input.requestText,
      created_at: this.tools.now(),
    };
    this.requestRecords.set(requestId, record);

    return {
      request_id: requestId,
      session_id: this.sessionId,
      done,
    };
  }

  async submitRequest(input) {
    const started = await this.startRequest(input);
    return started.done;
  }

  inspect() {
    return {
      currentGraph: this.currentGraph,
      currentEpoch: this.currentEpoch,
      representativeCache: [...this.stateStore.representativeCache.entries()],
      invocationHistory: this.invocationHistory,
      contextPackage: this.lastContextPackage,
      analyticCheckpoints: this.analyticStore.listEntries(),
      acceptedPlanSnapshot: this.currentPlanText,
    };
  }

  async inspectSessionPublic() {
    const manifest = this.sessionId ? await this.sessionManager.loadSession(this.sessionId) : null;
    const requestSummaries = this.sessionId ? await this.sessionManager.readRequestSummaries(this.sessionId) : [];
    return {
      session_id: this.sessionId,
      policy_profile: manifest?.policy_profile ?? this.policyProfile,
      is_admin: manifest?.is_admin ?? this.isAdmin,
      active_request_id: manifest?.active_request_id ?? this.activeRequestId,
      epoch_counter: this.currentEpoch,
      plan_snapshot: this.currentPlanText,
      request_history: requestSummaries,
      active_kus: this.sessionId ? (await this.kbStore.listSessionKus(this.sessionId)).map((entry) => ({
        ku_id: entry.kuId,
        summary: entry.meta.summary,
      })) : [],
      family_state: this.stateStore.listFamilies(),
    };
  }

  async inspectRequestPublic(requestId) {
    const record = this.requestRecords.get(requestId);
    if (record) {
      return record;
    }

    if (!this.sessionId) {
      return null;
    }

    return {
      request_id: requestId,
      session_id: this.sessionId,
      status: 'persisted',
      outcome: await this.sessionManager.loadRequestOutcome(this.sessionId, requestId),
      plan_snapshot: await this.sessionManager.loadCurrentPlan(this.sessionId, requestId),
      family_state: await this.requestManager.loadFamilyState(this.sessionId, requestId),
      envelope: await this.sessionManager.loadRequestEnvelope(this.sessionId, requestId),
    };
  }

  async close() {
    this.closed = true;
    this.eventEmitter.removeAllListeners();
    return {
      session_id: this.sessionId,
      closed: true,
    };
  }
}

export function createRuntime(rootDir, options = {}) {
  return new MRPVM(rootDir, options);
}
