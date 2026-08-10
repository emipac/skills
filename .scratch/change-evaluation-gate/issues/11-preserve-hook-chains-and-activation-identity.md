# TB-011 — Preserve hook chains and activation identity

Status: open
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent
Blocked by: 10-activate-authoritative-git-enforcement-transactionally
Tracker ID: 11-preserve-hook-chains-and-activation-identity
Draft key: TB-011

**Status:** ready-for-agent
**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

Activation composes with existing hooks, pauses and resumes safely across client trust, and rejects non-interactive identity mismatches without changing clone-local state.

## SRS Traceability

- `FR-LIFE-007`, `FR-LIFE-015`, `FR-LIFE-016`, `FR-LIFE-017`, `NFR-COMP-002`
- `AC-LIFE-003`, `AC-LIFE-008`, `AC-LIFE-009`
- `SG-HOOK-001`
- `RISK-004`

## Domain Concepts

Managed hook registration, Activation consent, Activation transaction, Activation receipt, and Gate health.

## Approach and Tradeoffs

Select hook composition in the decided order: native manager, confirmed marker-delimited local block, then owned shim. Preserve the surrounding chain and reject unsafe shared hook-path changes. Bind trust resumption and non-interactive approval to repository, configuration, selected-adapter, and preview identities before any mutation.

## Architecture Boundary and Public Seam

The boundary is clone-local hook and trust integration within lifecycle activation; the public seam is the activation command and authoritative Git fixture. First red test: resuming a paused activation after the configuration identity changes performs no mutation and leaves every integration inactive.

## Safeguards and Invariants

- `SG-HOOK-001`: never overwrite an existing hook, silently alter shared hook paths, resume changed identities, or leave partial activation.

## Prohibited Behavior and Non-goals

Do not replace existing hook content, automatically modify shared or global `core.hooksPath`, grant client trust, or infer non-interactive consent from a flag without exact identities.

## Risk and Decision Impacts

- `RISK-004`: accepted conditionally; hook, trust, and client behavior must pass exact compatibility fixtures before support is claimed.

## Acceptance Criteria

- [ ] `AC-LIFE-003`: activation preserves and executes the prior hook chain, refuses unsafe shared-hook changes, and requires manual resolution after marker drift.
- [ ] `AC-LIFE-008`: missing or mismatched non-interactive identities write nothing; an exact match may continue.
- [ ] `AC-LIFE-009`: trust pause/resume requires identical transaction identities and hook strategy selection follows the declared order without partial activation.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-LIFE-003`, `AC-LIFE-008`, `AC-LIFE-009`, `SG-HOOK-001`: hook, trust, and identity fixtures | `npm run test:unit` | Yes — configured unit suite exercises lifecycle integration |
| smoke | both | `AC-LIFE-003`, `AC-LIFE-009`: packaged hook chain and trust-resume behavior | `gate-hook-conformance-smoke` capability introduced by this slice | Yes — user-facing hook selector depends on this slice |

Frontend build and browser evidence are inapplicable.

## Blocked By

`TB-010` — hook and trust composition extend the transactional activation seam.

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
