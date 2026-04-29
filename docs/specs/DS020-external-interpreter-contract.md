---
id: DS020
title: External Interpreter Contract
status: implemented
owner: runtime
summary: Defines the shared contract for external interpreters, the default-KU declaration model for their capabilities, and its relation to DS013 and DS021.
---
# DS020 External Interpreter Contract

## Introduction

MRP-VM v0 distinguishes native commands from external interpreters. DS013 specifies the LLM-wrapper subset. This specification defines the wider contract that all external interpreters must satisfy, including non-LLM interpreters such as symbolic or solver-based tools.

## Core Content

### Shared contract fields

Every external interpreter registration must declare at least:

| Field | Meaning |
| --- | --- |
| `name` | Stable interpreter identifier |
| `purpose` | Short functional description |
| `input_contract` | Admissible normalized payload shapes |
| `output_shapes` | Allowed output forms |
| `cost_class` | Cheap, medium, expensive, or domain-specific equivalent |
| `can_insert_declarations` | Whether SOP declaration insertion proposals are allowed |
| `can_refuse` | Whether explicit refusal is part of contract |
| `uses_llm_adapter` | Whether DS013 adapter governance applies |
| `capability_profile` | Host and runtime authority boundaries |
| `trace_requirements` | Minimum invocation and outcome trace fields |

### Default-KU declaration model

These contracts must not live only in code. Every external interpreter must have default KUs that declare:

1. the contract fields above,
2. preferred input patterns or parsing hints,
3. capability expectations,
4. output-shape examples,
5. fallback or refusal policy notes.

This keeps interpreter contracts aligned with DS011 rather than buried in adapter implementation.

The repository-owned default KUs for an interpreter must be selection-ready, not merely descriptive. Their summaries must help planning distinguish one interpreter from another, and their bodies must contain actionable guidance about valid task shapes and expected outputs.

### Relation to LLM wrappers and non-LLM interpreters

LLM wrappers are one specialized family of external interpreters. They must satisfy the DS020 contract and the additional DS013 rules about prompt assets, provider adapters, output modes, and token accounting.

Non-LLM external interpreters remain first-class interpreters if they are invoked through the runtime, consume normalized inputs, and emit outcomes that fit the same external-execution contract. They are not second-class simply because they do not use model providers.

Detailed SMT direction, if adopted later, is specified separately in DS021 so that the general contract does not become solver-specific.

The baseline catalog now includes three concrete interpreter families above the generic DS020 skeleton: `HumanLikeReasoner`, whose detailed runtime contract is specified in DS026 and whose guidance and coverage obligations are specified in DS027; `AdvancedReasoner`, whose detailed runtime contract is specified in DS028 and whose guidance and coverage obligations are specified in DS029; and `DocumentScalePlanner`, whose detailed runtime contract is specified in DS030 and whose guidance and coverage obligations are specified in DS031. DS020 remains the generic contract layer above those concrete interpreters.

## Decisions & Questions

Question #1: Why do all external interpreters need one shared contract skeleton?

Response: The runtime scheduler, planning logic, and trace system need to know what they can expect from any external capability before caring whether it is LLM-based or symbolic. A shared contract keeps those integration points stable.

Question #2: Why must interpreter contracts and capabilities be declared through default KUs?

Response: Commands and interpreters should publish their preferred input shape and authority boundary through the same inspectable knowledge substrate used elsewhere in the runtime. Otherwise those contracts would become hidden implementation facts.

Question #3: Why keep `HumanLikeReasoner` under the generic external-interpreter contract instead of creating a disconnected special case?

Response: Even though it is solver-oriented, it still participates in the same runtime surfaces: planning choice, KU guidance, trace, enabled-state control, and bounded invocation. Keeping it under DS020 prevents a solver interpreter from bypassing the ordinary integration rules.

Question #4: Why keep `AdvancedReasoner` under the same DS020 skeleton even though it returns richer bounded responses such as `needs_engine` and `needs_review`?

Response: The richer response model changes the interpreter's local contract, not its registry role. `AdvancedReasoner` is still an external interpreter chosen by planning, governed by default KUs, traced by the same runtime, and enabled or disabled through the same registry surface. DS020 should therefore remain the common contract backbone while DS028 and DS029 define the richer interpreter-specific semantics.

Question #5: Why keep `DocumentScalePlanner` under DS020 even though it inserts declarations rather than only returning one plain value?

Response: Declaration insertion is already part of the generic external-interpreter effect model. `DocumentScalePlanner` still has a registry contract, default KUs, planning selection rules, enabled-state control, and trace obligations like any other external interpreter. Its richer structural behavior belongs in its interpreter-specific DS files, not outside the DS020 backbone.

## Conclusion

DS020 prevents external interpreter from meaning only LLM wrapper. It gives the runtime one common contract for outside capabilities while keeping their actual declarations inspectable through default KUs.
