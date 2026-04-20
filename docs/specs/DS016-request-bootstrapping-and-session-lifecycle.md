---
id: DS016
title: Request Bootstrapping and Session Lifecycle
status: implemented
owner: runtime
summary: Defines public request entry, request-local response conventions, and the explicit file layout for session, request, plan, and family-state persistence.
---
# DS016 Request Bootstrapping and Session Lifecycle

## Introduction

This specification closes the entry-point gap between a user request and the first executable epoch. It defines what a session is, what a request is, which entry forms are public, how the first plan is bootstrapped, and how plans and family state are serialized on disk.

## Core Content

### Session and request hierarchy

A session is the long-lived runtime container for:

1. session identity and policy context,
2. session-scoped KU overlay,
3. session-scoped analytic checkpoints when policy allows them,
4. one append-oriented session trace stream,
5. zero or more requests executed over time.

A request is one bounded execution attempt inside a session. It owns one request identifier, one scheduler state machine, one budget set, one current graph frontier, and one stop outcome.

The v0 baseline allows multiple requests over the lifetime of one session, but only one request may be scheduler-active in a session at a time.

### Public request entry forms

The public runtime request contract accepts:

1. natural-language request plus optional attached files,
2. natural-language request plus an existing session identifier and optional attached files.

If the request text happens to contain SOP Lang snippets, the runtime may preserve them as ordinary request text or attachment content, but there is no special public bypass mode for direct SOP execution in v0. Lower-level SDK graph-execution APIs may exist later, but they are outside this DS.

### Bootstrapping flow

The baseline request bootstrapping sequence is:

1. Resolve or create the target session.
2. Assign `session_id` and `request_id`.
3. Materialize the request envelope: user text, attached file descriptors, selected policy profile, and initial budgets.
4. Load session-scoped context needed for planning: active KU overlay summary, recent request summaries, and any analytic checkpoints allowed to influence planning.
5. Invoke `planning` in `new_session_request` or `continuing_session_request` mode, as defined by DS006.
6. Validate the resulting initial plan against DS002, DS003, and DS017 before any executable epoch opens.
7. Persist the accepted plan snapshot as `current-plan.sop` and open `epoch_id = 1`.

Epoch numbering starts at `1` for the first executable graph snapshot. Planning that happens before a graph exists is request initialization work, not an executable epoch.

Every accepted request plan must contain one canonical request-local response family named `response`, as required by DS006.

The `error_triggered_repair` planning mode from DS006 is execution-time only. It is triggered after bootstrapping when a running request becomes blocked by failure or unresolved ambiguity.

### Persistence layout

The baseline filesystem layout is:

| Path | Meaning |
| --- | --- |
| `data/sessions/<sessionId>/manifest.json` | Session identity, policy profile, creation metadata, active request pointer if any |
| `data/sessions/<sessionId>/trace/session.jsonl` | Unified session trace stream defined by DS014 |
| `data/sessions/<sessionId>/kb/**/*.sop` | Session-scoped KU overlay files |
| `data/sessions/<sessionId>/history/request-summaries.jsonl` | Compact summaries of completed requests |
| `data/sessions/<sessionId>/analytics/checkpoints.jsonl` | Reloadable analytic-memory checkpoints |
| `data/sessions/<sessionId>/requests/<requestId>/envelope.json` | Initial request envelope |
| `data/sessions/<sessionId>/requests/<requestId>/current-plan.sop` | Current accepted plan snapshot |
| `data/sessions/<sessionId>/requests/<requestId>/epochs/epoch-0001.sop` | Optional per-epoch plan snapshots |
| `data/sessions/<sessionId>/requests/<requestId>/state/families/<familyId>/family.meta.json` | Family metadata snapshot |
| `data/sessions/<sessionId>/requests/<requestId>/state/families/<familyId>/v0001.value.txt` | Concrete variant value payload |
| `data/sessions/<sessionId>/requests/<requestId>/state/families/<familyId>/v0001.meta.json` | Concrete variant metadata |
| `data/sessions/<sessionId>/requests/<requestId>/outcome.json` | Final request outcome |

This layout is intentionally hierarchical so plans, family state, and request outcomes stay easy to load and inspect independently.

### Request completion and session continuation

When a request stops, the runtime must:

1. persist final request outcome and remaining blocked regions if any,
2. flush all trace events durably before marking the request closed,
3. keep session-scoped overlays and analytic checkpoints only if policy allows them to survive request end,
4. clear scheduler-active ownership of the session so another request may start later.

A session ends only by explicit close, policy-driven expiration, or destructive administrative cleanup.

## Decisions & Questions

Question #1: Why does v0 allow only one scheduler-active request per session at a time?

Response: The architecture already includes session overlays, session-level trace, and optional session-level analytic state. Allowing concurrent scheduler-active requests inside one session in v0 would multiply race conditions and make attribution harder before the baseline runtime exists.

Question #2: Why is there no special public entry mode for direct SOP execution?

Response: The public runtime surface is intentionally request-oriented and natural-language-first. Supporting a separate direct-SOP public path would create a second lifecycle contract before the first one has implementation feedback.

Question #3: Why is `response` request-local instead of session-global?

Response: Each request needs one clear delivery surface, but a session may contain many requests over time. Making `response` request-local preserves that clarity without inventing a misleading global session-output slot.

## Conclusion

MRP-VM v0 must have one explicit path from request intake to the first executable epoch, with a public request contract that stays simple and a persistence layout that keeps plans, state, and outcomes inspectable.
