# FS-005 — Never rewrite a schema v4 configuration as v3

Status: done
Labels: done, defect
Blocked by:
Tracker ID: 05-never-rewrite-a-schema-v4-configuration-as-v3
Draft key: FS-005

**Status:** done

**Parent feature contract:** none. `framework-setup` owns `.agent-framework.yaml`
and its base configuration, and this is a defect in that operation rather than
in any feature built on it.

## Outcome

Base setup never silently throws away a schema version 4 configuration. A
maintainer or agent who runs `configure.mjs --tracker …` on a clone that has
already moved to schema v4 — with or without a Gate section, activated or not —
is refused with a stated reason and the file is left exactly as it was.

## Defect this contract fixes

Verified, by running it on a temporary copy of a real activated project's
configuration (`schema_version: 4` with an `evaluation_gate` section):

```
$ node configure.mjs --project . --tracker local-markdown   # exit 0
schema_version: 4  →  schema_version: 3, no evaluation_gate
```

Verified: `configureProject` in `skills/framework-setup/scripts/configure.mjs`
builds a fresh `schema_version: 3` document from discovery and selections and
writes it over `.agent-framework.yaml` without reading the existing schema
version. Nothing refuses, warns, or previews.

Consequences:

- every schema v4 decision is lost silently: the migration's mapped profiles and
  Command descriptors, and the whole Gate policy;
- on an activated clone the next commit is denied as `trusted-configuration`
  drift, and `gate status` names `gate sync`, which would then try to re-pin a
  configuration with no Gate section;
- the `framework-setup` skill told agents to "rerun the identical configure
  command" to prove idempotency, which is exactly the trigger. The skill now
  forbids base setup outside `no-configuration` and `schema-v3`, but the code
  still allows it.

## Approach and Tradeoffs

- Proposed: base setup reads the existing file's schema version first. On
  schema v4 it refuses with a dedicated reason code (for example
  `schema-v4-configured`) that names the version, says nothing was written,
  and points to the operations that own a v4 file: `agent-framework config
  <revision>` for the Gate section, and the maintainer's own edit for anything
  else. The implementer confirms the code name and that the refusal uses the
  same output and exit-status conventions as the script's other refusals.
- Proposed: schema v3 and a missing file behave exactly as today, including the
  existing schema v2 confirmation rule and byte-identical repeat runs.
- Not proposed: a v4-preserving rewrite. Re-rendering a v4 file from discovery
  would have to decide which discovered values may override confirmed v4 ones;
  that is a product decision this ticket does not make.

## Architecture Boundary and Public Seam

`framework-setup`'s base configuration. Public seam: `configure.mjs` run as a
child process with `--tracker …` on fixtures, and `configureProject` in-process
as the existing tests do. First red test: on a schema v4 fixture with an
`evaluation_gate` section, base setup exits non-zero and the file's bytes are
unchanged — today it exits 0 and rewrites it as v3.

## Safeguards and Invariants

- Every discovered `AGENTS.md` stays byte-for-byte unchanged, as the repository
  guidance requires.
- Repeat runs on schema v3 stay byte-identical.
- A refused run writes none of the four managed files.

## Prohibited Behavior and Non-goals

- No migration back to v3, no automatic re-migration to v4, and no merge of
  discovered values into a v4 file.
- No change to `--migrate-v4`, `--configure-gate`, or `--revise-gate`.

## Acceptance Criteria

- [x] On schema v4 fixtures — with no Gate section, with a configured Gate
  section, and with an activated clone's configuration — base setup is refused
  with the stated reason, exits non-zero, and every managed file's bytes are
  unchanged.
- [x] A missing configuration and a schema v3 configuration behave exactly as
  before, including byte-identical repeat runs and the schema v2 confirmation
  rule.
- [x] `agent-framework setup --json` on a schema v4 clone still names no base
  setup step.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | refusal on three v4 fixtures, unchanged bytes, v3 and missing-file behavior unchanged, AGENTS.md unchanged | `npm run test:unit` | Yes — the defect is fully observable at the script |
| smoke | both | the installed skill's `configure.mjs` refuses on a v4 file | `npm run test:install` | Yes — maintainers run the installed copy |

Frontend build and browser evidence are inapplicable.

## Blocked By

None — can start immediately.

## Unresolved Assumptions

None.

## Readiness

- [x] The outcome is a complete vertical behavior.
- [x] Acceptance criteria trace to the SRS and feature contract.
- [x] The public seam and first red test are identified.
- [x] Safeguards and non-goals are explicit.
- [x] Risks and resolved decisions are traced to the parent contract.
- [x] Blocking edges exist and are acyclic.
- [x] No unresolved assumption blocks the start.
- [x] The ticket fits one fresh implementation context.
- [x] User-facing and frontend evidence requirements are covered or explicitly inapplicable.

## Why existing coverage missed this

Every base-setup fixture starts from a missing file or a schema v3 file, because
base setup predates schema v4 and the migration was added beside it as a
separate transaction. No fixture ran base setup after a migration.
