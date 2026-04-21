---
id: DS006
title: Planning and Replanning
status: implemented
owner: runtime
summary: Defines LLM-assisted planning modes, mode-specific context, graph-authority boundaries, and the canonical response-family convention for requests.
---
# DS006 Planning and Replanning

## Introduction

Planning is the orchestration core of MRP-VM v0, but it must not become an opaque sovereign agent. It is a bounded native command that typically uses one or more planning-oriented external interpreters, then validates the returned SOP declarations against runtime policy, budgets, and graph rules.

## Core Content

### Planning modes

The planning command must support these three modes:

| Mode | Purpose |
| --- | --- |
| `new_session_request` | Create the first executable graph for the first request in a new session. |
| `continuing_session_request` | Create the first executable graph for a new request inside an existing session. |
| `error_triggered_repair` | Repair or redirect execution when a running request is blocked by error or ambiguity. |

All three modes consume ordinary request budget and planning budget. Planning is real work and must not escape bounded accounting.

### Mode-specific context

Planning must receive a normalized input object containing at least:

1. The user request and attached file descriptors.
2. The active mode and trigger reason.
3. The current graph snapshot when one already exists.
4. Family state summary, including blocked families and plural families awaiting DS012 resolution.
5. Session summary, including active session KUs and recent request summaries.
6. Remaining budgets and retry counters.
7. The active command and interpreter catalog.

The runtime must also distinguish the minimum contextual differences between modes:

| Mode | Mandatory context emphasis |
| --- | --- |
| `new_session_request` | user request, attached files, bootstrap KUs, default caller profiles |
| `continuing_session_request` | user request, attached files, session summary, active session overlay, latest completed request outcomes |
| `error_triggered_repair` | current plan, current family state, blocked regions, prior repair attempts, failure metadata from DS017 |

### LLM assistance and prompt governance

The native planning command may use `plannerLLM` or another approved planning-oriented external interpreter from DS013 and DS020. That LLM assistance is expected and must be explicit.

Planning guidance must come from KU-managed prompt assets resolved through `kb`. The runtime must support a `data/default/` bootstrap layer containing baseline planning assets and repair assets. Scope precedence is:

1. Session
2. Global
3. Default

Planning assets must be grouped by mode so that initialization and repair do not accidentally share the same full instruction surface. The baseline required groups are:

1. `planning_init_core`
2. `planning_continue_core`
3. `planning_repair_core`

If a required planning group is missing, planning must fail with configuration error rather than silently improvise.

Mode-specific prompt grouping and default-KU guidance for caller input shapes are normative requirements, not optional tuning advice.

Planning retrieval must not stop at the mandatory planning prompt alone. In addition to the mode-specific prompt asset, the planning command must retrieve rich command- and interpreter-guidance KUs that help it choose the correct execution route for each sub-task. Those guidance KUs are selected metadata-first, then refined lexically against the current request and any local planning slice.

Selection-facing KU summaries are part of the planning contract. A default KU summary must be detailed enough that planning can distinguish when to use `js-eval`, `logic-eval`, `template-eval`, `analytic-memory`, `kb`, `credibility`, or one of the external interpreters. Terse summaries such as "wrapper profile" or "guidance" are non-conformant because they do not give planning enough evidence to route work reliably.

### Planning outputs and graph authority

Planning outputs may include:

1. New SOP declarations.
2. Replacement declaration sets for a blocked region.
3. Revised command routing.
4. Retry recommendations.
5. Cleanup recommendations such as logical withdrawal of obsolete error variants.
6. Explicit stop recommendations.

Planning does not mutate the graph directly. It proposes declaration content, and the native planning command validates and hands accepted declaration insertions to the DS002 epoch mechanism.

Every accepted request plan must define one canonical user-facing response family for that request. The v0 reserved family name is `response`, but it is request-local rather than session-global. There is no global session response variable.

### Input-shape guidance for callers

Every planning-oriented interpreter and helper command must have default KUs that describe:

1. the preferred declaration-body shapes it accepts,
2. regex- or rule-based fast-path extraction rules when possible,
3. when LLM fallback is allowed for underspecified inputs.

This guidance exists both to help planning write cleaner declaration content and to keep ordinary command invocation from depending on opaque prompt guessing.

For every native command and every external interpreter in the baseline catalog, the repository must provide one or more detailed default KUs. Those KUs may be caller profiles, guidance assets, or prompt assets, but taken together they must give planning enough information to decide:

1. what the component is good at,
2. what input shape it expects,
3. what anti-patterns should be avoided,
4. what output surface it is expected to produce.

## Decisions & Questions

Question #1: Why are there separate planning modes for new sessions, continuing sessions, and repair?

Response: They need materially different context. The first request in a session is mostly bootstrap plus user intent. A later request must account for session overlays and prior outcomes. Repair planning must reason over the current plan and failure state, which is a different task again.

Question #2: Why does the native planning command remain the graph authority even when `plannerLLM` is used?

Response: LLM assistance may be strong, but graph mutation is still a runtime responsibility. The native planning command must keep budget checks, capability checks, and graph validation centralized.

Question #3: Why must every request plan define one canonical `response` family?

Response: User-facing execution needs one explicit target family for the result of that request. Without such a convention, plans could finish with many local artifacts but no clear delivery surface. Keeping `response` request-local avoids inventing a global session output slot.

## Conclusion

Planning in MRP-VM v0 must be explicit, budgeted, KU-governed, and mode-aware. It may rely on LLM assistance, but it must still produce validated declaration content under native runtime control.
