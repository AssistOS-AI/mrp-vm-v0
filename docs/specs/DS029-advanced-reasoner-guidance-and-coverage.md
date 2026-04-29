---
id: DS029
title: AdvancedReasoner Guidance and Coverage
status: implemented
owner: runtime
summary: Defines the default KU, prompt, planning-routing, demo, and evaluation requirements that make AdvancedReasoner usable and inspectable in practice.
---

# DS029 AdvancedReasoner Guidance and Coverage

## Introduction

`AdvancedReasoner` is not operationally useful unless planning can choose it deliberately, its prompt boundary stays explicit, and the repository exposes visible examples that show what the interpreter can actually do. This DS defines those supporting requirements.

The scope of DS029 is not the interpreter runtime itself. DS028 owns that. DS029 owns the reusable guidance layer: caller profiles, prompt assets, planning route rules, and repository-owned coverage examples.

## Core Content

### Required default assets

The repository must ship these default assets together:

1. a caller profile for `AdvancedReasoner`,
2. at least one selection-facing guidance KU for `AdvancedReasoner`,
3. at least one prompt asset that constrains advanced reasoning-program generation,
4. updated planning guidance that distinguishes direct `AdvancedReasoner` routing from both `HumanLikeReasoner` and `logic-eval`,
5. updated `logic-eval` caller guidance that treats `AdvancedReasoner` as a first-class downstream target.

These assets must be detailed enough that planning can answer four questions without hidden code knowledge:

1. when to route directly to `AdvancedReasoner`,
2. when to route directly to `HumanLikeReasoner` instead,
3. when to insert `logic-eval` first,
4. what bounded response structure the downstream advanced reasoning step should preserve.

### Planning route discipline

The required route discipline is:

| Situation | Required planning behavior |
| --- | --- |
| The request is already clearly an advanced bounded reasoning problem | route directly to `AdvancedReasoner` |
| The request is already clearly a finite symbolic reasoning problem | do not route to `AdvancedReasoner`; prefer `HumanLikeReasoner` |
| The request is really a bounded Markdown or JSON planning workflow | do not route to `AdvancedReasoner`; prefer `DocumentScalePlanner` |
| The request is reasoning-heavy but the planner needs help sharpening the next step | route first to `logic-eval`, then pass its brief to `AdvancedReasoner` or `HumanLikeReasoner` as appropriate |
| The request is mainly prose, broad analysis, or unrestricted scripting | do not route to `AdvancedReasoner` |

Planning guidance must say this directly. It is not enough for the runtime code to "know" it implicitly.

### Prompt-asset discipline

The default program-generation prompt asset for `AdvancedReasoner` must enforce:

1. raw JavaScript source only,
2. one explicit `ExecutionContext`,
3. one typed `ReasonerResponse` exit,
4. approved constructors only,
5. published method names and at least one canonical program shape for the shipped advanced families,
6. bounded control only,
7. no hidden provider, filesystem, or host access assumptions.

This asset exists so the managed generation path stays inspectable and stable even when the concrete model changes.

### Repository-owned coverage visibility

The repository must keep visible examples for the shipped advanced reasoning-class baseline. At minimum:

1. focused unit coverage for every shipped advanced reasoning class,
2. a shared chat-demo and evaluation catalog whose combined advanced showcase cases make every shipped family visible,
3. at least one mixed advanced showcase that combines more than one advanced family in one request,
4. examples that surface bounded escalation outcomes such as `needs_engine`, `needs_review`, and `needs_clarification` rather than showing only successful local answers.

The examples should remain simple enough to read quickly, but explicit enough that an operator can tell what useful bounded reasoning work the interpreter is performing before it promotes or escalates.

## Decisions & Questions

Question #1: Why does DS029 require both unit coverage for each reasoning class and shared end-to-end demo/eval coverage?

Response: The local reasoning classes are the core executable contract and need direct tests that do not depend on prompt generation. The shared catalog proves that planning, prompt assets, runtime execution, and operator-facing demos still line up end to end. One without the other would leave a blind spot.

Question #2: Why should `AdvancedReasoner` showcase escalation outcomes such as `needs_engine` and `needs_review` instead of emphasizing only local success cases?

Response: Those escalation outcomes are part of the interpreter's value proposition, not signs of failure. If demos showed only local success, the repository would hide the main reason `AdvancedReasoner` exists as a separate surface from `HumanLikeReasoner`.

Question #3: Why should planning guidance compare `AdvancedReasoner` directly against `HumanLikeReasoner`?

Response: Routing is comparative. Planning can only choose `AdvancedReasoner` intentionally if the repository also explains when the bounded exact-solver route is the better fit. The two reasoners form one reasoning-routing boundary together.

Question #4: Why require the prompt asset to publish exact method names for all shipped advanced classes instead of only naming the class families?

Response: Model drift becomes expensive quickly when the interpreter contract spans many families. Publishing the canonical method names keeps generation inspectable and materially reduces failures caused by invented helper objects or guessed APIs.

Question #5: Why should DS029 also mention `DocumentScalePlanner`?

Response: Not every long, complex request is an advanced reasoning problem. Some are explicit document workflows that need chunking, rollups, and selective expansion more than they need a bounded meta-reasoning response. Mentioning `DocumentScalePlanner` keeps the advanced route honest and prevents it from absorbing a neighboring planning surface by default.

## Conclusion

DS029 makes `AdvancedReasoner` operational rather than merely implemented. It requires the KUs, routing rules, prompt discipline, and visible coverage examples that let planning choose the interpreter deliberately and let reviewers verify what its bounded advanced reasoning surface can actually do.
