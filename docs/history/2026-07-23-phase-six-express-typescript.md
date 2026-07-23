# Phase 6 — Express/TypeScript compatibility

## Outcome

- Added first-class Express with TypeScript backend support for `v0.6.0`.
- Added schema version 3 with confirmed backend, frontend, and shared source
  scopes plus scoped verification commands.
- Preserved one shared SRS-to-review lifecycle instead of creating separate
  Laravel and Express skill sets.
- Added API verification and review guidance, compatibility fixtures,
  cross-client installation coverage, release gates, and explicit exclusions.

## Key safeguards

- Laravel behavior remains a mandatory regression baseline.
- Express is detected only when Express, TypeScript, and TypeScript
  configuration are proved.
- Backend TypeScript is not classified as frontend solely by extension.
- Verification commands are discovered or explicitly confirmed, never guessed.
- Generated `AGENTS.md` and project instruction files remain read-only.

## Verification

- All 60 unit and contract tests passed.
- Repository validation passed for 24 released skills and 108 Markdown files.
- Isolated installation passed for the eight core lifecycle skills in Codex,
  Claude Code, Cursor, GitHub Copilot, and OpenCode.
- The dependency audit reported 0 vulnerabilities.
- Official skill and native plugin validators remain pending where their CLIs
  are unavailable under the local command allowlist.
- A real Express/TypeScript tracer-bullet pilot remains a release gate.
