# mrp-vm-v0

MRP-VM v0 is a dependency-free Node.js `.mjs` runtime with:

- SOP Lang parsing and graph execution
- family-based state and trace persistence
- native commands for planning, `js-eval`, `logic-eval`, `template-eval`, `analytic-memory`, `kb`, and `credibility`
- declaration-style SOP Lang KU assets and caller profiles under `data/default/`
- AchillesAgentLib-aware LLM adapter routing through `LLMAgent`, with fake-adapter fallback for deterministic tests
- optional HTTP hosting adapter and `/chat` UI under `server/`
- Node native tests under `tests/`

Run the test suite with:

```bash
node run.mjs test
```

Start the local server and chat UI with:

```bash
npm run server
```

For a real Achilles-backed LLM path, provide `ACHILLES_AGENT_LIB_PATH` or install AchillesAgentLib in a resolvable location. If no Achilles library is available, the runtime falls back to the fake adapter unless `LLM_PROVIDER=achilles` is forced explicitly.
