---
id: DS033
title: Explainable Memory and Aspect Administration
status: implemented
owner: runtime
summary: Defines the aspect-oriented Explainable Memory subsystem, its strategy boundaries, its ordinary retrieval contract, its derived-state lifecycle, and the operator-facing aspect administration surface.
---
# DS033 Explainable Memory and Aspect Administration

## Introduction

MRP-VM v0 now supports an Explainable Memory layer for `kb`. Its goal is not to replace the authoritative SOP-backed KB catalog. Its goal is to make ordinary context selection more inspectable by introducing approved aspects, explicit usage indications, inspectable derived indexes, and operator-facing governance surfaces.

DS011 remains the authority for KU and caller-profile assets. DS033 defines the separate Explainable Memory subsystem, the lifecycle of approved and candidate aspects, the strategy boundary for persistence and source access, the ordinary retrieval contract when Explainable Memory mode is active, and the server-facing administration surface used to govern that layer.

## Core Content

### Subsystem boundary

Explainable Memory must live in a dedicated runtime subsystem, separate from the KU source loader, HTTP hosting code, and browser UI code. The subsystem must expose explicit source and persistence strategy boundaries so:

1. source access can read KUs and aspect assets from the authoritative repository state,
2. persistence can save or load derived Explainable Memory state without becoming part of query logic,
3. the query layer can operate over one loaded in-memory snapshot,
4. the same core logic can later support non-disk persistence or alternate KB sources.

The first implementation may use disk-backed strategies over the repository's existing `data/` layout, but those strategies must remain replaceable modules under the Explainable Memory subsystem.

### Domain objects

Explainable Memory introduces these governed objects:

| Object | Meaning |
| --- | --- |
| Knowledge Unit | The authoritative SOP-backed KU already defined by DS011. |
| Approved aspect | An active relevance axis that ordinary retrieval may use. |
| Candidate aspect | An editable aspect definition that is not yet active for ordinary retrieval. |
| Proposed aspect | A scan-derived editable aspect definition inferred from bounded runtime logs and still inactive for ordinary retrieval. |
| KU memory record | Derived state for one KU including summary, aspect positions, lexical text, and index metadata. |
| Inverse aspect view | Derived mapping from approved aspects to the KUs positioned under them. |
| Memory snapshot | One immutable version of the Explainable Memory state used for a request. |

An aspect is stronger than a tag. It must define what relevance means from that perspective and how retrieved KUs may be used in a request.

### Lifecycle

The minimum Explainable Memory lifecycle surface is:

1. `load` to read previously persisted derived state without scanning KUs or calling an LLM,
2. `save` to persist the current derived state,
3. `listAspects` to inspect approved, candidate, and proposed aspects,
4. `reanalyse` to synchronize KU memory with the current authoritative KB source,
5. `scanLogsForProposals` to derive bounded proposed aspects from recent runtime logs,
6. `approveAspect` to move a candidate or proposed aspect into the approved set and trigger reanalysis for that coordinate,
7. `queryRelevant` to produce the retrieval result used by ordinary `kb` work.

`reanalyse` must be explicit. Boot must load the last saved derived state quickly. Reanalysis is what detects new, changed, or removed KUs and refreshes their aspect positions and lexical documents.

Log scanning must stay bounded and inspectable. The first repository implementation may use only symbolic heuristics over recent request envelopes, trace events, responses, and request-local LLM cache capture. It must not silently call a provider-backed LLM unless a later DS extension introduces an explicit policy gate for that maintenance path.

### Ordinary retrieval contract

When runtime configuration selects `explainable_memory`, ordinary `kb` retrieval must:

1. start from the same caller profile, metadata gates, scopes, and byte budgets defined by DS011,
2. activate approved aspects through deterministic rules over caller metadata, domain hints, and query text,
3. gather candidate KUs from the inverse aspect view,
4. apply bounded local lexical fallback for uncovered names, acronyms, rare terms, or explicit text search,
5. return a structured selection result together with a context-package string or equivalent structured surfaces that explain how each selected KU should be used.

Each selected KU must carry:

1. the KU id,
2. the stable reference token `~<ku_id>`,
3. the title,
4. the retrieval summary,
5. the execution-facing body,
6. the usage indication for the current task,
7. the aspect ids or names that influenced selection,
8. the lexical-fallback marker when relevant,
9. score or rank metadata sufficient for audit.

Ordinary `queryRelevant` must remain symbolic and inspectable. It must not hide provider-backed dense retrieval, opaque reranking, or hidden LLM selection behind the Explainable Memory name. LLM assistance is allowed only for explicitly governed maintenance paths when repository policy enables it.

KU memory records and server-facing catalog inspection must also preserve enough aspect-state detail for operator review. At minimum, a KU's aspect-state surface must expose:

1. the matched aspect id,
2. the matched aspect title,
3. the matched aspect definition or root value,
4. the symbolic reasons that produced the placement,
5. any KU-side evidence snippets captured during reanalysis,
6. the stored score for that aspect coordinate.

### Mode selection and defaults

The runtime configuration must expose one KB retrieval mode setting with these allowed values:

1. `explainable_memory`
2. `naive_symbolic`

`explainable_memory` is the repository default. `naive_symbolic` remains available for compatibility, fallback, testing, and comparative evaluation.

The selected mode is request-scoped once a request starts. Mode changes made through configuration or admin UI affect later requests only.

### Snapshot isolation and reindexing

Explainable Memory must preserve request snapshot isolation. At request start, the runtime resolves:

1. the active KB retrieval mode,
2. the Explainable Memory snapshot or index version when that mode is active,
3. the current approved-aspect set visible to that snapshot.

Reindexing and aspect approval must publish a new snapshot atomically. Running requests continue using the snapshot chosen at start. Later requests may use the newer snapshot.

Reindex status must remain inspectable and must record at least:

1. target scope,
2. status,
3. last started time,
4. last completed time,
5. last successful snapshot version,
6. last error message when a rebuild failed.

When proposed aspects are inferred from log scanning, the stored proposal must also preserve bounded provenance such as:

1. whether it was scan-derived,
2. the recent request count that contributed to the proposal,
3. the recent commands or interpreters that co-occurred with it,
4. the scan timestamp.

### Server and UI administration

The server and UI must expose an operator-facing administration surface for Explainable Memory through the existing hosted routes. The minimum contract is:

1. Settings exposes a `Memory` tab for KB mode selection, aspect inspection, aspect editing, aspect approval, and reindex control.
2. The `Memory` tab uses a master-detail layout with a left aspect list and a right detail/editor panel.
3. The left aspect list keeps approved, candidate, and proposed aspects visibly distinguishable.
4. The `Memory` tab exposes a bounded `Scan logs` action that derives proposed aspects from recent runtime logs.
5. KB Browser exposes index-state visibility for the loaded catalog and for the selected KU, including KU-side aspect-state detail.
6. The native API exposes JSON endpoints for Explainable Memory status, aspect listing and editing, log-scan proposal generation, aspect approval, and reindex requests.
7. KB Browser inspection must surface not only which aspects matched a KU but also the stored aspect definition text and KU-side evidence captured for that aspect.
8. Non-admin callers may inspect only the surfaces allowed by current server policy and may not approve aspects, trigger log scanning, switch global mode, or trigger global reindexing.

The admin surface must allow editing the aspect definition, inclusion criteria, exclusion criteria, interpretation protocol text, and role vocabulary surfaces without mutating derived state directly. The authoritative edit target is the SOP aspect asset, followed by explicit reindexing.

## Decisions & Questions

Question #1: Why does DS033 insist on a separate subsystem instead of expanding `KbStore` until it covers aspects, derived state, and admin workflows?

Response: KU loading, ordinary retrieval, derived memory state, and admin governance move at different speeds and have different persistence needs. Keeping Explainable Memory separate avoids turning one storage helper into a mixed source-loader, indexer, and governance service.

Question #2: Why is `explainable_memory` the default mode if the repository still keeps `naive_symbolic`?

Response: The repository now wants aspect-aware, operator-governed context selection as the baseline behavior. Keeping the naive mode available supports rollback and comparison, but the default should reflect the intended product posture rather than the simpler compatibility path.

Question #3: Why must aspect approval trigger explicit reanalysis instead of merely flipping a metadata flag?

Response: An approved aspect changes the coordinate system used to interpret the KB. Existing KUs therefore need to be positioned relative to that new aspect before ordinary retrieval can rely on it safely.

Question #4: Why does DS033 require request-scoped snapshot versions for Explainable Memory?

Response: Without request-scoped snapshot versions, reindexing or aspect edits could alter context selection mid-request and make replay depend on timing accidents. Snapshot versions preserve the same stability guarantees already required for KU revisions in DS011.

Question #5: Why does the admin surface edit SOP aspect assets instead of editing the derived index state directly?

Response: The derived state is rebuildable and secondary. Editing it directly would blur the source-of-truth boundary and make later reindexing overwrite operator intent. SOP aspect assets keep the governed definition explicit and revision-aware.

Question #6: Why does DS033 introduce `proposed` instead of treating every scan-derived suggestion as an ordinary candidate?

Response: Scan-derived suggestions are noisier and less intentional than manually authored candidates. Giving them a distinct `proposed` status lets operators triage them separately, refine them before approval, and distinguish deliberate candidate drafting from heuristic suggestion output.

Question #7: Why does DS033 require KU-side aspect evidence instead of showing only aspect ids?

Response: Aspect ids alone explain classification too weakly for operators who are reviewing retrieval quality. Showing the aspect definition and KU-side evidence keeps Explainable Memory explainable at the point where KB Browser is used to inspect concrete KUs rather than only the aspect catalog.

## Conclusion

DS033 gives MRP-VM v0 an aspect-oriented Explainable Memory layer that stays modular, storage-agnostic, request-stable, and operator-governed while preserving the repository's commitment to inspectable ordinary retrieval over authoritative SOP-backed knowledge assets.
