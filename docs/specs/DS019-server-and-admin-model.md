---
id: DS019
title: Server and Admin Model
status: planned
owner: runtime
summary: Defines the optional HTTP embedding layer, session-executor reuse, and admin boundaries for hosting MRP-VM v0.
---
# DS019 Server and Admin Model

## Introduction

This specification defines the optional server-facing embedding model for MRP-VM v0. The runtime itself is SDK-first, but deployments may still expose HTTP interfaces, chat surfaces, and admin controls that host the runtime. Those surfaces need their own boundaries so they do not distort the SDK contract.

## Core Content

### Embedding boundary

The server layer is not the runtime core. It is an adapter that:

1. Accepts HTTP or chat requests.
2. Resolves or creates sessions.
3. Submits normalized request envelopes into the runtime.
4. Returns request outcomes, streamed trace views, or incremental UI-facing projections.

The server implementation should live outside `src/` runtime modules, typically under `server/`, and call the runtime through explicit SDK entry points.

### Session executor reuse

If a deployment hosts long-lived sessions, the server may cache session executors by `session_id` so that session overlays, trace writers, and analytic checkpoints do not need to be rebuilt for every request. Executor reuse must still respect DS016 request boundaries and must never allow two scheduler-active requests to run concurrently inside one session in v0.

Executor caches must support eviction. When an executor leaves memory, the server must be able to reconstruct it from session files or the authoritative session store without losing session identity, trace continuity, or persisted checkpoints.

### Admin boundary

Admin operations such as session inspection, trace export, policy override, KU promotion, or destructive cleanup must run under explicit admin capability profiles rather than under ordinary user request capabilities. The server layer must keep admin sessions and ordinary user sessions distinguishable in trace and policy handling.

### Hosting surfaces

The optional hosting layer may provide:

1. A native programmatic API for request submission.
2. A compatibility API for baseline OpenAI-style request shapes when the deployment needs it.
3. A `/chat` HTML application or equivalent chat-oriented UI.
4. Session-inspection endpoints for administrators.
5. Trace or benchmark export endpoints under admin policy.

The `/chat` surface should allow session selection, message submission, session-history inspection, and editing of runtime options exposed by policy such as default wrapper choices or interpreter mappings.

The existence of these surfaces does not change the authoritative runtime contracts defined by the DS suite.

## Decisions & Questions

Question #1: Why is the server model specified separately from the core runtime?

Response: Transport and hosting concerns evolve differently from parser, scheduler, and command contracts. Keeping the server model separate prevents HTTP convenience from becoming the accidental architecture of the runtime itself.

Question #2: Why may servers cache session executors by `session_id`?

Response: Session overlays, trace streams, and analytic checkpoints are session-level concerns. Reusing session executors can preserve continuity and reduce repeated setup work as long as the runtime still enforces one active request at a time per session in v0.

Question #3: Why must admin operations use explicit admin capability profiles instead of ordinary request capabilities?

Response: Session inspection, trace export, cleanup, and policy override expose far more authority than normal task execution. Treating them as ordinary user operations would blur security boundaries and weaken auditability.

Question #4: Why may the hosting layer expose baseline OpenAI-compatible request shapes in addition to native APIs?

Response: Compatibility endpoints can lower integration friction for clients that already speak common LLM API shapes. Exposing them at the server adapter layer preserves that convenience without redefining the SDK core in chat-completion terms.

Question #5: Why does DS019 call out a `/chat` HTML application explicitly?

Response: Session-oriented interaction is easier to inspect when users can see history, switch sessions, and adjust runtime-facing options in one hosted surface. Naming `/chat` explicitly keeps that UI from becoming an accidental afterthought or a private tool outside the architecture.

Question #6: Should session-executor eviction use TTL, LRU, or another policy?

Options:

Option 1: LRU-based eviction with a configurable size limit.
Implications: This matches access locality well for interactive workloads, but it may evict long-idle sessions that still matter semantically.

Option 2: TTL-based eviction with optional hard size caps.
Implications: This is simple to reason about operationally, but it may discard still-useful executors for frequently returning sessions.

Option 3: Hybrid size-and-time-based eviction.
Implications: This is usually operationally safer, but it adds more policy knobs before the baseline hosting layer exists.

## Conclusion

MRP-VM v0 may be embedded in servers and admin tools, but those surfaces must remain adapters around the SDK rather than substitutes for it. DS019 keeps that hosting boundary explicit.
