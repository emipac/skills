# TB-005 — Apply required, advisory, budget, and bypass policy

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent
Blocked by: 04-evaluate-an-exact-snapshot-end-to-end
Tracker ID: 05-apply-required-advisory-budget-and-bypass-policy
Draft key: TB-005

**Status:** ready-for-agent
**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

An authoritative evaluation allows only a current complete required pass, records advisory outcomes without compensation, enforces confirmed budgets, and supports only an explicitly configured one-shot audited bypass.

## SRS Traceability

- `FR-EVAL-001`, `FR-POL-001`, `FR-POL-002`, `FR-POL-003`, `FR-POL-004`, `FR-POL-005`, `FR-POL-006`, `FR-POL-007`, `FR-POL-008`, `NFR-PERF-001`
- `AC-EVAL-001`, `AC-POL-001`, `AC-POL-002`, `AC-POL-003`
- `SG-BYP-001`, `SG-EVAL-001`, `SG-POL-001`, `SG-TRUST-001`
- `RISK-001`, `RISK-003`, `Q-002`, `Q-007`

## Domain Concepts

Enforcement role, Gate policy, Trusted gate configuration, Check attempt, and Lifecycle event.

## Approach and Tradeoffs

Apply policy to the current evaluation binding only. Required failed or unverified checks deny; advisory checks remain nonblocking; eligible advisory work alone may be skipped for budget. Model bypass as a distinct snapshot-bound outcome that preserves failures, writes evidence, and supplies the commit marker rather than rewriting the decision as passed.

## Architecture Boundary and Public Seam

The boundary is policy evaluation over a completed process decision; evidence is observed through the evaluation interface and authoritative Git mapping. First red test: a stale pass plus a current required failure cannot authorize the current snapshot.

## Safeguards and Invariants

- `SG-EVAL-001`: authorization binds to the exact current snapshot.
- `SG-POL-001`: advisory success never compensates for required failure.
- `SG-BYP-001`: bypass is never a pass, reusable, or accepted without required reason and reference.
- `SG-TRUST-001`: bypass and local enforcement are not represented as tamper-proof.

## Prohibited Behavior and Non-goals

No baseline exemption, persistent pass cache, silent retry, universal timeout default, implicit bypass, or prevention of raw Git `--no-verify`.

## Risk and Decision Impacts

- `RISK-001`: accepted for local v1; explicit trust limits and observable bypass markers remain mandatory.
- `RISK-003`: remains open and owned; project-confirmed budgets and timing evidence remain visible.
- `Q-002`: the repository owner or lead maintainer is the sole Product Owner and risk acceptor.
- `Q-007`: no universal duration exists; projects confirm per-check timeouts and total budget.

## Acceptance Criteria

- [x] `AC-EVAL-001`: every activated commit evaluates; all current required passes allow and one required failure denies.
- [x] `AC-POL-001`: pre-existing required failure still blocks, advisory failure does not, and stale pass evidence cannot authorize.
- [x] `AC-POL-002`: timeouts terminate process trees, budget skips only eligible advisory work, and incomplete required coverage is blocking `unverified`.
- [x] `AC-POL-003`: disabled bypass is rejected; enabled bypass is one-shot, snapshot-bound, visibly bypassed, evidence-backed, marker-emitting, and preserves failure.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-EVAL-001`, `AC-POL-001`, `AC-POL-002`, `AC-POL-003`, `SG-BYP-001`, `SG-POL-001`: policy and negative fixtures | `npm run test:unit` | Yes — configured unit suite exercises evaluation policy |

Frontend build and browser evidence are inapplicable to this process-policy slice.

## Blocked By

`TB-004` — policy is applied to the complete versioned evaluation decision.

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
