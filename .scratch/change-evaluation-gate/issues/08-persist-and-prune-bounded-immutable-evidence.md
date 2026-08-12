# TB-008 — Persist and prune bounded immutable Evidence

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent
Blocked by: 04-evaluate-an-exact-snapshot-end-to-end
Tracker ID: 08-persist-and-prune-bounded-immutable-evidence
Draft key: TB-008

**Status:** ready-for-agent
**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

Every evaluation appends a bounded, redacted, content-addressed Evidence envelope under Git common metadata, and an operator can preview and confirm selective blob pruning without losing the audit trail.

## SRS Traceability

- `FR-EVID-001`, `FR-EVID-002`, `FR-EVID-003`, `FR-EVID-004`, `FR-EVID-005`, `NFR-AUD-001`
- `AC-EVID-001`, `AC-EVID-002`
- `SG-EVID-001`, `SG-SECRET-001`
- `RISK-006`, `RISK-010`, `Q-008`

## Domain Concepts

Evidence envelope, Evidence store, Lifecycle event, Check attempt, and Git common directory.

## Approach and Tradeoffs

Append canonical envelopes atomically and store bounded redacted blobs by content identity. Enforce 32 KiB inline, 4 MiB per blob, and 32 MiB per evaluation ceilings while allowing only lower project limits. Make pruning manual, preview-bound, and blob-only; retain envelopes, decisions, events, records, and tombstones.

## Architecture Boundary and Public Seam

The boundary is the clone-local Evidence store behind evaluation and lifecycle commands; public seams are the decision evidence reference and prune preview/result. First red test: a mismatched prune confirmation removes nothing and records no false successful deletion.

## Safeguards and Invariants

- `SG-EVID-001`: history is append-only and never automatically deleted or silently replaced.
- `SG-SECRET-001`: raw Sensitive values never persist in envelopes, blobs, or Lifecycle events.

## Prohibited Behavior and Non-goals

No background retention job, automatic deletion, envelope removal, raising fixed ceilings, silent truncation, or tamper-proof storage claim.

## Risk and Decision Impacts

- `RISK-006`: accepted conditionally; secret-canary and redaction evidence are a mandatory release gate and unsafe capture is `unverified`.
- `RISK-010`: mitigated by fixed ceilings and explicit preview-bound pruning.
- `Q-008`: fixes the three v1 ceilings and manual selection/confirmation policy.

## Acceptance Criteria

- [x] `AC-EVID-001`: repeated evaluations append canonical envelopes atomically at the Git-common location and enforce every ceiling, boundary, and byte count.
- [x] `AC-EVID-002`: no automatic deletion occurs; preview mismatch removes nothing and a match removes only selected blobs while preserving audit evidence.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-EVID-001`, `AC-EVID-002`, `SG-EVID-001`, `SG-SECRET-001`: append, bounds, redaction, preview, mismatch, and tombstone fixtures | `npm run test:unit` | Yes — configured unit suite exercises evidence and lifecycle seams |
| smoke | both | `AC-EVID-002`: packaged pruning command previews and confirms selected blobs | `gate-evidence-prune-smoke` capability introduced by this slice | Yes — user-facing selector is created by this slice |

Frontend build and browser evidence are inapplicable.

## Blocked By

`TB-004` — envelopes persist the complete evaluation identity and attempts.

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
