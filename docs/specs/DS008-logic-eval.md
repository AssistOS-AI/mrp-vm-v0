---
id: DS008
title: logic-eval
status: implemented
owner: runtime
summary: Defines the bounded rule language, action set, default KU guidance, and failure model of the declarative local reasoning command.
---
# DS008 logic-eval

## Introduction

`logic-eval` is the lightweight declarative reasoning command of MRP-VM v0. It exists for local checks and explicit rule-based actions that are clearer as short rules than as procedural JavaScript.

## Core Content

### Input style

The command must accept a compact line-oriented CNL. The minimum v0 structure is:

1. Optional `use` line listing variables.
2. One or more `when ... then ...` rule blocks.
3. Optional comments only if the parser can discard them deterministically.

The minimal grammar is line-oriented:

1. `use name[, name ...]`
2. `when <predicate expression>`
3. `then <action expression>`
4. Additional `and` or `or` predicate continuations only inside the recognized `when` block syntax.

### Predicates and values

The minimum predicate set is:

| Predicate | Meaning |
| --- | --- |
| `exists x` | `x` resolves to an active value. |
| `not exists x` | `x` does not resolve to an active value. |
| `value x == y` / `!=` | Equality or inequality. |
| `value x > y`, `<`, `>=`, `<=` | Numeric comparison. |
| `contains x "token"` | Text or collection containment. |
| `matches x "regex"` | Bounded regex matching. |
| `any item in x where ...` | At least one list item satisfies the predicate. |
| `all item in x where ...` | Every list item satisfies the predicate. |

### Actions

The minimum action set is:

| Action | Meaning |
| --- | --- |
| `set ~x = value with ...` | Emit a new variant plus metadata. |
| `patch-meta ~x with ...` | Emit metadata changes. |
| `score ~x = number because "..."` | Emit score metadata. |
| `withdraw ~x because "..."` | Emit logical withdrawal. |
| `emit error for ~x reason "..."` | Emit normalized failure state. |
| `insert declarations """..."""` | Propose direct SOP declaration insertion for the next epoch. |

Malformed rules must fail visibly. The runtime must not silently reinterpret an invalid rule set as best-effort prose.

### Caller guidance

`logic-eval` default KUs must describe its preferred CNL forms, regex-friendly patterns, and the exact action vocabulary it accepts. This keeps planning from drifting into unsupported pseudo-logic.

Those KUs must also make the routing boundary explicit: when `logic-eval` is preferable to `js-eval`, when it should be avoided in favor of narrative wrappers, and what a minimally valid rule block looks like. Summaries that merely restate the command name are not sufficient for reliable planning.

The predicate vocabulary remains closed in v0. Extension hooks for user-defined predicate libraries are deferred until the baseline grammar and validation path are stable.

## Decisions & Questions

Question #1: Why is `logic-eval` intentionally small instead of becoming a richer theorem-proving layer?

Response: The runtime needs a predictable local rule language that planners and humans can both reason about. A stronger logic system would add expressive power, but it would also add parser complexity and a larger debugging surface before the core runtime exists.

Question #2: Why does the command share the same `~var` mental model as `js-eval`?

Response: Native commands should not force planners to learn a different state model for each local reasoning regime. Reusing the `~var` handle concept keeps the runtime cognitively uniform even when the internal evaluator differs.

## Conclusion

`logic-eval` must stay a bounded, deterministic, and explicit rule surface for local judgments and actions, using the same direct declaration-insertion contract as the rest of the runtime.
