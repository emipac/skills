# TB-058 — Keep orphaned roots bounded when they are real

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by: TB-054
Tracker ID: 58-keep-orphaned-roots-bounded-when-they-are-real
Draft key: TB-058

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

Execution roots that outlive their evaluation stay bounded in what they cost a
machine, whether they hold a few symlinks or a copied dependency tree. A
maintainer whose evaluations are interrupted repeatedly is not left with disk
that no run will ever reclaim.

## SRS Traceability

- `FR-EVAL-004`, `FR-EVAL-008`
- `AC-EVAL-001`, `AC-EVAL-006`
- `SG-EVAL-001`, `SG-LIFE-001`
- `NFR-REL-002`, `NFR-OPER-001`
- `RISK-002`, `RISK-003`

## Defect this contract fixes

`TB-038` added a sweep of orphaned execution roots, and stated its design
clearly at `hook-runner.mjs:96-112`:

> Accumulation is bounded at roughly one day's interruptions, which is the
> hygiene obligation this discharges — not a disk quota.

and:

> The maintainer is waiting on the gate, not on a sweep, so the sweep gives up
> rather than delaying a commit.

Both were right when every execution root held tracked content plus a handful
of symlinks. `TB-054`'s `copy` strategy changes what a root weighs, and the
sweep's constants were chosen against the old weight.

### The constants, verified

- `EXECUTION_ROOT_RETENTION_MS` = 24 hours (`:105`). A root younger than that is
  never touched, so a live root belonging to a concurrent evaluation is safe.
- `SWEEP_ENTRY_CEILING` = 512 (`:111`).
- `SWEEP_DEADLINE_MS` = 250 (`:112`), checked **between entries** (`:287`).

### What `copy` does to them, measured

From `TB-054`'s implementation report, against a 33,972-file `vendor`:

| | `link` | `copy` |
| --- | --- | --- |
| provide | ~0 ms | 9,907 ms |
| reclaim one root (`rm -rf`) | ~0 ms | 1,575 ms |
| disk per root | ~0 | 372.9 MiB |

And the sweep under `copy`, with three `vendor`-sized orphans planted:
**considered 1, removed 1, 1,979 ms, two left behind.** The 250 ms deadline is
checked between entries, so the sweep removes one orphan and stops. It always
progresses, never touches a root under 24 hours old, and never leaks
unboundedly — but it now reclaims roughly **one root per run** where the
ceiling allows 512.

### Why that is a defect and not a tuning

Orphans arise from interrupted evaluations: a killed hook, a machine put to
sleep mid-run, an agent stopped during a preflight. `TB-039` established that a
preflight can fire on every agent turn. A maintainer whose client interrupts a
handful of turns in a day accumulates a handful of orphans; under `link` that
was a few kilobytes each, and "one day's interruptions" was a harmless bound.
Under `copy` it is 373 MiB each, and a sweep that reclaims one per run falls
behind the moment interruptions outpace commits. "Not a disk quota" was an
honest statement about symlinks; it is not an honest statement about copied
trees.

`TB-055` reduces the disk cost of a cloned orphan to roughly 16 MiB on
filesystems that can clone. It does not reduce the file count, the 1.6 seconds
to remove one, or the exposure on ext4 and NTFS, where a copy is a copy.

## Domain decisions this contract settles

**The two design statements stay true; the bound they describe has to hold in
bytes.** A maintainer still waits on the gate, not a sweep — a commit must not
stall behind housekeeping. And accumulation must still be bounded — now in
what it costs, not only in how many roots exist. The implementer finds the
shape that keeps both, and states what they traded.

**Partial removal of an orphan is progress, not damage.** An orphan is garbage
by definition — older than any run could plausibly be, under a temporary root
this Gate created. A root removed halfway is a smaller orphan the next run
finishes. Nothing about `SG-LIFE-001` protects it. This is what makes a
deadline checked *inside* an entry, rather than between entries, a legitimate
option the original design did not need.

## Domain Concepts

Orphaned execution root, Sweep, Retention window, Sweep deadline, Reclaim
cost, Interrupted evaluation.

## Approach and Tradeoffs

Verified: `sweepOrphanedExecutionRoots` (`:264-320`) is one function with two
constants, returns `{ removed, considered }` for tests, and is already
exercised by `TB-038`'s fixtures and `TB-054`'s. The seam is small.

Proposed — establish the actual accumulation rate before choosing. The
implementer plants N `copy`-weight orphans, runs the sweep as a commit would,
and measures how many runs clear them under the current constants. That number,
not this ticket's reasoning, is what the fix is measured against.

Proposed — three shapes worth evaluating, none mandated:

1. **Check the deadline inside an entry.** Remove files until the deadline,
   leave the rest for the next run. Every run then reclaims roughly 250 ms of
   files regardless of how many orphans exist, and a large orphan is finished
   across runs. Simplest; keeps the commit-latency promise exactly.
2. **Spend more time when there is more to reclaim.** A deadline that scales
   with the bytes or file count found, up to a stated cap. Reclaims faster;
   costs commit latency proportionally, which `RISK-003` bounds.
3. **Reclaim before provisioning.** Under `copy`, the evaluation is about to
   spend ~10 seconds copying; sweeping first, within the same budget, hides
   the cost where a maintainer is already waiting for the same reason.

The implementer may combine them or find a fourth, and says which and why.

Proposed — say what was reclaimed. `NFR-OPER-001` applies to housekeeping too:
a maintainer wondering where their disk went should be able to read that the
sweep ran, what it found, and what it removed, from the evidence a run already
writes.

Deliberately not changing the 24-hour retention — it is what makes a live
concurrent root safe and this contract has no evidence against it.
Deliberately not a background daemon, a scheduled task, or anything that runs
when no evaluation does; the Gate is a cooperative local process invoked by a
hook and stays one. Deliberately not `TB-055`'s cloning or `TB-057`'s per-root
provisioning, both of which reduce the weight this sweep has to move and
neither of which removes the need to move it.

## Architecture Boundary and Public Seam

The boundary is between an execution root's weight and the housekeeping that
was designed for a different weight. The public seam is
`sweepOrphanedExecutionRoots`, its two ceilings, and what a run records about
what it reclaimed.

First red test: three `copy`-weight orphans older than the retention window
are all gone after a bounded number of runs, where today each run removes at
most one.

## Safeguards and Invariants

- `SG-LIFE-001`, `SG-EVAL-001`: a root younger than the retention window is
  never touched; a live concurrent evaluation is never disturbed.
- `RISK-003`: a commit does not stall behind housekeeping. Whatever bound is
  chosen is stated in the code and measured.
- `NFR-REL-002`: a sweep that cannot read or remove a root leaves it and says
  nothing harmful; a partially removed orphan is safe to leave.
- `NFR-OPER-001`: what the sweep found and reclaimed is readable from evidence.
- `TB-054`'s guarantee holds: a crashed evaluation cannot leak a dependency
  tree the sweep will never reclaim.

## Prohibited Behavior and Non-goals

Do not shorten the retention window. Do not remove any root that is not under
the Gate's own execution-root prefix, or that is not an execution root by
name. Do not add a background process, scheduled task, or anything that runs
outside an evaluation. Do not let a sweep delay a commit without a stated,
measured bound. Do not change provisioning; that is `TB-054`, `TB-055`, and
`TB-057`.

## Risk and Decision Impacts

- `RISK-002`: developer state. A machine filling with dependency copies
  nobody will reclaim is interference with developer state by another route.
- `RISK-003`: commit latency. This contract may spend more of it on
  housekeeping; the amount is bounded and stated.

## Acceptance Criteria

- [ ] N `copy`-weight orphans past the retention window are fully reclaimed
  within a stated number of runs, proved by a fixture that plants them and
  counts.
- [ ] `RISK-003`: no single run spends more than a stated, measured bound on
  the sweep, and the bound is in the code beside the constants it replaces.
- [ ] `SG-LIFE-001`: a root younger than the retention window is untouched,
  proved by `TB-038`'s existing fixtures unchanged.
- [ ] A partially removed orphan is left safe and finished by a later run.
- [ ] `NFR-OPER-001`: evidence records what the sweep found and reclaimed.
- [ ] `NFR-REL-002`, `AC-EVAL-006`: a root that cannot be removed is left, the
  evaluation proceeds, and a sweep failure never changes a decision's outcome
  or reason — proved against the existing negative conformance fixtures.
- [ ] Under `link`, behaviour is byte-identical to today.
- [ ] `AC-EVAL-001`: a required failure still blocks and a passing snapshot is
  allowed; the sweep changes no decision.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `SG-LIFE-001`, `NFR-REL-002`, `AC-EVAL-006`, `NFR-OPER-001`: orphans-reclaimed-within-N-runs, young-root-untouched, partial-removal-finished-later, unremovable-root-left, bound-measured, link-unchanged, and reclaim-recorded fixtures against the real sweep | `npm run test:unit` | Yes — the unit suite owns the sweep and its ceilings |
| smoke | both | `FR-EVAL-004`, `AC-EVAL-001`, `RISK-003`: a real activated clone under `copy` with planted orphans reclaims them across real commits, each commit's elapsed time stays within the stated bound, and decisions are unaffected | `gate-activation-smoke`, extended by this slice | Yes — elapsed time and real removal are only observable against a real execution root |

Frontend build and browser evidence are inapplicable; this slice changes local
housekeeping.

## Blocked By

`TB-054`, which introduces the weight this sweep was not designed for.

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

`TB-038`'s fixtures plant orphans that weigh what an orphan weighed then — a
directory with a few entries — and assert they are gone after one sweep, which
they are. `TB-054`'s implementer was the first to plant one that weighed what
a copied `vendor` weighs, and reported the result rather than adjusting the
fixture to pass. Nothing in the suite measures what a sweep costs or how many
runs it needs, because under symlinks the answers were "nothing" and "one".
