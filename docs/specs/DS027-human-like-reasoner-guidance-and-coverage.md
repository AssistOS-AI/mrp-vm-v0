---
id: DS027
title: HumanLikeReasoner Guidance and Coverage
status: implemented
owner: runtime
summary: Defines the default KU, prompt, planning-routing, demo, and evaluation requirements that make HumanLikeReasoner usable and inspectable in practice.
---

# DS027 HumanLikeReasoner Guidance and Coverage

## Introduction

`HumanLikeReasoner` is not useful in practice unless planning can choose it intentionally, its prompt boundary stays explicit, and the repository exposes visible examples that show what the interpreter can actually do. This DS defines those supporting requirements.

The scope of DS027 is not the interpreter runtime itself. DS026 owns that. DS027 owns the reusable guidance layer: caller profiles, prompt assets, planning route rules, and repository-owned coverage examples.

## Core Content

### Required default assets

The repository must ship these default assets together:

1. a caller profile for `HumanLikeReasoner`,
2. at least one selection-facing guidance KU for `HumanLikeReasoner`,
3. at least one prompt asset that constrains reasoning-program generation,
4. a caller profile for `logic-eval` that describes its orchestration-only role,
5. updated planning guidance that distinguishes direct `HumanLikeReasoner` routing from `logic-eval`-assisted routing.

These assets must be detailed enough that planning can answer three questions without hidden code knowledge:

1. when to route directly to `HumanLikeReasoner`,
2. when to prefer `AdvancedReasoner` instead,
3. when to insert `logic-eval` first,
4. what kind of answer structure the downstream reasoning step should preserve.

### Planning route discipline

The required route discipline is:

| Situation | Required planning behavior |
| --- | --- |
| The request is already a clear bounded reasoning problem | route directly to `HumanLikeReasoner` |
| The request is already clearly an advanced bounded meta-reasoning problem | do not route to `HumanLikeReasoner`; prefer `AdvancedReasoner` |
| The request is really a bounded Markdown or JSON planning workflow | do not route to `HumanLikeReasoner`; prefer `DocumentScalePlanner` |
| The request is reasoning-heavy but the planner needs help sharpening the next step | route first to `logic-eval`, then pass its brief to `HumanLikeReasoner` |
| The request is mainly prose, broad analysis, or unrestricted scripting | do not route to `HumanLikeReasoner` |

Planning guidance must say this directly. It is not enough for the runtime code to “know” it implicitly.

### Prompt-asset discipline

The default program-generation prompt asset for `HumanLikeReasoner` must enforce:

1. raw JavaScript source only,
2. one explicit `ExecutionContext`,
3. approved constructors only,
4. published solver method names and at least one canonical program shape per shipped reasoning family,
5. bounded control only,
6. final output through `ctx.emit(...)`,
7. no hidden provider, filesystem, or host access assumptions.

This asset exists so the managed generation path stays inspectable and stable even when the concrete model changes.

### Repository-owned coverage visibility

The repository must keep visible examples for the shipped reasoning-class baseline. At minimum:

1. one simple example per shipped reasoning class,
2. at least one mixed-class example that combines more than one reasoning class in one statement,
3. chat-demo coverage for operator-facing showcase tasks,
4. automated evaluation coverage that replays the same capability families against the configured runtime.

The examples should remain simple enough to read quickly, but explicit enough that an operator can tell what useful reasoning work the interpreter is performing.

## Decisions & Questions

Question #1: Why does DS027 require both direct-routing guidance and `logic-eval`-assisted guidance?

Response: The planner should stay lighter than a full reasoning taxonomy, but the runtime should also avoid unnecessary helper steps when the route is already obvious. Keeping both paths explicit preserves that balance.

Question #2: Why require one visible example per shipped reasoning class?

Response: Without per-class examples, contributors and operators would see only a generic “reasoning interpreter” label and would not know what the repository actually claims to support. Per-class examples make the contract concrete and auditable.

Question #3: Why must the prompt asset constrain output to bounded JavaScript source plus `ctx.emit(...)`?

Response: The interpreter is defined by generated reasoning programs, not by freeform prose or hidden chain-of-thought. The prompt asset keeps the generation boundary aligned with the runtime contract and makes failure easier to diagnose.

Question #4: Why require prompt assets to publish concrete method names instead of only naming the solver classes?

Response: Naming only the classes leaves too much room for model invention, which quickly leads to runtime failures such as nonexistent helper methods. Publishing the canonical method names and examples keeps the generation surface inspectable and materially reduces drift between KU guidance and the executable wrapper API.

Question #5: Why should DS027 mention `AdvancedReasoner` even though DS027 is still the HumanLikeReasoner guidance DS?

Response: Routing guidance is comparative by nature. Planning can only choose `HumanLikeReasoner` intentionally if the repository also states when not to choose it. DS027 therefore needs a small amount of cross-reference to the companion advanced reasoner contract so the bounded-solver route stays well scoped.

Question #6: Why should DS027 also mention `DocumentScalePlanner`?

Response: Some large document-analysis tasks may look reasoning-heavy while actually needing explicit chunk planning instead of a generated solver program. If DS027 ignored that neighboring route, planning guidance would overclaim `HumanLikeReasoner` and would encourage awkward one-shot reasoning over material that should stay structurally explicit.

## Conclusion

DS027 makes `HumanLikeReasoner` operational rather than merely implemented. It requires the KUs, routing rules, prompt discipline, and visible coverage examples that let planning choose the interpreter intentionally and let reviewers verify what it can actually do.
