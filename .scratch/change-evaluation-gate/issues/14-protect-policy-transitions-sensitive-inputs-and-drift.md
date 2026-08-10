# TB-014 — Protect policy transitions, Sensitive inputs, and drift

Status: open
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent
Blocked by: 05-apply-required-advisory-budget-and-bypass-policy, 06-prove-task-scope-and-grader-runtime-integrity, 08-persist-and-prune-bounded-immutable-evidence, 12-manage-the-active-release-and-removal-lifecycle
Tracker ID: 14-protect-policy-transitions-sensitive-inputs-and-drift
Draft key: TB-014

**Status:** ready-for-agent
**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A policy-changing snapshot cannot weaken its own authorization, approved Sensitive inputs leave no raw value in retained state, and unexpected Gate control-surface drift makes health broken and authoritative evaluation unverified.

## SRS Traceability

- `FR-CFG-005`, `FR-CFG-006`, `NFR-SEC-003`, `NFR-SEC-004`
- `AC-CFG-003`, `AC-CFG-004`, `AC-SEC-001`
- `SG-CFG-001`, `SG-SECRET-001`, `SG-TRUST-001`
- `RISK-001`, `RISK-006`, `RISK-008`

## Domain Concepts

Trusted gate configuration, Gate control surface, Grader surface, Sensitive runtime input, Gate health, and Evaluation snapshot.

## Approach and Tradeoffs

Evaluate policy-surface changes under both trusted and candidate policy, require hash-bound approval, and advance trust only when both pass. Copy only approved named runtime inputs into the isolated root and remove them before persistence. Reconcile runtime, adapter, hook, receipt, configuration, descriptor, and provider identities; ordinary Grader changes remain visible without automatic malicious classification.

## Architecture Boundary and Public Seam

The boundary crosses lifecycle trust and the evaluation decision without widening either seam; public evidence is the lifecycle approval/status result plus evaluation integrity fields. First red test: a candidate that removes a required check passes its weaker policy but fails trusted policy and cannot advance trust or authorize.

## Safeguards and Invariants

- `SG-CFG-001`: candidate policy cannot authorize its own weakening.
- `SG-SECRET-001`: raw Sensitive values never persist in configuration, decisions, envelopes, blobs, or events.
- `SG-TRUST-001`: drift detection is not represented as tamper resistance against the machine owner.

## Prohibited Behavior and Non-goals

No single-policy self-approval, raw secret persistence, automatic drift repair, blanket malicious classification of Grader changes, encryption claim, or hostile-code containment claim.

## Risk and Decision Impacts

- `RISK-001`: accepted for cooperative local v1; ordinary drift remains observable without claiming machine-owner resistance.
- `RISK-006`: accepted conditionally; secret-canary and redaction evidence are release-blocking and unsafe capture is `unverified`.
- `RISK-008`: accepted conditionally; trusted/candidate identity and dual-policy fixtures are release-blocking.

## Acceptance Criteria

- [ ] `AC-CFG-003`: candidate policy weakening cannot self-authorize; hash-bound approval advances only after both trusted and candidate policies pass.
- [ ] `AC-CFG-004`: secret-canary fixtures copy only approved inputs, remove them, and find no raw value in retained configuration or Evidence.
- [ ] `AC-SEC-001`: independent control-surface drift produces broken health and authoritative `unverified`, while ordinary Grader changes remain visible without automatic malicious classification.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CFG-003`, `AC-CFG-004`, `AC-SEC-001`, `SG-CFG-001`, `SG-SECRET-001`: dual-policy, canary, and drift fixtures | `npm run test:unit` | Yes — configured unit suite exercises lifecycle and evaluation seams |
| smoke | both | `AC-CFG-004`, `AC-SEC-001`: packaged runtime input and drift behavior | `gate-security-control-smoke` capability introduced by this slice | Yes — the final security selectors depend on the new control surfaces |

Frontend build and browser evidence are inapplicable.

## Blocked By

- `TB-005` — dual-policy transitions extend complete policy evaluation.
- `TB-006` — Grader and runtime integrity identities must already be exposed.
- `TB-008` — redaction must cover the complete Evidence contract.
- `TB-012` — drift classification and repair rules extend lifecycle health.

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
