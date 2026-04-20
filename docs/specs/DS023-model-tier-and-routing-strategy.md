---
id: DS023
title: Model Tier and Routing Strategy
status: implemented
owner: runtime
summary: Defines model tiers, profile bindings, task tags, runtime configuration overrides, and AchillesAgentLib resolution rules for LLM wrapper routing.
---
# DS023 Model Tier and Routing Strategy

## Introduction

MRP-VM v0 needs a routing policy for LLM-backed interpreters that is explicit, inspectable, and adjustable without editing wrapper code. DS013 defines the wrapper contract. DS023 defines how wrapper profiles map to model tiers, concrete models, task tags, and runtime configuration.

## Core Content

### Runtime configuration sources

The runtime must derive LLM routing from one explicit runtime configuration object. That object may combine:

1. repository defaults,
2. environment variables,
3. manual overrides supplied by the embedding host.

Manual overrides must win over environment-derived defaults. This is necessary for tests, local servers, and embedded hosts that need to pin routing without mutating process-wide environment state.

### AchillesAgentLib resolution

The runtime may resolve AchillesAgentLib from:

1. an explicit manual override path,
2. a sibling or parent directory repository checkout,
3. installed `node_modules`.

If AchillesAgentLib is unavailable, the runtime may use a fake adapter only when the provider configuration explicitly allows that fallback or when deterministic tests require it. The absence of AchillesAgentLib must never be hidden behind a fake "real provider" claim.

### Model tiers

The baseline model tiers are:

| Tier | Meaning |
| --- | --- |
| `fast` | Lowest-cost routing for extraction, matching, and cheap helper work. |
| `standard` | Balanced routing for ordinary synthesis and generation. |
| `premium` | Stronger routing for planning, difficult reasoning, or high-value generation. |

Each tier resolves to a concrete model identifier through runtime configuration. DS023 does not hardcode vendor model names; it requires the tier map to remain configurable.

### Wrapper profile bindings

Each LLM wrapper profile must bind to a tier, a concrete model, and a task tag. The baseline routing table is:

| Profile | Tier | Task tag |
| --- | --- | --- |
| `fastLLM` | `fast` | `testing` |
| `deepLLM` | `premium` | `specification` |
| `codeGeneratorLLM` | `standard` | `project-bootstrap` |
| `writerLLM` | `standard` | `documentation` |
| `plannerLLM` | `premium` | `orchestration` |

Hosts may override the concrete model per profile and may override the tier or task tag when a downstream environment needs different routing economics.

### Task tags

Routing-sensitive work must carry task metadata tags so the provider layer can distinguish why a call exists. The baseline tags are:

1. `project-bootstrap`
2. `documentation`
3. `orchestration`
4. `specification`
5. `testing`

These tags are routing hints, not a substitute for wrapper profiles. A profile says what kind of interpreter is running. A task tag says what kind of repository work that invocation is serving.

## Decisions & Questions

Question #1: Why does DS023 separate model tiers from wrapper profiles?

Response: Profiles express behavioral contracts such as output mode and planning authority, while tiers express cost and strength expectations. Keeping them separate allows the host to retarget a profile to a different model without rewriting the wrapper DS.

Question #2: Why do manual overrides win over environment variables?

Response: Embedded runtimes, tests, and local tooling often need multiple configurations in one process or one session. Environment variables are too coarse for that. Manual overrides make routing explicit at the call site without forbidding environment defaults.

Question #3: Why are task tags required in addition to profile names?

Response: Two invocations may share one wrapper profile but belong to very different repository workflows. Task tags let the provider layer distinguish documentation, specification, orchestration, bootstrap, and testing work without duplicating wrapper profiles for every use case.

## Conclusion

MRP-VM v0 must route LLM wrapper work through explicit runtime configuration, configurable model tiers, explicit profile bindings, and routing-sensitive task tags so provider access remains inspectable and host-controlled.
