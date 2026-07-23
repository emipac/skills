---
name: framework-setup
description: Discover and configure a Laravel or Express/TypeScript repository for AI Skills Framework without modifying AGENTS.md. Use before the first lifecycle run, when migrating the configuration schema, switching tracker adapters, or changing project conventions, source scopes, or verification commands.
---

# Framework Setup

Create or update `.agent-framework.yaml`, the repository-local contract consumed
by the lifecycle skills. Discovery is deterministic; decisions remain human.

## Process

### 1. Discover

Run:

```bash
node <skill-directory>/scripts/configure.mjs --project "$PWD" --discover
```

Read every path reported under `guidelinePaths` before proposing configuration.
Treat existing repository instructions as authoritative. `AGENTS.md` is a
protected input: read it, record it, and preserve its exact bytes.

Completion criterion: backend, frontend, source-scope candidates, existing
schema version, SRS candidates, guideline paths, protected files, and the
detected verification profile, capabilities, and exact scoped commands are
visible.

### 2. Confirm the branches

Present detected values and ask only about unresolved or consequential choices:

1. **Tracker:** recommend the detected GitHub remote when present; otherwise
   local Markdown. Offer `local-markdown`, `github`, `jira`, and `linear`.
2. **SRS:** recommend the strongest discovered SRS candidate, or reserve
   `docs/specifications/srs.md` for `/srs-modeling` when none exists. Use `null`
   only when the user explicitly excludes an SRS.
3. **Profiles:** confirm `laravel`, `express-typescript`, or `unknown` and one
   compatible frontend profile: `livewire`, `react-typescript`,
   `svelte-typescript`, `none`, or `unknown`.
4. **Source scopes:** confirm backend, frontend, and shared roots. Prefer an
   existing schema version 3 contract, then detected entry-point and
   conventional roots. Express projects commonly use `server`, `backend`,
   `api`, or `src/server`; React and Svelte commonly use `src`, `client`, or
   `frontend`. Never classify TypeScript by extension alone. Shared and
   unmatched files affect both scopes.
5. **Command scopes:** confirm every discovered command as backend, frontend,
   or both. A package-manager command is not inherently a frontend command.
6. **History:** retain an existing history convention; otherwise recommend
   `docs/history` without creating it.

Show the proposed configuration before writing. Defaults yield to applicable
project instructions. A schema version 2 configuration must be confirmed before
rewriting it as schema version 3.

Completion criterion: the user has confirmed every value that changes the
generated contract.

### 3. Configure

Run the same script with the confirmed values:

```bash
node <skill-directory>/scripts/configure.mjs \
  --project "$PWD" \
  --tracker <adapter> \
  --srs <path-or-null> \
  --backend <profile> \
  --frontend <profile> \
  --backend-scopes <comma-separated-roots> \
  --frontend-scopes <comma-separated-roots> \
  --shared-scopes <comma-separated-roots> \
  --backend-scripts <comma-separated-package-script-names> \
  --frontend-scripts <comma-separated-package-script-names> \
  --both-scripts <comma-separated-package-script-names> \
  --history <path-or-null>
```

This writes only:

- `.agent-framework.yaml`
- `docs/agents/issue-tracker.md`
- `docs/agents/domain.md`
- `docs/agents/triage-labels.md`

It never writes `AGENTS.md` or `CLAUDE.md`. The script refuses an unknown
tracker or profile and verifies every discovered `AGENTS.md` remains unchanged.

Completion criterion: the command succeeds and reports the four managed files.

### 4. Verify

Run discovery again, inspect the generated files, then rerun the identical
configure command. The second run must produce byte-identical schema version 3
files.

Report:

- selected profiles and tracker;
- confirmed backend, frontend, and shared source roots;
- recorded SRS, glossary, ADR, guideline, convention, and history paths;
- exact verification commands and their backend/frontend/both scopes;
- protected instruction files checked;
- any unresolved values left as `null` or empty lists.

Completion criterion: repeat configuration is idempotent and every discovered
`AGENTS.md` is byte-for-byte unchanged.

## References

Read [configuration.md](./references/configuration.md) when interpreting the
generated contract. Read only the selected tracker reference:

- [tracker-local-markdown.md](./references/tracker-local-markdown.md)
- [tracker-github.md](./references/tracker-github.md)
- [tracker-jira.md](./references/tracker-jira.md)
- [tracker-linear.md](./references/tracker-linear.md)
