# Schema v4 migration and Gate configuration, step by step

The direct `configure.mjs` transactions behind the `migrate-schema-v4` and
`configure-gate` steps that `agent-framework setup --json` names. The workflow
that runs them is in [SKILL.md](../SKILL.md); prefer the exact commands, draft
paths included, that the plan prints.

## Migrate schema v3 to v4

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

## Configure the Gate policy

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
once: a clone already configured is refused, and its entries are revised by
name instead (`agent-framework config <revision>`, in [framework-command.md](framework-command.md)).

Completion criterion: the result reports `configured`, the exact preview was
installed, and commit behavior remains unchanged.
