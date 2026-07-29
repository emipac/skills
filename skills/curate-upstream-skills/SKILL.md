---
name: curate-upstream-skills
description: Curate updates from Matt Pocock's skills upstream into AI Skills Framework. Use when the user asks to check, review, sync, or selectively port changes from mattpocock/skills.
---

# Curate Upstream Skills

Run a curated intake: automatically port only structurally proven compatible
changes and make every other upstream change visible for human judgment.

## 1. Pin the review window

Read the repository instructions and `UPSTREAM.md`. Require:

- an immutable Matt Pocock ancestry baseline;
- a last-reviewed upstream SHA;
- an `upstream` remote pointing to the repository recorded in `UPSTREAM.md`;
- a Git worktree where every prospective local target is unmodified.

Fetch the recorded upstream default branch. Record its exact head SHA and list
every commit and changed path after the last-reviewed SHA. Treat fetch or
ancestry failures as blockers rather than substituting cached or unrelated
history.

Completion criterion: the review has one verified `last-reviewed..head` range,
and every commit and path in that range is inventoried.

## 2. Prove compatibility

Read [the compatibility policy](references/compatibility-policy.md) for every
run. Execute the analyzer from the repository root:

```bash
node skills/curate-upstream-skills/scripts/analyze-upstream.mjs
```

Inspect the upstream commits as well as the analyzer output. The analyzer proves
structural compatibility; the commit inspection confirms that the reported
purpose agrees with the patch. Classify every path as `auto-port`,
`manual-review`, or `no-port`. Apply the most conservative disposition to an
entire skill when its upstream changes are interdependent.

Completion criterion: every inventoried path has one disposition and reason,
and every `auto-port` candidate satisfies every policy gate.

## 3. Apply the clean ports

Run the analyzer's guarded write mode only after reviewing its dry-run report:

```bash
node skills/curate-upstream-skills/scripts/analyze-upstream.mjs --apply-safe
```

Inspect the resulting diff. Keep an applied change only when it preserves the
upstream intent, local terminology, references, and surrounding instructions.
Restore an unexpected result from the pre-apply content and reclassify it as
`manual-review`.

Leave manual-review candidates untouched. Present their upstream intent,
affected local contract, and smallest plausible adaptation to the user rather
than silently choosing an interpretation.

Completion criterion: every auto-port candidate appears in the local diff
exactly once, and no manual-review or no-port path was changed.

## 4. Record the intake

Update `UPSTREAM.md` only after all upstream changes are classified. Advance the
last-reviewed SHA and date to the verified head, then append one compact ledger
row containing:

- the reviewed range and date;
- the aggregate disposition;
- affected skills or paths;
- a Changeset, commit, or PR reference when one exists;
- a short reason, including outstanding manual review.

Preserve source attribution for copied or substantially adapted material. Add a
Changeset when a port changes released skill behavior; use a patch for backward-
compatible refinements and a minor for a new capability.

Completion criterion: the checkpoint equals the reviewed head, the ledger
accounts for the complete range, and released behavior has matching attribution
and release metadata.

## 5. Verify and report

Run the repository checks required by its current instructions. In this
framework, the minimum complete evidence is:

```bash
npm run validate
npm run test:unit
npm run test:install
npm audit --audit-level=high
git diff --check
```

Report the fixed upstream range, auto-ported changes, manual-review candidates,
no-port changes, ledger update, Changeset decision, and exact check results.
Commit, push, and open a pull request only with explicit authorization.

Completion criterion: every disposition is traceable from upstream path to
local outcome, all required checks pass or have a named blocker, and no
publication action exceeds the user's authorization.
