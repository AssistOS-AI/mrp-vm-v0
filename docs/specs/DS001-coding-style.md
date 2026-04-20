---
id: DS001
title: Coding Style
status: implemented
owner: repository
summary: Defines source layout, module boundaries, documentation rules, and DS authoring structure for MRP-VM v0.
---
# DS001 Coding Style

## Introduction

This file is the coding-style authority for the repository. All future implementation work, test layout, project documentation, and DS maintenance must follow this document unless a later DS defines a narrower subsystem rule.

The repository now contains the runtime source tree, default KU assets, and the native test suite. The coding style remains the authority that keeps future implementation work aligned with the DS boundaries rather than drifting into ad hoc structure.

## Core Content

The planned implementation must target Node.js with ECMAScript modules and `.mjs` files in the runtime core unless an external boundary forces a different file extension. The preferred minimal project layout is:

| Path | Role |
| --- | --- |
| `src/` | Reusable runtime SDK modules. |
| `server/` | Optional HTTP or admin hosting layer that embeds the SDK rather than defining it. |
| `tests/` | Modular subsystem tests and evaluation fixtures. |
| `data/` | Default KUs, fixtures, and persistent runtime data that belong to the product. |
| `docs/` | Product documentation and DS specifications for MRP-VM v0. |
| `scripts/` | Repository maintenance and validation utilities. |

Modules must follow a single dominant responsibility. Parser code must not mix with storage code. Session orchestration must not mix with HTTP hosting. Provider adapters must not mix with UI logic. When the source tree is created, a healthy top-level split will typically include `src/lang`, `src/runtime`, `src/session`, `src/commands`, `src/interpreters`, `src/storage`, `src/policies`, and `src/utils`.

All asynchronous public code must use `async` and `await`. Public APIs based on callback style or dense `.then()` chains should be avoided. The codebase should favor standard-library dependencies first and require strong justification for heavy third-party dependencies.

The codebase should explicitly prefer SRP, YAGNI, and pragmatic SOLID over speculative abstraction. First implementation work should solve the documented runtime contract with small modules and narrow interfaces rather than building a generalized framework around imagined future needs.

Tests must mirror subsystem boundaries. Parser tests, scheduler tests, command tests, knowledge-store tests, wrapper tests, and replay tests should remain separate so failures are easy to localize. Golden traces are permitted only when trace stability is part of the behavior under test; otherwise semantic-state assertions plus selected trace assertions are preferred. The baseline test runner for v0 should be the Node.js native test runner, invoked through repository-owned `.mjs` entry points rather than through external framework conventions.

The default repository-owned test entry point should be `run.mjs` at project root unless a later DS or implementation constraint forces a different name.

Product-owned runtime data should default to this layout:

1. `data/default/kus/` for bootstrap KUs and prompt assets.
2. `data/default/callers/` for default caller-profile KUs.
3. `data/kb/global/` for global curated KB artifacts.
4. `data/sessions/<sessionId>/manifest.json` for session identity and policy state.
5. `data/sessions/<sessionId>/trace/` for unified session trace streams.
6. `data/sessions/<sessionId>/kb/` for session overlay KUs.
7. `data/sessions/<sessionId>/history/` for compact request summaries.
8. `data/sessions/<sessionId>/requests/<requestId>/` for `current-plan.sop`, request state, family-state files, and final outcome artifacts.

DS001 provides the repository-level summary of that layout. DS011 owns the detailed KB and caller-profile subtrees, while DS016 owns the detailed session, request, plan, and family-state layout.

Project documentation under `docs/` must stay product-scoped. External authoring helpers or bootstrap tooling must not receive product DS files or HTML pages inside the project documentation set, even when they are present in the repository for development use.

Every ordinary DS file must use this section structure:

1. `Introduction`
2. `Core Content`
3. `Decisions & Questions`
4. `Conclusion`

The `Decisions & Questions` section must use one of these patterns:

- `Question #n:` followed by `Response:` for a decided point.
- `Question #n:` followed by `Options:` and numbered options for an unresolved point.

## Decisions & Questions

Question #1: Why does DS001 prescribe an explicit runtime, storage, and hosting tree instead of leaving repository structure open?

Response: The architecture already distinguishes language parsing, graph execution, session management, commands, interpreters, storage, hosting, and tests as separate concerns. Naming those areas early prevents ad hoc structure from drifting away from the DS boundaries before implementation stabilizes.

## Conclusion

MRP-VM v0 must be implemented with small modules, explicit responsibilities, synchronized documentation, and a DS structure that records decisions and unresolved questions in a stable, auditable format.
