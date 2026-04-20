---
id: DS004
title: Security and Capability Profiles
status: proposed
owner: runtime
summary: Proposal-only capability framework for default-deny execution, sandbox boundaries, and privileged-action trace requirements.
---
# DS004 Security and Capability Profiles

## Introduction

This DS is a proposal surface, not part of the initial implementation baseline. MRP-VM v0 will eventually need explicit capability profiles for commands, interpreters, and hosting layers, but the repository should currently treat this document as a hardening proposal that must be revisited before implementation.

## Core Content

### Capability axes

Every command or interpreter profile should eventually declare whether it may:

1. Read resolved runtime variables.
2. Emit new concrete variants.
3. Emit metadata updates.
4. Insert new SOP declarations into the graph.
5. Call external interpreters.
6. Read KUs and prompt assets.
7. Read analytic-memory exports or summaries.
8. Load deterministic helper libraries.
9. Read product-owned storage roots.
10. Write product-owned storage roots.
11. Access the host filesystem outside allowed roots.
12. Access the network.
13. Use provider credentials through the managed adapter.

The intended direction is deny-by-default outside runtime state and explicitly allowed storage roots.

### Proposal baseline profiles

| Component | Proposed authority |
| --- | --- |
| `js-eval` | Read runtime state, emit variants and metadata, insert declarations, no unrestricted host access. |
| `logic-eval` | Read runtime state, emit bounded effects, no host access. |
| `template-eval` | Read runtime state, emit deterministic text, no host access. |
| `planning` | Read graph state, KUs, errors, and budgets; insert declarations and propose reroutes within policy. |
| `analytic-memory` | Read and update managed analytic state, export summaries, no unrestricted host access. |
| `kb` | Read and write configured KU roots, no unrestricted shell or arbitrary filesystem access. |
| `credibility` | Read candidates, emit scores and withdrawals, and request additional evaluation steps when policy allows. |
| External interpreters | Reach outside capabilities only through DS020-style registrations and approved profiles. |

### Sandbox proposal

The current proposal baseline for `js-eval` is isolated-process execution with structured RPC over a narrow command protocol. If a lighter mechanism is ever used for trusted development, that must remain a policy-specific downgrade rather than the main capability story.

The proposal assumes no host-side escape hatch and no named capability bundles for the v0 baseline. If those ideas ever return, they must be introduced explicitly in a later revision rather than assumed implicitly by implementation.

Capability profiles should be request-scoped by default. A DS must opt in explicitly before a capability is allowed to persist across requests or be treated as environment-wide.

Privileged actions should always be trace-visible. Trace payloads for privileged actions should include the component, the granted capability, the policy profile, and the resource target when applicable.

## Decisions & Questions

Question #1: Why is DS004 marked as proposal-only instead of as immediate implementation scope?

Response: The runtime has not yet been implemented, and capability hardening is easier to specify well once the actual command and hosting seams exist. Marking DS004 as proposal-only prevents the repository from pretending that a full security model is already implementation-ready.

## Conclusion

Security in MRP-VM will eventually need to be capability-based, default-deny, and trace-visible. For now, DS004 is a proposal boundary rather than an implementation-ready commitment.
