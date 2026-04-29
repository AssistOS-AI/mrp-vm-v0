# AGENTS.md

## Scope

This repository hosts the implemented **MRP-VM v0** runtime together with its specification set, HTML documentation, default KU data, and native test suite.

The Design Specifications under `docs/specs/` remain the authoritative contract for the runtime. Future source code changes must preserve alignment between the implementation, the HTML documentation, and the DS specifications.

## Mandatory Reading Order

1. `docs/specs/DS000-vision.md`
2. `docs/specs/DS001-coding-style.md`
3. `docs/specs/DS013-llm-wrapper-interpreters.md`
4. `docs/specs/DS023-model-tier-and-routing-strategy.md`
5. `docs/specs/DS026-human-like-reasoner.md`
6. `docs/specs/DS027-human-like-reasoner-guidance-and-coverage.md`
7. `docs/specs/DS028-advanced-reasoner.md`
8. `docs/specs/DS029-advanced-reasoner-guidance-and-coverage.md`
9. `docs/specs/DS030-document-scale-planner.md`
10. `docs/specs/DS031-document-scale-planner-guidance-and-coverage.md`
11. `docs/index.html`
12. `docs/runtime-architecture.html`
13. `docs/specsLoader.html?spec=matrix.md`

## Current Skill Catalog

- `gamp_specs`: repository/spec/documentation normalization skill for the DS-first layout.
- `achilles_specs`: AchillesAgentLib integration skill for runtime config, LLMAgent routing, and coding-style additions.

## Repository Rules

- The DS specifications under `docs/specs/` are the source of truth for planned MRP-VM behavior.
- `DS001-coding-style.md` is the coding-style authority for module structure, file layout, documentation updates, and test organization.
- Repository-owned `.sop` files must use declaration-style SOP Lang as the canonical authoring form; do not introduce a second assignment mini-language for persistent KU or caller-profile assets.
- AchillesAgentLib is an authorized optional integration boundary for LLM provider access, but every non-test LLM call must still go through the managed adapter described by DS013 and DS023.
- All persistent documentation, specifications, and code comments must be written in English.
- When source code changes alter behavior, interfaces, architecture, workflows, or constraints, update both the HTML documentation and the DS specifications in the same change set.
- DS numbering must remain contiguous with no gaps.
- Every ordinary DS file must contain `Introduction`, `Core Content`, `Decisions & Questions`, and `Conclusion`.
- The `Decisions & Questions` section must use numbered labels in the form `Question #1:`, `Question #2:`, and so on, plus either `Response:` for decided points or `Options:` with numbered options for unresolved points.
- In projects that use generic reusable agent skills, the project `docs/` surface must not contain DS files or product documentation pages about those skills.

## Runtime Defaults

- Keep ordinary `kb` retrieval symbolic and inspectable; do not assume hidden LLM retrieval.
- Treat `analytic-memory` as the canonical aggregation command name for the planned runtime.
- Treat the normalized concrete-variable output contract as the authoritative interpreter result model.
- Treat direct SOP declaration insertion as the authoritative structural-effect contract.
- Require native commands and external interpreters to publish default KU guidance for their preferred input shapes and fallback behavior.
- Require non-test LLM wrappers to obtain provider access only through the managed adapter and `LLMAgent`, configured by runtime config plus explicit overrides.
- Treat `logic-eval` as a bounded rewrite-orchestration helper, `HumanLikeReasoner` as the implemented bounded reasoning interpreter for solver-style tasks, `AdvancedReasoner` as the implemented bounded advanced-reasoning interpreter for explicit meta-reasoning and escalation-aware tasks, and `DocumentScalePlanner` as the implemented document-workflow interpreter for explicit Markdown or JSON chunk planning.

## Key Paths

- HTML documentation entry point: `docs/index.html`
- Runtime overview: `docs/runtime-architecture.html`
- Specs entry point: `docs/specsLoader.html?spec=matrix.md`
- Specs directory: `docs/specs/`
- Server adapter and chat UI: `server/`
- Server startup entry point: `server/start.mjs`
- NPM scripts: `package.json`
- Documentation verification scripts: `scripts/`
- File-size helper: `fileSizesCheck.sh`
