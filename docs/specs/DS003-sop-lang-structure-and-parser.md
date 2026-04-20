---
id: DS003
title: SOP Lang Structure and Parser
status: implemented
owner: runtime
summary: Defines declaration-line grammar, parser outputs, declaration content versus variable content, and family-aware parsing conventions for SOP Lang.
---
# DS003 SOP Lang Structure and Parser

## Introduction

This specification owns the source-text structure of SOP Lang. DS002 defines what declarations and families mean once parsed. DS003 defines how the runtime recognizes declaration boundaries, distinguishes declaration content from emitted variable content, and constructs the parse artifacts consumed by graph compilation.

## Core Content

### Three distinct content surfaces

MRP-VM v0 must keep these surfaces separate:

1. **Declaration content**: the SOP Lang declaration text produced by planning or structural insertion. This is what says how a family should be computed.
2. **Variable content**: the emitted value of a concrete variant such as `report:v3`.
3. **Variable metadata**: the `:meta` payload attached to a family or concrete variant, including provenance, status, and credibility scores.

Planners and repair logic operate primarily on declaration content. Commands and interpreters emit variable content. DS002 and DS017 define how variable metadata controls usability and error propagation.

### Lexical model

The parser must recognize:

1. Declaration lines beginning with `@`.
2. Runtime references beginning with `$` or `~`.
3. Escaped literal `@`, `$`, and `~` through a leading backslash.
4. Newline-delimited declaration boundaries.

An `@` token inside declaration content is ordinary text unless it begins a new line and is followed by a structurally valid declaration line. The parser must therefore avoid accidental collisions with documentation tags, decorators, or command-local text.

### Declaration-line grammar

The v0 declaration-line grammar is:

1. `@target command`
2. `@target commandA | commandB | ...`
3. `@target commandA & commandB & ...`

`target` and command tokens must satisfy the lexical rules referenced by DS002. Inline command arguments are not part of v0 grammar; command-specific input lives in the declaration body.

The declaration body begins immediately after the terminating newline of a valid declaration line and continues byte-for-byte until the next valid declaration line or the end of document. The parser must preserve raw body bytes exactly as submitted so that command-local parsers receive the original content.

Declaration insertion is a DS002 runtime effect, not a parser mode. The parser treats newly inserted declaration text exactly like any other SOP text once the scheduler hands it a new epoch snapshot.

### Parse outputs

The parser must emit a structured parse result containing at least:

| Field | Meaning |
| --- | --- |
| `declaration_id` | Stable parse-local identifier |
| `target` | Parsed target family |
| `declaration_kind` | `single`, `fallback`, or `multi_attempt` |
| `commands` | Ordered command token list from the declaration line |
| `body` | Raw declaration body |
| `body_span` | Start and end offsets of the body |
| `declaration_line_span` | Start and end offsets of the declaration line |
| `references` | Structurally discovered `$` and `~` references |

Unknown command tokens do not make the parse invalid. They become resolution failures later during graph preparation.

### Family-oriented parsing conventions

Parsing must remain aware that a target names a family, not one immutable slot. One declaration may eventually produce multiple concrete variants for the same family, and plurality operators may produce competing candidates. The parser itself does not choose a winning variant, but its output must preserve enough structure for DS002 and DS012 to do so later.

### Parse errors

Malformed declaration lines must fail parsing with:

1. `line`
2. `column`
3. `kind`
4. `message`
5. `offending_fragment`

The parser must reject malformed plural operators, invalid identifiers, and structurally impossible declaration lines before any scheduler or planning step begins.

## Decisions & Questions

Question #1: Why does DS003 separate declaration content from emitted variable content and metadata?

Response: Planning edits declaration content, while execution emits variable content and metadata. If those surfaces were blurred together, the runtime would lose the ability to explain whether a change came from replanning, execution, or later credibility judgment.

Question #2: Why must declaration bodies be preserved byte-for-byte rather than normalized during parsing?

Response: Command-local parsers such as `js-eval`, `logic-eval`, and `template-eval` depend on exact body text. If the outer parser normalized whitespace or escaped content eagerly, it could silently change command behavior before command-specific parsing even begins.

Question #3: Why must `@` begin a valid new-line declaration line before it is treated as structure?

Response: Bodies for commands such as JavaScript or templates may legitimately contain `@` characters. Requiring new-line declaration position plus full declaration-line validity prevents accidental body text from being reclassified as graph structure.

## Conclusion

MRP-VM v0 needs a parser contract that is explicit enough to implement without guessing. DS003 provides that lower-level parsing and declaration-structure boundary while leaving graph semantics, family state, and epoch control to DS002.
