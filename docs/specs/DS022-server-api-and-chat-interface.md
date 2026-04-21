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

DS001 owns the `src/` vs `server/` directory split. DS016 owns the session/request persistence layout. DS018 owns the high-level embedding boundary. DS022 owns the concrete API contracts, the chat application behavior, and the trace-to-UI mapping. DS024 owns the detailed UX specification for each page including chat, traceability, KB browsing, and authentication-driven settings.

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
| `GET` | `/api/models` | Return the discovered model catalog and tags for settings. |
| `GET` | `/api/auth/context` | Return current caller role, auth mode, key identity, and bootstrap status. |
| `GET` | `/api/auth/keys` | List issued API keys (admin only). |
| `POST` | `/api/auth/keys` | Create an API key (admin only). |
| `DELETE` | `/api/auth/keys/:id` | Revoke an API key (admin only). |
| `POST` | `/api/auth/bootstrap-key` | Create the first bootstrap-admin API key when no keys exist yet. |

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

### UI information architecture

The repository-owned server UI must expose four primary routes:

1. `/chat`
2. `/traceability`
3. `/kb-browser`
4. `/settings`

`/chat` is the default landing page. The UI may share styles and helper modules, but each page must remain a dedicated surface with its own clear responsibility rather than collapsing all operational state into one transcript view.

The repository baseline must also expose `npm run server` as the canonical way to launch that top-level `server/` surface for local use.

HTML templates and CSS must live in server-owned files under `server/`, not in JavaScript string literals. JavaScript is responsible for interaction logic and API orchestration only.

The ordinary server startup path must not run with the fake LLM adapter. If the runtime resolves to the `fake` adapter or cannot resolve a managed provider path such as AchillesAgentLib, the server must refuse to start and report that a managed provider integration is missing. Fake-LLM operation is reserved for tests and explicit harness-level construction, not for the user-facing server entry point.

### Chat page

The chat page must behave like a modern messaging application. It should stay conversation-first, fast to scan, and free of inline operational clutter. The page must support:

1. **Session management**: create a new session, select an existing session from a compact header selector, and surface the active session identity, origin, effective role, last activity time, and status in the header rather than in a bulky first-page panel.
2. **Message input**: send natural-language requests from a fixed composer anchored at the bottom, with advanced options opened through a compact popover placed immediately before the text input and structured as a small two-level menu.
3. **Conversation rendering**: show message bubbles, timestamps, lightweight running/completed/error indicators, and an animated `Thinking...` placeholder while an assistant response is still in progress.
4. **Assistant actions**: every assistant response must expose a `Details` or `Traceability` action that opens the dedicated traceability page for that request. Copy response and retry request actions are also expected.
5. **Advanced options**: support text-file insertion into the input area, budget controls, and a small menu of predefined demo tasks that exercise distinct commands and interpreters.
6. **System context visibility**: provide a compact summary of the current authority context without moving deep trace or KB content inline.

Raw SOP Lang, trace payloads, KU lists, and execution graphs must not be shown inline on the chat page by default.

### Traceability page

The traceability page must focus on one request timeline at a time while allowing navigation across prior request or response pairs in the same session. It should present:

1. a compact request timeline with previews of the originating user request and final assistant response,
2. a dedicated detail workspace for the selected request, separate from the timeline rail,
3. exactly three primary tabs: `SOP Lang`, `Variables`, and `Execution Graph`,
4. no redundant request or outcome summary tiles above the main tab workspace,
5. node-level inspection for executed declarations, including declaration definition, resolved runtime context, selected KUs, outputs, diagnostics, retries, timing, and execution layer information.

The `Variables` tab must use a split layout:

1. a left list of families or variables,
2. a right detail area for the selected variable,
3. three nested tabs named `Current Value`, `Metadata`, and `Definition`.

The `Execution Graph` tab must render the graph as a left-to-right topological workflow with visually distinct nodes and explicit dependency arrows rather than as a flat list of edge names.

### KB Browser page

The KB Browser must be a dedicated inspection and editing surface for default, global, session, inherited, overridden, shadowed, and superseded KUs. It must support:

1. search by KU id, title, tags, type, interpreter targets, and text content,
2. filtering by scope and KU type,
3. compact summary indicators for total, default, global, session, prompt-asset, and overridden counts,
4. a closed-by-default multi-level tree rooted at `All KUs`,
5. ordered scope branches for `Default KUs`, `Global KUs`, and `Session KUs`,
6. a right-hand editor panel rather than a below-tree editor,
7. action buttons such as `Save` and `Default` placed below the editor surface,
8. direct editing and creation of session KUs,
9. direct editing and creation of global KUs under admin authority.

### Settings page

Settings must remain separate from chat. The page must expose:

1. tabbed sections for `Models`, `Interpreters`, and `Authentication`,
2. a wide layout that uses the available horizontal space instead of a narrow centered column,
3. default-model selection through select controls that show discovered model tags inline in the option labels,
4. no separate runtime-overview tab and no redundant candidate-model gallery,
5. per-interpreter enabled or disabled state rendered efficiently in one-row cards,
6. API-key management, saved-key selection, and bootstrap-admin status messaging,
7. clear permission messaging when controls are unavailable because the current authority context is not admin.

### Trace-to-UI mapping

DS014 defines the trace event types and minimum payloads. The chat UI and native API must translate those events into coherent visual presentation. The mapping is:

| DS014 Event | UI Presentation |
| --- | --- |
| `request_started` | Mark the active session as running and show an in-progress assistant placeholder. |
| `epoch_opened` | Show epoch number, ready-node count, and visible frontier summary. |
| `command_invoked` | Show which declaration is executing, which command, and execution ordinal. |
| `interpreter_invoked` | Show which external interpreter is called, adapter profile, and expected output mode. |
| `context_packaged` | Collapsible detail showing selected KUs, pruned items, and byte counts. |
| `family_resolved` | Show which family was resolved, which variant was selected, and why. Update the family state panel. |
| `variant_emitted` | Show the new variant value (truncated if long) and update the family state panel. |
| `failure_recorded` | Surface an error or repair state in the active request status, and keep the detailed failure payload on the traceability page. |
| `metadata_updated` | Show which metadata keys changed and whether the change has structural impact. |
| `analytic_memory_updated` | Collapsible detail showing updated keys and export flag. |
| `declarations_inserted` | Show the inserted declaration text (truncated), insertion source, and new declaration IDs. Update the plan panel. |
| `planning_triggered` | Show planning mode, trigger reason, and blocked-region summary. Mark request as "replanning". |
| `planning_stopped` | Show planning outcome: accepted actions, rejected actions. Return to execution view or stop view. |
| `request_stopped` | Replace the `Thinking...` placeholder with the final assistant response, show final outcome and stop reason, and persist that request in the traceability timeline. |

The chat route may stay intentionally compact, but live request state must still be driven by the trace stream rather than by speculative client-side bookkeeping. The detailed plan, variable state, and execution-graph inspection surfaces live on the dedicated traceability page, which must remain reconstructable from persisted request snapshots plus trace-derived status updates when a user reconnects mid-request.

### Authentication, session origin, and authority

The server must distinguish admin sessions from ordinary user sessions and must persist at least:

1. `session_origin`
2. `auth_mode`
3. `effective_role`
4. owner or key identity when applicable

Recommended origin values are `client`, `openai_api`, and `internal`. Recommended auth modes are `bootstrap_admin`, `api_key`, `anonymous`, and `internal`.

The server must support API-key creation and management. Each API key has an explicit role of `admin` or `user`. If the system has no API keys configured, the first browser login may create a bootstrap-admin API key and store it locally so first-run setup can complete coherently. Once API keys exist, protected operations must require API-key-backed authority rather than silent trust in the browser UI alone.
The bootstrap step is a one-time first-run flow. After it completes, future browsers and logged-out states should present ordinary API-key login only, not the bootstrap controls.
The UI should present the active API key in masked form together with `Copy` and `Logout` actions. Server-issued key inventory may expose ids, roles, timestamps, and token prefixes, but full API keys are only available at creation time or from browser-saved local copies.

An admin session:

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

Authority is determined through the session's persisted auth metadata and any authenticated API key used to create or reuse that session. The server must include the session's role and auth metadata in `request_started` payloads for audit purposes.

When API keys exist, the UI should prompt the user to choose or paste a saved API key on load, with local autocomplete over previously stored keys. Switching keys must switch the effective role for future sessions and protected operations.

### Streaming protocol

The `/api/sessions/:id/requests/:rid/stream` endpoint must use Server-Sent Events (SSE) for simplicity. Each SSE event must carry:

1. the DS014 event type as the SSE `event` field,
2. the full event payload as JSON in the SSE `data` field,
3. the event ordinal as a numeric `id` field for reconnection.

The client may send a `Last-Event-ID` header to resume from a specific point. The server must buffer the last N events per request for reconnection support, where N is configurable but defaults to 100.
Because standard browser `EventSource` clients cannot attach arbitrary custom headers, the server may also accept the API key through an `api_key` query parameter for this SSE route when API-key-backed authority is required.

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

Question #8: Should bootstrap-admin authority disappear immediately after the first API key is created?

Response: Keep bootstrap-admin authority alive for the claiming session lifetime so first-run setup can complete coherently, but treat API-key-backed roles as the preferred long-lived operational model once keys exist.

Question #9: Should chat remain available without an API key after the system has API keys configured?

Response: Allow anonymous chat-only sessions, but continue to require admin-backed authority for protected operations such as global settings, global KB changes, and API-key management. This preserves low-friction exploration while keeping shared state protected.

## Conclusion

MRP-VM v0 must expose its execution surfaces through a clean SDK, a native API for full functionality, an optional OpenAI-compatible API for integration convenience, and a server-owned four-page UI that keeps chat simple while moving deep inspection, KB tuning, settings, and authority management into dedicated operational surfaces. Trace events from DS014 remain the single source of truth for execution presentation.
