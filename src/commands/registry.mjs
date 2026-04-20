export class CommandRegistry {
  constructor() {
    this.commands = new Map();
  }

  register(name, handler) {
    this.commands.set(name, handler);
  }

  has(name) {
    return this.commands.has(name);
  }

  get(name) {
    return this.commands.get(name) ?? null;
  }
}
