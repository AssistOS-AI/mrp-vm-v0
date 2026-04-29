export class TextBuilder {
  constructor(name = 'text') {
    this.name = String(name);
    this.parts = [];
  }

  sentence(value) {
    const text = String(value ?? '').trim();
    if (text) {
      this.parts.push(text.endsWith('.') || text.endsWith('!') || text.endsWith('?') ? text : `${text}.`);
    }
    return this;
  }

  paragraph(value) {
    const text = String(value ?? '').trim();
    if (text) {
      this.parts.push(text);
    }
    return this;
  }

  section(title, value = '') {
    const heading = String(title ?? '').trim();
    const text = String(value ?? '').trim();
    if (!heading && !text) {
      return this;
    }
    if (heading && text) {
      this.parts.push(`${heading}: ${text}`);
      return this;
    }
    this.parts.push(heading || text);
    return this;
  }

  because(value) {
    const text = String(value ?? '').trim();
    if (text) {
      this.parts.push(`Because ${text}.`);
    }
    return this;
  }

  toString() {
    return this.parts.join('\n\n').trim();
  }
}
