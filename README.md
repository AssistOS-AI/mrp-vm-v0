# mrp-vm-v0

MRP-VM v0 is a dependency-free Node.js `.mjs` runtime with:

- SOP Lang parsing and graph execution
- family-based state and trace persistence
- native commands for planning, `js-eval`, `logic-eval`, `template-eval`, `analytic-memory`, `kb`, and `credibility`
- default KU assets and caller profiles under `data/default/`
- optional HTTP hosting adapter and `/chat` UI under `server/`
- Node native tests under `tests/`

Run the test suite with:

```bash
node run.mjs test
```
