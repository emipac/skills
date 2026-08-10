# TB-009 — Coordinate concurrent evaluations safely

Status: open
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent
Blocked by: 04-evaluate-an-exact-snapshot-end-to-end
Tracker ID: 09-coordinate-concurrent-evaluations-safely
Draft key: TB-009

**Status:** ready-for-agent
**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

Evaluations across clients and linked worktrees serialize safely per Git common directory, share only identical in-flight work, preserve role-specific decisions, and fail `unverified` when coordination cannot be trusted.

## SRS Traceability

- `FR-COORD-001`, `FR-COORD-002`, `FR-COORD-003`, `FR-COORD-004`, `FR-COORD-005`, `NFR-REL-003`
- `AC-COORD-001`
- `SG-COORD-001`
- `RISK-002`

## Domain Concepts

Evaluation coordination, Enforcement role, Evaluation snapshot, Check attempt, and Lifecycle event.

## Approach and Tradeoffs

Coordinate by Git common directory and full evaluation binding. Share only matching in-flight execution, never completed pass results; let authoritative Git advance ahead of queued preflights; make cancellation subscriber-local; and require explicit audited stale-lock recovery using process, host, start, and heartbeat evidence.

## Architecture Boundary and Public Seam

The boundary is coordination around `evaluate(request) -> decision`; the public seam remains the evaluation result and its coordination diagnostics. First red test: cancelling one of two identical subscribers does not cancel execution still required by the other.

## Safeguards and Invariants

- `SG-COORD-001`: different bindings never share mutable roots or completed passes, and one subscriber cannot cancel another's required work.

## Prohibited Behavior and Non-goals

No persistent pass cache, cross-repository lock, implicit stale-lock deletion, role sharing that changes authorization, or silent coordination fallback.

## Risk and Decision Impacts

- `RISK-002`: accepted conditionally; serialization, declared prerequisites and writes, and runtime release evidence remain mandatory.

## Acceptance Criteria

- [ ] `AC-COORD-001`: fixtures prove serialization, identical in-flight sharing, role-specific decisions, Git queue priority, subscriber-local cancellation, audited stale recovery, and `unverified` failure.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-COORD-001`, `SG-COORD-001`: deterministic concurrency and failure fixtures | `npm run test:unit` | Yes — configured unit suite exercises the evaluation coordination seam |

Frontend build and browser evidence are inapplicable to repository coordination.

## Blocked By

`TB-004` — coordination serializes and shares the complete evaluation binding.

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
