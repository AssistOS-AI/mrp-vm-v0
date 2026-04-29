---
id: DS019
title: Evaluation Strategy
status: implemented
owner: runtime
summary: Defines configured VM instances as the evaluation unit, task-family benchmarking, and baseline comparison rules for MRP-VM v0.
---
# DS019 Evaluation Strategy

## Introduction

MRP-VM v0 is intended to be evaluated as a configured runtime system, not only as a thin prompt wrapper around one model. This specification defines the evaluation unit, benchmark families, baseline types, and the metrics that matter for the architecture.

## Core Content

### Evaluation unit

The primary evaluation unit is a configured VM instance:

1. runtime version,
2. active native commands,
3. active external interpreters,
4. KU set and prompt assets,
5. policies and capability profiles,
6. memory and session-state assumptions.

Comparisons that ignore these factors are incomplete because they erase the very control surfaces MRP-VM is designed to expose.

### Task-family benchmarking

Evaluation should focus on task families where structured execution is expected to have architectural advantage, such as:

1. multi-step decomposition with selective recomputation,
2. tasks requiring explicit candidate comparison or bounded plurality,
3. tasks requiring auditable retrieval and prompt governance,
4. tasks requiring stable deterministic rendering or rule evaluation around model calls,
5. tasks where replay, trace, or partial repair materially matter,
6. bounded reasoning tasks where the configured runtime exposes visible class-specific behavior such as rule, constraint, graph, search, numeric, mixed-class composition, and the advanced reasoning families shipped by `AdvancedReasoner`,
7. bounded document-analysis tasks where the configured runtime exposes explicit chunk planning, rollups, and declaration insertion through `DocumentScalePlanner`.

### Baselines and metrics

Every serious benchmark should compare the configured VM instance against at least one appropriate baseline, such as:

1. a direct-model baseline,
2. a lighter scripted workflow baseline,
3. a reduced-configuration VM baseline.

Metrics should include:

1. answer quality,
2. cost,
3. latency,
4. trace richness,
5. replayability,
6. stability under partial graph change,
7. repair success under bounded failure scenarios,
8. ambiguity-resolution quality for plural families.

The repository should maintain explicit repair-oriented evaluation cases rather than hiding repair behavior inside only generic task-family benchmarks. Repair is one of the main claimed strengths of the architecture and should be measured directly. When the repository ships multi-class reasoning interpreters or a declaration-inserting document planner, evaluation should include visible coverage for each shipped family across the shared demo/eval catalog plus focused unit coverage for the local reasoning APIs and structural-insertion behavior.

## Decisions & Questions

Question #1: Why is the configured VM instance the primary evaluation unit instead of a raw prompt-plus-model pair?

Response: The architecture claims value through explicit orchestration, bounded retrieval, candidate comparison, and traceable control. A raw prompt-plus-model comparison would hide those mechanisms and test the wrong thing.

Question #2: Why must evaluation include trace, replay, and stability metrics in addition to answer quality?

Response: The runtime is not trying only to maximize textual output quality. It is also trying to make execution inspectable, repairable, and stable under change. Those traits need direct measurement or they will disappear behind purely answer-centric benchmarking.

Question #3: Why separate shared end-to-end reasoning cases from focused reasoning-class unit tests?

Response: The shared catalog proves that the configured runtime can route and present representative tasks end to end. Focused unit tests prove that the shipped local reasoning classes still obey their bounded contracts even when prompt generation is not involved. Both are needed to keep the evaluation story honest.

## Conclusion

MRP-VM v0 should be measured as a configured execution system with explicit structural advantages, not merely as another way to call a model.
