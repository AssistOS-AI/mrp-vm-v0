---
id: DS021
title: External Interpreter Contract
status: planned
owner: runtime
summary: Defines the shared contract for external interpreters, including non-LLM interpreters such as SMT, and its relation to the narrower LLM-wrapper DS.
---
# DS021 External Interpreter Contract

## Introduction

MRP-VM v0 distinguishes native commands from external interpreters. DS013 specifies the LLM-wrapper subset. This specification defines the wider contract that all external interpreters must satisfy, including non-LLM interpreters such as SMT-style solvers.

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
| `can_rewrite` | Whether SOP rewrite proposals are allowed |
| `can_refuse` | Whether explicit refusal is part of contract |
| `uses_llm_adapter` | Whether DS013 adapter governance applies |
| `capability_profile` | Host and runtime authority boundaries |
| `trace_requirements` | Minimum invocation and outcome trace fields |

### Relation to LLM wrappers

LLM wrappers are one specialized family of external interpreters. They must satisfy the DS021 contract and the additional DS013 rules about prompt assets, provider adapters, output modes, and token accounting.

### Non-LLM interpreters

Non-LLM external interpreters such as SMT or symbolic solvers remain first-class interpreters if they are invoked through the runtime, consume normalized inputs, and emit outcomes that fit the same external-execution contract. They are not second-class simply because they do not use model providers.

## Decisions & Questions

Question #1: Why do all external interpreters need one shared contract skeleton?

Response: The runtime scheduler, planning logic, and trace system need to know what they can expect from any external capability before caring whether it is LLM-based or symbolic. A shared contract keeps those integration points stable.

Question #2: Why is SMT treated as a first-class external interpreter rather than being folded into the LLM-wrapper family?

Response: SMT-style solvers are external execution capabilities, but they do not share LLM-specific concerns such as prompt assets, provider credentials, or token budgeting. Giving them first-class external-interpreter status preserves the native/external distinction without forcing an LLM-shaped contract onto symbolic tools.

Question #3: Why does DS021 sit next to DS013 instead of replacing it?

Response: The LLM wrappers need additional governance that generic external interpreters do not. DS021 defines the common external boundary; DS013 narrows the contract for the LLM-specific subset.

Question #4: Should the first implementation include SMT in the baseline interpreter catalog?

Options:

Option 1: Yes, include SMT early as a representative non-LLM interpreter.
Implications: This would make the external-interpreter abstraction more concrete from the start, but it also increases first-wave implementation scope.

Option 2: No, define the contract now and add SMT later.
Implications: This keeps the first implementation narrower while still preventing the contract from becoming LLM-only by accident.

## Conclusion

DS021 prevents “external interpreter” from meaning only “LLM wrapper.” It gives the runtime one common contract for outside capabilities while preserving DS013 for the stricter LLM-specific rules.
