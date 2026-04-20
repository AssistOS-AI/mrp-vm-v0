# AGENTS.md

## Scope

This repository hosts the implemented **MRP-VM v0** runtime together with its specification set, HTML documentation, default KU data, and native test suite.

The Design Specifications under `docs/specs/` remain the authoritative contract for the runtime. Future source code changes must preserve alignment between the implementation, the HTML documentation, and the DS specifications.

## Mandatory Reading Order

1. `docs/specs/DS000-vision.md`
2. `docs/specs/DS001-coding-style.md`
3. `docs/index.html`
4. `docs/runtime-architecture.html`
5. `docs/specsLoader.html?spec=matrix.md`

## Repository Rules

- The DS specifications under `docs/specs/` are the source of truth for planned MRP-VM behavior.
- `DS001-coding-style.md` is the coding-style authority for module structure, file layout, documentation updates, and test organization.
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

## Key Paths

- HTML documentation entry point: `docs/index.html`
- Runtime overview: `docs/runtime-architecture.html`
- Specs entry point: `docs/specsLoader.html?spec=matrix.md`
- Specs directory: `docs/specs/`
- Server adapter and chat UI: `server/`
- Documentation verification scripts: `scripts/`
- File-size helper: `fileSizesCheck.sh`
