import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveChatAuthState } from '../../server/public/chat-auth-state.mjs';

test('deriveChatAuthState requires a modal when configured keys exist and no key is validated', () => {
  const state = deriveChatAuthState({
    bootstrap: {
      has_api_keys: true,
      bootstrap_admin_available: false,
    },
    caller: {
      auth_mode: 'anonymous',
      api_key_required: true,
    },
  }, '');

  assert.equal(state.blocksSessionActions, true);
  assert.equal(state.modalVisible, true);
  assert.equal(state.title, 'API key required');
});

test('deriveChatAuthState marks a saved but invalid browser key as rejected', () => {
  const state = deriveChatAuthState({
    bootstrap: {
      has_api_keys: true,
      bootstrap_admin_available: false,
    },
    caller: {
      auth_mode: 'anonymous',
      api_key_required: true,
    },
  }, 'key_invalid.local');

  assert.equal(state.blocksSessionActions, true);
  assert.equal(state.modalVisible, true);
  assert.equal(state.invalidLocalKey, true);
  assert.equal(state.title, 'API key rejected');
  assert.match(state.status, /rejected by the server/i);
});

test('deriveChatAuthState unblocks the chat once the server validates the API key', () => {
  const state = deriveChatAuthState({
    bootstrap: {
      has_api_keys: true,
      bootstrap_admin_available: false,
    },
    caller: {
      auth_mode: 'api_key',
      api_key_required: true,
      role: 'admin',
    },
  }, 'key_valid.local');

  assert.equal(state.blocksSessionActions, false);
  assert.equal(state.modalVisible, false);
});

test('deriveChatAuthState keeps the bootstrap flow visible before any server key exists', () => {
  const state = deriveChatAuthState({
    bootstrap: {
      has_api_keys: false,
      bootstrap_admin_available: true,
    },
    caller: {
      auth_mode: 'anonymous',
      api_key_required: false,
    },
  }, '');

  assert.equal(state.blocksSessionActions, true);
  assert.equal(state.modalVisible, true);
  assert.equal(state.title, 'Create bootstrap admin key');
  assert.equal(state.bootstrapDisabled, false);
});
