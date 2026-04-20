---
id: DS002
title: Core Semantics
status: implemented
owner: runtime
summary: Defines family state, graph compilation, topological execution, representative resolution, epoch transitions, budgets, and authoritative runtime effects for MRP-VM v0.
---
# DS002 Core Semantics

## Introduction

This specification owns the core executable semantics of MRP-VM v0. It defines how SOP Lang declarations become a dependency graph, how that graph is ordered into executable frontiers, how family state is represented, how ambiguity is resolved through `credibility`, and when structural change forces a new epoch.

DS003 owns declaration parsing and source-text structure. DS007 through DS009 own the command-local meaning of runtime references inside each evaluator. DS002 remains the authority for graph meaning, family semantics, representative choice, and epoch boundaries.

## Core Content

### Execution substrate

SOP Lang is the only runtime surface language in v0. Every accepted request ultimately becomes a set of SOP Lang declarations. Each declaration is a graph node that names one target family and one execution route:

1. `@target command`
2. `@target commandA | commandB | commandC`
3. `@target commandA & commandB & commandC`

Planning emits declaration content. Commands and interpreters evaluate that declaration content and emit variable content plus variable metadata. The runtime must not invent a second hidden orchestration language behind SOP Lang.

### Graph compilation and topological execution

The runtime must compile all declarations of the current plan into one dependency graph before execution. Graph construction follows this order:

1. Parse declaration content according to DS003.
2. Create one node per declaration.
3. Scan structural references in each declaration body.
4. Create dependency edges from each declaration to the families or exact variants it requires.
5. Reject static cycles before execution begins.
6. Compute a topological ordering over the resulting graph.

The topological ordering defines executable frontiers. All ready declarations in the same topological stratum may be dispatched in parallel. Parallelism is therefore derived from dependency structure, not from a separate planner hint.

The graph is fixed inside one epoch. If execution later inserts new SOP declarations, the current epoch closes and the runtime recompiles the graph for the next epoch.

### Reference semantics at language level

DS002 owns only the graph-level meaning of `$` and `~`, not the command-local helper objects created from them.

- `$x` and `$x:vN` declare a materialized dependency on family `x` or exact variant `x:vN`.
- `~x` and `~x:vN` declare a reference-style dependency on family `x` or exact variant `x:vN`.
- The graph builder treats both forms as dependencies.
- DS007 and DS008 define the command-local operational meaning of these references inside `js-eval` and `logic-eval`.

Unknown exact references such as `$x:vN` or `~x:vN` are resolution failures. Unknown family references may remain optional only when the consuming command contract explicitly allows that slot to be absent.

The runtime performs one structural dependency scan over declaration content before invocation. Text inserted by runtime expansion inside one command invocation is not reparsed recursively for new dependencies during that same invocation.

### Family state model

All executable state is represented as families and concrete variants. For family `x`, the minimal canonical surface is:

1. `x:meta`
2. `x:v1`
3. `x:v1:meta`
4. `x:v2`
5. `x:v2:meta`

Families are created when the runtime first accepts a declaration targeting that family or first imports or emits a concrete variant for it. Declaration existence and emitted content must remain distinguishable:

1. Declaration content says how a family should be produced.
2. Variable content is the emitted value of one concrete variant.
3. Variable metadata is attached through `:meta` entries at family or variant level.

Variant numbering must be monotonic within one family. A new value creates a new `vN` variant rather than overwriting an older variant. Variants may be withdrawn logically, but v0 does not permit silent destructive deletion from the authoritative state path.

The baseline shared metadata fields in `:meta` are `scope`, `status`, `created_epoch`, `trust`, `priority`, `score`, `score_pct`, `origin`, `parent`, `source_url`, `source_type`, `citation`, `commands`, `domains`, `tags`, `source_interpreter`, and `reason`. `status` must at least distinguish `pending`, `active`, `error`, `refused`, `blocked`, `withdrawn`, and `unknown`.

### Authoritative state-effect contract

The authoritative runtime effect contract is append-oriented concrete-variant emission plus accompanying `:meta` state. Commands may still use internal local envelopes during execution, but accepted runtime effects must ultimately be expressed as:

1. emitted concrete variants,
2. metadata updates,
3. logical withdrawals,
4. direct SOP declaration insertions.

Opaque result envelopes are not the authoritative persisted state model of v0.

Direct SOP declaration insertion replaces the former special control-family approach. If a command or planner wants structural change, it must return ordinary SOP Lang declaration text as a structural effect. The scheduler validates that text with DS003, buffers it transactionally with the rest of the branch effects, and inserts it only when opening the next epoch.

The baseline sources allowed to propose declaration insertion are native planning (DS006), `js-eval` (DS007), `logic-eval` (DS008), `credibility` (DS012), and any external interpreter whose DS020 contract explicitly permits declaration insertion.

### Representative resolution and credibility

`$x:vN` and `~x:vN` refer to an exact concrete variant. `$x` and `~x` refer to the active representative of family `x`.

Representative resolution must follow this order:

1. If exactly one usable variant exists, use it.
2. If multiple usable variants exist, invoke DS012 `credibility` before first materialization or stable-handle resolution.
3. Apply the highest explicit `score` or `score_pct` emitted by `credibility`.
4. Break unresolved ties by newest `created_epoch` or scheduler ordinal.
5. Use producer order established by declaration position and branch position as final tie-breaker.

This representative selection is request-local and cached. The cache must be invalidated only by structural changes that may change the winner.

### Plurality semantics

The `|` operator is ordered fallback. Under the default policy, the runtime must stop at the first acceptable branch. A branch is acceptable when it emits at least one non-withdrawn concrete variant for the target family and does not terminate in refusal or error for that family.

The `&` operator is mandatory multi-attempt plurality. All branches run, preferably in parallel within one epoch, and every successful branch contributes a candidate to the same logical family.

### Epoch control, buffering, and budgets

An epoch is a maximal execution phase over:

1. a fixed declaration graph,
2. a fixed visible variant frontier,
3. a fixed representative cache,
4. a fixed ready set derived from the current topological ordering.

The lifecycle is:

1. Open epoch with the current graph snapshot.
2. Select all ready declarations in the next executable topological stratum.
3. Dispatch them, potentially in parallel.
4. Buffer branch-local effects transactionally.
5. Apply successful branch effects in deterministic scheduler order.
6. Continue within the same epoch only if no structural effect changed the graph or representative frontier.
7. Close the epoch and recompile the graph if a structural effect occurred.

Structural effects for v0 are:

1. emission of a new visible concrete variant,
2. metadata updates that affect filtering or representative choice,
3. first representative resolution for a downstream-used plural family,
4. change of representative for such a family,
5. logical withdrawal of an active variant,
6. accepted insertion of new SOP declarations.

Effects emitted by one branch are buffered transactionally for that branch. If the branch ends in failure before successful completion, the branch-local buffered variants, metadata updates, withdrawals, and declaration insertions must be discarded rather than partially committed.

One scheduler step in v0 is one dispatched executable branch or one accepted control action. The request must track at least wall-clock budget, total step budget, planning budget, and structural-change budget.

## Decisions & Questions

Question #1: Why does DS002 own graph compilation and topological execution rather than leaving them to planning or command DS files?

Response: The executable graph is the semantic center of the runtime. Planning may produce declarations and commands may consume them, but neither should redefine how the graph is built or ordered. Keeping graph compilation and topological execution here prevents local subsystems from inventing incompatible execution models.

Question #2: Why is `|` defined as stop-at-first-acceptable by default?

Response: The main architectural purpose of `|` is bounded fallback, not silent plurality. If `|` also routinely collected later successes, planners and readers would not know whether a declaration was intended as fallback or comparison.

Question #3: Why does v0 use direct SOP declaration insertion instead of a special control family?

Response: Structural change is about adding new declarations to the graph, not about maintaining a parallel family with special status. Returning ordinary SOP declaration text is simpler to explain, easier to trace, and keeps all graph growth on the same language substrate.

Question #4: Why must `credibility` run before first-touch expansion of a plural family?

Response: The runtime needs one authoritative moment where ambiguity becomes an explicit judgment rather than an accidental newest-value choice. Triggering `credibility` on first-touch keeps representative choice inspectable and lets the runtime emit scores, withdrawals, or synthesized variants before downstream commands commit to one branch of meaning.

Question #5: Why are branch effects buffered transactionally instead of committed incrementally?

Response: A failed branch should not leave half-applied variants or partially inserted declarations behind. Transactional buffering keeps the graph frontier and family state easier to replay and prevents error recovery from reasoning over artifacts that never represented a successful command outcome.

Question #6: Why may declarations in the same topological stratum run in parallel?

Response: Once the dependency graph says that two declarations do not depend on each other inside the current epoch, serializing them would add latency without adding semantic value. Topological strata make that concurrency explicit and auditable rather than heuristic.

Question #7: Why does the DS suite choose concrete emitted variants plus `:meta` as the authoritative runtime contract instead of an opaque result-envelope model?

Response: The architecture is built around append-oriented state, representative selection, replay, and explicit structural effects. Those mechanisms need concrete artifacts in runtime state. Local result envelopes may still exist during execution, but they cannot replace emitted state as the authoritative long-lived contract.

## Conclusion

MRP-VM v0 must execute on one explicit graph substrate with one family-based state model, one representative-selection policy, and one precise epoch lifecycle. All later command, planning, and interpreter behavior depends on these semantics being stable.
