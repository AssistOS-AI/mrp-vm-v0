# Copilot review note

The removed **Settings -> Models -> Selection and binding** area was exposing an internal runtime mechanism, not a user-facing product concept.

## Is it used internally?

Yes. The runtime still keeps per-profile model bindings in `runtime.runtimeConfig.llm.profileBindings`, and the server still applies them through `server/create-server.mjs` when LLM wrapper profiles such as `plannerLLM`, `fastLLM`, `deepLLM`, `writerLLM`, and `codeGeneratorLLM` need concrete models.

## Why remove it from the UI?

In the current product it looked like an end-user routing system, but what it really exposed was low-level wrapper plumbing. That made the Settings page harder to understand and suggested a public workflow that is not yet specified clearly enough in the UX docs.

## What changes after removal?

The runtime behavior does **not** disappear. Only the confusing control surface is removed from the baseline Settings UI. The page now focuses on the default model selection, while internal profile bindings remain available in runtime configuration and server internals.

## Important authentication note

Server-issued API-key inventory stores only non-secret metadata plus a token hash. Full API keys can be copied only at creation time or from browser-saved local copies. This is why the simplified Authentication UX now emphasizes:

1. copy the key when it is created,
2. optionally save it locally in the browser,
3. use masked display plus `Copy` / `Logout` for the active key,
4. treat the server-side inventory as audit metadata, not as a source of recoverable secrets.
