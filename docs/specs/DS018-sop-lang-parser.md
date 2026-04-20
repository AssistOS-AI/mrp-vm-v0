---
id: DS018
title: SOP Lang Parser
status: planned
owner: runtime
summary: Defines tokenization, declaration parsing, payload extraction, reference scanning, and parse-error shape for SOP Lang IR.
---
# DS018 SOP Lang Parser

## Introduction

This specification owns the parser mechanics of SOP Lang IR. DS002 defines the semantic meaning of declarations, families, variants, and rewrites; DS018 defines how the runtime tokenizes source text, extracts declaration bodies, reports parse errors, and hands a validated parse tree to later graph-building stages.

## Core Content

### Lexical model

The parser must recognize:

1. Declaration headers beginning with `@`.
2. Runtime references beginning with `$` or `~`.
3. Escaped literal `@`, `$`, and `~` through a leading backslash.
4. Newline-delimited header boundaries.

The parser must not reinterpret inline text as a declaration header unless the line satisfies the header grammar defined here.

An `@` token inside a declaration body is treated as ordinary text unless it appears at the beginning of a new line and is followed by a structurally valid SOP header. This prevents accidental collision with decorators, annotations, or documentation tags inside command-local bodies.

### Header grammar and payload extraction

The v0 header grammar is:

1. `@target command`
2. `@target commandA | commandB | ...`
3. `@target commandA & commandB & ...`

`target` and `command` tokens must satisfy the lexical rules defined in DS002. Inline header arguments are not part of v0 grammar; command-specific input belongs in the declaration body.

The body begins immediately after the terminating newline of a valid header and continues byte-for-byte until the next valid header line or the end of document. The parser must preserve raw body bytes exactly as submitted so that command-local parsers receive the original content.

### Reference scanning and parse outputs

The parser must emit a structured parse result containing at least:

| Field | Meaning |
| --- | --- |
| `declaration_id` | Stable parse-local identifier |
| `target` | Parsed target identifier |
| `header_kind` | single, fallback, or multi-attempt |
| `commands` | Ordered command token list from the header |
| `body` | Raw declaration body |
| `body_span` | Start and end offsets |
| `header_span` | Start and end offsets |
| `references` | `$` and `~` references discovered structurally |

Unknown command tokens do not make the parse invalid. They become resolution failures later during graph preparation.

### Parse errors

Malformed headers must fail parsing with:

1. `line`
2. `column`
3. `kind`
4. `message`
5. `offending_fragment`

The parser must reject malformed plural operators, invalid identifiers, and structurally impossible header lines before any scheduler or planning step begins.

## Decisions & Questions

Question #1: Why does DS018 separate parser mechanics from the semantic ownership kept in DS002?

Response: Parsing and semantics are related but not identical responsibilities. DS002 needs to own the language meaning, while implementation work still needs a sharper contract for tokenization, spans, payload extraction, and error shapes. Splitting them keeps both documents more focused.

Question #2: Why must declaration bodies be preserved byte-for-byte rather than normalized during parsing?

Response: Command-local parsers such as `js-eval`, `logic-eval`, and `template-eval` depend on exact body text. If the outer parser normalized whitespace or escaped content eagerly, it could silently change command behavior before command-specific parsing even begins.

Question #3: Should future SOP Lang versions allow inline header arguments?

Options:

Option 1: Keep header arguments out of scope for v0.
Implications: This preserves the current simple grammar and keeps command-local input inside the body where parsers already differ by command.

Option 2: Add inline header arguments in a future revision.
Implications: This may improve compactness for some declarations, but it complicates parsing and risks blurring the line between language-level syntax and command-local syntax.

Question #4: Why does DS018 require `@` to begin a valid new-line header before it is treated as a declaration?

Response: Bodies for commands such as JavaScript or templates may legitimately contain `@` characters. Requiring new-line header position plus full header validity prevents accidental body text from being reclassified as graph structure.

## Conclusion

MRP-VM v0 needs a parser contract that is explicit enough to implement without guessing. DS018 provides that lower-level parsing boundary while leaving language semantics in DS002.
