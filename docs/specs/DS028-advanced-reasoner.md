---
id: DS028
title: AdvancedReasoner
status: implemented
owner: runtime
summary: Defines the AdvancedReasoner external interpreter, its bounded JavaScript response-program contract, shipped advanced reasoning classes, and local-versus-engine boundary.
---

# DS028 AdvancedReasoner

## Introduction

`AdvancedReasoner` is the second implemented reasoning interpreter in MRP-VM v0. It is designed for bounded advanced reasoning tasks where the runtime should make uncertainty, evidence quality, review boundaries, and engine escalation explicit instead of pretending the task is already a finite closed-world solver problem.

Like `HumanLikeReasoner`, it is an external interpreter with its own guidance assets and runtime boundary. Unlike `HumanLikeReasoner`, it does not end by emitting only a solved family value. It ends by returning a typed bounded response that can say the local pass was useful but partial, needs clarification, needs review, or should be escalated to a more specialized engine.

## Core Content

### Input contract

`AdvancedReasoner` must accept these repository-owned input shapes:

1. a direct natural-language advanced reasoning task,
2. a structured rewrite brief whose main payload is `rewritten_problem`,
3. a JSON envelope that may override `result_mode`, `program`, or generation settings for tests and controlled execution.

The interpreter must preserve explicit observations, hypotheses, options, constraints, requested answer sections, and escalation-relevant details when they are already present in the input. It must not broaden the task into generic analysis prose.

### Program-generation and execution flow

The execution flow is:

1. normalize the input into one bounded advanced reasoning task,
2. obtain prompt guidance from default KUs,
3. ask the managed adapter for a bounded JavaScript reasoning program through `logicGeneratorLLM`,
4. run preflight validation on the returned source,
5. execute only approved constructs inside a restricted runtime,
6. terminate through `ctx.returnResponse(ReasonerResponse.*(...))`,
7. render the returned response into the ordinary family system plus auxiliary trace-facing surfaces.

Inline `program` input remains valid for tests and controlled fixtures, but the repository default path is generated program source plus local validation.

### Runtime contract

The generated reasoning program must create an `ExecutionContext` and may use only approved classes plus small scalar utilities. The repository-owned baseline allows:

| Surface | Role |
| --- | --- |
| `ExecutionContext` | Working memory, stored results, assumptions, trace, and final typed response |
| `ReasonerResponse` | Typed bounded exit statuses and promotion boundary |
| `AbductiveReasoningProblem` | Explicit hypothesis ranking over observations |
| `ProbabilisticReasoningProblem` | Tiny finite probabilistic updates |
| `CausalReasoningProblem` | Bounded causal triage and escalation detection |
| `ArgumentationProblem` | Small argument and attack structures |
| `BeliefRevisionProblem` | Minimal bounded repair over retractable assumptions |
| `LegalReasoningProblem` | Structural applicability scans with review boundaries |
| `ScientificSynthesisProblem` | Small evidence synthesis over explicit findings |
| `OptimizationReasoningProblem` | Tiny local optimization or optimization-engine recommendation |
| `FormalProofRoutingProblem` | Bounded proof-task classification and routing |
| `SMTReasoningProblem` | Tiny Int/Bool SMT fragments or SMT-engine recommendation |
| `PragmaticInterpretationProblem` | Bounded frame ranking and clarification prompts |
| `AnalogicalReasoningProblem` | Structural analogy scoring |
| `EthicalDeliberationProblem` | Bounded option comparison with review boundaries |
| `CreativeEvaluationProblem` | Bounded rubric checks for creative artifacts |

The repository-owned prompt assets must teach the canonical public method names for these classes and the bounded response statuses. The runtime must not allow `ctx.emit(...)`, provider calls, file access, or general host scripting inside generated advanced reasoning programs.

### Output contract

The primary successful outcome is one bounded response object with one of these statuses:

1. `reasoned`
2. `solved`
3. `partial`
4. `needs_clarification`
5. `needs_engine`
6. `needs_review`
7. `inconclusive`
8. `error`

The interpreter must render that response into:

1. the main target family,
2. a `:meta` surface,
3. `:open_questions` when present,
4. `:engine_requirements` when present,
5. `:assumptions` when local assumptions were recorded,
6. `:results` when local result artifacts were recorded,
7. `:trace` when trace text is available.

This keeps the advanced reasoning pass inspectable without pretending that every task ends in one exact local answer.

### Shipped reasoning-class baseline

The repository-owned implementation baseline in v0 covers these classes only:

1. `AbductiveReasoningProblem`
2. `ProbabilisticReasoningProblem`
3. `CausalReasoningProblem`
4. `ArgumentationProblem`
5. `BeliefRevisionProblem`
6. `LegalReasoningProblem`
7. `ScientificSynthesisProblem`
8. `OptimizationReasoningProblem`
9. `FormalProofRoutingProblem`
10. `SMTReasoningProblem`
11. `PragmaticInterpretationProblem`
12. `AnalogicalReasoningProblem`
13. `EthicalDeliberationProblem`
14. `CreativeEvaluationProblem`

The broader research direction may later add more advanced families, but DS028 must describe only the shipped baseline as implemented today.

## Decisions & Questions

Question #1: Why is `AdvancedReasoner` an external interpreter instead of a native command?

Response: It has its own routing identity, prompt discipline, typed response model, and execution boundary. Treating it as an external interpreter keeps those concerns explicit and aligned with DS020 rather than burying them inside one native helper.

Question #2: Why return a `ReasonerResponse` instead of using `ctx.emit(...)` like `HumanLikeReasoner`?

Response: Advanced reasoning often needs to say more than "here is the answer." It may need to say the bounded local pass was only partial, requires clarification, needs review, or should escalate to another engine. A typed response object keeps those outcomes explicit and machine-usable.

Question #3: Why allow local success and local escalation in the same interpreter?

Response: Many advanced tasks benefit from a bounded local pass even when the final promoted conclusion belongs elsewhere. For example, a causal check can expose the missing confounder information before routing to a larger engine. Splitting those into two unrelated interpreters would hide the continuity between local analysis and explicit escalation.

Question #4: Why keep `AdvancedReasoner` bounded instead of turning it into a freeform meta-agent?

Response: The repository contract is still about inspectable local reasoning, not about another opaque planner. `AdvancedReasoner` may classify, compare, and recommend, but it must do so through approved local classes, explicit trace, and typed response statuses.

## Conclusion

`AdvancedReasoner` is the implemented bounded advanced reasoning interpreter for MRP-VM v0. It turns direct tasks or rewrite briefs into validated reasoning programs, executes them under strict runtime rules, and returns typed bounded responses that expose both useful local analysis and explicit escalation boundaries.
