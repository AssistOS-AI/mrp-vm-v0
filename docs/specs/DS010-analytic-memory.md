---
id: DS010
title: Analytic Memory
status: implemented
owner: runtime
summary: Defines the hierarchical analytic store, instruction normalization rules, export policy, persistence boundary, and replay obligations of analytic-memory.
---
# DS010 Analytic Memory

## Introduction

`analytic-memory` is the canonical aggregation and analysis substrate of MRP-VM v0. It exists to hold structured observations, perform rollups and derived calculations, and export only the aggregates that the rest of the graph actually needs.

## Core Content

### Managed key space

The command manages hierarchical keys such as:

- `chapter.3.paragraph.12.sentiment`
- `chapter.3.claims.count`
- `book.summary.coverage`

Keys are namespaced strings, not arbitrary free-form JSON pointers. Values may be typed scalars, lists, objects, or aggregate records. Metadata may exist per key when needed.

Wildcard matching in hierarchical keys uses single-segment glob semantics. `*` matches exactly one key segment, is case-sensitive, and does not cross the `.` delimiter.

### Accepted instruction forms

The command may accept bounded natural language, but ordinary execution must normalize that input into deterministic operations. The baseline instruction surface is:

```text
store 0.72 under chapter.3.paragraph.12.sentiment
append "claim-a" under chapter.3.claims.items
rollup chapter.3 using average(sentiment) and count(claims.items)
derive book.risk = average(chapter.*.risk)
export chapter.3.summary as chapter3Summary
```

The minimum operation families are `store`, `append`, `merge`, `count`, `sum`, `average`, `min`, `max`, `group`, `rank`, `threshold flagging`, `derive`, `rollup`, and `export`.

Default KUs for `analytic-memory` must describe the preferred instruction patterns, normalization map, and any regex- or rule-based fast path that can parse requests without LLM help. LLM assistance is allowed only when policy explicitly permits fallback to normalize ambiguous natural language into this deterministic operator set.

### Execution and persistence

`analytic-memory` may keep richer internal state than the SOP graph exposes. However, that state is not allowed to become invisible runtime magic. The command must persist its managed state in a request- or session-scoped store that replay can reload, and every mutation must be represented in trace through an analytic-memory update record or equivalent payload.

Only exported results become ordinary top-level runtime variants unless another command explicitly asks for deeper analytic state.

Persistence remains request- or session-scoped in v0. Cross-session analytic namespaces are intentionally deferred.

### Streaming and chunking

Large collections must be processed through chunking or streaming so the runtime does not emit hundreds of tiny SOP variables just to represent intermediate analytics. The command may own those internals as long as exported state and replay inputs remain explicit.

## Decisions & Questions

Question #1: Why must analytic internal state be persisted and traced even when it is not exported as ordinary variants?

Response: Replay and auditability would break if a major part of the runtime reasoning lived in hidden in-memory accumulators that disappeared from trace. The command may keep internal structure, but that structure must still be reloadable and observable enough to reproduce outcomes.
## Conclusion

`analytic-memory` must externalize structured accumulation and derived analytics without turning itself into a second hidden planner or a generic expression engine.
