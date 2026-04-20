---
id: DS012
title: Credibility
status: implemented
owner: runtime
summary: Defines automatic family-resolution triggers, score persistence, strategy selection, and structural escalation rules for the independent credibility command.
---
# DS012 Credibility

## Introduction

`credibility` is the runtime component that compares candidate values independently of the commands that produced them. Its purpose is not philosophical neutrality; it is architectural separation between production and comparative judgment.

## Core Content

### Automatic triggers

`credibility` must run automatically whenever a command needs `$x` or `~x` and family `x` has more than one usable active variant. This makes `credibility` the authoritative path for first-touch ambiguity resolution across the runtime.

The minimum input modes are:

1. Compare all candidates of one family.
2. Compare all successful outputs of one `&` declaration.
3. Score or rank a list proposed by planning or another command.
4. Re-evaluate a family after new evidence or newly inserted declarations arrive.

Each input record must include the candidate ID, value summary, provenance, relevant metadata, and any comparison hints or criteria supplied by planning or KUs.

### Strategies and escalation

The command may use:

1. local heuristics,
2. `logic-eval` checks,
3. template-based rubrics,
4. stronger LLM wrappers when policy permits,
5. KU-defined evaluation procedures loaded through DS011.

All of these strategies must be trace-visible.

If `credibility` determines that it cannot judge honestly from the current candidate set, it may:

1. emit scores and withdrawals only,
2. synthesize a new best-of-set variant,
3. insert new SOP declarations that gather missing evidence,
4. trigger planning review for a larger repair or comparison plan.

Options 3 and 4 are structural effects. If accepted, they close the current epoch under DS002 before downstream execution continues.

### Outputs and persistence

The minimum output surface is:

| Output | Meaning |
| --- | --- |
| `score` or `score_pct` | Numeric comparison signal persisted in variant metadata. |
| `reason` | Compact explanation for the score, withdrawal, or escalation. |
| `confidence` | Optional confidence estimate for the comparison itself. |
| `withdrawn` metadata | Logical exclusion from active selection. |
| Optional synthesized variant | New best-of-set candidate emitted as an ordinary variant. |

When explicit scoring is absent or tied, `credibility` must align with DS002:

1. prefer the newest accepted variant by `created_epoch` or scheduler ordinal,
2. use producer order as the final deterministic tie-breaker.

`credibility` must not invent a second conflicting fallback model.

The baseline comparison model in v0 is one numeric score channel plus reason, confidence, and withdrawals. Richer multi-axis rubrics are deferred until a stronger cross-command comparison schema exists.

## Decisions & Questions

Question #1: Why must `credibility` run automatically on plural-family first touch instead of only when called explicitly?

Response: The runtime needs one coherent way to choose representatives when downstream work first touches a plural family. If `credibility` were only explicit, the language core would need a second hidden resolution regime.

Question #2: Why may `credibility` insert new declarations or trigger planning instead of only returning scores?

Response: Some ambiguities cannot be resolved honestly from the currently emitted variants alone. Allowing bounded structural escalation keeps evaluation agentic when necessary, while still making the escalation explicit and budgeted.

## Conclusion

`credibility` must remain an explicit comparison regime that resolves plural families before downstream execution commits to one candidate. It may become agentic when necessary, but only through explicit, traceable, budgeted structural effects.
