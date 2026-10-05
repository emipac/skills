---
name: framework-setup
description: Discover and configure a Laravel or Express/TypeScript repository for AI Skills Framework without modifying AGENTS.md. Use before the first lifecycle run, when migrating the configuration schema, explicitly configuring optional Gate policy, switching tracker adapters, or changing project conventions, source scopes, or verification commands.
---

# Framework Setup

Create or update `.agent-framework.yaml`, the repository-local contract consumed
by the lifecycle skills. Discovery is deterministic; decisions remain human.

## Where the clone stands: `agent-framework setup`

Before choosing a step, ask the Framework command, which ships in this skill
and as the `agent-framework` package bin:

```bash
node <skill-directory>/scripts/agent-framework.mjs setup [--json] [--project <directory>]
```

It reports the adoption state — `no-configuration`, `schema-v3`,
`gate-unconfigured`, `configured`, or `activated` with the Gate's health — every
remaining step in order with the command that owns it, and the exact next
command, including the draft path to use. It writes, confirms, and registers
nothing, and it never prompts. Each boundary is the owning command's own
answer: this skill's schema reading, migration preview, and policy preview;
`gate status --json` for the Gate state, its named remedies, and the Gate
subcommands that perform each one; `gate doctor --json` for whether activation
would stop. A step the owning command would refuse carries that refusal
verbatim. A Gate whose document names a remedy without its subcommands predates
them: setup stops with `gate-remedy-subcommands-missing`, naming the installed
Gate, rather than guess a command — update the Gate module.

It reaches the Gate only by running `change-evaluation-gate` on the path, else
the installed `change-evaluation-gate` skill beside this one. When neither
exists it names only this skill's steps and says the Gate steps are
unavailable. Exit status is `0` with nothing further to do, `1` when steps
remain, and `2` when it could not run.

Completion criterion: the next step and its owning command are known. Perform
it through the section below that owns it.

## What the Gate runs: `agent-framework config show`

To read the Gate configuration section without reading flow-JSON lines, run:

```bash
node <skill-directory>/scripts/agent-framework.mjs config show [--json] [--project <directory>]
```

It lists the five subcontracts — `checks`, `budget`, `bypass`, `execution`,
`evidence` — by name, one line per key. On an activated clone each value is
marked `matches` or `differs` against the section the Activation receipt
pinned, and a differing list of names says which were added and removed. The
receipt pins the section's identity, not its values, so the pinned values are
those `gate status --json` recovers (`observation.configuration`) by the rule
`gate sync` judges against: the receipt when a sync wrote it, else the file
when its identity never moved, else the committed file at `HEAD`. When no
document reproduces the pinned identity each value is `unrecoverable` and only
the section as a whole is compared. A clone never activated compares nothing.
Sensitive runtime inputs appear by name and the source `gate doctor --json`
resolves each from — never a value. A clone with no Gate section says so and
names setup's next step.

It is read-only: nothing under the clone or `.git` changes. Without the Gate
module a schema v4 clone is refused with `gate-unavailable`, and a Gate whose
status lacks the section is refused with `gate-configuration-unobserved` — update
the Gate module. Exit status is `0` when nothing differs, `1` when there is no
Gate section, it does not resolve, or a value differs, and `2` when it could not
run.

## Revising the Gate section by name: `agent-framework config <revision>`

To add or remove a dependency root, set how roots are provided, or change the
budget-skippable checks, never edit the YAML keys: name the revision.

```bash
node <skill-directory>/scripts/agent-framework.mjs config add-dependency-root <root> [--provisioning link|copy] [--confirm <token>] [--json] [--project <directory>]
node <skill-directory>/scripts/agent-framework.mjs config remove-dependency-root <root> [--confirm <token>] ...
node <skill-directory>/scripts/agent-framework.mjs config set-dependency-provisioning <link|copy> [--root <root>] [--confirm <token>] ...
node <skill-directory>/scripts/agent-framework.mjs config add-budget-skippable <check> [--confirm <token>] ...
node <skill-directory>/scripts/agent-framework.mjs config remove-budget-skippable <check> [--confirm <token>] ...
```

Without `--confirm` it writes nothing: it shows each line of the Gate section
the revision changes, before and after, its `previewHash`, and the exact
confirming command. `--confirm <previewHash>` writes exactly that change, and
only while the file is still the one previewed. The candidate is judged by the
same Gate policy validator `--configure-gate` loads and refused with its own
reason. Provisioning is set as a single strategy or, with `--root`, per root:
a single strategy that differs becomes a map in which every other root keeps
the strategy it had, and removing a root removes its map entry. A revision
that would change nothing is refused (`nothing-to-revise`).

Every byte outside the section — comments and formatting included — is kept.
The section itself is rewritten only when it round-trips: it is exactly what
`--configure-gate` writes (`evaluation_gate:` and then one flow-JSON line per
subcontract, `checks`, `budget`, `bypass`, `execution`, `evidence`, nothing
between them), so re-rendering the candidate the same way changes only the
revised line. A hand-written block section, a comment or blank line inside the
section, differently spelled JSON, or a section declared twice is refused by
line with nothing written (`section-unrevisable`, `section-ambiguous`); edit
that one by hand.

On an activated clone a confirmed revision continues into the Gate's own
preview of the re-pin `gate status` names for the changed configuration
(`gate sync --json`), checks it is for exactly the candidate written, and
prints its trusted and candidate identities, any weakening, any refusal, and
its own `--confirm` line. It never confirms that re-pin. A configured clone
that is not activated has nothing to re-pin. `allowed_environment` and
Verification profile commands are never revisable here.

The same operation runs without the Framework command:

```bash
node <skill-directory>/scripts/configure.mjs --project "$PWD" \
  --revise-gate add-dependency-root --root vendor --provisioning copy [--confirm <preview-hash>]
```

(`--check <id>` for the budget-skippable revisions.) Both write the same file.
Exit status is `0` when the revision is written and nothing follows, `1` when a
confirmation or a re-pin remains, and `2` when it was refused.

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

`verification.unclassifiedScripts` names every package script discovery
declined, with the reason. It is a report, not a question: nothing blocks on it
and none of it is inferred to be a verification command. Read it to confirm no
real check was left out.

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
   `test:integration`, `format:check`, and `smoke:<name>`, treats the type-check
   spellings `typecheck`, `type-check`, and `types` alike (so `typecheck:check`,
   `type-check:check`, and `types:check` are all accepted), uses referenced
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
an explicit logical `runner` and `args` array.

Do not hand-author that mapping from the migration report — the report names
the field that is missing, the mapping supplies it, and pasting the report back
fails on its own envelope keys. Ask for a correctly keyed draft instead:

```bash
node <skill-directory>/scripts/configure.mjs \
  --project "$PWD" \
  --draft-mapping
```

The draft is read-only and prints to stdout unless `--out <path>` is given, in
which case it refuses to overwrite an existing file. Its `commands` keys are
exactly the reported ambiguity paths and every value the framework has not
proved is `null`. Replace each `null` with a proved fact; a draft that still
carries one is refused by `--mapping` rather than accepted with a guess.

Preview without `--confirm`:

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

Check identities are owned by the provider that matches the project and are not
the ladder stage or command category names. Ask for a derived draft rather than
transcribing them:

```bash
node <skill-directory>/scripts/configure.mjs \
  --project "$PWD" \
  --draft-policy
```

The draft is read-only, prints to stdout unless `--out <path>` is given, and
refuses to overwrite an existing file. It emits all five subcontracts with
`checks.required` and `checks.advisory` taken from the matching provider's own
declared per-check default binding. Review both lists against the project — the
draft proposes the provider's defaults, not a decision. `budget.total_seconds`
is the total of the timeouts the configuration proved, or `null` when none are
proved; a `null` budget is refused by `--policy` rather than defaulted.

For a Laravel profile the draft's `evidence` subcontract declares
`sensitive_inputs: ["APP_KEY"]` and `environment_files: [".env"]`, because a
stock Laravel suite reads its encryption key from a git-ignored `.env` the
Gate's snapshot cannot contain. The Gate resolves that one approved name from
the file at evaluation time, hands it to the check, and scrubs it from
Evidence; names and paths only, never a value. Remove the two entries if the
project keeps its key elsewhere. Every other profile drafts `evidence: {}`.

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
creates a hook, receipt, trust decision, or evidence runtime. It configures
once: a clone already configured is refused, and its execution entries are
revised by name instead (`agent-framework config <revision>`, above).

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
