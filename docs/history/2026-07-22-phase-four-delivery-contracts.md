# Phase 4 — Planning and delivery contracts

## Outcome

Implemented the local Phase 4 lifecycle on the published `v0.3.0` baseline:

- extended `to-spec` with SRS traceability, a concept/risk/gap analysis matrix,
  safeguards, prohibited behavior, public evidence seams, and a
  `ready-for-tickets` gate;
- extended `to-tickets` with vertical delivery contracts, verification
  matrices, explicit assumptions, temporary `TB-NNN` graph keys, and acyclic
  blocker-graph validation;
- expanded `implement` into the single implementation orchestrator with
  readiness refusal, one vertical red-green behavior at a time, evidence logs,
  explicit contract amendments, configured verification, and review;
- preserved Matt Pocock's tracer bullets, public seams, prefactoring, TDD, and
  expand-migrate-contract exception;
- excluded OpenSPDD's exhaustive Operations scripts and batch generation.

## Safety

- A ticket cannot start with an incomplete blocker or unresolved
  start-blocking assumption.
- Red evidence must fail because behavior is absent, not because setup, syntax,
  fixtures, or the environment are broken.
- Implementation learning cannot weaken or change durable intent without an
  explicit accepted amendment.
- Commits and pushes require explicit user authorization.
- Existing `AGENTS.md` files remain read-only.

## Verification

- All 26 unit and contract tests passed.
- Repository validation passed for 23 released skills and 95 Markdown files.
- All 23 released skills passed the official Agent Skills validator.
- The native Codex plugin passed the official plugin validator.
- Isolated installation smoke tests passed for Codex, Claude Code, and Cursor,
  including all six core lifecycle skills.
- The dependency audit reported 0 vulnerabilities.
- Native Claude plugin validation was unavailable under the local command
  allowlist; the universal Claude Code installation path passed.
