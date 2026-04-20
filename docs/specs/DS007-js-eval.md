---
id: DS007
title: js-eval
status: implemented
owner: runtime
summary: Defines preprocessing, proxy semantics, supported write patterns, helper surface, default KU guidance, and sandbox behavior for the procedural JavaScript evaluator.
---
# DS007 js-eval

## Introduction

`js-eval` is the main procedural command of MRP-VM v0. It must be strong enough for bounded local orchestration, transformation, and comparison, while still preserving version safety, traceability, and host isolation.

## Core Content

### Preprocessing

Before execution, the runtime performs source-to-source rewriting:

1. Resolve plural-family ambiguity under DS002 and DS012 when `$x` or `~x` touches a family with multiple usable variants.
2. `$x` becomes the canonical textual rendering of the active representative of family `x`.
3. `$x:vN` becomes the canonical rendering of the exact variant.
4. `~x` becomes a family-scoped runtime proxy handle.
5. `~x:vN` becomes a concrete-variant-scoped runtime proxy handle.

The rewrite happens before sandbox execution and after dependency extraction.

### Proxy semantics

The `~x` proxy is family-scoped by default. It exposes:

| Helper | Meaning |
| --- | --- |
| `get()` | Return current resolved value. |
| `meta()` | Return metadata for current target. |
| `exists()` | Return whether the target resolves to an active value. |
| `set(value, meta?)` | Emit a fresh variant for the family and retarget the proxy to that new variant for the remainder of the script. |
| `patchMeta(patch)` | Emit metadata changes for the current target. |
| `withdraw(reason?)` | Emit logical withdrawal metadata for the current target. |
| `family()` | Return family identifier. |
| `id()` | Return the current concrete target ID. |

If the script needs both the old and the newly created value, it must snapshot the old value before calling `set()`.

### Direct property access

The proxy must support simple property-style access when the resolved value is an object or array:

- Reading `ref.title` delegates to `ref.get().title`.
- Writing `ref.title = "x"` performs a read-clone-write that emits a fresh variant.
- Writing `ref[2] = "x"` is allowed for array-like values and also emits a fresh variant.

Unsupported operations must throw visibly. Unsupported operations include prototype mutation, property descriptor mutation, `delete`, arbitrary nested assignment through deep live references, and mutation of shared object identity.

### Helper surface

The sandbox must expose a narrow helper object such as `sop` with deterministic helpers only:

| Helper | Role |
| --- | --- |
| `sop.ref(id)` | Obtain a proxy explicitly. |
| `sop.emit(id, value)` | Emit a concrete variant explicitly. |
| `sop.fail(reason)` | Emit a normalized failure artifact for the command result. |
| `sop.insertDeclarations(text, meta?)` | Propose direct SOP declaration insertion for the next epoch. |
| `sop.now()` | Return a deterministic scheduler-supplied timestamp token if policy allows. |

Host APIs must not be exposed through the helper surface in the v0 baseline.

### Caller guidance and sandbox

`js-eval` default KUs must describe the preferred body format, the allowed helper surface, and any regex-friendly cues that help planning produce executable bodies predictably. LLM fallback is not part of `js-eval` execution itself; if planning needs help producing code, that happens before `js-eval` runs.

The helper surface remains intentionally minimal in v0. Additional deterministic helper libraries are deferred until repeated implementation pressure justifies them.

The security baseline is isolated-process execution with structured RPC. The command must not expose unrestricted filesystem, process, or network APIs.

## Decisions & Questions

Question #1: Why does `set()` retarget the proxy to the newly created variant inside the same script?

Response: Most procedural code expects the current thing to become the just-written value after an update. If the proxy stayed attached to the older variant, simple scripts would need extra bookkeeping for every normal update.

Question #2: Why are only simple direct property writes supported?

Response: The purpose of property-style syntax is to keep generated code readable for common cases, not to simulate unrestricted mutable object graphs. Limiting direct writes to top-level clone-and-set behavior preserves determinism and keeps state effects aligned with variant creation.

## Conclusion

`js-eval` must offer a compact procedural environment that feels convenient to generate but remains version-safe, host-bounded, and aligned with direct SOP declaration insertion.
