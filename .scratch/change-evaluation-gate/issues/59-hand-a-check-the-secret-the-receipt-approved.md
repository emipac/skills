# TB-059 — Hand a check the secret the receipt approved

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 59-hand-a-check-the-secret-the-receipt-approved
Draft key: TB-059

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A stock Laravel project's test suite boots inside the Gate's snapshot without
the maintainer hand-editing anything. A Sensitive runtime input a project
declared and an operator approved at activation is resolved from where the
project keeps it, handed to the check that needs it, scrubbed from everything
the Gate stores, and gone when the evaluation ends — and `framework-setup`
declares the one every Laravel project needs so nobody has to know this exists.

## SRS Traceability

- `FR-CFG-006`, `FR-LIFE-006`, `FR-LIFE-013`, `FR-EVAL-004`
- `AC-CFG-004`, `AC-EVAL-001`, `AC-EVID-001`
- `SG-SECRET-001`, `SG-OWNER-001`, `SG-EVAL-001`
- `NFR-SEC-003`, `NFR-OPER-001`, `NFR-REL-001`
- `RISK-006`

## Defect this contract fixes

Found on the first real project whose test suite reached the point of booting
inside the snapshot, after `TB-054`.

### What happens

Verified on a Laravel and TypeScript project: with `vendor` provided by copy,
Pest boots and 38 of 40 tests fail with one exception:

```
MissingAppKeyException: No application encryption key has been specified.
```

`APP_KEY` lives in `.env`. `.env` is git-ignored. `captureSnapshot` materializes
tracked content, so the snapshot has no `.env` and Laravel has no key.

### This is every Laravel project, not this one

Verified: the project's `phpunit.xml` is the stock Laravel skeleton — the
`php` element sets `APP_ENV=testing`, `DB_CONNECTION=sqlite`,
`DB_DATABASE=:memory:`, array cache and session, sync queue, and **no
`APP_KEY`**. Laravel leaves it out deliberately and relies on `.env`, which
`composer create-project` populates through `key:generate`. A standard Laravel
project therefore runs its tests locally and fails inside the snapshot, on
first activation, with a message that names the project's configuration rather
than the Gate's.

This framework declares Laravel a first-class profile. `FR-CFG-006` already
says activation shall "temporarily copy approved environment files, record only
their names and sources, and remove the copies with the evaluation
materialization." The requirement exists; the runtime does not do it.

### What is built, and what reaches it

Verified: `materializeRuntimeInputs` (`security-control.mjs:221`) takes
`{ approved, inputs, executionRoot }`, refuses any input whose name the
receipt did not approve, writes each approved value to a `0600` file under
`.change-evaluation-gate-runtime-inputs/` inside the execution root (directory `0700`),
and returns `{ record, refused, environment, files, release }` — names and
sources in `record`, values only in `environment` and on disk. Its own comment
states the design: *"This module never reads an ambient environment, a
credential store, or a developer's files. Values arrive from the caller that
resolved them."*

Verified: outside its own smoke, **nothing calls it.** The same shape as
`TB-045`'s `runtimeInputs: []`, `TB-044`'s `prerequisites: []`, and every other
built-and-unreached subsystem this project has closed.

Verified after `TB-045`: a project can now declare
`evidence.sensitive_inputs: ["APP_KEY"]`, the receipt pins the name, and
`declaredSecrets` (`hook-runner.mjs:732`) reads the value from the runner's
process environment. **That is not where Laravel keeps it.** Laravel reads
`.env` from the file; the maintainer's shell does not export `APP_KEY`. So on
this project the declaration lands as `redaction.unresolved` on every commit,
the redactor arms nothing, and the check still has no key.

### And the check would not receive it anyway

Verified at `bounded-execution.mjs:87-95`: `environmentFor` passes a variable
to the check process only if its name is in the descriptor's
`allowed_environment`. Every descriptor `framework-setup` writes has
`allowed_environment: []` — verified on this project, six of six. A value the
Gate resolved would stop at that gate.

## Domain decisions this contract settles

**Resolve from the file; never copy the file.** The declared name is the
allow-list. The Gate reads *those names and only those names* from a declared
environment file, and nothing else in that file is ever read, copied, or
reported. `SG-SECRET-001` — *"a value must not enter configuration or
evidence"* — is satisfied by the existing materializer, which was designed for
exactly this and puts the value in a `0600` file inside the execution root and
in the check's environment, nowhere else. Copying `.env` whole into the snapshot
would put every secret the file holds beside the graded tree for the benefit of
one; it is rejected.

**Process environment beats the file, in both directions.** Laravel's own
loader does not overwrite a variable already present in the process
environment — that is the mechanism `phpunit.xml`'s environment overrides rely on
— so a resolved value handed to the check through its environment is honoured
without the file. And a name already present in the runner's environment is
taken from there and the file is not consulted for it. One rule, no branch on
the framework.

**Approval at activation is the consent to hand it over.** A name the receipt
pinned was previewed and confirmed by an operator. That consent covers giving
the value to the check — the whole purpose of declaring it — and does not
require the maintainer to also list it in `allowed_environment`, which governs
pass-through of *ambient* variables and is a different question. An approved
runtime input reaches the check; an unapproved one is refused by name, as the
materializer already does.

**`framework-setup` declares it for Laravel.** `FR-LIFE-013` makes setup the
owner of the Gate section a project starts with. When the configured profile is
Laravel, setup writes `sensitive_inputs: ["APP_KEY"]` and the environment file
`".env"` into the section it generates, so a maintainer activating a stock
project meets a working test suite rather than an exception. A maintainer who
does not want it removes one line. Verified that this is sufficient for a stock
suite: the project above needs nothing else — 38 failures, one cause.

## Domain Concepts

Sensitive runtime input, Environment file, Approved name, Materialized input,
Check environment, Allowed environment, Laravel profile.

## Approach and Tradeoffs

Verified: `TB-045` put the declaration under `evidence`, validates it in
`policy.mjs`, and carries names to the receipt. The file declaration goes
beside it in the same subcontract — a list of repository-relative paths, held
to `isContainedRoot` (`policy.mjs:~70`) so nothing can name a path outside the
repository, and refused if the path is tracked, because a tracked file is
already in the snapshot and copying it would be a second source.

Verified: the materializer already returns `environment` and `release`, and
`releaseExecutionRoot` (`hook-runner.mjs:~235`) already removes the whole root
in `finally`, so removal "with the evaluation materialization" costs nothing
new. `sweepOrphanedExecutionRoots` (`TB-038`) covers an interrupted run, and a
`0600` file under the OS temporary directory is the transient the implementer
states rather than hides.

Proposed — resolve at the seam that already has the receipt and the execution
root. The implementer establishes where, and states it; the packaged runners
both open their store through one path and both hold the receipt when they do.
Resolution reads each approved name from the runner's environment first, then
from each declared file in declaration order, taking the first value found and
never reading a name that was not approved. What it hands the materializer is
`{ name, source, value }` with `source` naming which — `environment` or the
file's declared path.

Proposed — feed the redactor from the same resolution. `declaredSecrets` today
reads the environment only; the values the materializer was handed are the
values the redactor must scrub, whatever their source. One resolution, two
consumers, so a value can never reach a check without also reaching the
redactor. `residualFindings` then proves absence before persistence as it does
today.

Proposed — hand approved inputs to the check without touching
`allowed_environment`'s meaning. The implementer establishes how the
materializer's `environment` is merged into `environmentFor`'s result — after
the ambient pass-through, so an approved input is never shadowed by an ambient
one of the same name, and never the other way around — and proves that a
descriptor with `allowed_environment: []` still receives an approved input
while receiving no ambient variable it did not list.

Proposed — the file is the maintainer's; read it as such. Parse only enough of
the environment-file grammar to find `NAME=value` for the approved names —
quoted and unquoted values, `export` prefix, comments. No YAML library, no
dotenv library, no runtime dependency: `TB-049`'s reasoning applies. A file
that cannot be parsed for an approved name yields no value for it, which is the
`unresolved` case `TB-045` already records, not an error.

Proposed — `framework-setup` writes the Laravel default. `configureGate`
(`configure.mjs:~1036`) writes `evidence: {}` at `:~842`; when the backend
profile is Laravel it writes the two declarations instead. Repeat runs stay
byte-identical, as that skill's own contract requires, and the smoke-install
prose that describes the generated section is updated with it.

Proposed — record what was resolved from where, names only. The envelope's
`redaction.secrets[].source` already exists; `unresolved` already exists. A
maintainer reading evidence should see that `APP_KEY` was resolved from `.env`
and scrubbed, or was unresolved and why. No value, no derived form.

Deliberately not copying any file into the snapshot, not reading any name that
was not approved, not reading `.env` on the maintainer's behalf for anything
but the declared names, not a secret store, not an approval flow beyond the
activation consent that exists, and not a change to what `allowed_environment`
means for ambient variables. Deliberately not host-path redaction, which
remains its own gap.

## Architecture Boundary and Public Seam

The boundary is between a secret a project keeps in a file and a check that
needs it inside an isolated materialization that holds only tracked content.
The public seam is the environment-file declaration beside `sensitive_inputs`,
the resolution that turns approved names into values, the materializer that was
built for this and reached by nothing, and the environment the check receives.

First red test: a Laravel-shaped fixture whose test reads `APP_KEY` and whose
`.env` is git-ignored fails inside the snapshot with a missing key today, and
boots after this change — with the key's value absent from every stored byte.

## Safeguards and Invariants

- `SG-SECRET-001`, `NFR-SEC-003`: no value enters configuration, the receipt,
  an envelope, a blob, an event, or the committer-facing output. Only declared,
  approved names are ever read from a file.
- `FR-CFG-006`: names and sources are recorded; values live in a `0600` file
  under the execution root and in the check's environment, and are removed with
  the materialization.
- `AC-CFG-004`: an input the receipt did not approve is refused by name; its
  value is never read.
- `SG-EVAL-001`, `FR-EVAL-004`: the runtime-input directory is outside the
  snapshot path list, identity, and immutability re-check — as `TB-054`'s
  provided roots are.
- `SG-OWNER-001`: no variable name, file name, or framework branch enters Gate
  core. `APP_KEY` and `.env` appear in `framework-setup`'s Laravel profile and
  in fixtures, nowhere in `scripts/lib/`.
- `NFR-REL-001`: an identical binding resolves the same checks and identities;
  which source a value came from is recorded, never part of an identity.
- `AC-EVID-001`: redaction runs before persistence; two runs printing the same
  resolved value address one envelope.
- A project declaring no file behaves exactly as `TB-045` left it.

## Prohibited Behavior and Non-goals

Do not copy an environment file, or any file, into the snapshot. Do not read a
name from a file that the receipt did not approve. Do not read any file the
configuration did not declare. Do not add a runtime dependency. Do not put a
variable name, file name, or framework check into `scripts/lib/`. Do not change
what `allowed_environment` means for ambient variables. Do not let an approved
input reach a check without also reaching the redactor. Do not report a value
or a derived form of one anywhere. Do not weaken the materializer's refusal of
unapproved names. Do not touch host-path redaction.

## Risk and Decision Impacts

- `RISK-006`: redaction missing a secret in command output. Its stated
  mitigation begins with "allowlisted inputs"; `TB-045` built the allow-list
  and this contract makes it cover the values a check actually receives.
- `FR-LIFE-013`: setup presents Gate configuration as an unselected option and
  infers no consent. Writing a Laravel default into the section a maintainer
  has already chosen to generate is within that; activation still previews the
  names and obtains consent.
- No safeguard is withdrawn.

## Acceptance Criteria

- [ ] `FR-CFG-006`, `AC-EVAL-001`: a Laravel-shaped fixture whose test needs a
  key kept only in a git-ignored `.env` fails inside the snapshot before this
  change and boots after it, with the same commit blocked on a required
  failure and allowed on a pass.
- [ ] `SG-SECRET-001`, `NFR-SEC-003`: the resolved value appears in no stored
  byte — envelope, blob, decision, event, receipt, configuration, or
  committer-facing output — in raw, base64, hex, or url-encoded form, proved
  by scanning.
- [ ] `AC-CFG-004`: a name present in the file but not approved by the receipt
  is not read, not handed to the check, and refused by name in the record.
- [ ] Only approved names are read from a declared file, proved by a file
  holding an undeclared name whose value is then shown absent from the check's
  environment and from every stored byte.
- [ ] A name present in the runner's environment is taken from there and the
  file is not consulted for it; a name present in neither is `unresolved`.
- [ ] A descriptor with `allowed_environment: []` receives every approved
  input and no ambient variable it did not list.
- [ ] `FR-CFG-006`: the value's file is `0600` under the execution root and is
  gone when the evaluation ends, including after an interrupted run, proved
  against the existing sweep.
- [ ] `AC-EVID-001`: redaction precedes persistence and two runs printing the
  same resolved value address one envelope.
- [ ] `FR-LIFE-013`: `framework-setup` writes `sensitive_inputs` and the
  environment file for a Laravel profile, repeat runs are byte-identical, and a
  non-Laravel profile's generated section is unchanged.
- [ ] `SG-OWNER-001`: no variable name, file name, or framework branch is
  added to `scripts/lib/`, stated in the report.
- [ ] A project declaring no file behaves byte-identically to today.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CFG-004`, `SG-SECRET-001`, `NFR-SEC-003`, `AC-EVID-001`: declaration-validated, approved-name-resolved-from-file, unapproved-name-not-read, environment-beats-file, unresolved-recorded, allowed-environment-untouched, redactor-fed-from-resolution, value-absent-from-stored-bytes, and setup-writes-laravel-default fixtures against the real policy, materializer, executor, and setup modules | `npm run test:unit` | Yes — the unit suite owns policy, the materializer, bounded execution, and `framework-setup` |
| smoke | both | `FR-CFG-006`, `AC-EVAL-001`, `SG-EVAL-001`: a real activated clone with a git-ignored environment file boots a check that needs a value from it, the value is absent from every stored byte, the `0600` file is gone after the run, and a required failure still blocks | `gate-security-control-smoke` and `gate-activation-smoke`, extended by this slice | Yes — real files, real permissions, and real removal are only observable against a real execution root |
| smoke | both | `FR-LIFE-013`: a smoke-installed Laravel project's generated Gate section carries the declaration, and repeat runs are byte-identical | `npm run test:install` | Yes — that capability owns what `framework-setup` generates |

Frontend build and browser evidence are inapplicable; this slice changes local
runtime-input resolution and one profile default.

## Blocked By

None.

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

`gate-security-control-smoke` proves the materializer thoroughly — by calling
it directly with values the fixture resolved. Nothing in the suite has a test
that *needs* a secret to boot, because the suite's checks are Node scripts that
need nothing. And until `TB-054` no real project's test suite got as far as
booting inside the snapshot, so the exception that names the missing key was
never seen. The two halves — a materializer nothing calls, and a framework that
keeps its key in an untracked file — met for the first time on a real project.
