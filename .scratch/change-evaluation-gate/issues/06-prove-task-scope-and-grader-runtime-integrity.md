# TB-006 — Prove task scope and Grader runtime integrity

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent
Blocked by: 04-evaluate-an-exact-snapshot-end-to-end
Tracker ID: 06-prove-task-scope-and-grader-runtime-integrity
Draft key: TB-006

**Status:** ready-for-agent
**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

Evaluation reports honest task coverage, changed Grader surfaces, and served-runtime binding so regression evidence or a stale runtime can never masquerade as acceptance evidence for the proposed snapshot.

## SRS Traceability

- `FR-EVAL-007`, `FR-EVAL-009`, `FR-EVAL-010`, `FR-PROF-005`, `NFR-SEC-001`
- `AC-EVAL-005`, `AC-EVAL-007`, `AC-EVAL-008`
- `SG-CFG-001`, `SG-EVAL-002`, `SG-SCOPE-001`
- `RISK-008`, `RISK-009`

## Domain Concepts

Evaluation scope, Check assertion, Grader surface, Gate control surface, and Evaluation snapshot.

## Approach and Tradeoffs

Resolve delivery-contract acceptance IDs into assertion coverage, default missing contracts to `regression-only`, and bind changed Grader surfaces plus runner, provider, configuration, environment, and snapshot identities into decisions. Treat HTTP or browser evidence as valid only when the existing runtime proves its served source is the materialized Evaluation snapshot.

## Architecture Boundary and Public Seam

The boundary is integrity and coverage enrichment of `evaluate(request) -> decision`; the public seam is the decision contract. First red test: an HTTP fixture serving the live worktree while a different snapshot is evaluated returns `unverified` and cannot authorize.

## Safeguards and Invariants

- `SG-SCOPE-001`: regression-only evidence never claims requested acceptance coverage.
- `SG-EVAL-002`: unproved served-source binding is `unverified`.
- `SG-CFG-001`: changed policy surfaces are visible and cannot self-authorize.

## Prohibited Behavior and Non-goals

Do not infer acceptance from broad tests, classify every Grader change as malicious, launch an alternate application runtime, or accept path coincidence as served-source proof.

## Risk and Decision Impacts

- `RISK-008`: accepted conditionally; Grader and policy integrity identities are mandatory release evidence.
- `RISK-009`: accepted conditionally; unsafe snapshot/runtime binding returns `unverified` and blocks the support claim.

## Acceptance Criteria

- [x] `AC-EVAL-005`: missing delivery contract yields `regression-only`; a valid contract uses stable AC assertions and exposes gaps.
- [x] `AC-EVAL-007`: changed tests, scripts, providers, or Gate configuration report affected Grader surfaces and all integrity identities.
- [x] `AC-EVAL-008`: a bound runtime fixture can pass, while live-worktree or unprovable routing is `unverified`.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-EVAL-005`, `AC-EVAL-007`, `SG-SCOPE-001`: decision coverage and integrity fixtures | `npm run test:unit` | Yes — configured unit suite exercises the evaluation seam |
| smoke | both | `AC-EVAL-008`, `SG-EVAL-002`: served-source binding succeeds only for the materialized snapshot | `gate-runtime-binding-smoke` capability introduced by this slice | Yes — the final selector depends on the new runtime-binding behavior |

Frontend build is inapplicable; the smoke capability exercises runtime binding without changing a frontend.

## Blocked By

`TB-004` — coverage and integrity extend the complete evaluation decision.

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
