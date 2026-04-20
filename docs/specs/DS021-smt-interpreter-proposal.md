---
id: DS021
title: SMT Interpreter Proposal
status: proposed
owner: runtime
summary: Proposal-only DS for a future SMT-style external interpreter family and its default-KU declaration requirements.
---
# DS021 SMT Interpreter Proposal

## Introduction

This DS is a proposal, not part of the initial implementation baseline. Its purpose is to reserve a clean architectural slot for future SMT-style interpreters so that the external-interpreter model does not drift into an LLM-only worldview.

## Core Content

### Proposed role

An SMT-style interpreter would be an external interpreter under DS020. Its intended use cases are:

1. satisfiability checks,
2. bounded consistency checking,
3. constraint solving over planner-produced artifacts,
4. symbolic validation of selected runtime claims.

The interpreter would consume normalized inputs prepared by the runtime rather than raw ad hoc solver prompts.

### Proposed contract shape

If adopted later, the SMT interpreter family should declare through default KUs:

1. supported logical fragments or solver dialects,
2. preferred input templates,
3. expected output shapes such as `sat`, `unsat`, `unknown`, model payload, or proof summary,
4. capability boundaries and cost class,
5. refusal conditions for unsupported theories or oversized problems.

This keeps the solver contract aligned with DS011 and DS020 from the start.

### Non-baseline status

The repository should not treat SMT as part of the first implementation target. The proposal exists so future work can add solver capability without reopening the generic external-interpreter contract from scratch.

## Decisions & Questions

Question #1: Why keep a dedicated SMT proposal DS if SMT is not in the baseline implementation?

Response: The general external-interpreter contract should remain broad enough for symbolic tools, but concrete solver assumptions do not belong inside that general DS. A proposal DS preserves architectural clarity without pretending SMT is already in scope.

## Conclusion

DS021 reserves a clean future path for SMT-style interpreters while keeping them explicitly out of the initial MRP-VM v0 implementation scope.
