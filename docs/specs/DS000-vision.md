---
id: DS000
title: Vision
status: implemented
owner: repository
summary: Defines the architectural identity, evaluation target, and documentation scope of MRP-VM v0.
---

# DS000 Vision

## Introduction

MRP-VM v0 is the first operational runtime of the Meta-Rational Pragmatics program. Its purpose is to replace a substantial portion of hidden, model-internal cognition with explicit local computation, explicit planning, explicit memory, explicit comparison, and explicit trace.

The project is not a workflow engine, not a prompt wrapper, and not a monolithic chat agent. It is a bounded execution machine that transforms natural-language requests, files, prior state, and reusable knowledge into an auditable graph of local declarations and runtime artifacts. MRP-VM can be a replacement for large LLMs by solving requests using smaller LLMs and symbolic reasoning or, depending on the interpreters it receives in its configuration, it can become an AI agent that takes actions upon the environment.



## Core Content
<!-- {"achilles-ide-paragraph":{"id":"paragraph-ce3303b0-193f-4ea2-9906-29f6da133641","type":"markdown","title":"Paragraph 1"}} -->
The runtime must be designed around explicit externalization of intermediate work. A useful execution step in MRP-VM is not merely a line of prose returned by a model. It is a named artifact, a candidate value, a score, a declaration insertion, a memory aggregate, or a trace event that can be inspected and reused later.

The architecture must preserve six project-level commitments.

1. Planning must be explicit, bounded, and revisable.
2. Runtime state must be explicit through families, variants, metadata, and trace.
3. Plurality must be explicit and limited to declarations that ask for it.
4. Candidate evaluation must be at least partially independent from candidate production.
5. Reusable guidance must be represented as knowledge units loaded through bounded retrieval.
6. The implementation target must remain a reusable Node.js SDK rather than a server-first monolith.

The right comparison target for MRP-VM v0 is not only a raw model endpoint. It is a configured VM instance: active native commands, wrapper profiles, KUs, memory state, policies, and synthesis rules considered as one system. This means that implementation choices must optimize not only output quality but also traceability, bounded cost, stability under partial change, and selective recomputation.

Normative architecture language must use `native command` and `external interpreter`. The term `plugin` is not part of the v0 product vocabulary because it obscures the difference between VM-owned execution surfaces and externally adapted capabilities.

The runtime is SDK-first. Optional servers, chat shells, or admin surfaces may embed the runtime later, but the primary product identity is an embeddable Node.js `.mjs` runtime that other applications can host and configure.

All native commands and external interpreters must be treated as bounded interpreters of natural-language intent plus structured runtime context. Their preferred input shapes, fast parsing hints, and fallback rules must be declared through default KUs rather than hidden in code or left to guesswork.

Session-local continuity in v0 stays inside the `kb` session overlay. The baseline architecture does not introduce a second continuity command or a separate memory substrate for ordinary request flow.

The project documentation must stay strictly about MRP-VM v0. External authoring or bootstrap tooling may be used to create or refine the documentation set, but it is not part of the product surface and must not appear as project DS files or product HTML chapters.


## Decisions & Questions

Question #1: Why is MRP-VM v0 specified as a runtime instead of a prompt methodology?

Response: The supplied architecture material consistently argues that the core problem is structural opacity, not just prompt quality. A runtime can own state, budgets, graph growth, comparison, memory, and replay in a way that a prompt methodology cannot. Treating the system as a runtime therefore makes the implementation target auditable and modular rather than advisory.

## Conclusion

MRP-VM v0 must be implemented as a governed execution system for explicit local computation. The DS set exists to keep that target precise enough for implementation while preserving a strict boundary between product architecture and auxiliary tooling.
