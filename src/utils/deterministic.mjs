export function createDeterministicTools(options = {}) {
  const {
    startTime = '2026-01-01T00:00:00.000Z',
    timeStepMs = 1_000,
    idPrefix = 'id',
  } = options;

  let currentTime = new Date(startTime).getTime();
  let ordinal = 0;

  return {
    now() {
      const value = new Date(currentTime).toISOString();
      currentTime += timeStepMs;
      return value;
    },
    nextOrdinal() {
      ordinal += 1;
      return ordinal;
    },
    createId(prefix = idPrefix) {
      ordinal += 1;
      return `${prefix}-${String(ordinal).padStart(4, '0')}`;
    },
  };
}

export function createLiveTools() {
  let ordinal = 0;

  return {
    now() {
      return new Date().toISOString();
    },
    nextOrdinal() {
      ordinal += 1;
      return ordinal;
    },
    createId(prefix = 'id') {
      ordinal += 1;
      return `${prefix}-${Date.now()}-${ordinal}`;
    },
  };
}
