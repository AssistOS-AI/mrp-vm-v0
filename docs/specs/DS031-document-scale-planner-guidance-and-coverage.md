---
id: DS031
title: DocumentScalePlanner Guidance and Coverage
status: implemented
owner: runtime
summary: Defines the caller-profile, guidance, routing, demo, and evaluation requirements that make DocumentScalePlanner usable and inspectable in practice.
---

# DS031 DocumentScalePlanner Guidance and Coverage

## Introduction

`DocumentScalePlanner` is only operationally useful when planning can choose it deliberately, the accepted body shapes are published through default KUs, and the repository exposes visible examples that show how explicit document-scale planning differs from one opaque document prompt. This DS defines those supporting requirements.

The scope of DS031 is not the interpreter runtime itself. DS030 owns that. DS031 owns the reusable guidance layer: caller profiles, selection-facing guidance, planner-routing rules, and repository-owned demo and evaluation coverage.

## Core Content

### Required default assets

The repository must ship these default assets together:

1. a caller profile for `DocumentScalePlanner`,
2. at least one selection-facing guidance KU for `DocumentScalePlanner`,
3. updated planning guidance that distinguishes direct `DocumentScalePlanner` routing from both reasoning interpreters and from `logic-eval`,
4. updated `plannerLLM` guidance that explains how to keep the initial graph connected when an interpreter will insert declarations later,
5. shared demo and evaluation cases that show bounded Markdown and JSON planning routes.

Unlike the two reasoning interpreters, `DocumentScalePlanner` does not require a program-generation prompt asset because the implemented v0 planner is deterministic and local. Its guidance burden is therefore concentrated on route selection, accepted body shapes, and graph-connection discipline.

### Planning route discipline

The required route discipline is:

| Situation | Required planning behavior |
| --- | --- |
| The request is already clearly a bounded Markdown or JSON analysis workflow with repeated per-unit processing | route directly to `DocumentScalePlanner` |
| The request is primarily a finite symbolic reasoning task | do not route to `DocumentScalePlanner`; prefer `HumanLikeReasoner` |
| The request is primarily a bounded advanced meta-reasoning task | do not route to `DocumentScalePlanner`; prefer `AdvancedReasoner` |
| The planner still needs a rewrite brief for a reasoning-heavy request | use `logic-eval`, then route to the matching reasoning interpreter |
| The request is only one-shot prose over a small excerpt | do not route to `DocumentScalePlanner`; prefer the appropriate ordinary LLM route |

Planning guidance must also say explicitly that the initial accepted graph must remain connected. If `DocumentScalePlanner` will later insert the final semantic target, the initial `@response` declaration must depend on the declared planner family rather than on an undeclared future family.

### Repository-owned coverage visibility

The repository must keep visible coverage for the implemented document-planning baseline. At minimum:

1. focused unit coverage for deterministic planning primitives and inserted-plan behavior,
2. at least one Markdown showcase case in the shared chat/eval catalog,
3. at least one JSON showcase case in the shared chat/eval catalog,
4. validation rules that prove the shared catalog still exposes the expected operator-visible outputs.

The shared catalog is part of the public capability surface. Document-scale planning examples should therefore remain small enough to read quickly, but concrete enough that an operator can see the explicit chunking, rollup, and response-bridging behavior.

## Decisions & Questions

### Question #1: Why does DS031 require caller and guidance KUs but not a prompt asset like DS027 and DS029?

Response: The implemented `DocumentScalePlanner` does not ask a managed LLM to generate local programs. Its planning logic is deterministic and local. The critical public contract is therefore how planning selects it and how declaration bodies should be shaped, not how a hidden code generator should be prompted.

### Question #2: Why must shared chat demos and automated evaluation include Markdown and JSON cases separately?

Response: The interpreter claims two explicit document families in v0. If only one family were showcased, the repository would advertise a broader contract than it demonstrates. Separate visible cases keep the baseline auditable.

### Question #3: Why does planning guidance need a special rule about keeping `@response` connected through the planner family?

Response: Document-scale planning inserts declarations after the initial graph is accepted. Without that rule, a planner could create an initial `@response` step that depends on a family which does not yet exist, producing a disconnected graph or a premature completion path. The bridge rule keeps the runtime behavior inspectable and correct.

## Conclusion

DS031 makes `DocumentScalePlanner` operational rather than merely implemented. It requires the KUs, routing rules, and visible coverage that let planning choose the interpreter deliberately and let reviewers verify the bounded document-planning surface end to end.
