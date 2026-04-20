# MRP-VM v0 — Implementation vs Specification Audit

> Generated: 2026-04-20
> Scope: Comparison between DS000–DS022 specifications and actual `src/` code
> Focus: What's implemented, what's missing, what's wrong, what should change

---

## SECTION 1 — Implementation Coverage Matrix

### SDK Entry Points (DS022)

| DS022 Entry Point | Implemented | Notes |
|---|---|---|
| `createRuntime(config)` | ✅ `src/index.mjs:10` — `createRuntime(rootDir, options)` | Works, but takes `rootDir` not `config` object |
| `createSession(runtime, sessionConfig)` | ❌ Missing | `MRPVM.bootstrapSession()` exists but is not exported from index |
| `submitRequest(session, requestEnvelope)` | ✅ `MRPVM.submitRequest(input)` | Exists but takes `input` object, not `(session, envelope)` |
| `inspectSession(session)` | ✅ `MRPVM.inspect()` | Returns graph, epoch, cache, history, context, plan |
| `closeSession(session)` | ❌ Missing | No session teardown/close API |

**Verdict:** 3/5 entry points exist but with different signatures than DS022 specifies.

### SOP Lang Parser (DS003)

| DS003 Requirement | Implemented | Notes |
|---|---|---|
| Parse declaration lines `@target command` | ✅ `parser.mjs:14-53` | Correct grammar |
| Parse `|` fallback | ✅ `parser.mjs:22-35` | Correct |
| Parse `&` multi-attempt | ✅ `parser.mjs:23-35` | Correct |
| Reject mixed `|` and `&` | ✅ `parser.mjs:25-33` | Correct |
| Body extraction byte-for-byte | ✅ `parser.mjs:103-104` | Correct |
| Reference scanning (`$`, `~`) | ✅ `references.mjs:1-91` | With comment/quote awareness |
| Parse error shape (line, column, kind, message, fragment) | ✅ `parser.mjs:4-11` | Correct |
| `parseSopModule` for KU files | ✅ `parser.mjs:141-215` | With `"""` support |
| `renderSopModule` | ✅ `parser.mjs:217-231` | Correct |
| Identifier validation | ✅ `identifiers.mjs` | Family, command, variable patterns |

**Verdict:** 10/10 — Parser is well implemented and matches DS003.

### Graph Compilation (DS002)

| DS002 Requirement | Implemented | Notes |
|---|---|---|
| One node per declaration | ✅ `graph.mjs:42-66` | Correct |
| Dependency edges from `$`/`~` references | ✅ `graph.mjs:68-85` | Correct |
| Reject static cycles | ✅ `graph.mjs:35-37` | Topological sort detects cycles |
| Topological ordering into strata | ✅ `graph.mjs:87-104` | Correct strata computation |
| Unknown family refs → external dependencies | ✅ `graph.mjs:72-75` | Correct |

**Verdict:** 5/5 — Graph compilation is solid.

### State Store / Family Model (DS002)

| DS002 Requirement | Implemented | Notes |
|---|---|---|
| Families with variants (`x:v1`, `x:v2`) | ✅ `state-store.mjs:65-84` | Monotonic versioning |
| `x:meta` family metadata | ✅ `state-store.mjs:8-12` | `familyMeta` object |
| `x:vN:meta` variant metadata | ✅ `state-store.mjs:76-78` | Per-variant meta |
| `emitVariant` (append, not overwrite) | ✅ `state-store.mjs:65-84` | Correct |
| `patchMetadata` | ✅ `state-store.mjs:86-108` | Handles both family and variant meta |
| `withdraw` | ✅ `state-store.mjs:110-116` | Sets status=withdrawn |
| Representative resolution with cache | ✅ `state-store.mjs:126-147` | Caches per family |
| Plural family → credibility callback | ✅ `state-store.mjs:138-143` | Calls `resolvePluralFamily` |
| `resolveReference` (`$x` vs `~x`) | ✅ `state-store.mjs:149-160` | Exact vs representative |
| `recordFailure` | ✅ `state-store.mjs:162-173` | Emits failure variant |

**Verdict:** 10/10 — State store is complete.

### Epoch Control & Execution (DS002)

| DS002 Requirement | Implemented | Notes |
|---|---|---|
| Epoch lifecycle (open → ready → dispatch → buffer → apply) | ⚠️ Partial | `openEpoch` exists, but no separate buffer/apply phase |
| Structural effects close epoch | ✅ `vm.mjs:508-530` | `hasStructuralEffects` triggers recompilation |
| Budget tracking (wall-clock, steps, planning, structural) | ✅ `vm.mjs:24-31` | All 4 budgets tracked |
| Parallel execution within stratum | ❌ Missing | `vm.mjs:452` executes ready nodes sequentially in a `for` loop |
| Transactional branch buffering | ❌ Missing | Effects are applied immediately via `applyEffects`, not buffered per-branch |
| Deterministic effect ordering | ⚠️ Partial | Sequential execution provides ordering but not by scheduler ordinal |

**Verdict:** 3/6 — Epoch control exists but parallel execution and transactional buffering are missing.

### Commands (DS007–DS012)

| Command | DS Spec | Implemented | Coverage |
|---|---|---|---|
| `js-eval` (DS007) | Full spec | ✅ `commands/js-eval.mjs` | ~80% |
| `logic-eval` (DS008) | Full spec | ✅ `commands/logic-eval.mjs` | ~85% |
| `template-eval` (DS009) | Full spec | ✅ `commands/template-eval.mjs` | ~75% |
| `analytic-memory` (DS010) | Full spec | ✅ `commands/analytic-memory.mjs` | ~70% |
| `kb` (DS011) | Full spec | ✅ `commands/kb.mjs` | ~30% |
| `credibility` (DS012) | Full spec | ✅ `commands/credibility.mjs` | ~60% |
| `planning` (DS006) | Full spec | ✅ `commands/planning.mjs` | ~50% |

**Command Details:**

**js-eval** — Proxy with `get()`, `meta()`, `exists()`, `set()`, `patchMeta()`, `withdraw()`, `family()`, `id()`. Property access via Proxy. `sop` helper with `ref()`, `emit()`, `fail()`, `insertDeclarations()`, `now()`. Uses `node:vm` with 1s timeout. Missing: isolated-process sandbox (uses in-process `vm` instead).

**logic-eval** — Parses `use`, `when/then`, `and/or`. Predicates: `exists`, `not exists`, `value ==/!=/</>/<=/>=`, `contains`, `matches`, `any/all in where`. Actions: `set`, `patch-meta`, `score`, `withdraw`, `emit error`, `insert declarations`. Missing: `any/all` only does string `.includes()`, not full predicate nesting.

**template-eval** — Handlebars-like: `{{expr}}`, `{{#if}}`, `{{#each}}`, `{{join}}`, `{{default}}`, `{{truncate}}`, `{{formatDate}}`, `{{formatNumber}}`. Missing: required vs optional placeholder distinction (all missing placeholders fail).

**analytic-memory** — Instructions: `store`, `append`, `merge`, `derive`, `rollup`, `export`. Wildcard matching. Aggregates: `count`, `sum`, `average`, `min`, `max`. Missing: `group`, `rank`, `threshold flagging`, streaming/chunking.

**kb** — Very thin. Only does explicit query retrieval. Missing: upsert, revision management, session overlay, promotion, caller-profile resolution, metadata induction.

**credibility** — Heuristic scoring (score + trust + priority + length). Withdraws non-winners. Can insert evidence-gathering declarations. `resolvePluralFamily` applies effects and returns best candidate. Missing: LLM-based comparison, template rubrics, `logic-eval` checks, KU-defined evaluation procedures.

**planning** — Retrieves required prompt group, invokes `plannerLLM`, extracts declaration insertions. Three modes with separate required groups. Missing: mode-specific context differences, graph snapshot input, family state summary, repair attempt tracking, stop recommendations.

### Storage Layer

| Component | Implemented | Notes |
|---|---|---|
| `KbStore` | ✅ | Retrieve, snapshot |
| `TraceStore` | ✅ | Append-only JSONL |
| `AnalyticStore` | ✅ | In-memory with checkpoint |
| `FileStore` | ✅ | Generic file I/O |
| Session persistence | ⚠️ Partial | `SessionManager` and `RequestManager` exist but family-state file layout from DS016 not fully implemented |

### Server & API (DS022)

| DS022 API Endpoint | Implemented | Notes |
|---|---|---|
| `POST /api/sessions` | ❌ | Not implemented |
| `GET /api/sessions` | ❌ | Not implemented |
| `GET /api/sessions/:id` | ❌ | Not implemented |
| `POST /api/sessions/:id/requests` | ❌ | Only `POST /api/requests` exists |
| `GET /api/sessions/:id/requests/:rid` | ❌ | Not implemented |
| `GET /api/sessions/:id/requests/:rid/plan` | ❌ | Not implemented |
| `GET /api/sessions/:id/requests/:rid/state` | ❌ | Not implemented |
| `GET /api/sessions/:id/requests/:rid/trace` | ❌ | Not implemented |
| `GET /api/sessions/:id/requests/:rid/stream` | ❌ | Not implemented |
| `GET /api/sessions/:id/kb` | ❌ | Not implemented |
| `POST /api/sessions/:id/kb` | ❌ | Not implemented |
| `POST /api/kb/promote` | ❌ | Not implemented |
| `GET /api/kb/global` | ❌ | Not implemented |
| `GET /api/config` | ❌ | Not implemented |
| `PUT /api/config` | ❌ | Not implemented |
| `POST /v1/chat/completions` | ✅ | Basic translation |
| `GET /api/inspect` | ✅ | Returns `runtime.inspect()` |
| `/chat` HTML app | ❌ | Not implemented |
| Admin session model | ❌ | Not implemented |
| SSE streaming | ❌ | Not implemented |

**Verdict:** 2/18 — Server is a thin skeleton with only 3 endpoints.

### Trace (DS014)

| DS014 Event | Emitted in Code | Notes |
|---|---|---|
| `request_started` | ✅ `vm.mjs:401` | Present |
| `epoch_opened` | ✅ `vm.mjs:309` | Present |
| `command_invoked` | ✅ `vm.mjs:245` | Present |
| `interpreter_invoked` | ✅ `vm.mjs:245` | Present |
| `context_packaged` | ✅ `vm.mjs:260` | Present |
| `family_resolved` | ❌ | Not emitted |
| `variant_emitted` | ✅ `vm.mjs:463` | Present |
| `failure_recorded` | ✅ `vm.mjs:485` | Present |
| `metadata_updated` | ✅ `vm.mjs:474` | Present |
| `analytic_memory_updated` | ✅ `vm.mjs:512` | Present |
| `declarations_inserted` | ✅ `vm.mjs:498` | Present |
| `planning_triggered` | ❌ | Not emitted |
| `planning_stopped` | ❌ | Not emitted |
| `request_stopped` | ✅ `vm.mjs:550` | Present |

**Verdict:** 10/14 — Most events emitted, 4 missing.

### Tests

| Test Area | Files | Status |
|---|---|---|
| Parser | `tests/lang/parser.test.mjs` | ✅ |
| Graph | `tests/runtime/graph.test.mjs` | ✅ |
| Runtime | `tests/runtime/runtime.test.mjs` | ✅ |
| Commands (all 6) | `tests/commands/*/` | ✅ |
| Interpreters | `tests/interpreters/external-interpreter.test.mjs` | ✅ |
| Server | `tests/server/server.test.mjs` | ✅ |
| Integration/Evaluation | `tests/integration/evaluation.test.mjs` | ✅ |
| Fixtures | `tests/fixtures/runtime-root.mjs` | ✅ |

**Verdict:** Test coverage exists for all major subsystems. Good.

---

## SECTION 2 — What's Wrong or Non-Compliant

### 2.1 `js-eval` Uses In-Process `vm` Instead of Isolated Process

**DS004** (even as proposal) and **DS007** specify isolated-process execution with structured RPC. The code uses `node:vm` with a 1-second timeout (`js-eval.mjs:178-184`). `node:vm` is not a security boundary — it can escape via prototype pollution, constructor access, etc.

**Impact:** Security baseline is weaker than specified.

### 2.2 No Parallel Execution

**DS002:121-122** says "Dispatch them, potentially in parallel." **DS002:139** says "declarations in the same topological stratum may run in parallel." The code executes sequentially in a `for` loop (`vm.mjs:452`).

**Impact:** Performance is correct but slower than specified. Not a correctness issue for v0, but should be noted.

### 2.3 No Transactional Branch Buffering

**DS002:123-124** says "Buffer branch-local effects transactionally" and "If the branch ends in failure before successful completion, the branch-local buffered variants... must be discarded." The code applies effects immediately via `applyEffects` (`vm.mjs:455`).

**Impact:** A failed command may have already emitted variants that persist. This violates the append-only integrity model.

### 2.4 `kb` Command Is Extremely Thin

**DS011** specifies a comprehensive KB with upsert, revision management, session overlay, promotion, caller-profile resolution, and two retrieval paths. The implementation (`commands/kb.mjs:1-34`) is 34 lines that only does explicit query retrieval. No upsert, no revision, no session overlay, no promotion.

**Impact:** The KB is the most underspecified component in the implementation relative to its spec.

### 2.5 Planning Uses Fake LLM Adapter by Default

**DS006** specifies LLM-assisted planning with KU-managed prompt assets. The default registry (`vm.mjs:46-65`) registers `FakeLlmAdapter` for all profiles. Planning will work in test mode but produces no real SOP declarations without a real LLM adapter.

**Impact:** This is intentional for testability (DS015), but should be documented.

### 2.6 Server Is Not in `server/` Directory

**DS001:23** says `server/` is "Optional HTTP or admin hosting layer." The server code lives in `src/server/create-server.mjs` instead of `server/`. The `server/` directory at root doesn't exist.

**Impact:** Violates the directory structure convention.

### 2.7 `data/` Structure Incomplete

**DS001:39-48** and **DS011:107-117** specify:
- `data/default/kus/**/*.sop` — exists (empty)
- `data/default/callers/*.sop` — ❌ missing
- `data/kb/global/**/*.sop` — exists (empty)
- `data/sessions/` — ❌ missing (created at runtime)

**Impact:** No default caller-profile KUs exist. No bootstrap planning prompt assets.

### 2.8 No `/chat` Application

**DS018:43** and **DS022** specify a `/chat` HTML application. Nothing exists.

### 2.9 No Admin Session Model

**DS018:33-35** and **DS022** specify admin vs non-admin session distinction. No implementation.

### 2.10 No Session Executor Caching/Eviction

**DS018:29-31** and **DS022** specify session executor caching with eviction and reconstruction. The `SessionManager` loads/creates sessions but has no cache layer.

---

## SECTION 3 — What Should Change (Not Wrong, But Not Aligned)

### 3.1 SDK Entry Point Signatures Don't Match DS022

DS022 specifies `createRuntime(config)`, `createSession(runtime, sessionConfig)`, `submitRequest(session, requestEnvelope)`. The actual API is `createRuntime(rootDir, options)`, `MRPVM.submitRequest(input)`. The signatures work but don't match the documented contract.

### 3.2 `MRPVM` Class Is Not Exported as Named Export in a Clean Way

`src/index.mjs:10` exports both `createRuntime` and `MRPVM`. DS022 doesn't mention `MRPVM` class — it only mentions factory functions. The class is useful for testing but shouldn't be the primary public API.

### 3.3 `submitRequest` Doesn't Return a Stream

DS022 specifies SSE streaming for live trace events. `submitRequest` returns a Promise with the final outcome only. No streaming API exists.

### 3.4 Planning Context Package Is JSON String, Not Markdown

DS005 specifies the context package as "deterministic Markdown package with stable top-level sections." The planning command (`planning.mjs:48-55`) passes `contextPackage.markdown` as `JSON.stringify({...})`. This is JSON, not Markdown.

### 3.5 `findReadyNodes` Only Returns One Stratum

`vm.mjs:322-348` finds ready nodes but breaks after the first stratum that has ready nodes (`break` at line 344). DS002 says "All ready declarations in the same topological stratum may be dispatched in parallel." The code finds them but doesn't dispatch them in parallel.

### 3.6 `|` Fallback Doesn't Check "Acceptable" Correctly

`vm.mjs:209` checks `acceptable` as `effects.emittedVariants.some((entry) => entry.familyId === node.targetFamily) && !effects.failure`. This means any emitted variant counts as acceptable, even if it's an error variant. DS002 says "A branch is acceptable when it emits at least one non-withdrawn concrete variant for the target family and does not terminate in refusal or error."

### 3.7 No `group`, `rank`, `threshold flagging` in analytic-memory

DS010 specifies these operations. The implementation only has `store`, `append`, `merge`, `derive`, `rollup`, `export`.

### 3.8 Credibility Uses Heuristic Scoring Only

DS012 specifies that credibility "may use local heuristics, `logic-eval` checks, template-based rubrics, stronger LLM wrappers, KU-defined evaluation procedures." The implementation only uses a `baseScore` heuristic (score + trust + priority + value length).

### 3.9 No `data/default/callers/` Default Caller Profiles

DS011:48 says "Caller profiles and capability declarations for native commands and external interpreters must also be represented as default KUs." No such files exist.

### 3.10 `response` Family Fallback Is Hardcoded

`vm.mjs:429-431` says `if (!request.planText.includes('@response')) { request.planText = `@response writerLLM\n${request.requestText}\n`; }`. This is a hardcoded fallback that should come from a default KU or planning prompt asset.

---

## SECTION 4 — Maturity Assessment

### Overall Implementation Coverage

| Area | Spec Coverage | Implementation Coverage | Maturity |
|---|---|---|---|
| SOP Lang Parser | DS003 (100%) | ~95% | **High** |
| Graph Compilation | DS002 (100%) | ~95% | **High** |
| Family State Model | DS002 (100%) | ~95% | **High** |
| Epoch Control | DS002 (100%) | ~50% | **Medium** |
| js-eval | DS007 (100%) | ~80% | **Medium-High** |
| logic-eval | DS008 (100%) | ~85% | **Medium-High** |
| template-eval | DS009 (100%) | ~75% | **Medium** |
| analytic-memory | DS010 (100%) | ~70% | **Medium** |
| kb | DS011 (100%) | ~30% | **Low** |
| credibility | DS012 (100%) | ~60% | **Medium** |
| planning | DS006 (100%) | ~50% | **Medium** |
| Trace | DS014 (100%) | ~70% | **Medium** |
| Server/API | DS022 (100%) | ~10% | **Low** |
| Chat UI | DS022 (100%) | 0% | **None** |
| Admin Model | DS018/DS022 (100%) | 0% | **None** |
| Testability | DS015 (100%) | ~80% | **Medium-High** |
| Evaluation | DS019 (100%) | ~40% | **Low-Medium** |

### What's Ready for Use

- **Parser + Graph + State Store** — solid, can parse SOP plans, build dependency graphs, manage family state
- **All 7 commands** — functional but with varying depth
- **Test infrastructure** — tests exist for all subsystems
- **Basic request lifecycle** — submit → plan → execute → respond works end-to-end with fake LLM

### What's Not Ready

- **KB** — only explicit query retrieval, no upsert/revision/promotion
- **Server** — 3 endpoints only, no session management, no streaming
- **Chat UI** — doesn't exist
- **Admin** — doesn't exist
- **Parallel execution** — not implemented
- **Transactional buffering** — not implemented
- **Isolated-process sandbox** — uses `node:vm` instead

### Can You Start Implementing Against These Specs?

**Yes, but with caveats:**

1. The specs are mature and consistent — no architectural contradictions remain
2. The existing code is a solid foundation (~50% of v0 is implemented)
3. The biggest gaps are KB (needs ~70% more work) and Server/API (needs ~90% more work)
4. The ~26 redundant questions in DS files should be cleaned up first to avoid confusing coding agents
5. DS004 (security) being `proposed` means the sandbox decision needs to be made before js-eval hardening

---

## SECTION 5 — Recommended Changes

### Must Fix Before Further Implementation

1. **Fix `|` fallback acceptability check** — `vm.mjs:209` should check `!effects.failure` AND that emitted variants have usable status
2. **Add `family_resolved`, `planning_triggered`, `planning_stopped` trace events** — DS014 requires them
3. **Fix planning context package to be Markdown, not JSON** — DS005 specifies Markdown
4. **Create `data/default/callers/` with default caller-profile KUs** — needed for KB bootstrap
5. **Move server code from `src/server/` to `server/`** — matches DS001 directory structure

### Should Fix Soon

6. **Add transactional branch buffering** — prevents partial effect commits on failure
7. **Implement session executor caching with eviction** — DS018/DS022 requirement
8. **Add the remaining native API endpoints** — at minimum session CRUD, request status, trace retrieval
9. **Implement KB upsert and revision management** — core KB functionality
10. **Clean up redundant DS questions** — ~26 questions that restate Core Content

### Can Defer

11. **Parallel execution** — correct sequential execution is fine for v0
12. **Isolated-process sandbox** — `node:vm` is acceptable for v0 if documented as a known limitation
13. **Chat UI** — can be built after the API is complete
14. **Admin session model** — can be added after basic sessions work
15. **`group`, `rank`, `threshold flagging` in analytic-memory** — nice-to-have operations
