export function extractReferences(body) {
  const references = [];
  let index = 0;
  let state = 'normal';

  while (index < body.length) {
    const char = body[index];
    const next = body[index + 1];

    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'normal';
      }
      index += 1;
      continue;
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'normal';
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    if (state === 'single-quote' || state === 'double-quote' || state === 'template') {
      const closing = state === 'single-quote' ? '\'' : state === 'double-quote' ? '"' : '`';
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === closing) {
        state = 'normal';
      }
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      state = 'line-comment';
      index += 2;
      continue;
    }

    if (char === '/' && next === '*') {
      state = 'block-comment';
      index += 2;
      continue;
    }

    if (char === '\'') {
      state = 'single-quote';
      index += 1;
      continue;
    }

    if (char === '"') {
      state = 'double-quote';
      index += 1;
      continue;
    }

    if (char === '`') {
      state = 'template';
      index += 1;
      continue;
    }

    if ((char === '$' || char === '~') && body[index - 1] !== '\\') {
      const match = /^[A-Za-z_][A-Za-z0-9_]*(?::v[1-9][0-9]*)?/.exec(body.slice(index + 1));
      if (match) {
        const raw = match[0];
        const [familyId, variantId] = raw.split(':');
        references.push({
          kind: char,
          familyId,
          variantId: variantId ?? null,
          raw: `${char}${raw}`,
        });
        index += raw.length + 1;
        continue;
      }
    }

    index += 1;
  }

  return references;
}

export function rewriteJsReferences(source, replacer) {
  let output = '';
  let index = 0;
  let state = 'normal';

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (state === 'line-comment') {
      output += char;
      if (char === '\n') {
        state = 'normal';
      }
      index += 1;
      continue;
    }

    if (state === 'block-comment') {
      output += char;
      if (char === '*' && next === '/') {
        output += next;
        state = 'normal';
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    if (state === 'single-quote' || state === 'double-quote' || state === 'template') {
      output += char;
      const closing = state === 'single-quote' ? '\'' : state === 'double-quote' ? '"' : '`';
      if (char === '\\') {
        output += next ?? '';
        index += 2;
        continue;
      }
      if (char === closing) {
        state = 'normal';
      }
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      output += '//';
      state = 'line-comment';
      index += 2;
      continue;
    }

    if (char === '/' && next === '*') {
      output += '/*';
      state = 'block-comment';
      index += 2;
      continue;
    }

    if (char === '\'') {
      state = 'single-quote';
      output += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      state = 'double-quote';
      output += char;
      index += 1;
      continue;
    }

    if (char === '`') {
      state = 'template';
      output += char;
      index += 1;
      continue;
    }

    if ((char === '$' || char === '~') && source[index - 1] !== '\\') {
      const match = /^[A-Za-z_][A-Za-z0-9_]*(?::v[1-9][0-9]*)?/.exec(source.slice(index + 1));
      if (match) {
        const token = `${char}${match[0]}`;
        output += replacer(token);
        index += token.length;
        continue;
      }
    }

    output += char;
    index += 1;
  }

  return output;
}
