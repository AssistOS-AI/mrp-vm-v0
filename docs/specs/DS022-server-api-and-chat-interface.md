---
id: DS022
title: Server, API, and Chat Interface
status: implemented
owner: runtime
summary: Defines the SDK entry points, session executor lifecycle, native and compatibility APIs, the top-level server/ adapter, the /chat application, admin boundaries, and how DS014 trace events drive UI presentation.
---

# DS022 Server, API, and Chat Interface

## Introduction

This specification defines the hosting and interaction surfaces of MRP-VM v0. The runtime core is SDK-first and embeddable. The server, APIs, and chat UI are adapters around that SDK, not substitutes for it. This DS also defines how trace events from DS014 become coherent UI presentation so users can see the current plan, family state, and execution progress in real time.

DS001 owns the `src/` vs `server/` directory split. DS016 owns the session/request persistence layout. DS018 owns the high-level embedding boundary. DS022 owns the concrete API contracts, the chat application behavior, and the trace-to-UI mapping.

## Core Content

### SDK entry points

The SDK under `src/` must expose at least these entry points to any host process:

| Entry point | Purpose |
| --- | --- |
| `createRuntime(config)` | Instantiate the runtime core with commands, interpreters, KB roots, and policies. |
| `createSession(runtime, sessionConfig)` | Create or reload a session with its executor, KU overlay, and trace writer. |
| `submitRequest(session, requestEnvelope)` | Submit one bounded request into the session and receive the outcome stream. |
| `inspectSession(session)` | Return current graph, family state, active KUs, epoch counter, and plan snapshot. |
| `closeSession(session)` | Flush trace, persist final state, and release executor resources. |

The runtime must not depend on HTTP, chat, or any transport layer. All hosting surfaces call these SDK entry points.

The repository-owned HTTP and chat adapter must live under top-level `server/`, while `src/` exports only SDK-facing modules and helper APIs.

### Session executor

A session executor is a runtime object that owns:

1. the session identity and policy context,
2. the session-scoped KU overlay loaded from `data/sessions/<sessionId>/kb/`,
3. the active trace writer pointing to `data/sessions/<sessionId>/trace/session.jsonl`,
4. the current request state machine (idle, planning, executing, stopped),
5. the family representative cache for the active request,
6. the analytic-memory checkpoint store when policy allows cross-request persistence,
7. a compact request-summary index for retrieval hints.

The executor must be cacheable in memory by `session_id`. When evicted, it must be reconstructable from the session files defined in DS016 without losing session identity, trace continuity, or persisted checkpoints. The server layer manages eviction; the SDK only guarantees serializability and reloadability.

Only one request may be scheduler-active in a session at a time. Concurrent requests to the same session must queue or reject with a clear status code.

### Native MRP-VM API

The server must expose a native programmatic API for full MRP-VM functionality. The minimum endpoint set is:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/sessions` | Create a new session. Returns `session_id`. |
| `GET` | `/api/sessions` | List sessions visible to the current caller. |
| `GET` | `/api/sessions/:id` | Inspect session state: identity, policy, active request pointer, KU overlay summary. |
| `POST` | `/api/sessions/:id/requests` | Submit a request (natural language + optional files). Returns `request_id`. |
| `GET` | `/api/sessions/:id/requests/:rid` | Get request outcome and final family state. |
| `GET` | `/api/sessions/:id/requests/:rid/plan` | Get the current accepted plan snapshot (`current-plan.sop` content). |
| `GET` | `/api/sessions/:id/requests/:rid/state` | Get current family state: families, variants, representatives, statuses. |
| `GET` | `/api/sessions/:id/requests/:rid/trace` | Get trace events for this request, optionally filtered by event type. |
| `GET` | `/api/sessions/:id/requests/:rid/stream` | SSE or WebSocket stream of live trace events for the active request. |
| `GET` | `/api/sessions/:id/kb` | List session-scoped KUs. |
| `POST` | `/api/sessions/:id/kb` | Upsert a session KU (create, fork, or update). |
| `POST` | `/api/kb/promote` | Promote a session KU to global scope (admin only). |
| `GET` | `/api/kb/global` | List global KUs. |
| `GET` | `/api/config` | Get current VM configuration: active interpreters, LLM mappings, policies. |
| `PUT` | `/api/config` | Update VM configuration (admin only). |

All native API responses must be JSON. The request submission endpoint accepts JSON bodies for ordinary requests and multipart form data when attached files are present.

### OpenAI-compatible API

The server may expose a compatibility endpoint at `/v1/chat/completions` to lower integration friction for existing tooling. This endpoint translates chat-completion requests into MRP-VM request envelopes and returns the final `response` family value as a chat-completion response.

The compatibility layer must:

1. map the `model` parameter to the configured default LLM or a named interpreter profile,
2. translate the `messages` array into the natural-language request text,
3. create or reuse a session based on a custom `session_id` header or equivalent session header when provided,
4. submit the request through the SDK and wait for the `response` family to be populated,
5. return the `response` value as the `content` field of the completion response.

The compatibility layer must not expose MRP-VM's internal structure (families, epochs, trace, planning). It is a thin translation surface, not a full MRP-VM API. Clients that need plan inspection, family state, or trace must use the native API.

### /chat application

The server must serve a `/chat` endpoint that returns a self-contained HTML application. The application must be simple, pleasant, and sufficient for direct use without external tooling.

The chat UI must support:

1. **Session management**: create a new session, select an existing session, see session identity and status.
2. **Message input**: send natural-language requests with optional file attachments.
3. **Live execution view**: while a request is executing, show the current plan, family state, and trace events in real time via SSE stream.
4. **Request history**: display completed requests for the current session with their outcomes and response values.
5. **Options panel**: edit VM options that influence execution, including:
   - default LLM selection,
   - interpreter-to-LLM-class mapping (e.g., `fastLLM` → `gpt-4o-mini`, `deepLLM` → `gpt-4o`),
   - budget overrides (step budget, planning budget),
   - policy toggles (allow session KU promotion, enable analytic-memory cross-request persistence).

The chat UI must prioritize three things over raw transcript history:

1. the current accepted plan (`current-plan.sop` rendered as a readable declaration list),
2. the current family state (families with their active representative values and statuses),
3. the latest request outcome (the `response` family value plus any blocked regions or errors).

Session history is available but secondary. The user should be able to understand what the runtime is doing right now without scrolling through a conversation log.

The repository baseline keeps the chat application self-contained inside `server/` with no external UI dependencies.

### Trace-to-UI mapping

DS014 defines the trace event types and minimum payloads. The chat UI and native API must translate those events into coherent visual presentation. The mapping is:

| DS014 Event | UI Presentation |
| --- | --- |
| `request_started` | Show request metadata, budgets, and initial planning mode. Mark request as "planning". |
| `epoch_opened` | Show epoch number, ready-node count, and visible frontier summary. |
| `command_invoked` | Show which declaration is executing, which command, and execution ordinal. |
| `interpreter_invoked` | Show which external interpreter is called, adapter profile, and expected output mode. |
| `context_packaged` | Collapsible detail showing selected KUs, pruned items, and byte counts. |
| `family_resolved` | Show which family was resolved, which variant was selected, and why. Update the family state panel. |
| `variant_emitted` | Show the new variant value (truncated if long) and update the family state panel. |
| `failure_recorded` | Show failure kind, affected family, repairable flag, and originating component. Mark the family as error/blocked in the state panel. |
| `metadata_updated` | Show which metadata keys changed and whether the change has structural impact. |
| `analytic_memory_updated` | Collapsible detail showing updated keys and export flag. |
| `declarations_inserted` | Show the inserted declaration text (truncated), insertion source, and new declaration IDs. Update the plan panel. |
| `planning_triggered` | Show planning mode, trigger reason, and blocked-region summary. Mark request as "replanning". |
| `planning_stopped` | Show planning outcome: accepted actions, rejected actions. Return to execution view or stop view. |
| `request_stopped` | Show final outcome, stop reason, remaining blocked regions. Display the `response` family value prominently. |

The UI must maintain three synchronized panels during execution:

1. **Plan panel**: the current accepted SOP plan, updated when `declarations_inserted` or `planning_stopped` events arrive.
2. **State panel**: the current family state (family name, active representative value, status), updated when `variant_emitted`, `family_resolved`, `metadata_updated`, or `failure_recorded` events arrive.
3. **Trace panel**: a chronological log of trace events with collapsible detail, updated on every event.

The trace stream is the single source of truth for UI updates. The UI must not maintain independent state that diverges from the trace. If the UI reconnects to a session mid-request, it must replay the trace from the last known event to reconstruct the current plan and state.

### Admin session model

The server must distinguish admin sessions from ordinary user sessions. An admin session:

1. may promote session KUs to global scope,
2. may update global KB content,
3. may override VM configuration,
4. may inspect any session's trace and state,
5. may perform destructive cleanup (session deletion, trace truncation).

A non-admin session:

1. may create and use session-scoped KUs,
2. may fork global KUs into session scope,
3. may submit requests and inspect its own session state,
4. may not promote, modify, or delete global KB content,
5. may not inspect other sessions.

Admin status is determined at session creation time through an explicit flag or authentication token. The SDK must enforce these boundaries at the API level, not only in the UI. The server must include the session's admin status in every trace event's `request_started` payload for audit purposes.

### Streaming protocol

The `/api/sessions/:id/requests/:rid/stream` endpoint must use Server-Sent Events (SSE) for simplicity. Each SSE event must carry:

1. the DS014 event type as the SSE `event` field,
2. the full event payload as JSON in the SSE `data` field,
3. the event ordinal as a numeric `id` field for reconnection.

The client may send a `Last-Event-ID` header to resume from a specific point. The server must buffer the last N events per request for reconnection support, where N is configurable but defaults to 100.

## Decisions & Questions

Question #1: Why does the SDK expose `createSession` and `submitRequest` as separate entry points instead of one `execute` call?

Response: Sessions are long-lived containers that may host many requests over time. Separating session creation from request submission preserves session continuity, KU overlay persistence, and executor caching. A single `execute` call would force session reconstruction on every request.

Question #2: Why does the OpenAI-compatible API not expose MRP-VM's internal structure?

Response: The compatibility layer exists for integration convenience, not for architectural transparency. Exposing families, epochs, and trace through a chat-completion-shaped response would distort both the MRP-VM model and the OpenAI model. Clients that need full visibility must use the native API.

Question #3: Why must the chat UI prioritize plan and state over transcript history?

Response: MRP-VM's value is in explicit, inspectable execution. A transcript-only view would hide the plan, the family state, and the trace — the very things that make the system auditable. The UI should show what the runtime is doing, not just what it said.

Question #4: Why does the trace-to-UI mapping require the UI to use trace as the single source of truth?

Response: If the UI maintained independent state, it could diverge from the actual runtime state after errors, reconnections, or mid-request joins. Trace replay guarantees that the UI always reflects the authoritative execution record.

Question #5: Should the streaming protocol use SSE or WebSocket?

Response: Use SSE for simplicity and HTTP compatibility.
Implications: SSE is unidirectional (server-to-client), which is sufficient for trace streaming. It works through standard HTTP proxies and requires no special WebSocket infrastructure.

Question #6: Should the chat UI support multiple concurrent session tabs?

Response:  Allow multiple session tabs in the same browser window.
Implications: This supports power users who monitor several sessions, but it increases UI complexity and requires careful state isolation per tab.

Question #7: Why must admin boundaries be enforced at the SDK level and not only in the UI?

Response: UI-level restrictions are trivially bypassed. Admin operations such as KU promotion, config override, and session deletion affect shared state and must be gated by the runtime's capability system. The UI should only reflect boundaries that the SDK already enforces.

## Conclusion

MRP-VM v0 must expose its execution surfaces through a clean SDK, a native API for full functionality, an optional OpenAI-compatible API for integration convenience, and a chat UI that prioritizes plan and state visibility over transcript history. Trace events from DS014 are the single source of truth for all UI presentation, ensuring that what the user sees matches what the runtime actually did.
