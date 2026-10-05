# TB-075 — Prove doctor left no probe without racing other suites

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: done, defect
Blocked by:
Tracker ID: 75-prove-doctor-left-no-probe-without-racing-other-suites
Draft key: TB-075

**Status:** done

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

The test that proves `gate doctor` leaves nothing behind passes or fails on what
that test's own doctor runs did, never on what another test file was doing in
the shared temporary directory at the same moment. The full unit suite stops
failing intermittently on it.

## SRS Traceability

- `FR-LIFE-009`
- `AC-PORT-001`
- `SG-LIFE-001`

## Domain Concepts

Gate health, execution root, Evidence store.

## Approach and Tradeoffs

- Verified: `tests/gate-doctor-command.test.mjs` test "doctor writes nothing
  under the clone or its store, and the one probe it makes under the temporary
  directory is gone" lists every `gate-doctor-probe-*` entry in the shared
  temporary directory before its runs (`doctorProbesUnderTemporary`, line 223)
  and asserts the listing is identical afterwards (line 534).
- Verified: lines 529–530 of the same test already assert that each run's own
  reported probe directory no longer exists and that `probe.removed` is true.
- Verified: `node --test tests/*.test.mjs` runs test files in parallel, and other
  files run real `gate doctor` probes, which create and remove
  `gate-doctor-probe-*` directories under the same temporary directory. During
  `TB-069` the assertion failed once in five full-suite runs; no change under
  test touched doctor.
- Proposed: either run this test's doctor invocations with a private temporary
  directory, so the before-and-after listing covers only its own probes, or
  replace the global listing with assertions confined to the probe directories
  this test's runs reported. The implementer chooses and states why. Whichever
  is chosen must still fail if doctor leaked a second, unreported probe
  directory, which is what the global listing was guarding against.

## Architecture Boundary and Public Seam

Test code only. Public seam: `tests/gate-doctor-command.test.mjs` run alongside
the full suite. First red test: a deliberately induced race — another process
creating and removing a `gate-doctor-probe-*` directory in the shared temporary
directory while this test runs — makes the current assertion fail, and the fixed
one pass.

## Safeguards and Invariants

- `SG-LIFE-001`: the test still proves doctor leaves no probe directory behind,
  including an unreported one; weakening it to check only the reported directory
  is not enough.
- `FR-LIFE-009`, `AC-PORT-001`: the clone, `.git`, and store byte-identity
  assertions in the same test are unchanged.

## Prohibited Behavior and Non-goals

- No change to `gate doctor`, the probe, its prefix, or the sweep.
- No serialising of the whole unit suite to hide the race.
- No retry loop around the assertion.

## Risk and Decision Impacts

- `TB-063`'s accepted limit (free-space probes are noisy under concurrent disk
  activity) is unrelated and unchanged; this race is about directory listings,
  not free space.

## Acceptance Criteria

- [x] `SG-LIFE-001`: the induced-race fixture fails the old assertion and passes
  the new one, and the test still fails when doctor is made to leave an
  unreported `gate-doctor-probe-*` directory behind.
- [x] `FR-LIFE-009`, `AC-PORT-001`: the clone, `.git`, and store stay
  byte-identical after doctor, as before, and the full unit suite passes 20
  consecutive runs with 0 failures.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `SG-LIFE-001`, `FR-LIFE-009`, `AC-PORT-001`: induced-race, leaked-unreported-probe, and the existing byte-identity assertions | `npm run test:unit` | Yes — the defect is a test defect, observable only in the suite |

Smoke, frontend build, and browser evidence are inapplicable: no product
behavior changes.

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
