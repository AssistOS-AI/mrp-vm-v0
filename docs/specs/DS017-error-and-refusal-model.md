---
id: DS017
title: Error and Refusal Model
status: implemented
owner: runtime
summary: Defines normalized failure kinds, pending-versus-error state, repair boundaries, and KU-shaped error presentation for MRP-VM v0.
---
# DS017 Error and Refusal Model

## Introduction

MRP-VM v0 needs one normalized failure model so parser errors, missing dependencies, native-command failures, wrapper refusals, policy denials, and blocked regions do not get represented ad hoc by each subsystem. This specification defines that shared model and the boundary between repairable failure, terminal failure, and non-error unknown outcomes.

## Core Content

### Normalized outcome categories

The runtime must distinguish these categories:

| Category | Meaning |
| --- | --- |
| `parse_error` | SOP Lang or command-local syntax is malformed before execution can proceed. |
| `resolution_error` | A required dependency or command target could not be resolved. |
| `contract_refusal` | A command or interpreter declines the task because the normalized request is out of contract, underspecified, unsafe, or policy-disallowed for that component. |
| `execution_error` | The component attempted execution and failed locally. |
| `provider_failure` | External transport, quota, provider, or adapter failure prevented completion. |
| `policy_denied` | Capability or policy gates blocked the action before execution. |
| `blocked_state` | No usable representative exists for a required family and execution cannot continue without repair or stop. |
| `budget_exhausted` | Request, planning, retry, or structural-change budget was exhausted. |
| `unknown_outcome` | No stable usable answer was produced, but the event is not itself an execution error. |

### Pending, error, and structured error values

The runtime must keep `pending` distinct from `error`.

1. `pending` means a declaration exists for a family but no concrete usable variant has been produced yet.
2. `error` means execution produced a non-usable concrete variant whose value payload is a structured error record.

A family-scoped non-success result must be represented through ordinary append-oriented variants plus metadata, not through hidden side channels. The minimum error payload is:

1. `kind`
2. `message`
3. `origin`
4. optional blocked-family or provider details

The minimum metadata for a non-success variant is:

1. `status`
2. `error_kind`
3. `reason`
4. `repairable`
5. `origin`
6. `created_epoch`
7. `retry_count`

### Propagation and blocking rules

A declaration may execute only when every required dependency resolves to at least one usable representative or the declaration contract marks the slot optional. A usable representative is one whose active metadata is not `error`, `refused`, `blocked`, `withdrawn`, or `unknown`.

Propagation rules are:

1. If usable and non-usable variants coexist in one family, representative search must ignore the non-usable variants unless policy explicitly asks for repair review.
2. If only non-usable variants exist for a required family, that family enters `blocked_state`.
3. `contract_refusal` should bias repair toward rerouting, better context, or narrower task decomposition rather than blind retry of the same component.
4. `provider_failure` may use bounded retry before it upgrades to `blocked_state`.
5. `policy_denied` and request-level `parse_error` are terminal for the blocked region unless configuration changes outside the request.

### Repair boundary and stop semantics

Repairability is a first-class field, not an inference left to planners. The baseline expectations are:

| Kind | Default repair posture |
| --- | --- |
| `parse_error` | terminal for the submitted payload |
| `resolution_error` | repairable if planning can produce the missing dependency |
| `contract_refusal` | repairable through reroute, normalization, or narrowed task |
| `execution_error` | repairable only within bounded retry or alternate routing |
| `provider_failure` | repairable within adapter retry policy and request budget |
| `policy_denied` | terminal unless a higher-level actor changes policy |
| `blocked_state` | repairable only while planning and retry budgets remain |
| `budget_exhausted` | terminal for the request |
| `unknown_outcome` | soft-stop or repair depending on downstream need |

When the runtime exhausts the recovery budget and can no longer make meta-rational progress, it must stop explicitly with a normalized terminal outcome rather than continue retrying optimistically.

Error messages, user-facing stop summaries, and repair guidance text should be shaped by KU-managed assets rather than hardcoded large message templates in code. The code must normalize the failure; the presentation layer may then render it using curated knowledge.

## Decisions & Questions

Question #1: Why must `pending` stay distinct from `error`?

Response: Planning and repair need to know whether a family simply has not been computed yet or whether computation already failed. Treating those states as equivalent would make repair much less precise.

Question #2: Why should error messages and stop summaries be shaped by KUs instead of hardcoded prose?

Response: Error normalization and human presentation are different responsibilities. KU-shaped messaging lets deployments adapt wording, guidance, and domain terminology without changing the normalized failure contract.

Question #3: Why is `unknown_outcome` treated as non-usable for automatic representative selection?

Response: `unknown_outcome` records a visible non-success, not a soft success. If the runtime treated it as usable, downstream dependencies could proceed on artifacts that explicitly failed to yield a stable answer.

## Conclusion

MRP-VM v0 must treat failure as structured runtime state with explicit kinds, explicit pending-versus-error distinction, and explicit repair boundaries. Without one normalized model, planning, scheduling, wrappers, and replay would each invent incompatible failure semantics.
