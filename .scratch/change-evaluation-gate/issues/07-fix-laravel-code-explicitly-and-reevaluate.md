# TB-007 — Fix Laravel code explicitly and reevaluate

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent
Blocked by: 03-produce-stack-neutral-verification-descriptors, 04-evaluate-an-exact-snapshot-end-to-end
Tracker ID: 07-fix-laravel-code-explicitly-and-reevaluate
Draft key: TB-007

**Status:** ready-for-agent
**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A Laravel maintainer can explicitly request a mutating fix that runs Rector before Pint and then evaluates the resulting new snapshot, while ordinary commit evaluation remains strictly check-only.

## SRS Traceability

- `FR-POL-009`, `FR-PROF-009`, `FR-PROF-010`
- `AC-POL-004`, `AC-PROF-005`
- `SG-OWNER-001`
- `RISK-007`

## Domain Concepts

Command descriptor, Evaluation snapshot, Check attempt, and Verification Evidence ladder.

## Approach and Tradeoffs

Keep mutation behind the lifecycle `gate fix` command and a separately declared provider fix contract. Laravel proposes only proved defaults, runs Rector before Pint when both exist, and always creates a new snapshot followed by full non-mutating evaluation. Gate core remains stack-neutral.

## Architecture Boundary and Public Seam

The boundary is the lifecycle command delegating provider-owned mutation; the public seam is `gate fix` plus the subsequent evaluation decision. First red test: a mutating descriptor supplied to commit evaluation is rejected while explicit fix mutates and triggers a new evaluation identity.

## Safeguards and Invariants

- `SG-OWNER-001`: Laravel fix ordering remains provider-owned and Gate evaluation never becomes a second verifier or formatter.

## Prohibited Behavior and Non-goals

Do not mutate during commit evaluation, authorize the pre-fix snapshot, guess unavailable tools, or add Laravel branches to Gate core.

## Risk and Decision Impacts

- `RISK-007`: remains open; reevaluation preserves attempts and does not hide a flaky required result behind mutation.

## Acceptance Criteria

- [x] `AC-POL-004`: commit evaluation rejects mutating descriptors; explicit fix may mutate only through its declared command and requires a new snapshot.
- [x] `AC-PROF-005`: Laravel setup proposes only proved defaults and fix runs Rector before Pint followed by full reevaluation.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-POL-004`, `AC-PROF-005`, `SG-OWNER-001`: check-only rejection and ordered fix fixtures | `npm run test:unit` | Yes — configured unit suite drives lifecycle and provider seams |
| smoke | both | `AC-PROF-005`: packaged explicit fix produces a new evaluated snapshot | `gate-fix-smoke` capability introduced by this slice | Yes — user-facing CLI evidence depends on the new fix selector |

Frontend build and browser evidence are inapplicable because the configured frontend profile is `none`.

## Blocked By

- `TB-003` — fix commands and Laravel defaults are provider-owned descriptors.
- `TB-004` — the post-fix result requires the versioned reevaluation seam.

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
