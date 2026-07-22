# Phase 5 — Verification and review

## Outcome

- Added `.agent-framework.yaml` schema version 2 with an explicit verification
  profile, proved capabilities, and exact package-manager-correct commands.
- Added `verify-change` to plan and audit an impact-based evidence ladder from
  focused behavior through broad suites.
- Extended `code-review` to independent Standards, Contract, and Evidence
  passes with safeguard, scope, intent-drift, and verification checks.
- Added selective synchronization rules for SRS, glossary, ADR, tracker, and
  history ownership while keeping private implementation as code truth.

## Safety

- Verification never invents an unavailable command.
- Required checks cannot be skipped; optional skips require a reason.
- User-facing work requires smoke or browser evidence.
- Frontend work runs the configured production build.
- Review findings remain separated by axis.
- Durable artifacts change only through their explicit decision gate.
- Existing `AGENTS.md` files remain read-only.

## Verification

- All 39 unit and contract tests passed.
- Repository validation passed for 24 released skills and 104 Markdown files.
- All 24 released skills passed the official Agent Skills validator.
- The native Codex plugin passed the official plugin validator.
- Isolated installation smoke tests passed for Codex, Claude Code, and Cursor,
  including all eight core lifecycle skills.
- The dependency audit reported 0 vulnerabilities.
- Native Claude plugin validation was unavailable under the local command
  allowlist; the universal Claude Code installation path passed.
