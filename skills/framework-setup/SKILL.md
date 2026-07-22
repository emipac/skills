---
name: framework-setup
description: Discover and configure a repository for AI Skills Framework without modifying AGENTS.md. Use before the first lifecycle run, when switching tracker adapters, or when project conventions and verification commands change.
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

Completion criterion: backend, frontend, SRS candidates, guideline paths,
protected files, and the detected verification profile, capabilities, and
exact commands are visible.

### 2. Confirm the branches

Present detected values and ask only about unresolved or consequential choices:

1. **Tracker:** recommend the detected GitHub remote when present; otherwise
   local Markdown. Offer `local-markdown`, `github`, `jira`, and `linear`.
2. **SRS:** recommend the strongest discovered SRS candidate, or reserve
   `docs/specifications/srs.md` for `/srs-modeling` when none exists. Use `null`
   only when the user explicitly excludes an SRS.
3. **Profiles:** confirm Laravel and one frontend profile: `livewire`,
   `react-typescript`, `svelte-typescript`, or `none`.
4. **History:** retain an existing history convention; otherwise recommend
   `docs/history` without creating it.

Show the proposed configuration before writing. Defaults yield to applicable
project instructions.

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
configure command. The second run must produce byte-identical files.

Report:

- selected profiles and tracker;
- recorded SRS, glossary, ADR, guideline, convention, and history paths;
- exact verification commands discovered;
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
