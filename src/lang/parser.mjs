import { assertCommandIdentifier, assertFamilyIdentifier, assertVariableIdentifier, isFamilyIdentifier } from './identifiers.mjs';
import { extractReferences } from './references.mjs';

function createParseError(line, column, kind, message, offendingFragment) {
  const error = new Error(message);
  error.name = 'SopParseError';
  error.line = line;
  error.column = column;
  error.kind = kind;
  error.offending_fragment = offendingFragment;
  return error;
}

function parseDeclarationLine(line, lineNumber) {
  const match = /^@([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/.exec(line);
  if (!match) {
    throw createParseError(lineNumber, 1, 'invalid_declaration_line', 'Malformed declaration line.', line);
  }

  const target = assertFamilyIdentifier(match[1]);
  const route = match[2].trim();
  const hasFallback = route.includes('|');
  const hasMultiAttempt = route.includes('&');

  if (hasFallback && hasMultiAttempt) {
    throw createParseError(
      lineNumber,
      1,
      'invalid_plural_operator',
      'Mixed `|` and `&` are not allowed in one declaration line.',
      line,
    );
  }

  const separator = hasFallback ? '|' : hasMultiAttempt ? '&' : null;
  const commands = separator
    ? route.split(separator).map((token) => token.trim()).filter(Boolean)
    : [route];

  if (commands.length === 0) {
    throw createParseError(lineNumber, 1, 'missing_command', 'Declaration line has no command token.', line);
  }

  for (const command of commands) {
    assertCommandIdentifier(command);
  }

  return {
    target,
    declarationKind: hasFallback ? 'fallback' : hasMultiAttempt ? 'multi_attempt' : 'single',
    commands,
  };
}

function isValidDeclarationLine(line) {
  try {
    parseDeclarationLine(line, 1);
    return true;
  } catch {
    return false;
  }
}

export function parsePlan(source) {
  const text = String(source ?? '');
  const lines = text.split('\n');
  const declarations = [];
  let offset = 0;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const lineNumber = index + 1;
    const lineStartOffset = offset;
    const lineEndOffset = offset + line.length;

    if (!line.trim()) {
      offset += line.length + 1;
      index += 1;
      continue;
    }

    if (!line.startsWith('@')) {
      throw createParseError(lineNumber, 1, 'unexpected_text', 'Plan text must begin with a valid declaration line.', line);
    }

    const declarationHeader = parseDeclarationLine(line, lineNumber);
    const bodyStartLineIndex = index + 1;
    let bodyEndLineIndex = lines.length;
    let bodyEndOffset = text.length;
    let scanOffset = lineEndOffset + 1;

    for (let scanIndex = bodyStartLineIndex; scanIndex < lines.length; scanIndex += 1) {
      const candidateLine = lines[scanIndex];
      if (candidateLine.startsWith('@') && isValidDeclarationLine(candidateLine)) {
        bodyEndLineIndex = scanIndex;
        bodyEndOffset = scanOffset - 1;
        break;
      }
      scanOffset += candidateLine.length + 1;
    }

    const bodyLines = lines.slice(bodyStartLineIndex, bodyEndLineIndex);
    const body = bodyLines.join('\n');
    const declarationId = `decl-${String(declarations.length + 1).padStart(4, '0')}`;

    declarations.push({
      declaration_id: declarationId,
      target: declarationHeader.target,
      declaration_kind: declarationHeader.declarationKind,
      commands: declarationHeader.commands,
      body,
      body_span: {
        start: lineEndOffset + 1,
        end: bodyEndOffset,
      },
      declaration_line_span: {
        start: lineStartOffset,
        end: lineEndOffset,
      },
      references: extractReferences(body).map((reference) => ({
        kind: reference.kind,
        family: reference.familyId,
        variant: reference.variantId,
        raw: reference.raw,
      })),
    });

    for (let consumedIndex = index; consumedIndex < bodyEndLineIndex; consumedIndex += 1) {
      offset += lines[consumedIndex].length + 1;
    }
    index = bodyEndLineIndex;
  }

  return {
    declarations,
    source: text,
  };
}

export function parseSopModule(source) {
  const text = String(source ?? '');
  const lines = text.split('\n');
  const entries = new Map();
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      index += 1;
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_:-]*)\s*=\s*(.*)$/.exec(rawLine);
    if (!match) {
      throw new Error(`Invalid SOP module assignment on line ${index + 1}: ${rawLine}`);
    }

    const variableId = assertVariableIdentifier(match[1]);
    const remainder = match[2].trim();

    if (remainder.startsWith('"""')) {
      const parts = [];
      let first = remainder.slice(3);
      let closed = false;

      if (first.endsWith('"""')) {
        first = first.slice(0, -3);
        parts.push(first);
        closed = true;
      } else {
        parts.push(first);
      }

      while (!closed) {
        index += 1;
        if (index >= lines.length) {
          throw new Error(`Unclosed triple-quoted value for ${variableId}.`);
        }
        const nextLine = lines[index];
        if (nextLine.endsWith('"""')) {
          parts.push(nextLine.slice(0, -3));
          closed = true;
        } else {
          parts.push(nextLine);
        }
      }

      if (parts[0] === '') {
        parts.shift();
      }
      if (parts[parts.length - 1] === '') {
        parts.pop();
      }

      entries.set(variableId, parts.join('\n'));
      index += 1;
      continue;
    }

    let value;
    try {
      value = JSON.parse(remainder);
    } catch (error) {
      throw new Error(`Invalid SOP JSON value for ${variableId}: ${error.message}`);
    }

    entries.set(variableId, value);
    index += 1;
  }

  return entries;
}

export function renderSopModule(entries) {
  const lines = [];
  for (const [key, value] of entries) {
    if (!isFamilyIdentifier(key.split(':')[0])) {
      assertVariableIdentifier(key);
    }
    if (typeof value === 'string' && value.includes('\n')) {
      lines.push(`${key} = """`);
      lines.push(value);
      lines.push('"""');
    } else {
      lines.push(`${key} = ${JSON.stringify(value)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
