# TB-050 — Close three gaps the audit found

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 50-close-three-gaps-the-audit-found
Draft key: TB-050

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

Three small, unrelated inconsistencies an external audit found are closed: every
capability that operates on a throwaway clone proves it is one, the single
content-identity scheme is actually single, and the operator surface stops
refusing a command it performs.

## SRS Traceability

- `FR-EVID-002`, `FR-LIFE-019`
- `AC-EVID-001`, `AC-LIFE-010`
- `SG-LIFE-001`, `SG-EVID-001`
- `NFR-AUD-001`, `NFR-REL-001`
- `RISK-002`

## Defect this contract fixes

Three findings, kept together because each is small and none is worth its own
context. They are independent: an implementer may fix them in any order.

### 1. Three capabilities operate on real directories with no guard

Verified by counting definitions and applications of
`assertThrowawayRepository` across the nine smoke scripts:

| Capability | Guard defined | Guard applied |
| --- | --- | --- |
| `gate-activation-smoke` | yes | 8 |
| `gate-hook-conformance-smoke` | yes | 3 |
| `gate-lifecycle-smoke` | yes | 4 |
| `gate-evidence-prune-smoke` | **no** | — |
| `gate-fix-smoke` | **no** | — |
| `runtime-binding-smoke` | **no** | — |

Each of those three creates temporary directories, spawns real processes, and
the first two register real Git hooks. Every script that defines the guard
describes it the same way — "the guard: nothing in this capability operates
outside a throwaway clone" — so the intent is unanimous and three capabilities
simply do not carry it.

Note the audit's own table for this finding is wrong in one respect: it reports
that `gate-activation-smoke` and `gate-hook-conformance-smoke` define the guard
without applying it. They apply it eight and three times respectively. The
finding stands for the three scripts above and not for those two.

### 2. Two identities depend on key order, which the stated scheme forbids

`evidence-identity.mjs` opens by declaring that there is a single
content-identity scheme in this Gate, a SHA-256 over a canonical serialization
in which key order never changes an identity.

Verified: `policy.mjs:300` and `fix.mjs:44` both hash `JSON.stringify(value)`
directly, with no canonical serialization. So the bypass identity and the fix
identity do depend on key order — the exact property the scheme exists to
guarantee. Neither is reachable from an entry point today, which is why no test
catches it.

The audit also reports the canonical serializer copy-pasted into six files, with
eleven `sha256` helpers and eight `isPlainObject` definitions across `lib/`.
That wider consolidation is **not** in scope here — see Non-goals. Only the two
that produce a wrong result are.

### 3. The surface refuses a command it performs

Verified at `operator-surface.mjs:182`: `CONFIRMED_SELECTORS` still maps
`--repair` to `gate repair` as a refused selector, though `TB-041` made `repair`
a first-class command. The table is stale rather than wrong in effect, but it is
the table a reader consults to learn what the surface will not do.

## Domain Concepts

Throwaway clone guard, Content identity, Canonical serialization, Refused
selector, Capability script.

## Approach and Tradeoffs

Verified: six of the nine smoke scripts already define the guard, identically.
There is an established shape to follow and no design question to settle.

Proposed — apply the existing guard in the three capabilities that lack it, in
the same place the others apply it. The implementer confirms each of the three
still passes afterwards, and that the guard actually refuses when pointed at a
directory that is not a throwaway clone — a guard nothing has ever seen refuse
is not yet a guard.

Proposed — import the canonical identity rather than restating it, in those two
places only. `contentIdentity` is exported from `evidence-identity.mjs`. The
implementer confirms both call sites accept it without changing any value that
is currently recorded anywhere, and states what they found — if either identity
is persisted in a form a reader would compare against, that is a compatibility
question to report rather than to decide silently.

Proposed — remove the stale selector entry. `--repair` is no longer a selector
nothing owns. The implementer confirms the refusal path still works for the
selectors that remain, and that `gate repair` is unaffected.

Deliberately not the wider identity consolidation. The audit is right that the
canonical serializer is duplicated across six files and that there are eleven
`sha256` helpers, but collapsing them touches modules on the authoritative
commit path for no behavioural gain, and this contract exists to close gaps
rather than to refactor. If the implementer finds that fixing the two wrong ones
naturally removes others, that is welcome and should be stated; hunting the rest
is not asked for.

Deliberately not moving, deleting, or restructuring the smoke scripts. The audit
argues they should not ship inside the installed skill. That is a real question
and a separate decision; this contract only closes the safety gap in three of
them.

## Architecture Boundary and Public Seam

Three boundaries, one per finding: between a capability and the filesystem it
operates on; between a stated identity scheme and the identities that claim to
follow it; and between what the operator surface says it refuses and what it
performs.

First red test: pointing one of the three unguarded capabilities at a directory
that is not a throwaway clone refuses, where today it proceeds.

## Safeguards and Invariants

- `SG-LIFE-001`: no capability operates outside a throwaway clone, and a guard
  that refuses leaves the directory exactly as it was.
- `SG-EVID-001`: no stored Evidence is rewritten. If either corrected identity
  appears in anything already persisted, that is reported rather than migrated.
- `NFR-AUD-001`: every identity the Gate records keeps its stated property —
  key order never changes it.
- `NFR-REL-001`: every capability still passes, and the authoritative commit
  path is untouched.
- `AC-LIFE-010`: `gate repair` behaves exactly as it does today.

## Prohibited Behavior and Non-goals

Do not move, delete, or restructure any smoke script. Do not consolidate the
duplicated serializer, `sha256`, or `isPlainObject` definitions beyond the two
call sites that produce a wrong result. Do not change any identity that is
already persisted without reporting it first. Do not change what any capability
tests. Do not change `gate repair`, its preview, or its confirmation. Do not
touch the authoritative commit path.

## Risk and Decision Impacts

- `RISK-002`: isolation limits are accepted because they are explicit. A
  capability that spawns processes and registers hooks without proving it is in
  a throwaway clone is an isolation limit nobody stated.
- No disposition changes. Nothing here alters a decision, an outcome, or what a
  commit may do.

## Acceptance Criteria

- [ ] `SG-LIFE-001`: each of `gate-evidence-prune-smoke`, `gate-fix-smoke`, and
  `runtime-binding-smoke` refuses to operate on a directory that is not a
  throwaway clone, proved by pointing it at one.
- [ ] `AC-EVID-001`: an Evidence store written by any of those capabilities is
  addressed and read back exactly as it is today.
- [ ] All nine capabilities still pass.
- [ ] `NFR-AUD-001`: the bypass identity and the fix identity are unchanged by
  key order, proved by hashing two objects whose keys differ only in order.
- [ ] `SG-EVID-001`: if either identity appears in persisted Evidence, the report
  says so and nothing stored is rewritten.
- [ ] `AC-LIFE-010`: `--repair` is no longer listed as a refused selector, the
  remaining refused selectors still refuse, and `gate repair` is unchanged.
- [ ] The authoritative commit path is untouched, proved by the existing commit
  capabilities passing.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `NFR-AUD-001`, `AC-LIFE-010`: key-order-identity, refused-selector, and guard-refuses fixtures against the real modules | `npm run test:unit` | Yes — the unit suite owns the identity helpers and the operator surface |
| smoke | both | `SG-LIFE-001`, `AC-EVID-001`: each of the three capabilities refuses a directory that is not a throwaway clone, an Evidence store one of them writes is still addressed and read back as it is today, and all nine still pass | the nine gate capabilities | Yes — the guard is a property of those capabilities and cannot be proved elsewhere |

Frontend build and browser evidence are inapplicable; this slice changes local
guards, identity helpers, and one table.

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

Each smoke script is its own file with its own copied harness, so a guard added
to one never reaches the others and nothing compares them. The two wrong
identities sit in code no entry point reaches, so no test observes their output
at all. And a refused-selector table is asserted against itself — the test reads
the same constant the surface does, so a stale entry agrees with itself
perfectly.
