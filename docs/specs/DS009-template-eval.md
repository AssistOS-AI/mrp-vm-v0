---
id: DS009
title: template-eval
status: implemented
owner: runtime
summary: Defines the deterministic template syntax, rendering rules, default KU guidance, and failure behavior for structured composition tasks.
---
# DS009 template-eval

## Introduction

`template-eval` is the deterministic composition command of MRP-VM v0. It handles output rendering, prompt assembly, and message construction when structural stability is more important than open-ended generation.

## Core Content

### Syntax

The v0 baseline syntax aligns with SOP Lang references for simple placeholders and reserves `{{ ... }}` for template logic:

| Form | Meaning |
| --- | --- |
| `$expr` or `${expr}` | Placeholder expansion (preferred for plain values). |
| `{{#if expr}} ... {{else}} ... {{/if}}` | Conditional rendering. |
| `{{#each expr as item}} ... {{/each}}` | Looping over lists. |
| `{{join expr ", "}}` | Join helper. |
| `{{default expr "fallback"}}` | Default fallback helper. |
| `{{formatDate expr}}`, `{{formatNumber expr}}`, `{{truncate expr 120}}` | Deterministic formatters. |

`expr` resolves against direct values, representatives, or explicit runtime handles flattened into deterministic renderable values by the command. Simple value insertion must use `$expr`/`${expr}` rather than `{{expr}}`.

### Resolution rules

When a placeholder references a family, the current family representative from DS002 must be used. Missing values must be handled explicitly:

1. Required placeholders fail the render.
2. Optional placeholders may use `default`.
3. Missing loop sources render as empty only when the template explicitly treats them as optional.

Nested structures must be traversable deterministically by dotted paths such as `report.summary.title`.

### Caller guidance and failure semantics

`template-eval` default KUs must describe preferred template skeletons, allowed helper usage, and the standard section names it is expected to assemble from DS005 context packages. This keeps template generation predictable for planning.

The KU summary must be specific enough that planning can recognize `template-eval` as a deterministic assembly surface rather than as a general prose generator. The KU body must include the expected placeholder style, control-block limits, and examples of when to hand work to `writerLLM` instead.

Named templates may live either in `kb` or as local module assets, but both paths must use explicit loading rules so template provenance remains inspectable.

`template-eval` must fail visibly when:

1. a required reference is missing,
2. a helper receives an incompatible type,
3. a loop target is not list-like,
4. the template contains invalid control syntax.

The command must not silently erase required sections or swallow type errors.

## Decisions & Questions

Question #1: Why does `template-eval` use an explicit deterministic syntax rather than delegating composition to an LLM?

Response: The point of the command is not creativity. It is control. Deterministic syntax keeps rendering reproducible, makes prompt assembly inspectable, and gives the runtime a stable way to format outputs without paying for another inference step.

Question #2: Why does the command reuse family representatives instead of inventing its own selection logic?

Response: If the template system had an independent family-resolution policy, one runtime could render two different current values for the same family depending on which command was used. Reusing DS002 keeps the runtime semantically coherent.

## Conclusion

`template-eval` must provide deterministic structured rendering over explicit runtime state and must not hide reasoning behind template execution.
