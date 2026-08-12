# TB-010 — Activate authoritative Git enforcement transactionally

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent
Blocked by: 02-configure-the-gate-as-a-dormant-opt-in-module, 04-evaluate-an-exact-snapshot-end-to-end, 08-persist-and-prune-bounded-immutable-evidence
Tracker ID: 10-activate-authoritative-git-enforcement-transactionally
Draft key: TB-010

**Status:** ready-for-agent
**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A configured repository can preview, consent to, self-test, and atomically activate authoritative local Git enforcement, enabling Git last and leaving no partial active state on failure.

## SRS Traceability

- `FR-LIFE-004`, `FR-LIFE-005`, `FR-LIFE-006`, `NFR-REL-002`
- `AC-LIFE-002`
- `SG-HOOK-001`, `SG-LIFE-001`
- `RISK-002`

## Domain Concepts

Activation transaction, Activation consent, Activation receipt, Managed hook registration, Active gate release, and Gate lifecycle state.

## Approach and Tradeoffs

Implement activation as a previewed clone-local transaction that validates repository identity, resolves commands, establishes trust, self-tests selected adapters and the existing hook chain, records a pinned receipt, and enables authoritative Git last. Roll back every Gate-owned change on any failure and append the lifecycle outcome.

## Architecture Boundary and Public Seam

The boundary is lifecycle activation around configured policy and evaluation runtime; the public seam is the activation command preview/result plus an authoritative commit fixture. First red test: inject failure immediately before Git enablement and prove the clone remains configured with no receipt or registration.

## Safeguards and Invariants

- `SG-HOOK-001`: activation never overwrites hooks or leaves a partial adapter set active.
- `SG-LIFE-001`: failed lifecycle transitions expose no partial successful state and never repair unrelated drift.

## Prohibited Behavior and Non-goals

Do not activate during install or setup, grant client trust, enable Git before self-tests pass, create global activation, or retain a partial receipt.

## Risk and Decision Impacts

- `RISK-002`: accepted conditionally; activation self-tests and rollback must expose shared-runtime limitations for release qualification.

## Acceptance Criteria

- [x] `AC-LIFE-002`: success records previewed identities and enables Git last; failure at any step restores configured state with no partial receipt or registration.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-LIFE-002`, `SG-HOOK-001`, `SG-LIFE-001`: transaction and failure-injection fixtures | `npm run test:unit` | Yes — configured unit suite exercises the lifecycle seam |
| smoke | both | `AC-LIFE-002`: packaged activation and authoritative commit fixture | `gate-activation-smoke` capability introduced by this slice | Yes — user-facing activation selector is created by this slice |

Frontend build and browser evidence are inapplicable.

## Blocked By

- `TB-002` — activation requires an explicitly configured dormant Gate.
- `TB-004` — activation self-tests the evaluation process.
- `TB-008` — activation receipts and Lifecycle events use the Evidence contract.

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
