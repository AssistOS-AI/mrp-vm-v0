---
id: DS005
title: Context Packaging and Injection
status: implemented
owner: runtime
summary: Defines how `kb`-selected material, runtime state, analytics, and planning notes are packaged and delivered to commands and interpreters.
---
# DS005 Context Packaging and Injection

## Introduction

MRP-VM v0 depends on bounded local context, not on one ever-growing transcript. This DS defines how the runtime packages context for commands and interpreters, how that packaging depends on `kb`, and which parts of the package are authoritative at invocation time.

DS011 owns retrieval, ranking, and pruning. DS005 owns the resulting package shape and delivery contract.

## Core Content

### Canonical assembly path

Before every native-command or external-interpreter invocation, the runtime must build one canonical context package. The assembly path is:

1. Resolve direct declaration dependencies from DS002.
2. Resolve active family representatives, invoking DS012 when plurality requires explicit judgment.
3. Call `kb` automatically with the caller profile defined in DS011.
4. Add analytic summaries exported from DS010 when the caller profile allows them.
5. Add planning notes or repair hints when the current request state requires them.
6. Render the final package for delivery.

This means that ordinary commands and interpreters do not reach arbitrarily into storage to fetch ad hoc context. The runtime gives them one prepared package.

### Source tiers

The global source order is:

1. Direct declaration dependencies.
2. Selected family representatives.
3. Required prompt or policy KUs resolved by `kb`.
4. Preferred content KUs resolved by `kb`.
5. Exported analytic-memory summaries.
6. Planning or repair notes.
7. Optional background material that survived DS011 pruning.

`kb` scope precedence composes inside tiers 3 and 4, not against them. Inside a chosen tier, the precedence is session, then global, then default.

### Delivery format

The authoritative delivery surface is a deterministic Markdown package with stable top-level sections. The minimum section order is:

1. `# Task`
2. `# User Request`
3. `# Direct Dependencies`
4. `# Resolved Family State`
5. `# Knowledge Units`
6. `# Analytic Summaries`
7. `# Planning Notes`

LLM-facing interpreters receive this Markdown package directly. Deterministic native commands may derive structured helper views from the same package, but the Markdown rendering remains the inspectable and traceable canonical form.

The `# User Request` section must contain the normalized current request text for the active request. This keeps sub-tasks grounded in the original problem statement even when a declaration body only names one slice of the work.

When the package includes KUs selected through DS011, the rendering must preserve three distinct surfaces for each KU:

1. the human-readable title,
2. the retrieval-facing summary,
3. the substantive guidance body from the KU root variable.

The summary is the short discriminative surface used during selection and auditing. The body is the execution-facing guidance that the receiving command or interpreter actually consumes. Packaging must not collapse those roles into one flat unlabeled text block.

### Deduplication and trace

Deduplication in v0 must be exact, not semantic in the fuzzy sense. Two context items count as duplicates when one of the following holds:

1. They reference the same concrete variant ID.
2. They reference the same KU ID and revision.
3. They have byte-identical rendered payload plus the same source kind.

The trace must record the selected context package and the items rejected by DS011 pruning. DS005 does not define the pruning heuristic; it defines only the final packaging boundary.

## Decisions & Questions

Question #1: Why does every caller receive one canonical context package instead of assembling context privately?

Response: Context selection is an architectural control surface, not a hidden per-command convenience. One canonical package keeps trace, debugging, and later conformance testing aligned across the runtime.

Question #2: Why is the delivered context package defined as Markdown instead of only as an internal object?

Response: The package must be inspectable by humans, by trace tooling, and by LLM-facing interpreters. Markdown gives the runtime one stable textual form while still allowing deterministic commands to derive structured helper views from it.

## Conclusion

Context in MRP-VM v0 must arrive through one explicit package built from runtime state, `kb`, analytics, and planning notes. Commands and interpreters should consume prepared context, not reconstruct it privately.
