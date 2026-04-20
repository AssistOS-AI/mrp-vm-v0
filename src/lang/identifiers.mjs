const FAMILY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COMMAND_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const VARIABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_:-]*$/;

export function assertFamilyIdentifier(value) {
  if (!FAMILY_PATTERN.test(value)) {
    throw new Error(`Invalid family identifier: ${value}`);
  }
  return value;
}

export function assertCommandIdentifier(value) {
  if (!COMMAND_PATTERN.test(value)) {
    throw new Error(`Invalid command identifier: ${value}`);
  }
  return value;
}

export function assertVariableIdentifier(value) {
  if (!VARIABLE_PATTERN.test(value)) {
    throw new Error(`Invalid variable identifier: ${value}`);
  }
  return value;
}

export function isFamilyIdentifier(value) {
  return FAMILY_PATTERN.test(value);
}

export function isCommandIdentifier(value) {
  return COMMAND_PATTERN.test(value);
}
