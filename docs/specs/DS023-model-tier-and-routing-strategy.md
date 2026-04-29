---
id: DS023
title: Model Tier and Routing Strategy
status: implemented
owner: runtime
summary: Defines model tiers, profile bindings, tag-aware model discovery, simplified settings-facing default-model controls, and AchillesAgentLib resolution rules for LLM wrapper routing.
---
# DS023 Model Tier and Routing Strategy

## Introduction

MRP-VM v0 needs a routing policy for LLM-backed interpreters that is explicit, inspectable, and adjustable without editing wrapper code. DS013 defines the wrapper contract. DS023 defines how wrapper profiles map to model tiers, concrete models, task tags, discovered model tags, and runtime configuration.

## Core Content

### Runtime configuration sources

The runtime must derive LLM routing from one explicit runtime configuration object. That object may combine:

1. repository defaults,
2. environment variables,
3. manual overrides supplied by the embedding host,
4. model discovery through AchillesAgentLib APIs when available.

Manual overrides must win over environment-derived defaults. This is necessary for tests, local servers, and embedded hosts that need to pin routing without mutating process-wide environment state.

### AchillesAgentLib resolution

The runtime resolves AchillesAgentLib from:

1. a repository-local `AchillesAgentLib/` directory,
2. a parent-directory checkout such as `../AchillesAgentLib/` or `../achillesAgentLib/`,
3. installed `node_modules`.

If AchillesAgentLib is unavailable, the runtime may use a fake adapter only when deterministic tests or explicit local overrides require it. The absence of AchillesAgentLib must never be hidden behind a fake "real" adapter claim.

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
| `logicGeneratorLLM` | `premium` | `specification` |
| `formatterLLM` | `standard` | `documentation` |

Hosts may override the concrete model per profile and may override the tier or task tag when a downstream environment needs different routing economics.

### Managed provider fallback

When the managed Achilles-backed adapter reports a provider failure for a routed profile, the runtime may retry that invocation against lower-cost tiers only when the runtime configuration explicitly enables fallback. The baseline fallback order is:

1. `premium` -> `standard`
2. `standard` -> `fast`

`fast` is terminal and does not degrade further. Fallback is for provider availability failures, not for semantic refusals or normal completed answers. The settings surface may expose this behavior as one compact operator toggle, but the authoritative state still lives in runtime configuration.

### Achilles model discovery and tags

When AchillesAgentLib is available, the settings surface must query it for the model catalog together with model metadata such as tier and tags. The server-facing model catalog must normalize those results into:

1. a stable model `id`,
2. a display `name`,
3. a normalized tier,
4. a tag list,
5. an `is_default` marker for the currently selected default.

When AchillesAgentLib is not available, the server may infer tags heuristically from configured model names so the settings page still has a usable selection surface.

### Settings-facing selection behavior

The settings page must expose model selection through compact select controls rather than through a separate read-only gallery of candidate cards. The required behavior is:

1. model options show associated tags inline in their labels,
2. model tag filters may narrow the visible options without hiding the full catalog permanently,
3. the default-model selection is rendered compactly,
4. the settings UI must also expose one compact model select for each LLM routing target when operators need explicit per-profile routing, including internal command stages such as `logicGeneratorLLM` and `formatterLLM`,
5. the per-profile controls must reuse the same discovered model catalog rather than inventing a second model source,
6. the UI should not dedicate a separate "candidate models" panel once the tag-aware selects already expose the catalog.

The purpose of tags is routing clarity, not decorative display. If the runtime knows a model is tagged `coding`, `reasoning`, or `agentic`, that information must be visible where the user makes the selection.
When the UI exposes per-profile bindings, it should still keep the presentation compact and operator-facing rather than turning settings into a raw dump of adapter internals.

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

Question #4: Why allow the settings UI to expose per-profile bindings even though they are internal runtime routing state?

Response: Once operators need to pin different models for `plannerLLM`, `writerLLM`, `logicGeneratorLLM`, `formatterLLM`, or the other routed profiles, hiding those bindings entirely becomes artificial. The important constraint is not secrecy; it is UX discipline. The UI may expose one compact select per routed LLM target as long as it still routes through the authoritative runtime configuration and the shared discovered model catalog.

Question #5: Why make provider fallback opt-in instead of always retrying lower tiers?

Response: A silent downgrade can change cost, quality, or behavior in ways operators may want to control explicitly. An opt-in fallback keeps the routing policy inspectable while still giving deployments a practical recovery path when premium routes are temporarily unavailable.

## Conclusion

MRP-VM v0 must route LLM wrapper work through explicit runtime configuration, configurable model tiers, explicit profile bindings, routing-sensitive task tags, and tag-aware model discovery so provider access remains inspectable and host-controlled.
