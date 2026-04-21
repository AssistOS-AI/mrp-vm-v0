---
id: DS018
title: Server and Admin Model
status: implemented
owner: runtime
summary: Defines the optional HTTP embedding layer, session-executor reuse, and admin boundaries for hosting MRP-VM v0.
---
# DS018 Server and Admin Model

## Introduction

This specification defines the optional server-facing embedding model for MRP-VM v0. The runtime itself is SDK-first, but deployments may still expose HTTP interfaces, chat surfaces, and admin controls that host the runtime. Those surfaces need their own boundaries so they do not distort the SDK contract.

## Core Content

### Embedding boundary

The server layer is not the runtime core. It is an adapter that:

1. accepts HTTP or chat requests,
2. resolves or creates sessions,
3. submits normalized request envelopes into the runtime,
4. returns request outcomes, streamed trace views, or incremental UI-facing projections.

The server implementation should live outside `src/` runtime modules, typically under `server/`, and call the runtime through explicit SDK entry points.

### Session executor reuse

If a deployment hosts long-lived sessions, the server may cache session executors by `session_id` so that session overlays, trace writers, and analytic checkpoints do not need to be rebuilt for every request. Executor reuse must still respect DS016 request boundaries and must never allow two scheduler-active requests to run concurrently inside one session in v0.

Executor caches must support eviction. When an executor leaves memory, the server must be able to reconstruct it from session files or the authoritative session store without losing session identity, trace continuity, or persisted checkpoints.

### Admin boundary

Admin operations such as session inspection, trace export, policy override, KU promotion, or destructive cleanup must run under explicit admin capability profiles rather than under ordinary user request capabilities. The server layer must keep admin sessions and ordinary user sessions distinguishable in trace and policy handling.

At minimum, hosted sessions should persist `session_origin`, `auth_mode`, `effective_role`, and owner or key identity when applicable so audit, policy enforcement, and UI transparency do not depend on inferred state.

### Hosting surfaces

The optional hosting layer may provide:

1. a native programmatic API for request submission,
2. a compatibility API for baseline OpenAI-style request shapes when the deployment needs it,
3. a `/chat` HTML application or equivalent chat-oriented UI,
4. session-inspection endpoints for administrators,
5. trace or benchmark export endpoints under admin policy.

The hosted UI may expose dedicated pages for chat, traceability, KB inspection, and settings, but those surfaces must still remain server-owned adapters around the SDK instead of moving hosting logic back into `src/`.

The baseline hosting layer should start with one simple executor-eviction policy such as pure TTL or pure LRU. Hybrid eviction may be added later if operational evidence justifies the extra policy surface.

The ordinary server startup path must detect whether a managed provider path is available and refuse to start when only the fake adapter is available. Fake-LLM execution is reserved for tests and other explicit harness-level invocations; the user-facing server entry point must not expose an environment-variable escape hatch that silently turns the server into a fake-provider deployment.

## Decisions & Questions

Question #1: Why is the server model specified separately from the core runtime?

Response: Transport and hosting concerns evolve differently from parser, scheduler, and command contracts. Keeping the server model separate prevents HTTP convenience from becoming the accidental architecture of the runtime itself.

Question #2: Why must admin operations use explicit admin capability profiles instead of ordinary request capabilities?

Response: Session inspection, trace export, cleanup, and policy override expose far more authority than normal task execution. Treating them as ordinary user operations would blur security boundaries and weaken auditability.
## Conclusion

MRP-VM v0 may be embedded in servers and admin tools, but those surfaces must remain adapters around the SDK rather than substitutes for it.
