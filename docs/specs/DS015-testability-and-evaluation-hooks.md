---
id: DS015
title: Testability and Evaluation Hooks
status: implemented
owner: runtime
summary: Defines fake adapters, fixture contracts, deterministic modes, inspection hooks, and configured-system evaluation seams for MRP-VM v0.
---
# DS015 Testability and Evaluation Hooks

## Introduction

The runtime must be testable before real-model integration grows large enough to hide basic architectural mistakes. This DS defines the hooks that implementation work must expose to make scheduler behavior, command semantics, and configured-system evaluation testable.

## Core Content

### Deterministic seams

The implementation must provide deterministic substitutes for all nondeterministic execution boundaries, especially LLM wrappers. Fake or stub adapters must be able to return fixed outputs, refusals, and failures under test control.

Fake adapters must also support scripted sequences keyed by interpreter profile so tests can predefine multi-step plans and responses without relying on prompt-text matching. It must be possible to specify a per-profile queue of outputs and/or keyed outputs for a specific invocation signature.

The runtime must also expose deterministic modes for:

1. scheduler ordinals and timestamps,
2. planning output validation,
3. representative selection,
4. analytic-memory checkpoints,
5. replay ordering.

### Fixture contract

Test fixtures must be able to express:

| Fixture element | Meaning |
| --- | --- |
| Input program or request | SOP Lang input or normalized planning input |
| Initial state | families, KUs, analytic-memory state, policies |
| Expected effects | emitted variants, metadata, declaration insertions, stop conditions |
| Expected trace fragments | event types and critical payload assertions |
| Expected context package | selected and pruned context items when relevant |

Fixtures may be stored as JSON, YAML, or mixed text-plus-fixture assets, but the format must be machine-readable and stable.

### Inspection hooks

The runtime must expose test-facing inspection hooks for:

1. current graph structure,
2. current epoch counter,
3. family representative cache,
4. buffered and applied scheduler effects,
5. current context package,
6. command and interpreter invocation history,
7. analytic-memory visible checkpoints,
8. current accepted plan snapshot.

### Benchmarking

Benchmark harnesses must compare configured VM instances against direct-model baselines where relevant. Measurements should include answer quality, cost, latency, trace richness, replayability, and stability under partial graph changes.

The baseline testing posture in v0 uses both semantic-state assertions and trace assertions, with golden traces reserved for cases where trace stability itself is part of the contract.

## Decisions & Questions

Question #1: Why are fake adapters mandatory rather than optional developer conveniences?

Response: The architecture depends on nondeterministic wrappers but also claims traceability, replay, and testability. Without deterministic substitutes, core runtime behavior would be testable only through live providers.

Question #2: Why must fixtures include initial state and not only input programs?

Response: MRP-VM execution depends on more than one text input. Families, KUs, analytic state, and policies materially change outcomes. If fixtures captured only the input program, they would not be strong enough to validate real runtime behavior.

Question #3: Why must inspection hooks be explicit instead of letting tests reach into runtime internals however they want?

Response: Testability should not rely on accidental object shapes or private module knowledge. Named inspection hooks preserve encapsulation while still making the key runtime surfaces observable under test.

## Conclusion

MRP-VM v0 must expose deterministic seams, explicit fixtures, and rich inspection hooks so contributors can validate the configured runtime as a system rather than as a collection of untestable ideas.
