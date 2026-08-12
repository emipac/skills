---
name: framework-setup
description: Discover and configure a Laravel or Express/TypeScript repository for AI Skills Framework without modifying AGENTS.md. Use before the first lifecycle run, when migrating the configuration schema, explicitly configuring optional Gate policy, switching tracker adapters, or changing project conventions, source scopes, or verification commands.
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
   `svelte-typescript`, `none`, or `unknown`. In schema v4, `none` means the
   profile is proved absent while `unknown` remains active and conservative;
   both backend and frontend may be `none` only for a tooling-only repository.
4. **Source scopes:** confirm backend, frontend, and shared roots. Prefer an
   existing schema version 3 contract, then detected entry-point and
   conventional roots. Express projects commonly use `server`, `backend`,
   `api`, `database`, or `src/server`; React and Svelte commonly use `src`,
   `client`, or `frontend`. Never classify TypeScript by extension alone.
   Shared, tied, and unmatched files affect every configured active profile.
5. **Command scopes:** confirm every discovered command as backend, frontend,
   or both. A package-manager command is not inherently a frontend command.
   Discovery accepts safe qualified checks such as `test:unit`,
   `test:integration`, `format:check`, and `smoke:<name>`, uses referenced
   source roots as scope evidence, and excludes watch, fix, development,
   coverage, and write variants unless explicitly selected. Prefer a
   non-mutating `format:check` when both it and `format` exist. Record any
   intentionally excluded scripts and preserve the same exclusion list on
   later setup runs.
6. **History:** retain an existing history convention; otherwise recommend
   `docs/history` without creating it.

Show the proposed configuration before writing. Defaults yield to applicable
project instructions. A schema version 2 configuration must be confirmed before
rewriting it as schema version 3.

Completion criterion: the user has confirmed every value that changes the
generated contract.

### 3. Preview and migrate schema v3 to v4 when requested

Keep schema v3 readable. Migration is a separate, explicit transaction and is
not part of ordinary configuration. Prepare a JSON mapping for every schema v3
`unknown` profile and every command timeout; ambiguous raw commands also need
an explicit logical `runner` and `args` array. Preview without `--confirm`:

```bash
node <skill-directory>/scripts/configure.mjs \
  --project "$PWD" \
  --migrate-v4 \
  --mapping <mapping-json>
```

Review `proposedConfiguration` and its `previewHash`. Install exactly that
preview with:

```bash
node <skill-directory>/scripts/configure.mjs \
  --project "$PWD" \
  --migrate-v4 \
  --mapping <mapping-json> \
  --confirm <preview-hash>
```

Migration refuses stale confirmation, unresolved ambiguity, behavior-changing
profile mappings, or backend/frontend data assigned to a `none` profile. It
writes atomically and never adds `evaluation_gate`, a receipt, or a hook.

Completion criterion: the preview is reviewed, the confirmation matches the
current source and proposed bytes, and the result reports `migrated`.

### 4. Configure

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
  --exclude-scripts <comma-separated-package-script-names> \
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

### 5. Configure the optional Gate only when selected

Leave Gate configuration unselected during ordinary setup. Installed Gate assets
never imply consent. Only schema v4 may add the policy, and it must contain
exactly `checks`, `budget`, `bypass`, `execution`, and `evidence`. Check entries
are required/advisory identities; Verification remains the sole command owner.

Prepare the five-subcontract policy as JSON, then preview without `--confirm`:

```bash
node <skill-directory>/scripts/configure.mjs \
  --project "$PWD" \
  --configure-gate \
  --policy <gate-policy-json>
```

Review `proposedConfiguration` and `previewHash`, then install only that preview:

```bash
node <skill-directory>/scripts/configure.mjs \
  --project "$PWD" \
  --configure-gate \
  --policy <gate-policy-json> \
  --confirm <preview-hash>
```

The transaction rejects schema v3, stale confirmation, missing or extra
subcontracts, command ownership, and activation state. It writes only
`.agent-framework.yaml`, atomically, and reports `activated: false`. It never
creates a hook, receipt, trust decision, or evidence runtime.

Completion criterion: the result reports `configured`, the exact preview was
installed, and commit behavior remains unchanged.

### 6. Verify

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
