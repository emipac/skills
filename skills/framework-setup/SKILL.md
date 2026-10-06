---
name: framework-setup
description: Discover and configure a Laravel or Express/TypeScript repository for AI Skills Framework without modifying AGENTS.md, then, only when the maintainer opts in, take it through schema v4, Gate policy, and activation with the agent-framework command. Use before the first lifecycle run, when migrating the configuration schema, configuring or revising the optional Gate policy, switching tracker adapters, or changing project conventions, source scopes, or verification commands.
---

# Framework Setup

Create or update `.agent-framework.yaml`, the repository-local contract consumed
by the lifecycle skills. Discovery is deterministic; decisions remain human.
Every write goes through a command that previews first. This skill never
authors the configuration by hand.

`<skill-directory>` below is the directory holding this `SKILL.md`. Resolve it
from where the client installed the skill; do not assume a path.

## Rules that keep setup on its rails

- **Ask the state; never infer it.** Before and after every step run
  `node <skill-directory>/scripts/agent-framework.mjs setup --json` and read its
  `state`, `steps`, and `next`. That plan is the only source of what comes
  next.
- **Run what the plan names, verbatim.** Use each step's own commands,
  including its draft paths. Never invent a path, flag, step, or order.
- **Previews are free; confirmations are the maintainer's.** Run any preview.
  Show it to the maintainer, then run its `--confirm <token>` only after they
  approve that exact preview in this conversation. A preview run again has a new
  token; show it again.
- **Never answer `agent-framework setup`'s interactive prompts** and never pass
  `--consent-channel`: both say a person consented at a terminal.
- **Never hand-edit the `evaluation_gate` section.** Revise it by name with
  `agent-framework config <revision>`. Never put a secret value in any
  argument; a `NAME=value` argument is refused.
- **Run base setup only while the plan says `no-configuration` or
  `schema-v3`.** `configure.mjs --tracker …` writes a schema v3 file from
  scratch, so it refuses a schema v4 file (`schema-v4-configured`, exit 2) and
  writes nothing.
- **The Gate is opt-in.** Never configure or activate it unless the maintainer
  asked for it in this conversation; an installed Gate module is not consent.
- Never write `AGENTS.md` or `CLAUDE.md`; preserve every discovered `AGENTS.md`
  byte for byte.

## Process

### 1. Discover

```bash
node <skill-directory>/scripts/configure.mjs --project "$PWD" --discover
node <skill-directory>/scripts/agent-framework.mjs setup --json
```

Read every path reported under `guidelinePaths` before proposing anything;
existing repository instructions are authoritative. `verification.unclassifiedScripts`
names every package script discovery declined, with the reason: read it to
confirm no real check was left out, and do not turn any of it into a command.

Completion criterion: profiles, source-scope candidates, schema version, SRS
candidates, guideline paths, protected files, verification commands, and the
plan's `state` are known.

### 2. Base configuration

Only when the plan's `state` is `no-configuration`, or the maintainer wants to
change a schema v3 contract. Present the detected values and ask only about
unresolved or consequential choices:

1. **Tracker:** recommend the detected GitHub remote when present, otherwise
   `local-markdown`. Offer `local-markdown`, `github`, `jira`, `linear`.
2. **SRS:** recommend the strongest discovered candidate, or reserve
   `docs/specifications/srs.md` for `/srs-modeling`. Use `null` only when the
   maintainer explicitly excludes an SRS.
3. **Profiles:** backend `laravel`, `express-typescript`, or `unknown`; one
   compatible frontend `livewire`, `react-typescript`, `svelte-typescript`,
   `none`, or `unknown`. `none` means proved absent; `unknown` stays active and
   conservative. Both may be `none` only for a tooling-only repository.
4. **Source scopes:** backend, frontend, and shared roots. Prefer an existing
   contract, then detected entry points and conventional roots. Never classify
   TypeScript by extension alone.
5. **Command scopes:** each discovered command as backend, frontend, or both. A
   package-manager command is not inherently frontend. The type-check spellings
   `typecheck`, `type-check`, and `types` are treated alike. Watch, fix,
   development, coverage, and write variants stay excluded unless explicitly
   selected; prefer `format:check` over `format`. Record intentional exclusions
   and keep them on later runs.
6. **History:** keep an existing convention, otherwise recommend `docs/history`
   without creating it.

Show the proposed configuration, then run, with the confirmed values:

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

It writes only `.agent-framework.yaml`, `docs/agents/issue-tracker.md`,
`docs/agents/domain.md`, and `docs/agents/triage-labels.md`, and verifies every
discovered `AGENTS.md` is unchanged. Running it again with the same values must
produce byte-identical files. A schema version 2 file must be confirmed before
it is rewritten as schema version 3.

Completion criterion: the four managed files are written and the plan's `state`
is `schema-v3`.

### 3. Decide about the Gate

Ask the maintainer whether to adopt the Change Evaluation Gate: a clone-local
Git `pre-commit` gate that blocks a commit whose required checks fail, opt-in
and reversible. If not, go to step 7.

If yes, offer two ways and let them choose:

- **They run `agent-framework setup` in their own terminal (recommended).** It
  shows each remaining step's complete preview, asks only what nothing can
  derive, and confirms on their `yes`. Wait for them, then continue at step 5
  for anything the plan still names.
- **You continue with steps 4 to 6,** showing every preview and confirming each
  only after they approve it.

### 4. Schema v4 and the Gate policy

Follow the plan's steps in order, with their exact commands.

- **`migrate-schema-v4`:** run the step's draft command. Open the draft at the
  path it names and ask the maintainer for every value left `null`; never fill
  one with a guess. Write their answers into that draft — the only file you edit
  — then run the preview, show `proposedConfiguration`, and confirm on approval.
- **`configure-gate`:** run the step's draft command. Review
  `checks.required` and `checks.advisory` with the maintainer — the draft is the
  provider's defaults, not a decision — and have them decide a `null` budget.
  For a Laravel profile the draft's `evidence` declares
  `sensitive_inputs: ["APP_KEY"]` and `environment_files: [".env"]`, because the
  test suite needs the key from the git-ignored `.env`; ask whether the project
  keeps its key elsewhere before keeping them. Then preview, show, and confirm
  on approval.

The rules, refusals, and Laravel `APP_KEY` default of both transactions are in
[schema-and-gate-transactions.md](./references/schema-and-gate-transactions.md).

Completion criterion: the plan's `state` is `configured`.

### 5. Fill in what the project implies

On a configured clone, before activating:

```bash
node <skill-directory>/scripts/agent-framework.mjs config suggest --json
```

Present each proposal with its evidence. For each one the maintainer accepts,
run its `command` (a preview), show it, and run it again with `--confirm
<token>` on approval. Any other change to the Gate section — a root's
provisioning, a check moved between required and advisory, the budget, bypass —
is a named `config` revision too; see
[framework-command.md](./references/framework-command.md). Before activation
nothing needs re-pinning. On an activated clone each confirmed revision prints
a `gate sync` preview; that is a separate confirmation with its own token.

Completion criterion: `config suggest` proposes nothing the maintainer wants.

### 6. Doctor and activation

Run the plan's `doctor` command and report what it says. If it predicts that
activation would stop, resolve that first.

Then ask which client gets the Gate: `git` (Git only) or `cursor` (Git and
Cursor together). Say plainly that this is about the editor hook, not the
tracker. Cursor needs `.cursor/hooks.json` carrying `"version": 1`; the Gate
never creates it. If it is missing, ask before creating the minimal file:

```bash
mkdir -p .cursor
printf '{\n  "version": 1,\n  "hooks": {}\n}\n' > .cursor/hooks.json
```

Run the plan's activation preview, adding `--client cursor` when chosen, with
`--json`. Show it, and confirm it with its `confirmationToken` on approval. An
already activated clone gains or loses a client only by deactivating and
activating again; everything after activation belongs to the
`change-evaluation-gate` skill.

Completion criterion: the plan's `state` is `activated` with health `healthy`.

### 7. Verify and report

Run `setup --json` once more. Report:

- the plan's `state` and `next`;
- the tracker and profiles, and the backend, frontend, and shared source roots;
- the recorded SRS, glossary, ADR, guideline, convention, and history paths;
- the exact verification commands and their scopes;
- the protected instruction files checked;
- any value left `null` or empty.

Recommend committing `.agent-framework.yaml`, and `.cursor/hooks.json` when
Cursor was activated; until then the Gate reports the configuration as
unversioned. `agent-framework report --html` writes a one-page summary the
maintainer can read or share.

Completion criterion: the report is delivered and every discovered `AGENTS.md`
is byte-for-byte unchanged.

## References

- [framework-command.md](./references/framework-command.md): every
  `agent-framework` subcommand — `setup`, `config show`, the named `config`
  revisions, `config suggest`, `report --html` — with refusals and exit status.
- [schema-and-gate-transactions.md](./references/schema-and-gate-transactions.md):
  the direct migration and Gate-configuration transactions.
- [configuration.md](./references/configuration.md): interpreting the generated
  contract.
- Only the selected tracker's reference:
  [local Markdown](./references/tracker-local-markdown.md),
  [GitHub](./references/tracker-github.md),
  [Jira](./references/tracker-jira.md),
  [Linear](./references/tracker-linear.md).
