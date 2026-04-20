---
id: DS011
title: kb Command
status: implemented
owner: runtime
summary: Defines SOP-backed KU files, deterministic retrieval modes, caller-profile KUs, filtering rules, overlay rules, and file-system serialization for default, global, and session knowledge.
---
# DS011 kb Command

## Introduction

The `kb` command is the authoritative knowledge-management mechanism of MRP-VM v0. It must handle reusable content KUs, prompt assets, caller profiles, session overlays, revision management, and bounded context injection without relying on hidden LLM-based retrieval.

DS005 consumes the final context package. DS016 owns the broader session/request persistence model. DS011 owns the knowledge artifacts and retrieval path that feed both.

## Core Content

### KU file model

A KU is stored as one plain SOP Lang text file. KU files must not use a separate metadata front-matter block. Instead:

1. the KU public root variable is the KU identifier,
2. KU metadata lives in `<ku_id>:meta`,
3. supporting helper variables may exist in the same SOP module when needed.

The KU identifier must be variable-safe and stable. The baseline form is `ku_` plus a cryptographically strong lowercase hexadecimal suffix.

Minimum KU metadata fields stored in `<ku_id>:meta` are:

| Field | Meaning |
| --- | --- |
| `rev` | Monotonic revision number. |
| `ku_type` | `content`, `prompt_asset`, `template_asset`, `example_asset`, `policy_asset`, or `caller_profile`. |
| `scope` | `global`, `session`, or `default`. |
| `status` | `active`, `inactive`, `withdrawn`, or `draft`. |
| `title` | Human-readable label. |
| `summary` | Retrieval-facing purpose statement. |
| `priority` | Numeric preference signal. |
| `trust` | Canonical, trusted, normal, or low. |
| `domains` | Domain tags. |
| `commands` | Relevant native commands. |
| `interpreters` | Relevant external interpreters. |
| `tags` | Additional retrieval hints. |
| `input_patterns` | Regex-friendly or rule-friendly parsing hints for callers. |

Prompt assets additionally use metadata such as `prompt_role`, `prompt_mode`, `mandatory_group`, `target_interpreters`, `model_classes`, `activation_tags`, and `version_policy`.

Caller profiles and capability declarations for native commands and external interpreters must also be represented as default KUs rather than as hardcoded tables hidden in code.

### Bootstrap sequence

The runtime must bootstrap `kb` in this order before any ordinary retrieval happens:

1. load `data/default/callers/*.sop`,
2. load `data/default/kus/**/*.sop`,
3. build the minimal caller-profile and KU indexes from those default assets,
4. allow ordinary retrieval for planning, commands, and interpreters,
5. layer global and session KUs on top when they exist.

This bootstrap order resolves the apparent circularity between "caller profiles are KUs" and "`kb` needs caller profiles to retrieve KUs." Default caller-profile KUs are available before the first retrieval call.

### Retrieval paths

Ordinary retrieval must be symbolic and deterministic. The runtime must support two ordinary retrieval paths:

1. **Automatic caller retrieval** for planning, commands, and interpreters before invocation.
2. **Explicit `kb` query retrieval** when a declaration asks `kb` to search for user-supplied text.

Every retrieval request normalizes into an object containing at least:

- caller name,
- retrieval mode,
- desired KU types,
- required prompt groups,
- accepted model classes,
- domain hints,
- query tokens,
- scope preference,
- byte budget,
- optional session and task hints.

### Retrieval situations and filtering inputs

The runtime must distinguish these retrieval situations:

| Situation | Typical caller | Primary filtering inputs | Lexical inputs |
| --- | --- | --- | --- |
| `planning_bootstrap` | DS006 planning | mode, mandatory prompt groups, domains, session/global/default scope, attached file descriptors | user request text, request summaries, repair notes when applicable |
| `automatic_native_command` | planned native command | caller profile, command id, target family, domains, referenced families, required prompt groups | declaration-body text derived by caller-profile extraction rules |
| `automatic_external_interpreter` | planned external interpreter | caller profile, interpreter id, model class, target family, domains, referenced families, required prompt groups | declaration-body text derived by caller-profile extraction rules |
| `manual_component_call` | host- or test-triggered command/interpreter call | caller profile, explicit component id, target family if any, domains, current request/session scope | explicit invocation text or body, plus optional request summary |
| `explicit_kb_query` | explicit `kb` declaration | allowed KU types, domains, scope hints, optional target command/interpreter hints | explicit user-supplied search text is primary |

Declaration-body text is not treated uniformly for all callers. The caller-profile KU must define how to derive lexical material from the body:

1. For natural-language-heavy callers such as planning helpers or LLM wrappers, use the declaration body directly after light normalization.
2. For structured callers such as `js-eval`, `logic-eval`, or `template-eval`, first apply `input_patterns` and other caller-profile extraction rules to pull out the semantically meaningful fragments.
3. If the body yields no useful textual fragments after caller-specific extraction, skip the lexical phase and stay metadata-first.

This is how the runtime uses declaration content when it exists without pretending that all declaration bodies are equivalent search text.

The ranking rules are:

1. Always apply strict metadata gates first.
2. Resolve mandatory prompt groups before any soft ranking.
3. For automatic caller retrieval, rank primarily by metadata, scope precedence, trust, caller affinity, target-command or target-interpreter match, and domain overlap.
4. Add lexical scoring only when the active retrieval situation provides explicit search text or caller-derived body text.
5. The lexical phase should use BM25-style scoring or another deterministic symbolic method over rendered KU text, title, summary, tags, and selected metadata text fields.
6. Break remaining ties by scope precedence, then explicit priority, then stable KU id ordering.

This means planning and ordinary pre-execution injection usually rely on metadata-dominant retrieval, while explicit textual knowledge search uses metadata plus lexical ranking.

The filtering rules per situation are:

1. `planning_bootstrap`: require `ku_type=prompt_asset`, `prompt_role=planning`, matching mode groups, and active status before any lexical work. Use lexical ranking only over the request text, request summaries, and repair notes that survive normalization.
2. `automatic_native_command`: require caller-profile match, active status, allowed KU types, and command affinity first. Use declaration-body lexical cues only if caller-profile extraction yields meaningful fragments.
3. `automatic_external_interpreter`: same as automatic native command, but also require compatible interpreter name or model class where relevant.
4. `manual_component_call`: behave like automatic command/interpreter retrieval, but the explicit invocation text supplied by the caller counts as first-class lexical input even if there is no planner-produced declaration.
5. `explicit_kb_query`: after metadata gates, lexical ranking is mandatory because the user explicitly asked to search text rather than only to inject default guidance.

Ordinary retrieval must not depend on an LLM. LLM assistance belongs only to maintenance paths such as session-KU discovery, metadata induction, or other explicitly declared KB-curation flows.

### Overlay and injection

Retrieval precedence is:

1. Session
2. Global
3. Default

Session KUs may shadow global parents. Default assets exist to bootstrap the runtime before project-specific curation exists.

KUs resolved for one request are snapshot-isolated for that request. Revisions, promotions, or upserts that occur during the request become visible only to later requests, not mid-request to already running execution.

Before executing a native command or external interpreter, the runtime must automatically resolve the caller profile KU for that component and then run `kb` retrieval using that profile. The caller profile must declare:

1. required prompt groups,
2. accepted prompt roles,
3. accepted model classes,
4. allowed KU types,
5. whether session override is allowed,
6. byte budget,
7. preferred input patterns and LLM-fallback policy.

This is how MRP-VM makes explicit that every command and external interpreter should have default guidance about the input it prefers.

When both request-level text and declaration-body text exist, the retrieval policy must use both, but not with equal force:

1. caller-profile metadata and required groups always gate first,
2. request-level text provides broad task intent,
3. declaration-body text provides local execution intent,
4. referenced families and target family provide structural hints,
5. lexical ranking then combines the surviving text fields deterministically.

This prevents manual or planner-produced free text inside a declaration from being ignored while still keeping retrieval governed by explicit caller contracts.

### Serialization and file layout

The baseline file layout is:

| Path | Meaning |
| --- | --- |
| `data/default/kus/**/*.sop` | Bootstrap KUs and prompt assets. |
| `data/default/callers/*.sop` | Default caller-profile KUs and capability declarations. |
| `data/kb/global/**/*.sop` | Global curated KUs. |
| `data/sessions/<sessionId>/kb/**/*.sop` | Session-scoped overlay KUs. |
| `data/sessions/<sessionId>/indexes/kb-catalog.jsonl` | Session-local materialized retrieval index or cache. |
| `data/sessions/<sessionId>/history/request-summaries.jsonl` | Request summaries usable as retrieval hints. |
| `data/sessions/<sessionId>/requests/<requestId>/current-plan.sop` | Current request plan snapshot, cross-owned with DS016. |

All of these artifacts should remain text-based and inspectable. Index files may be JSON or JSON Lines, but the authoritative KU source remains the SOP file.

### Upsert, revision, and promotion

Upsert creates a new revision rather than mutating the active artifact destructively. Content KUs usually float to the latest active revision. Prompt assets with `version_policy=locked` require explicit activation before the new revision becomes the winning active asset.

Session KUs may be forked from global KUs and may be promoted later under policy control. Promotion is not automatic. The minimum conceptual actions are:

1. `forkGlobalToSession`
2. `promoteSessionKU`
3. `promoteForkAsRevision`
4. `proposePromotion`

## Decisions & Questions

Question #1: Why are KU files plain SOP Lang rather than a separate metadata block plus body?

Response: The runtime already has one language substrate for values and metadata. Using a separate metadata block would create a second authoring format and duplicate the role that `:meta` already plays for ordinary variables.

Question #2: Why is ordinary retrieval metadata-first for automatic callers?

Response: Planning and automatic pre-execution injection usually already know the caller, role, domain, and required prompt groups. That metadata is richer and cheaper than free-text search. Using it first keeps retrieval fast and inspectable.

Question #3: When should BM25-style lexical scoring be used?

Response: It should run only after metadata gating and only when the retrieval path includes explicit search text or content discovery. Ordinary automatic caller retrieval should not pay lexical-search cost when caller metadata is already sufficient.

Question #4: Why are caller profiles and capability declarations stored as default KUs?

Response: Commands and interpreters should publish their preferred input shape, parsing hints, and fallback policy through the same inspectable substrate used for other reusable guidance. Otherwise those contracts would drift into hidden code tables.

Question #5: Why are KU revisions snapshot-isolated per request instead of becoming visible immediately?

Response: Mid-request knowledge changes would make execution and replay depend on timing accidents rather than on one stable retrieval view. Snapshot isolation preserves determinism for the current request while still allowing later requests to see newly curated knowledge.

## Conclusion

`kb` must remain the authoritative, SOP-backed, revision-aware knowledge substrate of MRP-VM v0, with caller profiles and prompt assets stored in the same inspectable ecosystem as ordinary knowledge units.
