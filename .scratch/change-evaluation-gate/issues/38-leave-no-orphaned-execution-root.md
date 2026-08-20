# TB-038 — Leave no orphaned execution root behind

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 38-leave-no-orphaned-execution-root
Draft key: TB-038

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A run that is killed rather than finished leaves no materialized snapshot
behind, and a machine that already accumulated some reclaims them the next time
the gate runs. The maintainer never has to know that execution roots exist.

## SRS Traceability

- `FR-EVAL-004`, `FR-LIFE-019`
- `AC-EVAL-004`, `AC-CFG-004`
- `SG-EVAL-001`, `SG-SECRET-001`, `SG-LIFE-001`
- `NFR-REL-001`, `NFR-PORT-002`
- `RISK-002`

## Defect this contract fixes

Every evaluation materializes the proposed snapshot into a fresh temporary
directory and removes it in a `finally`. That covers the deny path and the
crash path. It does not cover the process not reaching `finally` at all:
`SIGKILL`, and `SIGINT` from the maintainer pressing Ctrl-C on a commit whose
checks are taking too long.

There is no signal handler in either runner and no sweep at startup, so each
interrupted run leaves a full copy of the repository's snapshot content under
`os.tmpdir()` until the operating system reclaims it — on macOS, potentially
until reboot. A maintainer who interrupts a slow commit repeatedly accumulates
one repository-sized copy per interruption.

Two things this is *not*, stated so the slice does not grow to cover them:

- It is not a secret leak. `mkdtemp` creates the root `0700`, and ignored paths
  never reach a snapshot, so a git-ignored `.env` is not in the orphan. What is
  in it is tracked content plus untracked-but-not-ignored content — the same
  material the maintainer already has in the clone.
- It is not a correctness defect. An orphan is inert: nothing reads it, no
  later evaluation reuses it, and snapshot identity is derived per run.

It is disk accumulation and stale copies of the maintainer's source in a
directory they did not choose, which is a hygiene obligation the gate owes for
a workspace it created, not a threat to defend against.

## Domain Concepts

Execution root, Materialized snapshot, Interrupted run, Orphaned root, Sweep,
Ownership marker.

## Approach and Tradeoffs

Verified: both runners create the root with `mkdtemp` and remove it in a
`finally` — `hook-runner.mjs:693` and `:748`, `preflight-runner.mjs:252` and
`:291`. The `finally` in the authoritative runner wraps the `catch` that turns
a thrown error into `runner-failed`, so an internal crash already cleans up
correctly. Verified: `grep` for `process.on`, `SIGINT`, and `SIGTERM` across
the gate's `scripts/` finds only `bounded-execution.mjs:64`, which signals a
child, never the runner itself. Verified: no code outside the two `mkdtemp`
calls names the `gate-hook-runner-exec-` or `gate-preflight-exec-` prefixes, so
nothing sweeps them.

Proposed — remove the root on the signals a process can catch. `SIGINT` and
`SIGTERM` cover Ctrl-C, which is the case a maintainer actually reaches.
`SIGKILL` cannot be caught and is what the sweep below is for. The implementer
confirms a handler added here cannot change the runner's exit status or swallow
the signal, because a gate that declines to die when interrupted is worse than
the orphan.

Proposed — sweep what earlier runs left, at the start of a run. The runner
already knows the prefix it owns and the directory it creates under. Removing
roots matching that prefix whose age exceeds a comfortable ceiling reclaims
`SIGKILL` orphans without any bookkeeping. The implementer picks the ceiling
and states it; it must be far longer than any plausible run so a sweep can
never delete a live root belonging to a concurrent evaluation. Bound the sweep
so it cannot delay a commit — the maintainer is waiting on the gate, not on
housekeeping.

Proposed — a sweep that fails is silent. Failing to reclaim disk is not a
reason to refuse a commit or to emit a diagnostic the maintainer cannot act on.
Nothing in this slice may change a decision, an outcome, or a diagnostic.

Deliberately not a tracked-workspace registry. No manifest of live roots, no
lockfile, no PID file, no `gate` subcommand for cleaning up. The prefix and the
directory's own mtime carry enough information, and a registry would be one
more thing that can itself be orphaned.

## Architecture Boundary and Public Seam

The boundary is between an evaluation's lifetime and the directory it
materializes into: today the directory outlives the process whenever the
process does not exit normally. The public seam is the execution-root lifecycle
itself — creation, removal on exit including caught signals, and the
reclamation of roots a previous run abandoned.

First red test: a runner terminated by `SIGINT` mid-evaluation leaves no
directory matching its prefix, where today it leaves the whole snapshot.

## Safeguards and Invariants

- `SG-EVAL-001`: nothing here touches snapshot capture, identity derivation, or
  the post-run re-check. A swept root is one no evaluation is using.
- `SG-SECRET-001`: temporary copies are removed, which is what this restores on
  the interrupted path.
- `SG-LIFE-001`: the sweep removes only directories the gate created under its
  own prefix, inside the system temporary directory, and never anything in the
  repository, the evidence store, or a path a maintainer chose.
- `NFR-REL-001`: a concurrent evaluation's live root is never removed.
- `NFR-PORT-002`: temporary-path handling stays free of operating-system
  branching in product logic.
- `FR-LIFE-019`: nothing here becomes a maintainer-facing recovery action.

## Prohibited Behavior and Non-goals

Do not add a workspace registry, lockfile, or PID file. Do not add a `gate`
subcommand, flag, or configuration key for cleanup. Do not let a sweep failure
change a decision, an outcome, a diagnostic, or an exit status. Do not handle
`SIGKILL` — it cannot be caught, and pretending otherwise is worse than saying
so. Do not remove anything outside the gate's own prefix under the system
temporary directory. Do not change snapshot capture, identity, dependency-root
provision, or the `finally` blocks that already work.

## Risk and Decision Impacts

- `RISK-002`: isolation limits are explicit by design, and unbounded temporary
  growth is a limit that was never stated. This removes it rather than
  documenting it.
- No disposition changes. Every evaluation still materializes a fresh root; what
  changes is that abandoning one is no longer permanent.

## Acceptance Criteria

- [ ] `AC-CFG-004`, `SG-SECRET-001`: a runner interrupted by `SIGINT` or
  `SIGTERM` mid-evaluation leaves no directory matching its prefix, and still
  terminates — the signal is honored, not swallowed.
- [ ] A root left behind by a previous run, older than the stated ceiling, is
  removed by the next run of either runner.
- [ ] `NFR-REL-001`: a root younger than the ceiling, or belonging to a
  concurrent evaluation, is left alone — proved with a live root present while
  a sweep runs.
- [ ] `SG-LIFE-001`: the sweep removes nothing outside the gate's own prefix
  under the system temporary directory, proved by a fixture that places
  similarly-named decoys beside it and finds them untouched.
- [ ] A sweep that cannot remove a root leaves the evaluation's decision,
  outcome, diagnostics, and exit status byte-for-byte what they would have been.
- [ ] `AC-EVAL-004`: successful and denying evaluations are unchanged — same
  decision, same evidence, same cleanup as today.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CFG-004`, `NFR-REL-001`: signal-interruption, stale-root, live-root, and decoy-path fixtures against the real execution-root lifecycle | `npm run test:unit` | Yes — the unit suite owns both runners |
| smoke | both | `AC-EVAL-004`: a real interrupted commit against a real clone leaves no root behind, and a subsequent commit still decides identically | `gate-activation-smoke`, extended by this slice | Yes — that capability already drives real commits through the authoritative runner |

Frontend build and browser evidence are inapplicable; this slice changes local
temporary-directory lifecycle.

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

Every fixture and every smoke scenario runs an evaluation to completion — that
is what makes it a test. The `finally` is therefore exercised on every path a
test can produce, and the one path no test produces is the process not reaching
it. Interruption is not a state the suite has ever been able to observe,
because nothing in it terminates a runner from outside.
