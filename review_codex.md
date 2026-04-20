# Codex Review: Implementation Maturity vs. Declared Specifications

## Scope

This review compares the runtime implementation against the DS files in `docs/specs/` that are currently marked `status: implemented`.

Excluded from the conformance verdict:

- `DS004`, because it is explicitly `proposed`
- `DS021`, because it is explicitly `proposed`
- `DS022`, because it is explicitly `planned`

Validation note:

- `node run.mjs test` passes outside the sandbox. Inside the sandbox, the server test failed only because `listen()` on `127.0.0.1` is blocked there.

## Overall Verdict

The repository is a credible executable scaffold, not a mature “implemented DS002-DS020” runtime.

What is clearly real already:

- SOP parsing and graph compilation exist and are usable.
- The family/variant state model exists in a basic form.
- There is a working end-to-end request loop.
- There are default KUs, caller profiles, trace persistence, and a basic HTTP adapter.
- The test suite proves the happy-path skeleton works.

What is overstated today:

- Several DS files marked `implemented` are only partially implemented.
- Some normative behaviors are shortcut implementations rather than contract-complete implementations.
- The tests are mostly smoke tests; they do not validate many DS-level obligations.

My practical maturity reading:

| DS | Declared | Observed maturity | Comment |
| --- | --- | --- | --- |
| DS002 | implemented | partial | Core graph/state shell exists, but epoch, buffering, and failure semantics are incomplete. |
| DS003 | implemented | mostly aligned | Parser is one of the stronger areas. |
| DS005 | implemented | partial | Canonical package exists, but source-tier governance and dedup are incomplete. |
| DS006 | implemented | partial | Planning modes exist, but plan validation and planning trace are missing. |
| DS007 | implemented | partial / high-risk | `js-eval` works for simple cases, but state safety and sandbox posture are not at spec level. |
| DS008 | implemented | partial | Basic rule engine exists, but `any/all where ...` semantics are not truly implemented. |
| DS009 | implemented | partial | Basic template engine exists, but error normalization and representative handling are incomplete. |
| DS010 | implemented | partial | Persistence/checkpoints exist, but several required operation families are missing. |
| DS011 | implemented | partial | Deterministic retrieval exists, but caller-profile governance, overlays, revisioning, and contract completeness are missing. |
| DS012 | implemented | partial | Basic scoring exists, but trace-visible strategy/escalation behavior is thin. |
| DS013 | implemented | skeletal | Wrapper profiles are hardcoded and under-governed relative to the DS. |
| DS014 | implemented | partial | Trace writing exists, but several required event types/payloads are missing. |
| DS015 | implemented | partial | Deterministic seams exist, but evaluation/fixture depth is much thinner than declared. |
| DS016 | implemented | partial | Request/session persistence exists, but bootstrap validation and session lifecycle rules are incomplete. |
| DS017 | implemented | skeletal | Error taxonomy exists, but blocking, retry, and terminal stop semantics are not implemented to spec. |
| DS018 | implemented | minimal | A server exists, but admin/session-hosting model is far from the DS contract. |
| DS019 | implemented | skeletal | Evaluation harness is a smoke harness, not the strategy described by the DS. |
| DS020 | implemented | skeletal | The interpreter registry exists, but the DS020 declaration model is still mostly hardcoded. |

## Highest-Priority Non-Conformities

### Critical

- Branch effects are not transactional, even though DS002 requires branch-local buffering and discard-on-failure. `src/runtime/vm.mjs:454-460` always applies effects, and `src/commands/js-eval.mjs:147-155` plus `src/commands/js-eval.mjs:180-205` allow a branch to both emit variants and end in failure. That means partially failed work can be committed.
- `js-eval` allows hidden in-memory mutation through nested object references. The proxy `get` trap in `src/commands/js-eval.mjs:79-99` returns nested objects directly, so expressions like `~draft.title.x = 1` can mutate the current object without emitting a new variant. This breaks the append-oriented state contract from DS002 and the bounded mutation model from DS007.
- `js-eval` uses in-process `node:vm` execution (`src/commands/js-eval.mjs:178-184`) instead of the isolated-process baseline required by DS007. This is not just “less mature”; it is a different security model.
- Plans and inserted declarations are not validated before acceptance. The initial planner output is accepted in `src/runtime/vm.mjs:424-431`, and later structural insertions are appended in `src/runtime/vm.mjs:496-498`, but DS002/DS006/DS016 require validation before graph mutation is accepted.
- The runtime does not implement DS017 blocked-state and terminal stop semantics. When execution stalls, `src/runtime/vm.mjs:440-449` and `src/runtime/vm.mjs:540-556` collapse many cases into `unknown_outcome` instead of emitting normalized `blocked_state` or `budget_exhausted` outcomes.

### High

- Caller-profile governance from DS011 is present in data but largely ignored in execution. `src/runtime/vm.mjs:165-175` hardcodes retrieval settings instead of taking `allowed_ku_types`, `model_classes`, `byte_budget`, and `session_override_allowed` from the caller-profile KUs.
- External interpreter contracts are still hardcoded in `src/runtime/vm.mjs:45-64`. DS011 and DS020 say these contracts should be declared through default KUs, but the `.sop` files in `data/default/callers/` do not carry the full DS020 contract surface.
- `template-eval` and some `js-eval` access paths can bypass authoritative representative resolution. `src/runtime/vm.mjs:90-98` and `src/commands/js-eval.mjs:11-22` fall back to “first active variant” if no cache entry exists, which is weaker than the DS002/DS012 requirement to resolve plural families through `credibility`.
- Trace coverage is materially incomplete relative to DS014. There is no emitted `family_resolved`, `planning_triggered`, or `planning_stopped` event path, and `declarations_inserted` stores text length instead of a real hash in `src/runtime/vm.mjs:498-505`.
- Session lifecycle rules from DS016 are incomplete. `submitRequest()` loads the session in `src/runtime/vm.mjs:379-381` but does not enforce “only one scheduler-active request per session”, and the repository never writes the `history/request-summaries.jsonl` artifact described by DS011 and DS016.

### Medium

- `logic-eval` does not really implement `any item in x where ...` and `all item in x where ...` as predicate evaluation. `src/commands/logic-eval.mjs:72-88` only checks whether each item string contains the raw trailing text.
- `analytic-memory` does not implement all minimum operation families promised by DS010. `src/commands/analytic-memory.mjs:41-107` supports `store`, `append`, `merge`, `derive`, `rollup`, and `export`, but not `group`, `rank`, or threshold-style flagging.
- `kb` overlay and revision behavior is much thinner than declared. `src/storage/kb-store.mjs:147-167` and `src/storage/kb-store.mjs:203-313` load and rank entries, but there is no real shadowing, revision winner selection, promotion path, or upsert model from DS011.
- The model-class filter in `src/storage/kb-store.mjs:236-238` is not correct for array-valued `model_classes`; it checks `acceptedModelClasses.includes(entry.meta.model_classes)` instead of checking overlap.
- `template-eval` throws raw errors for missing placeholders and incompatible helper inputs (`src/commands/template-eval.mjs:15-84`) instead of normalizing them into DS017-style failure records.
- The server implementation is much smaller than the DS018 hosting/admin model. `src/server/create-server.mjs:14-66` provides only `/api/requests`, `/v1/chat/completions`, and `/api/inspect`, with no executor cache, no admin boundary, and no trace/session API.
- `src/server/create-server.mjs` also lives under `src/server/`, while DS001 prescribes `server/` as the hosting layer boundary. The docs already drift here too, so this is partly an implementation issue and partly a documentation consistency issue.

## Test and Verification Gaps

- The tests prove happy-path behavior, not DS conformance. They do not cover transactional branch rollback, blocked-state propagation, invalid planner output rejection, plural-family resolution traces, session-concurrency rules, KU revision/overlay behavior, or security boundaries.
- `src/runtime/evaluation-harness.mjs:1-34` is a minimal smoke harness. It does not measure cost, latency, replayability, stability under partial graph change, repair success, or ambiguity-resolution quality as required by DS019.
- `runtime.inspect()` in `src/runtime/vm.mjs:560-569` is useful, but it still misses the “buffered and applied scheduler effects” hook expected by DS015.

## What Should Change First

1. Decide whether to lower several DS statuses from `implemented` to `partial/planned`, or to finish the missing behavior. Right now the matrix overstates implementation maturity.
2. Fix runtime correctness before adding features: transactional branch buffering, declaration insertion validation, blocked-state and budget-exhausted stop semantics, and representative resolution consistency.
3. Rework `js-eval` before trusting it as a core primitive: eliminate hidden deep mutation, normalize failures cleanly, and replace in-process `node:vm` with an actually isolated execution boundary.
4. Move KB/interpreter governance out of hardcoded defaults and into the declared KU contract: caller-profile-driven retrieval, DS020 contract fields in default KUs, and real overlay/revision/shadow behavior.
5. Expand trace and tests around the normative surfaces, not just the happy path: planning events, family resolution, repair paths, blocked states, and session lifecycle rules.

## Bottom Line

The project already has real implementation value, but the current DS status discipline is too optimistic.

If the question is “is there a runtime here?” the answer is yes.

If the question is “does the code already satisfy the DS set that is marked implemented?” the answer is no, not yet. The parser, graph shell, persistence shell, and happy-path execution loop exist, but a large part of the normative runtime contract is still partial, shortcut, or only sketched.
