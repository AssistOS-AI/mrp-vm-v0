---
id: DS008
title: logic-eval
status: implemented
owner: runtime
summary: Defines logic-eval as a bounded orchestration helper that rewrites logic-heavy requests into structured briefs for external reasoning interpreters instead of solving them directly.
---

# DS008 logic-eval

## Introduction

`logic-eval` remains a native command in MRP-VM v0, but its role is now narrower and cleaner than the earlier symbolic-solver draft. It is not the main reasoning runtime anymore. Its job is to help planning and execution sharpen a logic-heavy request into a bounded, machine-usable reasoning brief that an external reasoning interpreter can consume directly.

The purpose of this change is to avoid duplicated solver architecture. The bounded reasoning runtime now belongs to a dedicated external interpreter surface. `logic-eval` stays valuable because planning should not be forced to internalize all reasoning decomposition logic by itself. The command can look at a request, preserve the explicit entities and constraints, recommend a configured reasoning interpreter, and package the next-step instructions in a form that the runtime can inspect and route.

## Core Content

### Role and output surface

`logic-eval` is a rewrite-orchestration command. Its primary successful output is a structured brief, not the final solved answer. The minimum successful brief must contain:

1. `status`
2. `rewritten_problem`
3. `preferred_interpreters`
4. `decomposition_hints`
5. `answer_requirements`
6. `planner_hint`

The command may emit that brief either as structured data or as canonical text when the caller explicitly asks for textual mode, but the normative contract is the structured form because downstream interpreters and planning repair logic must be able to reuse it without re-parsing prose.

### Accepted input shapes

`logic-eval` must accept these bounded input shapes:

1. a direct natural-language request that needs reasoning-oriented rewriting,
2. a JSON envelope that already contains fields such as `problem`, `preferred_interpreters`, `answer_requirements`, or `decomposition_hints`,
3. a direct reference to an earlier family whose structured value should become the next-step reasoning brief.

The command must preserve the explicit problem content that matters for reasoning: entities, finite domains when present, hard constraints, target question, and requested output sections. It must not silently broaden the task into general analysis prose.

### Relation to external reasoning interpreters

`logic-eval` does not execute the bounded solver runtime directly. Instead, it recommends one or more enabled external reasoning interpreters, using:

1. runtime-enabled external interpreter registrations,
2. default caller-profile metadata,
3. retrieved KU guidance,
4. optional managed LLM assistance for rewrite quality.

The repository default path should favor `HumanLikeReasoner` for finite closed-world reasoning and `AdvancedReasoner` for bounded advanced reasoning, but the command contract remains plural: later repositories may configure additional reasoning interpreters and let `logic-eval` recommend among them. `DocumentScalePlanner` remains outside this route because document-scale chunk planning is not a reasoning-brief rewrite target.

### Relation to planning

Planning should use two distinct routes:

| Situation | Preferred route |
| --- | --- |
| The planner already recognizes a finite bounded reasoning task clearly | route directly to `HumanLikeReasoner` |
| The planner already recognizes a bounded advanced reasoning task clearly | route directly to `AdvancedReasoner` |
| The planner already recognizes a bounded Markdown or JSON planning workflow clearly | do not route to `logic-eval`; prefer `DocumentScalePlanner` |
| The planner recognizes that the task is reasoning-heavy but needs help sharpening the next step | insert a `logic-eval` step first, then pass its brief to the external reasoning interpreter |

This means `logic-eval` participates in planning without replacing planning. It narrows a local reasoning subproblem. It does not own the whole request graph.

### Explicit non-goals

`logic-eval` must not:

1. duplicate the bounded solver runtime that now belongs to external reasoning interpreters,
2. present itself as the final exact-solving surface for finite assignment, graph, search, rule, or numeric tasks,
3. masquerade as a prose validator for ordinary writing steps,
4. become a hidden second planner.
5. become the document-scale synthesis surface for Markdown or JSON chunk workflows.

If the request is already execution-ready for the external reasoning interpreter, planning should skip `logic-eval` rather than route through it out of habit.

## Decisions & Questions

Question #1: Why keep `logic-eval` as a native command instead of deleting it once the external reasoning interpreter exists?

Response: Planning still benefits from a bounded helper that can sharpen a local reasoning step without forcing the planner prompt to contain all decomposition logic itself. Keeping that helper native preserves one explicit orchestration seam while avoiding duplicated solver execution.

Question #2: Why does `logic-eval` emit a structured rewrite brief instead of inserting fresh SOP declarations directly?

Response: A structured brief is easier to compose safely with already planned dependencies and with downstream interpreter calls. Direct declaration insertion would blur the boundary between local reasoning decomposition and whole-plan mutation. The planner remains the graph-authority surface, while `logic-eval` contributes a reusable brief.

Question #3: Why must `logic-eval` stop pretending to be the final bounded solver runtime?

Response: Keeping the solver runtime inside both `logic-eval` and an external interpreter would create architectural duplication, divergent prompt rules, and inconsistent evaluation seams. One bounded reasoning runtime is easier to test, document, and route deliberately.

Question #4: Why should `logic-eval` recommend both `HumanLikeReasoner` and `AdvancedReasoner` instead of collapsing all reasoning into one generic target?

Response: The two reasoners expose materially different execution contracts and safety boundaries. `HumanLikeReasoner` is for exact bounded symbolic work, while `AdvancedReasoner` is for bounded meta-reasoning that may end in review or engine escalation. Keeping both visible lets `logic-eval` help planning without hiding the interpreter taxonomy.

Question #5: Why should `logic-eval` explicitly avoid document-scale plan synthesis?

Response: Document-scale planning is not just a better rewrite brief. It needs chunk selection, declaration budgeting, rollups, validation, and structural insertion over explicit document inputs. Moving that responsibility into `logic-eval` would turn it back into a hidden second planner and would blur the contract boundary that DS008 is trying to preserve.

## Conclusion

`logic-eval` in MRP-VM v0 is a bounded orchestration helper for reasoning-heavy steps. It rewrites requests into structured briefs, recommends external reasoning interpreters, and helps planning stay lighter without duplicating the actual reasoning runtime.
