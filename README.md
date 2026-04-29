# mrp-vm-v0

MRP-VM v0 is a dependency-free Node.js `.mjs` runtime with:

- SOP Lang parsing and graph execution
- family-based state and trace persistence
- native commands for planning, `js-eval`, `logic-eval`, `template-eval`, `analytic-memory`, `kb`, and `credibility`
- external interpreters for `HumanLikeReasoner`, `AdvancedReasoner`, and `DocumentScalePlanner`
- declaration-style SOP Lang KU assets and caller profiles under `data/default/`
- AchillesAgentLib-aware LLM adapter routing through `LLMAgent`, with fake adapters used only when tests opt in explicitly
- optional HTTP hosting adapter and `/chat` UI under `server/`
- Node native tests under `tests/`
- shared operator demos and evaluation cases under `eval/`

Run the test suite with:

```bash
node run.mjs test
```

The real-LLM integration test runs automatically when AchillesAgentLib is resolved and credential-backed models are discovered through the library. If AchillesAgentLib is not configured, the test is skipped.

Start the local server and chat UI with:

```bash
npm run server
```

For a real Achilles-backed LLM path, install AchillesAgentLib in the repository root, in a parent directory, or in `node_modules` (including the common `achillesAgentLib` folder name). The server refuses to start on the fake adapter unless a test harness enables it explicitly.
