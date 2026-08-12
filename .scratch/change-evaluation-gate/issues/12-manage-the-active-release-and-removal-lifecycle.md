# TB-012 — Manage the active release and removal lifecycle

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent
Blocked by: 11-preserve-hook-chains-and-activation-identity
Tracker ID: 12-manage-the-active-release-and-removal-lifecycle
Draft key: TB-012

**Status:** ready-for-agent
**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

An activated clone can expose a candidate release, update atomically, inspect health without repair, recover explicitly, and deactivate, uninstall, or clean configuration without removing shared state or historical Evidence.

## SRS Traceability

- `FR-LIFE-008`, `FR-LIFE-009`, `FR-LIFE-010`, `FR-LIFE-011`, `FR-LIFE-014`, `FR-LIFE-018`, `FR-LIFE-019`, `NFR-REL-002`
- `AC-LIFE-004`, `AC-LIFE-005`, `AC-LIFE-007`, `AC-LIFE-010`
- `SG-LIFE-001`
- `RISK-004`

## Domain Concepts

Active gate release, Gate health, Gate removal, Activation receipt, Gate configuration section, and Lifecycle event.

## Approach and Tradeoffs

Keep ordinary package updates separate from explicit `gate update`. Switch releases only after preview, migration validation, and self-tests; preserve the prior release on failure. Make status read-only, repair explicit, and all removal conservative: deactivation removes unchanged owned registrations and receipt, uninstall removes only project assets, and cleanup removes only previewed Gate keys.

## Architecture Boundary and Public Seam

The boundary is the lifecycle command interface over an Active gate release and receipt; public seams are update, status, repair, deactivate, uninstall, and cleanup results. First red test: an injected update failure keeps the prior active release and reports health without repairing anything.

## Safeguards and Invariants

- `SG-LIFE-001`: lifecycle operations never silently repair drift, delete shared configuration, delete Evidence, remove global assets, or expose partial success.

## Prohibited Behavior and Non-goals

No automatic update, repair, removal, background cleanup, global uninstall, evidence deletion, or status-time mutation.

## Risk and Decision Impacts

- `RISK-004`: accepted conditionally; adapter loss must be reported as degraded or broken according to authority and requalified before support is claimed.

## Acceptance Criteria

- [x] `AC-LIFE-004`: update failure preserves the prior release; adapter loss may be degraded, authoritative loss is broken, and neither status repairs.
- [x] `AC-LIFE-005`: deactivation and uninstall remove only unchanged Gate-owned state while preserving configuration, global assets, and Evidence.
- [x] `AC-LIFE-007`: ordinary distribution exposes a candidate only; explicit successful update advances the active release.
- [x] `AC-LIFE-010`: cleanup removes only previewed Gate keys and drift remains until confirmed repair or activation.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-LIFE-004`, `AC-LIFE-005`, `AC-LIFE-007`, `AC-LIFE-010`, `SG-LIFE-001`: update, health, removal, and failure fixtures | `npm run test:unit` | Yes — configured unit suite exercises lifecycle commands |
| smoke | both | `AC-LIFE-005`, `AC-LIFE-007`: packaged update and removal preserve unrelated state | `gate-lifecycle-smoke` capability introduced by this slice | Yes — user-facing lifecycle selectors are created by this slice |

Frontend build and browser evidence are inapplicable.

## Blocked By

`TB-011` — update, health, and removal reconcile the fully composed activation state.

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
