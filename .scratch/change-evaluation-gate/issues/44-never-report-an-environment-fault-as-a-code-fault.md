# TB-044 — Never report an environment fault as a code fault

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 44-never-report-an-environment-fault-as-a-code-fault
Draft key: TB-044

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A check that could not run says so. The maintainer, and the agent reading over
their shoulder, can tell "your code is wrong" from "this check never got what it
needed", and neither is ever told to change the project because the evaluation
environment was missing something.

## SRS Traceability

- `FR-EVAL-003`, `FR-EVAL-008`, `FR-POL-003`
- `AC-EVAL-003`, `AC-EVAL-008`
- `SG-EVAL-001`, `SG-OWNER-001`
- `NFR-OPER-001`, `NFR-REL-003`
- `RISK-002`

## Defect this contract fixes

Raised by a real `gms` run at release `0.11.2`, preserved under
`real-project-evidence/change-evaluation-gate-0.11.2/`. Three of that run's
checks reported `failed` with `grader-negative` — the outcome that means the
graded code did not satisfy the check — when in every case the check never
evaluated the code at all:

- The formatter refused to start: *"The [--dirty] option is only available when
  using Git."* A materialized snapshot is a tree of files with no repository, so
  a command whose arguments depend on Git cannot run in one.
- Static analysis crashed: *"PHPStan process crashed because it reached
  configured PHP memory limit: 128M"*, where the maintainer's own shell gives it
  `512M`. The interpreter the Gate resolved is not the interpreter the
  maintainer's tools are configured for.
- Lint reported ordering violations against import paths that a build step
  generates. Generated directories are not tracked, so they are absent from the
  snapshot, and the resolver reclassified every import that pointed at them.

Each was reported as a finding about `gms`. Verified from the preserved
envelope: `outcome: failed`, `reasonCode: grader-negative` on all three.

The harm is not that the run was red. It is what a red run instructs. The
maintainer's agent read those three as defects in the project and began
rewriting the project to satisfy them — dropping a formatter flag, adding a
bootstrap file, loosening lint configuration, and removing a test-suite
directory filter whose removal would apply the framework test case and a
database refresh to every unit test. Its own preserved reasoning notes the
danger and proceeds anyway: *"Modifying verification commands without
framework-setup authorization is risky, since those commands fall outside the
five Gate subcontracts."* The maintainer stopped it before anything was written.

A gate that makes a project worse to satisfy the gate has inverted its purpose.

Verified, and this is the mechanism: **the prerequisite system exists, is
complete, and is switched off.** `evaluate.mjs:531-545` filters a check's
declared `prerequisites` through `dependencies.resolvePrerequisite` and reports
`prerequisite-missing` / `unverified` for any that is not proved. The descriptor
contract already defines the four kinds — `executable`, `configuration`,
`service`, `environment` — and validates them
(`check-descriptor.mjs:227-237`). And both production runners pass
`resolvePrerequisite: () => true` (`hook-runner.mjs:969`,
`preflight-runner.mjs:312`), so every declared prerequisite is asserted proved
without anything being checked.

That is a fail-open, and it is the same shape this project has fixed repeatedly:
a component built, proved in isolation, and never reached by the runtime.

## Domain Concepts

Prerequisite, Proved requirement, Environment fault, Grader-negative outcome,
Unverified outcome, Snapshot environment, Declared dependency root.

## Approach and Tradeoffs

Verified: `prerequisite-missing` already maps to `unverified` in the evaluation
process contract, and `unverified` already denies authoritatively — absence of
evidence is never success. The outcome this slice needs already exists and
already fails closed. What is missing is anything that produces it.

Verified: `PREREQUISITE_KINDS` are `executable`, `configuration`, `service`, and
`environment`, and a prerequisite carries a `kind` and a `name`. The vocabulary
for "this check needs Git", "this check needs this much memory", and "this check
needs these generated directories" is already declared data owned by the
provider or the project, not by Gate core (`SG-OWNER-001`).

Proposed — bind a real resolver in both runners. Replace
`resolvePrerequisite: () => true` with one that actually establishes each
declared prerequisite against the environment the checks will run in, and let
the existing `prerequisite-missing` path report the ones it cannot. The
implementer establishes what "proved" means per kind from the descriptor
contract, and confirms that a check declaring no prerequisites behaves exactly
as it does today.

Proposed — the snapshot states what it is. A resolver can only answer
`kind: 'environment'` questions if the snapshot's own properties are legible:
that it is a tree of files without a repository, which interpreter and version
each runner resolved to, and which declared dependency roots were provided
against which were missing. Verified: the missing-dependency-root case is
already established and reported by `TB-030`'s work in `snapshot.mjs`, so part
of this exists — the implementer confirms how much and reuses it rather than
building a second answer.

Proposed — do not teach Gate core any tool. Gate core must not learn that one
formatter flag needs Git or that one analyzer needs memory. A check declares
what it needs; the Gate proves or refuses. If satisfying this outcome appears to
require a tool name inside Gate core, that is a signal the declaration is in the
wrong place, and the implementer reports it rather than writing the tool name.

Proposed — say which, in the decision. `NFR-OPER-001` requires a denial be
diagnosable without reading client-native logs. An unverified check must name
the prerequisite that was not proved, so a maintainer or an agent reads "this
check needed X and did not get it" rather than inferring it from a tool's error
text. The implementer confirms the reason reaches the desktop feedback channel,
because that channel is what pointed the agent at the project in the first place.

Deliberately not a fix for the environment gaps themselves. This slice does not
make a snapshot a Git repository, does not configure interpreters, and does not
materialize generated inputs. It makes the Gate say what it could not do instead
of blaming the code. Whether any of those gaps should later be closed is a
separate decision this contract does not take.

Deliberately not a heuristic. Nothing infers "that looks like an environment
failure" from an exit code or an error string. A prerequisite is declared and
proved, or it is not.

## Architecture Boundary and Public Seam

The boundary is between a check that ran and produced a verdict about the code,
and a check that never got what it needed to run. Today both arrive as
`failed` / `grader-negative`. The public seam is the prerequisite resolver the
runners bind, and the `unverified` / `prerequisite-missing` result the
evaluation already knows how to produce.

First red test: a check declaring a prerequisite the environment does not
satisfy reports `unverified` naming that prerequisite, where today it runs
anyway and reports whatever the tool's failure looked like.

## Safeguards and Invariants

- `SG-EVAL-001`: nothing here changes what a snapshot is, how its identity is
  derived, or the post-run re-check.
- `SG-OWNER-001`: Gate core gains no tool name, no stack branch, and no opinion
  about which flag needs what. Requirements are declared by whoever owns the
  check.
- `NFR-REL-003`: an unproved prerequisite is `unverified` and therefore denies
  authoritatively. Nothing in this slice lets a check pass because it could not
  run.
- `FR-POL-003`: a required check that is `unverified` still denies. This changes
  the reason a maintainer is given, never the authorization.
- `NFR-OPER-001`: every unverified check names what was not proved.

## Prohibited Behavior and Non-goals

Do not infer an environment fault from an exit code, an error string, or any
tool output. Do not add a tool name, flag name, or stack branch to Gate core. Do
not make a snapshot a Git repository, install or configure an interpreter, or
materialize generated inputs. Do not let an unproved prerequisite produce
`passed`, `not-applicable`, or a skipped check — it is `unverified`. Do not
change the evaluation ladder, applicability, or `decisionOutcome`. Do not change
the execution root's naming — that is `TB-043`.

## Risk and Decision Impacts

- `RISK-002`: isolation limits are accepted on the basis that they are explicit.
  Three limits were not explicit, and the cost was a maintainer's agent
  proposing to degrade a real project. Making them declarable and reportable is
  what the disposition assumed.
- No authorization changes. Every outcome this slice produces already denies.

## Acceptance Criteria

- [ ] `AC-EVAL-003`: a check whose declared prerequisite the environment does not
  satisfy reports `unverified` with `prerequisite-missing` and never runs its
  command, where today it runs and reports `grader-negative`.
- [ ] `NFR-OPER-001`: that check names the unproved prerequisite in the decision,
  and the same naming reaches the desktop preflight feedback channel.
- [ ] `AC-EVAL-008`, `FR-POL-003`: a required check that is `unverified` still
  denies authoritatively; nothing here turns a blocked commit into an allowed one.
- [ ] A check declaring no prerequisites behaves exactly as it does today, proved
  against the existing commit and preflight fixtures.
- [ ] `SG-OWNER-001`: the diff adds no tool name, flag name, or stack branch to
  Gate core, proved by inspection and stated in the report.
- [ ] Each of the three faults the preserved `gms` evidence recorded is
  reproducible as a fixture and reports `unverified` naming what was missing,
  rather than a verdict about the code.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-EVAL-003`, `AC-EVAL-008`: unproved-prerequisite, proved-prerequisite, no-prerequisite, and required-still-denies fixtures against the real runners | `npm run test:unit` | Yes — the unit suite owns evaluation and both runners |
| smoke | both | `AC-EVAL-003`, `NFR-OPER-001`: a real clone whose check declares an unsatisfiable prerequisite denies a real commit and states what was not proved, rather than reporting a code failure | `gate-activation-smoke`, extended by this slice | Yes — that capability drives real commits through the authoritative runner |

Frontend build and browser evidence are inapplicable; this slice changes local
evaluation reporting.

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

Every fixture's checks run in an environment the fixture built for them, so no
check has ever wanted something the environment did not have. The prerequisite
path is covered — there are tests for `prerequisite-missing` — but they inject a
resolver that refuses, which proves the reporting and says nothing about whether
any runner ever asks. The stub in both runners is invisible to a suite that
supplies its own resolver everywhere it looks.
