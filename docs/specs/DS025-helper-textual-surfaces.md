---
id: DS025
title: Helper Textual Surfaces
status: implemented
owner: runtime
summary: Defines reserved non-executing helper surfaces such as `text` and `json` for declaration-style SOP modules, clarifies their semantic role, and forbids planning from treating them as ordinary executable routes.
---

# DS025 Helper Textual Surfaces

## Introduction

MRP-VM v0 uses declaration-style SOP not only for executable plans but also for persistent assets such as KUs, caller profiles, prompt assets, and other repository-owned textual artifacts. Some declaration tokens therefore act as helper surfaces for storage and inspection rather than as scheduler-executed runtime commands.

DS003 owns the syntax of declaration-style SOP modules. DS025 owns the semantic role of the reserved helper surfaces used by those modules.

## Core Content

### Reserved helper surfaces

The baseline reserved helper surfaces are:

1. `text`
2. `json`

They are valid declaration-line command tokens inside persistent declaration-style SOP modules, but they are **not** ordinary executable routes in the runtime scheduler.

### Semantic role

The helper surfaces exist so repository-owned assets can stay on the same declaration substrate as executable SOP plans while still preserving non-executable payloads.

1. `text` means the body is preserved byte-for-byte as authoritative textual content.
2. `json` means the body is parsed as JSON metadata or structured helper data after body extraction.

These helper surfaces are valid for:

1. KUs and prompt assets,
2. caller profiles,
3. metadata companions such as `:meta`,
4. stable machine-readable demo and evaluation fixtures when they are stored as declaration-style SOP modules.

### Planning and execution boundary

Planning must not emit `text` or `json` as ordinary execution steps for request graphs unless a future DS explicitly promotes one of them into an executable runtime command.

The authoritative executable route inventory remains the runtime-owned command and interpreter catalog described by DS006, DS020, and the concrete code registry. If a token is not present in that catalog, planning must treat it as unavailable for executable routing even if the token appears elsewhere in persistent SOP modules.

### Trace and UI expectations

When helper textual surfaces are loaded from persistent assets, they remain inspectable as source text or parsed metadata in KB and trace-adjacent tooling. They do not produce executable node timing, invocation events, or scheduler-visible side effects on their own.

## Decisions & Questions

Question #1: Why keep `text` and `json` on the same declaration substrate if they are not executable commands?

Response: The repository is easier to reason about when executable plans, KUs, caller profiles, and helper artifacts share one syntactic container. Reusing the declaration substrate avoids inventing a second persistent authoring language while still keeping execution authority explicit.

Question #2: Why forbid planning from using helper surfaces as ordinary executable routes?

Response: Planning must route only through code-owned commands and enabled interpreters. If helper tokens were treated as ordinary routes, planner output would drift away from real runtime capability and traceability would become misleading.

## Conclusion

MRP-VM v0 should keep textual and metadata assets on the declaration substrate without pretending that every declaration token is an executable runtime command. DS025 formalizes that boundary for `text`, `json`, and future helper surfaces of the same class.
