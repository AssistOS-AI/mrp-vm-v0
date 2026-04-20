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

### Relation to LLM wrappers and non-LLM interpreters

LLM wrappers are one specialized family of external interpreters. They must satisfy the DS020 contract and the additional DS013 rules about prompt assets, provider adapters, output modes, and token accounting.

Non-LLM external interpreters remain first-class interpreters if they are invoked through the runtime, consume normalized inputs, and emit outcomes that fit the same external-execution contract. They are not second-class simply because they do not use model providers.

Detailed SMT direction, if adopted later, is specified separately in DS021 so that the general contract does not become solver-specific.

The first implementation does not include solver-style interpreters in the baseline catalog. DS020 fixes the generic contract now so later solver work can attach to it cleanly.

## Decisions & Questions

Question #1: Why do all external interpreters need one shared contract skeleton?

Response: The runtime scheduler, planning logic, and trace system need to know what they can expect from any external capability before caring whether it is LLM-based or symbolic. A shared contract keeps those integration points stable.

Question #2: Why must interpreter contracts and capabilities be declared through default KUs?

Response: Commands and interpreters should publish their preferred input shape and authority boundary through the same inspectable knowledge substrate used elsewhere in the runtime. Otherwise those contracts would become hidden implementation facts.

## Conclusion

DS020 prevents external interpreter from meaning only LLM wrapper. It gives the runtime one common contract for outside capabilities while keeping their actual declarations inspectable through default KUs.
