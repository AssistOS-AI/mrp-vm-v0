---
id: DS003
title: Runtime Control and Scheduling
status: planned
owner: runtime
summary: Defines scheduler steps, epoch lifecycle, conflict resolution, budgets, and stop behavior for MRP-VM v0.
---
# DS003 Runtime Control and Scheduling

## Introduction

The scheduler is the control surface that prevents MRP-VM v0 from collapsing into opaque retries and uncontrolled replanning. This DS defines request budgeting, epoch transitions, concurrency rules, and deterministic effect application order.

## Core Content

### Scheduler steps and budget units

One scheduler step in v0 is one dispatched executable branch. The following each count as one step:

1. One native command invocation.
2. One external interpreter invocation.
3. One planning invocation.
4. One credibility invocation.
5. One accepted rewrite application.

If three branches run in parallel, they consume three steps. Parallelism changes wall-clock behavior, not accounting granularity.

Each request must track at least:

| Budget | Meaning |
| --- | --- |
| Wall-clock budget | Maximum elapsed time for the request. |
| Total step budget | Maximum total executed branches and scheduler actions. |
| Planning budget | Maximum planning invocations for the request. |
| Rewrite budget | Maximum accepted structural rewrites. |
| Optional retry budgets | Per-family, per-command, or per-region retry caps nested inside the request budget. |

### Epoch lifecycle

An epoch is a maximal execution phase over:

1. A fixed declaration graph.
2. A fixed set of visible concrete variants and active metadata.
3. A fixed cache of family representatives.
4. A fixed command-ready frontier.

The lifecycle is:

1. Open epoch with current frontier.
2. Select all ready nodes whose dependencies are satisfied in that frontier.
3. Dispatch those ready branches, potentially in parallel.
4. Buffer emitted effects.
5. Apply buffered effects in deterministic scheduler order.
6. If no structural effect occurred, continue within the same epoch with newly ready nodes from the same graph snapshot.
7. If a structural effect occurred, close the epoch and open the next one.

The deterministic effect-application order for one dispatch wave must be based on scheduler-assigned execution ordinals, not wall-clock completion order. This avoids nondeterministic race behavior when parallel branches finish at different times.

Representative caches must be invalidated when a structural effect can change the winner for the affected family, including new candidate emission, score-changing metadata updates, withdrawal, or accepted rewrites that alter the reachable dependency graph for that family.

Effects emitted by one branch are buffered transactionally for that branch. If the branch ends in execution failure before successful completion, the branch-local buffered variants, metadata updates, and rewrites must be discarded rather than partially committed.

Epoch closure triggers for v0 are:

| Trigger | Closes current epoch? | Reason |
| --- | --- | --- |
| New visible concrete variant | Yes | Visible state frontier changed |
| Metadata update that affects filtering or representative choice | Yes | Downstream resolution may change |
| First representative resolution for a downstream-used family | Yes | The visible representative frontier changed |
| Representative change for such a family | Yes | Downstream resolution changed |
| Logical withdrawal of an active variant | Yes | Active candidate set changed |
| Accepted `__decl` rewrite | Yes | Graph structure changed |
| Purely local failed branch with discarded buffered effects | No | No visible state changed |

### Structural effects and conflicts

Structural effects are:

1. Emission of a new visible concrete variant.
2. Metadata updates that change representative selection or filtering.
3. First representative selection for a family used downstream.
4. Change of representative selection for such a family.
5. Logical withdrawal of an active variant or candidate.
6. Accepted `__decl` rewrites.

Parallel branches do not create classic in-place write races because runtime state is append-oriented. Two branches writing to the same family create different variants. Apparent conflicts arise only in metadata or representative choice, and those are resolved through deterministic effect ordering plus later credibility or planner intervention.

### Stop conditions

Hard-stop conditions include exhausted request budget, exhausted planning budget, exhausted rewrite budget, explicit no-viable-path state, and repeated instability in the same repair region beyond retry limits.

Soft-stop conditions include partial success with blocked downstream regions, explicit unknown outcome, policy-authorized degraded completion, and early stop after a sufficient result when the request does not require full graph completion.

## Decisions & Questions

Question #1: Why does every executed branch consume its own scheduler step even when branches run in parallel?

Response: Parallel execution changes latency but not computational work. If parallel branches were counted as one shared step, the scheduler could hide large amounts of work behind concurrency and budgets would stop reflecting real execution complexity. Per-branch accounting keeps cost control honest.

Question #2: How are concurrent writes to the same family handled?

Response: v0 resolves this by forbidding hidden in-place mutation as the primary update model. Parallel branches append new variants instead of racing on one mutable slot. Deterministic effect ordering then decides metadata application order, while `credibility` and planning resolve semantic competition afterwards.

Question #3: Should planning consume only the planning budget or both the planning budget and the main request budget?

Response: It must consume both. Planning is real work with real cost and must not escape the global request budget simply because it is control logic. The planning budget adds a narrower leash specifically against plan churn.

Question #4: Should the runtime add a separate budget for representative-selection churn beyond the rewrite budget?

Options:

Option 1: Keep representative changes inside the ordinary step and structural-effect budgets.
Implications: This keeps the budget model simpler and is adequate if representative churn is rare or planner-driven.

Option 2: Add a dedicated representative-resolution churn budget later.
Implications: This gives finer protection against pathological credibility loops, but it adds another dimension to already complex budgeting and should only be introduced if implementation data shows the simpler model is insufficient.

Question #5: Why does v0 keep a separate rewrite budget in addition to ordinary step budgeting?

Response: Structural churn can consume significant control effort even when individual command invocations remain cheap. A dedicated rewrite budget prevents repeated replanning or declaration replacement from quietly exhausting the whole request through graph manipulation alone.

Question #6: Why does DS003 include an explicit epoch-closure trigger table instead of leaving closure rules implicit?

Response: Epoch boundaries are central to replay, cache invalidation, and structural determinism. A trigger table gives implementers one direct checklist for deciding whether the current frontier remains valid or a new epoch must begin.

Question #7: Why are representative caches invalidated only by structural changes affecting the family instead of on every epoch boundary?

Response: The cache exists to preserve deterministic, low-overhead representative lookup within stable graph regions. Invalidating it on every epoch would throw away useful stability. Invalidating it only when a relevant structural effect occurs keeps the cache honest without making it useless.

Question #8: Why are branch effects committed only after successful branch completion?

Response: Partial branch commits would leave orphan variants or half-applied metadata when a later step in the same invocation throws. Transactional branch buffering keeps replay cleaner and prevents failure recovery from reasoning over artifacts that were never part of a successful invocation outcome.

## Conclusion

The scheduler must provide deterministic epochs, explicit structural-effect boundaries, per-branch accounting, and bounded replanning. Without that control layer, the rest of the architecture would become non-auditable.
