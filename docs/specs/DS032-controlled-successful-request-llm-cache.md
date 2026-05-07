---
id: DS032
title: Controlled Successful-Request LLM Cache
status: implemented
owner: runtime
summary: Defines request-scoped LLM call capture, explicit successful-request promotion, normalized cache lookup keys, persistent cache storage, and operator-facing cache inspection controls.
---
# DS032 Controlled Successful-Request LLM Cache

## Introduction

MRP-VM v0 now ships a controlled cache for LLM-backed work. The purpose of this cache is not to memorize every provider interaction automatically. The purpose is to let the runtime preserve only those LLM calls that actually participated in a request which finished successfully and was then promoted explicitly through a cache-control surface.

This keeps the cache inspectable, operator-governed, and aligned with the repository's explicit-runtime posture instead of turning provider reuse into an opaque hidden optimization.

## Core Content

### Request-scoped capture before promotion

Every successful LLM invocation that goes through the managed adapter path must be captured first as request-scoped candidate data, not written directly into the shared cache. The request-scoped capture must preserve:

1. the request and session identifiers,
2. the routed profile and model-class hint,
3. the normalized instruction and context package,
4. the prompt assets used for the invocation,
5. the normalized response payload,
6. provenance such as model, tier, task tag, and origin when available.

Provider failures and semantic refusals must not become shared cache entries. They may remain visible inside request-local inspection data, but the global cache stores only successful completions.

### Explicit promotion boundary

The shared cache may be populated only after both of these conditions hold:

1. the parent request finished with `stop_reason = completed`,
2. an explicit cache-promotion action was invoked through a runtime or server cache API surface.

This promotion step is the authoritative control boundary for the feature. A successful request may still remain unpromoted. Promotion is therefore deliberate, not automatic.

When promotion runs, the runtime must promote only provider-backed successful LLM candidates. Request-local entries that were already satisfied from cache may remain visible for audit purposes, but they must not be reinserted as new cache entries.

### Lookup and normalization contract

Cache lookup must use a stable normalized key derived from the invocation shape rather than from volatile trace metadata. The normalized lookup input must include:

1. wrapper profile,
2. model-class hint,
3. expected output mode,
4. normalized prompt-asset content,
5. normalized context package text,
6. normalized instruction text.

The lookup key must ignore volatile request identifiers, session identifiers, epoch numbers, event ordinals, and provider-transport ids. Concrete model or tier metadata may be stored for provenance, but the reuse decision is driven by the normalized invocation shape above.

### Storage model

The repository-owned persistence model has two layers:

1. request-local candidate capture under `data/sessions/<sessionId>/requests/<requestId>/llm-cache-candidates.json`,
2. promoted shared cache storage under `data/cache/llm/index.json`.

The request-local file must record candidate items together with stop reason and promotion metadata. The shared cache must record entry ids, lookup keys, request and response bodies, prompt assets, provenance, hit counts, and source-request history.

### Operator-facing surfaces

The runtime and server must expose operator-facing cache controls for:

1. inspecting request-local candidate capture for a known request,
2. listing recent unpromoted request-local captures across visible sessions through a dedicated pending surface,
3. promoting a completed request's successful LLM calls into the shared cache,
4. promoting from the pending surface without requiring navigation back into the originating chat transcript,
5. listing shared cache entries,
6. inspecting a shared cache entry's request and response payloads,
7. deleting a shared cache entry.

The chat UI family of pages must expose a dedicated Cache page that distinguishes:

1. the promoted shared cache,
2. the recent pending capture set that is waiting for explicit promotion.

Showing pending captures does not weaken the promotion boundary. Those entries remain request-local until an explicit promotion action succeeds. Destructive mutation of the shared cache remains a privileged control surface even when read access is available more broadly.

### Evaluation use

Repository-owned evaluation may promote successful request-local LLM calls between attempts so later retries can reuse already-successful generations. This does not weaken the promotion rule above, because evaluation still promotes only completed successful requests through the same explicit control surface.

## Decisions & Questions

Question #1: Why does DS032 insist on request-scoped capture first instead of writing every successful LLM call directly into the global cache?

Response: A provider completion is not useful merely because it succeeded technically. The runtime must know whether that completion belonged to a request that actually reached a successful final outcome. Request-scoped capture preserves the audit trail and lets the system reject incomplete or failed request traces before they influence future execution.

Question #2: Why is promotion explicit instead of automatic once a request completes successfully?

Response: Successful completion is necessary but not sufficient for trustworthy reuse. Operators may want to inspect the request, the generated plan, or the resulting response before allowing reuse. Explicit promotion preserves that control boundary and keeps the cache understandable as a deliberate repository asset rather than an invisible side effect.

Question #3: Why does the lookup key ignore request ids and other volatile trace metadata?

Response: Request ids, epoch numbers, and event ordinals describe one execution instance, not the semantic shape of an LLM invocation. If those volatile fields were part of the key, identical work would miss the cache on every rerun. The cache therefore normalizes away runtime-instance noise while still storing provenance separately for audit.

Question #4: Why does the shared cache store prompt assets and context package text instead of only the instruction and final answer?

Response: MRP-VM's routed LLM work depends on more than the final instruction string. Prompt assets and bounded context packaging are part of the actual invocation contract defined by DS005 and DS013. Storing them makes the cache entry inspectable and makes reuse depend on the real execution inputs rather than on a misleading summary.

Question #5: Why does DS032 require a pending-capture listing surface if promotion stays explicit?

Response: Without a pending listing surface, operators cannot see that request-local capture is already working and may incorrectly conclude that the cache is broken whenever the promoted shared cache is empty. A dedicated pending view preserves DS032's explicit-promotion contract while making the two-layer model inspectable and operationally understandable.

## Conclusion

DS032 gives MRP-VM v0 a controlled LLM cache that stays faithful to the repository's explicit-runtime architecture. Successful LLM work is captured per request, promoted deliberately after successful completion, matched through normalized invocation inputs, and exposed through auditable operator-facing cache controls.
