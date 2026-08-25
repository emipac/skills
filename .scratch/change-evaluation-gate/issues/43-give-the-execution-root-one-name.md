# TB-043 — Give the execution root one name

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 43-give-the-execution-root-one-name
Draft key: TB-043

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

The directory a check runs in has exactly one name. A tool that resolves the
path it was given reaches the same place the Gate named, so no check fails
because two spellings of one directory did not compare equal.

## SRS Traceability

- `FR-EVAL-004`, `FR-EVAL-005`
- `AC-EVAL-004`, `AC-EVAL-006`
- `SG-EVAL-001`, `SG-OWNER-001`
- `NFR-PORT-002`, `NFR-REL-001`
- `RISK-002`

## Defect this contract fixes

Raised by a real `gms` run at release `0.11.2`, preserved under
`real-project-evidence/change-evaluation-gate-0.11.2/`.

Verified: `createExecutionRoot` builds the root as
`mkdtemp(path.join(tmpdir(), prefix))` (`hook-runner.mjs:187`), and `tmpdir()`
is not resolved. Verified on the reporting machine:

```
tmpdir  : /var/folders/gg/…/T
realpath: /private/var/folders/gg/…/T
equal   : false
```

Verified: the preserved `log.ndjson` records
`executionRoot: /var/folders/gg/…/gate-preflight-exec-2ZJtX8`, and the
preserved test output names the same directory the other way —
`FAILED Private\var\folders\gg\sqwfjpd0rgdgdvtk81w0sw40…`. The test runner
canonicalized the path it was handed, compared it against the path it was
given, and found them different.

The result is `40` of `41` tests failing in a suite that passes locally, and
the whole evaluation reported `failed`. Nothing about the code under evaluation
was wrong.

What makes this worse than a broken run: the maintainer's agent read those
failures as findings about the project and began changing the project to satisfy
them. Its own reasoning, preserved: removing the test suite's directory filter
would apply the framework test case and a database refresh to every unit test.
That is a permanent degradation of a real project, proposed because the Gate
reported an environment fault as a code fault. The maintainer stopped it.

Verified, and it is the strongest evidence that this is an oversight rather
than a decision: this codebase already resolves the temporary directory
elsewhere. `TB-036` and `TB-038` compare against `realpath` of the system
temporary directory when bounding the orphan sweep. One place resolves it, the
other does not, and the two are about the same directory.

## Domain Concepts

Execution root, Materialized snapshot, Canonical path, Symbolic link,
Dependency root, Snapshot identity.

## Approach and Tradeoffs

Verified: the execution root is created in one place, `createExecutionRoot`
(`hook-runner.mjs:187`), which both runners call. There is a single point to fix.

Verified: the snapshot identity is derived over repository-relative paths, not
absolute ones (`contentIdentity` in `snapshot.mjs`), so canonicalizing the root
cannot move any snapshot identity. The implementer confirms this before relying
on it.

Proposed — resolve the root once, where it is created. Everything downstream —
materialization, the identity re-check, dependency-root symlinks, the executor's
working directory, the recorded `executionRoot` — then names the same directory
a tool will name after resolving it. The implementer confirms that resolving
after `mkdtemp` rather than resolving the temporary directory first still yields
a path that exists and is the one created.

Proposed — one definition of the resolved temporary directory. The sweep added
by `TB-038` already resolves it; the implementer confirms both uses read the
same helper rather than each calling `realpath` in its own way, so a third
caller cannot reintroduce the split.

Proposed — prove it the way it actually broke. A fixture that asserts the
recorded root equals its own canonical form is necessary but weak; it would pass
on Linux where the two are already equal and prove nothing about the machine
that reported this. Prove instead that a check *executed inside the root*
observes the same path the decision records — the comparison the test runner
made. The implementer chooses how, and states whether the proof is
platform-dependent.

Deliberately not a path-rewriting layer. Nothing translates between spellings,
nothing normalizes tool output, and nothing in Gate core learns what any tool
does with a path (`SG-OWNER-001`). The root is created canonical and there is
only one spelling to have.

## Architecture Boundary and Public Seam

The boundary is between the name the Gate gives the execution root and the name
the operating system considers canonical. The public seam is
`createExecutionRoot` and the `executionRoot` every consumer reads from it.

First red test: a check executing inside the execution root observes the same
absolute path the decision records, where today it observes a resolved path the
decision does not name.

## Safeguards and Invariants

- `SG-EVAL-001`: the snapshot identity, its derivation, and the post-run
  re-check are unchanged. Identity is over relative paths, so no decision's
  snapshot identity may move because of this slice.
- `SG-OWNER-001`: no tool name, no tool-specific path handling, and no knowledge
  of what any check does with the path it is given.
- `NFR-PORT-002`: temporary-path handling stays free of operating-system-labelled
  product logic. A platform where the two spellings already agree must behave
  exactly as it does today.
- `NFR-REL-001`: dependency roots keep pointing at the same installed
  directories, and remain outside the snapshot identity.
- `FR-EVAL-005`: the execution root is still removed after the run, and
  `TB-038`'s signal disposition and orphan sweep still find and reclaim it.

## Prohibited Behavior and Non-goals

Do not add a translation, rewriting, or normalization layer for paths in check
output. Do not change what a snapshot contains, how its identity is derived, or
the post-run re-check. Do not change the dependency-root mechanism beyond the
root it hangs from. Do not special-case an operating system in product logic. Do
not address the other environment gaps the same `gms` run exposed — a check
whose command depends on Git, an interpreter whose limits differ from the
maintainer's shell, or absent generated inputs — those are `TB-044`.

## Risk and Decision Impacts

- `RISK-002`: isolation limits are explicit by design. A root whose name does
  not survive resolution is an isolation limit nobody stated and nobody could
  have anticipated.
- No disposition changes. Every evaluation still materializes, still grades,
  still re-verifies.

## Acceptance Criteria

- [ ] `AC-EVAL-004`: a check executing inside the execution root observes the
  same absolute path the decision records, on a platform where the system
  temporary directory is reached through a symbolic link.
- [ ] `SG-EVAL-001`: snapshot identities are unchanged by this slice, proved by
  deriving an identity for the same content before and after.
- [ ] `AC-EVAL-006`: a check that resolves the path it was given and compares it
  against that path finds them equal — the comparison that failed in the
  preserved evidence.
- [ ] `FR-EVAL-005`: the root is still removed on every path, and `TB-038`'s
  interruption and sweep behavior still reclaim it under its own prefix.
- [ ] `NFR-REL-001`: declared dependency roots still resolve to the installed
  directories they name, and remain absent from the snapshot's path list.
- [ ] Nothing in the resolved-and-unresolved-agree case changes, so a platform
  that never had this problem behaves exactly as before.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-EVAL-004`, `AC-EVAL-006`, `SG-EVAL-001`: observed-path-equals-recorded-path, identity-unchanged, dependency-root, and sweep-still-reclaims fixtures against the real execution root | `npm run test:unit` | Yes — the unit suite owns snapshot capture and the execution-root lifecycle |
| smoke | both | `AC-EVAL-004`: a real check run through the packaged path against a real clone observes and reports one path, and the commit decision is unchanged for content that already passed | `gate-runtime-portability`, extended by this slice | Yes — that capability owns cross-environment path behavior |

Frontend build and browser evidence are inapplicable; this slice changes local
temporary-path handling.

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

Every fixture asserts against the path the Gate itself produced, so the two
spellings are never compared — the suite only ever asks whether the Gate agrees
with itself. Observing the split requires a program that resolves the path it
was handed and compares, which no fixture does, and a filesystem where resolving
changes the answer, which not every machine has. `gate-runtime-portability`
covers spaces, linked worktrees, and separators, and does not cover a temporary
directory reached through a symbolic link.
