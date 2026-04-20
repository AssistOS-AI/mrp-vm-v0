---
id: DS013
title: LLM Wrapper Interpreters
status: implemented
owner: runtime
summary: Defines the provider adapter contract, profile-specific prompt governance, default KU guidance, and output modes for LLM-based interpreters.
---
# DS013 LLM Wrapper Interpreters

## Introduction

MRP-VM v0 needs multiple LLM-facing execution profiles, but they must share one adapter architecture and one prompt-governance model. This DS defines that common contract and the allowed differences between wrapper profiles.

## Core Content

### Provider adapter contract

Every wrapper must reach a model provider only through the managed adapter. The minimum adapter invocation object must support:

| Field | Meaning |
| --- | --- |
| `profile` | Wrapper profile name such as `fastLLM` or `plannerLLM`. |
| `model_class` | Cheap, medium, or strong routing hint. |
| `prompt_assets` | Required and selected prompt assets resolved through `kb`. |
| `context_package` | Bounded DS005 context package. |
| `instruction` | Normalized task instruction. |
| `expected_output_mode` | Plain value, code block, SOP proposal, ranked candidates, or structured JSON. |
| `input_budget` | Token budget and size expectations for the prompt. |
| `output_budget` | Maximum response size or token target. |
| `trace_context` | Request, epoch, and component identifiers. |

The adapter result must distinguish successful completion, semantic refusal, low-confidence completion, and transport or provider failure.

### Profiles

The required wrapper profiles are:

| Profile | Intended role |
| --- | --- |
| `fastLLM` | Cheap extraction, matching, metadata induction, and lightweight synthesis. |
| `deepLLM` | Stronger reasoning when escalation is justified. |
| `codeGeneratorLLM` | Code or transformation generation. |
| `writerLLM` | Fluent wording when deterministic templates are insufficient. |
| `plannerLLM` | Planning proposals or executable SOP proposals under native planning control. |

Profiles may share implementation code, but they must remain distinct configuration instances with different routing expectations, output modes, and budgets.

### Prompt governance and caller guidance

Substantive wrapper guidance must come from KU-managed prompt assets. Hardcoded wrapper prompts may contain only transport-safe protocol framing, minimal schema reminders, and invariant parser-safety text.

Every wrapper profile must also have default KUs that describe:

1. preferred input packaging conventions,
2. any regex- or rule-based fast paths for interpreting wrapper-local directives,
3. allowed output modes,
4. when fallback to heavier model behavior is allowed.

This keeps wrapper use aligned with DS011 rather than hidden inside adapter code.

### Output modes and boundary

The runtime must declare allowed output modes per profile. Example baseline:

| Profile | Allowed output modes |
| --- | --- |
| `fastLLM` | plain value, structured JSON, short candidate list |
| `deepLLM` | plain value, structured JSON, comparative reasoning payload |
| `codeGeneratorLLM` | code block, structured patch payload |
| `writerLLM` | plain value, structured prose payload |
| `plannerLLM` | planning proposal, executable SOP proposal |

Even when `plannerLLM` emits executable SOP, the native `planning` command remains the validation and application authority.

The output-mode table above is normative. Profiles do not share one maximal output surface in v0.

Non-LLM external interpreters and the wider external-interpreter contract surface are specified separately in DS020 so that LLM-wrapper policy does not become the accidental contract for every external capability.

## Decisions & Questions

Question #1: Why do all wrappers share one adapter contract instead of each profile talking to providers directly?

Response: Shared adapter control is what lets the runtime standardize token accounting, caching, failure taxonomy, trace payloads, and provider credential handling. If each profile owned its own provider path, the runtime would lose one of its main control surfaces.

Question #2: Why may `plannerLLM` emit executable SOP proposals but not own graph mutation directly?

Response: Allowing proposal emission keeps the profile expressive enough for planning work, but native validation is still required to preserve one graph-authority boundary. This prevents model output from bypassing budget checks and graph validation.

Question #3: Why are non-LLM external interpreters specified separately from the LLM-wrapper DS?

Response: LLM wrappers share prompt governance, model classes, and provider access constraints that do not apply cleanly to every external interpreter. Separating the broader external-interpreter contract keeps DS013 focused.
## Conclusion

LLM wrappers in MRP-VM v0 must be differentiated in role but unified in control, prompt governance, and provider access discipline.
