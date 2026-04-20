---
id: DS020
title: Evaluation Strategy
status: planned
owner: runtime
summary: Defines configured VM instances as the evaluation unit, task-family benchmarking, and baseline comparison rules for MRP-VM v0.
---
# DS020 Evaluation Strategy

## Introduction

MRP-VM v0 is intended to be evaluated as a configured runtime system, not only as a thin prompt wrapper around one model. This specification defines the evaluation unit, benchmark families, baseline types, and the metrics that matter for the architecture.

## Core Content

### Evaluation unit

The primary evaluation unit is a configured VM instance:

1. Runtime version
2. Active native commands
3. Active external interpreters
4. KU set and prompt assets
5. Policies and capability profiles
6. Memory and session-state assumptions

Comparisons that ignore these factors are incomplete because they erase the very control surfaces MRP-VM is designed to expose.

### Task-family benchmarking

Evaluation should focus on task families where structured execution is expected to have architectural advantage, such as:

1. Multi-step decomposition with selective recomputation.
2. Tasks requiring explicit candidate comparison or bounded plurality.
3. Tasks requiring auditable retrieval and prompt governance.
4. Tasks requiring stable deterministic rendering or rule evaluation around model calls.
5. Tasks where replay, trace, or partial repair materially matter.

### Baselines and metrics

Every serious benchmark should compare the configured VM instance against at least one appropriate baseline, such as:

1. A direct-model baseline.
2. A lighter scripted workflow baseline.
3. A reduced-configuration VM baseline.

Metrics should include:

1. Answer quality
2. Cost
3. Latency
4. Trace richness
5. Replayability
6. Stability under partial graph change
7. Repair success under bounded failure scenarios

## Decisions & Questions

Question #1: Why is the configured VM instance the primary evaluation unit instead of a raw prompt-plus-model pair?

Response: The architecture claims value through explicit orchestration, bounded retrieval, candidate comparison, and traceable control. A raw prompt-plus-model comparison would hide those mechanisms and test the wrong thing.

Question #2: Why should benchmarks be organized around task families where structured execution has architectural advantage?

Response: Every system looks weaker or stronger depending on which tasks are chosen. MRP-VM should be measured where its design principles are supposed to matter, not only on generic single-shot completion tasks that underuse its structure.

Question #3: Why must evaluation include trace, replay, and stability metrics in addition to answer quality?

Response: The runtime is not trying only to maximize textual output quality. It is also trying to make execution inspectable, repairable, and stable under change. Those traits need direct measurement or they will disappear behind purely answer-centric benchmarking.

Question #4: Should the repository maintain a separate benchmark corpus for structural-failure and repair scenarios?

Options:

Option 1: Yes, maintain explicit repair-oriented evaluation cases.
Implications: This would let the runtime measure one of its most distinctive claimed strengths, but it adds benchmark-authoring work before implementation is mature.

Option 2: No, fold repair scenarios into general task-family benchmarks only.
Implications: This keeps the benchmark surface smaller, but it may under-measure repair quality as a distinct system capability.

## Conclusion

DS020 makes evaluation a first-class part of the architecture instead of an afterthought. MRP-VM v0 should be measured as a configured execution system with explicit structural advantages, not merely as another way to call a model.
