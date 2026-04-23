---
id: DS014
title: Trace and Replay
status: implemented
owner: runtime
summary: Defines event types, minimum payloads, declaration-insertion visibility, storage format, and replay assumptions for MRP-VM v0.
---
# DS014 Trace and Replay

## Introduction

Trace is a first-class runtime artifact in MRP-VM v0. Without explicit trace, the architecture would lose its main promise: inspectable local computation with diagnosable failure modes.

## Core Content

### Storage model

The baseline storage format is append-only JSON Lines. One session may keep one unified trace stream, but every event must carry `session_id` and `request_id`, and every request-scoped event must also carry `epoch_id` when applicable.

Trace is separate from executable state. It may reference executable artifacts, but it is not itself encoded as ordinary families unless a program explicitly exports some of its content.

### Required event types and minimum payloads

| Event | Minimum payload |
| --- | --- |
| `request_started` | request metadata, trigger, budgets, initial mode |
| `epoch_opened` | epoch id, visible frontier summary, ready-node set |
| `command_invoked` | command id, declaration id, context summary, execution ordinal |
| `interpreter_invoked` | interpreter id, adapter profile, expected output mode |
| `context_packaged` | selected items, pruned items, byte counts, source tiers |
| `family_resolved` | family id, chosen representative, resolution reason |
| `variant_emitted` | emitted ids, family ids, source component, execution timing when available |
| `failure_recorded` | failure kind, affected family or request scope, repairable flag, originating component, execution timing when available |
| `metadata_updated` | target ids, changed keys, structural-impact flag, execution timing when available |
| `analytic_memory_updated` | updated keys, scope, export flag, checkpoint hash if any |
| `declarations_inserted` | inserted declaration hash, insertion source, new declaration ids |
| `planning_triggered` | mode, trigger reason, blocked-region summary |
| `planning_stopped` | outcome, accepted actions, rejected actions |
| `request_stopped` | final outcome, stop reason, remaining blocked regions |

The event schema must be stable enough that replay tools can parse it without command-specific guesswork.

When a declaration execution completes, the trace should preserve `started_at`, `finished_at`, and `duration_ms` either directly on the emitted event payload or in a clearly associated timing object. Traceability tooling may derive fallback timing from event timestamps, but persisted timing is preferred when the runtime knows the execution window explicitly.

### Replay contract

A replayable run requires:

1. the same starting request envelope,
2. the same accepted plan snapshot plus accepted declaration insertions,
3. the same stored runtime state, including families and analytic-memory state,
4. the same active KU revisions and prompt assets,
5. the same policies and adapter configuration,
6. the same deterministic scheduler order,
7. explicit visibility into nondeterministic wrapper dependencies.

Replay may not reproduce identical model text when wrappers are nondeterministic, but it must reproduce the structural execution path as far as the preserved artifacts allow.

When a command, wrapper, or scheduler path records a normalized refusal, error, or blocked state under DS017, the trace must record that through either `failure_recorded` or a more specific event whose payload still carries the normalized failure fields.

## Decisions & Questions

Question #1: Why does trace need a dedicated `analytic_memory_updated` event instead of relying only on ordinary variant events?

Response: `analytic-memory` is allowed to keep internal structured state that is not always exported as ordinary variants. If trace ignored those updates, replay would lose a major part of the runtime effective reasoning state.

Question #2: Why does v0 choose one unified session trace stream instead of one file per request?

Response: A unified stream preserves the sequential operational history of a session and simplifies append-only writing. Request identifiers still allow filtering, so the unified stream gives both session continuity and request-level analysis without needing a more complex storage scheme.

Question #3: Why does DS014 define minimum payloads per event type instead of leaving event schemas illustrative?

Response: Replay tooling and audit consumers need to know which fields they can rely on across implementations. Illustrative event descriptions would not be strong enough to support consistent replay, debugging, or conformance testing.

## Conclusion

MRP-VM v0 must record enough structured trace data to explain planning, context packaging, candidate comparison, analytics, and structural change. Replay is only meaningful if those facts remain explicit.
