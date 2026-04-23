export class CommandRegistry {
  constructor() {
    this.commands = new Map();
  }

  register(name, handler, contract = {}) {
    this.commands.set(name, {
      handler,
      contract: {
        name,
        ...contract,
      },
      enabled: contract.enabled !== false,
    });
  }

  has(name) {
    return this.commands.has(name);
  }

  get(name) {
    return this.commands.get(name)?.handler ?? null;
  }

  getContract(name) {
    const entry = this.commands.get(name);
    if (!entry) {
      return null;
    }
    return {
      ...entry.contract,
      enabled: entry.enabled,
    };
  }

  isEnabled(name) {
    return this.commands.get(name)?.enabled ?? false;
  }

  setEnabled(name, enabled) {
    const entry = this.commands.get(name);
    if (!entry) {
      throw new Error(`Unknown command: ${name}`);
    }
    if (entry.contract.disableable === false && enabled === false) {
      throw new Error(`Command ${name} cannot be disabled.`);
    }
    entry.enabled = Boolean(enabled);
    return {
      ...entry.contract,
      enabled: entry.enabled,
    };
  }

  listContracts() {
    return [...this.commands.values()].map((entry) => ({
      ...entry.contract,
      enabled: entry.enabled,
    }));
  }
}
