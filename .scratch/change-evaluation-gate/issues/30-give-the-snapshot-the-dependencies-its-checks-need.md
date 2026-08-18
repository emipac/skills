# TB-030 — Give the evaluation snapshot the dependencies its checks need

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: done, defect
Blocked by:
Tracker ID: 30-give-the-snapshot-the-dependencies-its-checks-need
Draft key: TB-030

**Status:** done

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A check executes against the exact proposed snapshot *and* can load the
dependencies it needs to run at all. The graded content stays exactly what a
commit would create; the installed dependencies a tool needs to reach that
content are present in the execution root as environment, never as subject.

## SRS Traceability

- `FR-EVAL-001`, `FR-EVAL-004`, `FR-PROF-010`
- `AC-EVAL-001`, `AC-PROF-004`
- `SG-EVAL-001`, `SG-OWNER-001`
- `NFR-REL-001`, `NFR-REL-003`
- `RISK-001`

## Defect this contract fixes

Found by committing in a real Laravel project (`gms`); the evidence is
preserved under `real-project-evidence/change-evaluation-gate/evidence/`. The
one required check that successfully launched its program failed like this:

```
Warning: require(/…/T/gate-hook-runner-exec-H33i9A/vendor/autoload.php):
  Failed to open stream: No such file or directory in
  /…/T/gate-hook-runner-exec-H33i9A/artisan on line 10
Fatal error: Uncaught Error: Failed opening required '…/vendor/autoload.php'
```

`php` was pinned to an absolute path and launched correctly. It read the
snapshot's own `artisan`, which requires `vendor/autoload.php` relative to the
execution root — and the execution root has no `vendor/`.

The mechanism is deliberate and complete. `captureSnapshot` materializes the
snapshot from `listTrackedPaths`, which is `git ls-files` (`snapshot.mjs`).
`vendor/` and `node_modules/` are git-ignored in every project that has them,
so they are untracked, so they are absent from every execution root the gate
has ever built. A PHP project's autoloader, a Node project's `node_modules`,
and anything either resolves through them are simply not there.

`TB-024` settled the neighbouring half of this question and settled it
correctly: the *tool* is not the thing under test, which is why a
`composer-bin` runner resolves to an absolute path outside the snapshot and
runs the live binary against snapshot content. A project's installed
dependencies are the same category of thing. They are not the change being
graded; they are what the tool needs in order to grade it. Today the gate
resolves the tool as environment and then materializes a tree in which that
tool cannot function.

The consequence is that the Gate denies every commit in any project with
installed dependencies, for a reason that has nothing to do with the change.

## Domain Concepts

Evaluation snapshot, Execution root, Snapshot identity, Tracked path,
Dependency root, Stack provider, Command descriptor.

## Approach and Tradeoffs

**The identity already leaves room for this.** `captureSnapshot` computes its
identity through `identifyExecutionRoot(executionRoot, paths)` over the
*enumerated tracked paths only*, and `verifySnapshot` re-derives it over the
same list. Content placed in the execution root outside that list therefore
changes neither the snapshot identity nor the immutability check. The
architecture anticipated a populated execution root; nothing about
`SG-EVAL-001` has to bend to allow this.

**Declare which roots are dependencies; never guess.** `vendor` and
`node_modules` are stack facts, and stack facts belong to providers, not to the
snapshot module — `SG-OWNER-001` is the reason the gate core carries no
framework knowledge. The dependency roots a profile needs are declared where
that profile is declared, and the snapshot materializes what it is handed. A
project with no declared dependency roots materializes exactly what it does
today.

**Provide, do not copy blindly.** A `node_modules` tree is large enough that
copying it per evaluation would make the budget meaningless. The mechanism
should link rather than duplicate where the platform allows, and the choice
must be stated in the receipt-visible preview so a maintainer can see what
their checks will be given.

**A dependency root is never graded.** It is excluded from the snapshot
identity, excluded from `changedPaths`, excluded from Grader-surface
visibility, and excluded from the immutability re-check. If a tool writes into
it during a run — caches do — that must not turn into `snapshot-mismatch`,
because the snapshot is the tracked content and that has not changed.

**A declared dependency root that is absent is `unverified`, not silence.** A
project that declares `vendor` and has not run `composer install` gets a stated
reason naming the missing root, not a fatal error from inside a tool. That is
the difference between a diagnosable condition and the failure observed here.

## Architecture Boundary and Public Seam

The boundary is snapshot materialization: what is placed in the execution root
beyond the tracked paths, and what remains excluded from the snapshot's
identity. The public seam is the declared dependency roots and the
materialization contract that provides them.

First red test: a fixture clone with a git-ignored dependency directory and a
required check that loads a file from it passes inside the execution root,
while the snapshot identity is byte-identical to the identity the same clone
produces with the dependency root absent.

## Safeguards and Invariants

- `SG-EVAL-001`: the graded tree is exactly the proposed snapshot. A dependency
  root is not tracked content, is not part of the identity, and is never the
  subject of a check. The worktree is still never graded.
- `NFR-REL-001`: the snapshot identity stays a function of tracked content
  alone, so an identical change produces an identical identity on any machine
  regardless of what is installed.
- `SG-OWNER-001`: `vendor` and `node_modules` appear in provider declarations,
  never in the snapshot module or gate core.
- `NFR-REL-003`: a declared dependency root that cannot be provided is
  `unverified` with a stated reason; the evaluation never proceeds pretending
  it was there.
- `SG-EVAL-002`: a check that reaches a runtime still proves that runtime
  serves this snapshot. Nothing here relaxes that.

## Prohibited Behavior and Non-goals

Do not add a dependency root to the snapshot identity or to `changedPaths`. Do
not install anything: the gate never runs `composer install` or `npm ci`, and a
missing dependency root is reported, not repaired. Do not put a framework name
in `snapshot.mjs`, `gate-core.mjs`, or the evaluation contract. Do not grade,
scan, or report the contents of a dependency root. Do not use this as a way to
expose arbitrary untracked files to checks — only declared dependency roots are
provided.

## Risk and Decision Impacts

- `RISK-001`: exact command evidence only mitigates anything if the command can
  reach the code. This restores that on every real project.
- The map's out-of-scope list is untouched: no container, virtual machine, or
  hardened sandbox is introduced. This is the existing developer runtime,
  reused exactly as the decision record already contemplates.
- A new residual is worth stating on completion: a linked dependency root is
  shared with the live clone, so a tool that mutates it mutates the developer's
  own installation. That is already true of the live binaries `TB-024` runs.

## Acceptance Criteria

- [x] `AC-EVAL-001`, `FR-EVAL-001`: an activated clone whose required check
  loads a git-ignored dependency root executes that check successfully inside
  the execution root, denies on genuinely bad content, and allows on good
  content.
- [x] `SG-EVAL-001`, `NFR-REL-001`: the snapshot identity and the post-run
  immutability verification are byte-identical whether or not dependency roots
  were provided, and a tool writing inside a provided root never produces
  `snapshot-mismatch`.
- [x] `FR-PROF-010`, `SG-OWNER-001`: the dependency roots are declared by the
  profile that needs them; a source scan finds no `vendor` or `node_modules`
  literal in the snapshot module, gate core, or evaluation contract.
- [x] `NFR-REL-003`: a declared dependency root that is absent from the clone
  is reported with a stated reason naming the root, and the required check is
  `unverified` rather than failing inside a tool.
- [x] A project declaring no dependency roots materializes exactly the tree it
  does today, proved by an unchanged existing fixture.
- [x] The preview a maintainer consents to at activation states which
  dependency roots their checks will be given and how.

## Decisions this slice recorded

**Where the declaration lives: the Gate policy, not a provider plan.** The
approach section put dependency roots "where that profile is declared", meaning
a provider. That is not reachable at commit time: an activated clone derives
its checks from `gateChecksFromConfiguration`, no provider is loaded, and the
recorded decisions in `real-project-evidence/` carry `profile: null`. The
declaration therefore lives in `evaluation_gate.execution.dependency_roots`,
beside `budget_skippable` — an execution concern, validated by the policy
contract, and already in the runners' hands. `SG-OWNER-001` is satisfied the
same way either place: gate core provides directories it is handed and names
none, and the source scan proves it.

**A manifest alone does not prove a dependency root is needed.** The first
implementation derived `vendor` from `composer.json` and `node_modules` from
`package.json`, which immediately denied every commit in
`derived-configuration-round-trip` — a fixture carrying a `package.json` whose
only check is a Node repository script that reaches into no module tree. Two
proved facts are now required: some configured check runs through a runner that
reaches into that directory, *and* the governing manifest exists. Declaring a
root nothing was going to read would deny commits for a directory no check
needs, which is the same class of false accusation this ticket exists to end.

**Linked, not copied.** A dependency root is symlinked into the execution root.
Copying a module tree per evaluation would make the budget meaningless. The
residual is the one the ticket anticipated and it is real: the link is to the
clone's own installation, so a tool that writes into its dependency root writes
into the maintainer's — which is already true of the live binaries `TB-024`
runs, and is what running the tool by hand would have done.

**A platform that cannot link reports it.** A failed link is recorded as a
missing root and the evaluation is `unverified`, rather than proceeding into a
fatal error from inside somebody's tool.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `SG-EVAL-001`, `NFR-REL-001`, `NFR-REL-003`, `SG-OWNER-001`: identity-invariance, provided-root, absent-root, mutation-inside-root, no-declaration, and declaration-scan fixtures | `npm run test:unit` | Yes — the unit suite owns snapshot materialization and the profile declarations |
| smoke | both | `AC-EVAL-001`: an activated fixture whose required check loads a git-ignored dependency root denies a bad commit and allows a good one through a real `git commit` | `gate-activation-smoke`, extending `vendor-binary-commit` | Yes — that scenario already builds a git-ignored `vendor/bin` and is the natural home for a git-ignored `vendor/autoload.php` |

Frontend build and browser evidence are inapplicable; this slice changes local
snapshot materialization.

## Blocked By

None. Its full effect is only observable once `TB-028` lands, because five of
six checks in the reproducing project cannot start at all — but the failure
this ticket fixes is independently reproduced by the one check that does start,
and its fixtures do not depend on that ticket.

## Unresolved Assumptions

1. **Whether a dependency root is linked or copied.** Linking is fast and is
   almost certainly right for `node_modules`; copying is more isolated. The
   tradeoff is bounded and local, so decide during implementation against the
   budget and record the choice with its residual risk. Not start-blocking.

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

Every check fixture in the repository is self-contained: a Node script with no
imports, or a `#!/bin/sh` script reading one file. None has ever needed a
second file to exist in order to start, so no fixture has ever asked whether
the execution root is habitable. `gate-runtime-portability` proves the snapshot
is materialized correctly and `gate-activation-smoke` proves real commits are
graded — both against checks that would run just as well in an empty directory.
