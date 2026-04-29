---
id: DS030
title: DocumentScalePlanner
status: implemented
owner: runtime
summary: Defines the DocumentScalePlanner external interpreter, its explicit Markdown or JSON planning contract, bounded planning outcomes, and declaration-insertion boundary.
---

# DS030 DocumentScalePlanner

## Introduction

`DocumentScalePlanner` is a planning-oriented external interpreter in MRP-VM v0. It is not a third reasoning runtime in the same sense as `HumanLikeReasoner` or `AdvancedReasoner`. Its job is to convert a bounded document-analysis request over explicit Markdown or JSON input into an inspectable SOP Lang workflow built from explicit chunk variables, semantic passes, rollups, validation steps, and a bridged final result.

The interpreter remains external because it has its own routing identity, input-shape discipline, and structural effect model. It accepts explicit document input, performs deterministic local planning, emits bounded planning-status surfaces, and may insert new declarations into the running SOP graph.

## Core Content

### Input contract

`DocumentScalePlanner` must accept these repository-owned input shapes:

1. a natural-language document-analysis request that explicitly names a source reference,
2. a mixed body that repeats an explicit `document_ref ~family` line plus an inline JSON envelope,
3. a JSON envelope that directly provides `document_text` or `document_json` for tests and controlled execution,
4. a direct reference to a structured object whose fields already describe the bounded planning request.

The normalized envelope may include:

1. `document_ref`,
2. `document_text`,
3. `document_json`,
4. `operation`,
5. `granularity`,
6. `path`,
7. `text_field`,
8. `final_target`,
9. `max_declarations_per_plan`,
10. `max_tokens_per_chunk`,
11. `selected_paths`,
12. `task`.

When planning wants the accepted graph to stay connected before declaration insertion occurs, the body must repeat the source reference explicitly as plain text such as `document_ref ~report_source` even if the JSON envelope also contains the same information. This keeps the dependency visible to the SOP graph validator rather than hiding it inside opaque JSON text alone.

### Planning flow and structural effects

The implemented v0 planning flow is:

1. normalize the request into one bounded document-planning envelope,
2. load the document from explicit Markdown or JSON input,
3. choose one inspectable granularity such as chapter, section, paragraph, table, or record,
4. derive stable chunk identifiers and estimate declaration cost,
5. return `too_large` rather than silently over-expanding when the requested plan exceeds configured limits,
6. generate explicit chunk-materialization declarations,
7. generate explicit per-chunk semantic declarations and rollup declarations using existing runtime surfaces,
8. generate explicit validation declarations,
9. generate a bridge declaration that writes the final semantic target back into the planner family itself.

The inserted plan must be executable with the current runtime catalog. The implemented v0 interpreter therefore builds plans only from already shipped surfaces such as `js-eval`, `writerLLM`, and `template-eval`. It must not invent a hidden document store or undocumented document-only commands.

### Output contract

The interpreter must support these bounded planning outcomes:

1. `plan_ready`,
2. `partial_plan`,
3. `too_large`,
4. `needs_normalization`,
5. `needs_clarification`.

For `plan_ready` and `partial_plan`, the interpreter must:

1. insert explicit SOP declarations,
2. emit a blocked variant for the main target family while the inserted plan is still pending,
3. emit `:plan_summary`, `:meta`, and `:trace` companion surfaces,
4. bridge the promoted final target back into the main target family so an initial `@response` step can remain graph-connected.

For `too_large`, `needs_normalization`, and `needs_clarification`, the main target family may be emitted directly as an ordinary active summary because there is no later inserted workflow to wait for.

### Current v0 implementation boundary

The implemented v0 boundary is intentionally narrower than the wider research direction:

1. only explicit Markdown and JSON inputs are supported,
2. chunk planning is deterministic and local,
3. semantic work is delegated to already shipped interpreters such as `writerLLM`,
4. coverage checking is bounded and explicit,
5. selective document expansion is supported only through explicit path selection rather than hidden adaptive search,
6. the interpreter may recommend a coarser first-pass strategy when a requested plan would exceed the configured declaration budget.

`DocumentScalePlanner` is therefore a structural planning surface, not a hidden retrieval engine and not a replacement for the two reasoning interpreters.

## Decisions & Questions

### Question #1: Why is `DocumentScalePlanner` an external interpreter instead of a native command?

Response: It has its own routing identity, bounded outcome model, and declaration-insertion behavior. Treating it as an external interpreter keeps that structural planning role explicit and aligned with DS020 instead of hiding it inside a generic native helper.

### Question #2: Why must the body repeat `document_ref ~family` in plain text when planning wants a connected initial graph?

Response: The SOP graph validator sees explicit family references, not arbitrary JSON semantics. Repeating the source reference as plain text keeps the dependency inspectable and prevents the planner from accepting a disconnected graph that only appears connected to a human reader.

### Question #3: Why does the main planner family stay blocked for `plan_ready` instead of returning the plan summary immediately?

Response: The main family is also the bridge that the initial `@response` step depends on. If the planner marked that family usable too early, the request could complete with only the planning summary instead of with the final semantic document result. Keeping it blocked until the inserted bridge declaration runs preserves one connected and truthful response path.

### Question #4: Why does the inserted plan reuse `js-eval`, `writerLLM`, and `template-eval` instead of introducing a new document-command family?

Response: The current repository contract does not yet ship a separate document-command catalog. Reusing existing executable surfaces keeps the implementation honest, traceable, and testable while still making chunking and rollups explicit.

## Conclusion

`DocumentScalePlanner` is the implemented document-scale planning interpreter for MRP-VM v0. It accepts explicit Markdown or JSON inputs, produces bounded planning outcomes, and expands the running SOP graph through inspectable declaration insertion without inventing hidden runtime capabilities.
