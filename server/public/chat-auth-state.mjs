export function hasValidatedApiKey(auth = null) {
  return auth?.caller?.auth_mode === 'api_key';
}

export function deriveChatAuthState(auth = null, currentKey = '') {
  const bootstrap = auth?.bootstrap ?? {};
  const caller = auth?.caller ?? {};
  const normalizedKey = String(currentKey || '').trim();
  const configuredKeysExist = Boolean(bootstrap.has_api_keys || caller.api_key_required);
  const validatedApiKey = hasValidatedApiKey(auth);
  const invalidLocalKey = Boolean(normalizedKey) && !validatedApiKey;
  const needsBootstrapKey = !configuredKeysExist && !validatedApiKey;
  const blocksSessionActions = !validatedApiKey;

  if (configuredKeysExist) {
    return {
      blocksSessionActions,
      invalidLocalKey,
      modalVisible: !validatedApiKey,
      title: invalidLocalKey ? 'API key rejected' : 'API key required',
      status: invalidLocalKey
        ? 'The current browser API key was rejected by the server. Replace it, select another saved key, or log out.'
        : 'Select or paste an API key. Saved local keys appear below for quick switching.',
      bootstrapDisabled: true,
    };
  }

  return {
    blocksSessionActions,
    invalidLocalKey: Boolean(normalizedKey) && !validatedApiKey,
    modalVisible: needsBootstrapKey,
    title: 'Create bootstrap admin key',
    status: normalizedKey && !validatedApiKey
      ? 'No server API keys exist yet. Create the first bootstrap admin key before using any saved browser key.'
      : 'No server API keys exist yet. Create the first admin key and store it locally in this browser.',
    bootstrapDisabled: !bootstrap.bootstrap_admin_available,
  };
}
