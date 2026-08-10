# TB-013 — Deliver supported desktop preflight adapters

Status: open
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent
Blocked by: 11-preserve-hook-chains-and-activation-identity
Tracker ID: 13-deliver-supported-desktop-preflight-adapters
Draft key: TB-013

**Status:** ready-for-agent
**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

Claude Code Desktop, Codex Desktop, and Cursor local-project users receive deterministic structured preflight feedback through thin capability-aware adapters while Git alone remains authoritative.

## SRS Traceability

- `FR-ADAPT-001`, `FR-ADAPT-002`, `FR-ADAPT-003`, `FR-ADAPT-004`, `FR-ADAPT-005`, `FR-ADAPT-006`, `FR-ADAPT-007`, `NFR-COMP-001`
- `AC-ADAPT-001`, `AC-ADAPT-002`
- `SG-SUPPORT-001`
- `RISK-004`, `Q-003`, `Q-004`

## Domain Concepts

Enforcement role, Support tier, Client compatibility baseline, Adapter distribution, and Evaluation snapshot.

## Approach and Tradeoffs

Keep adapters thin: declare capabilities, normalize supported events and repository/session identity, invoke the shared process interface, and present its structured result. Map Git `deny` to blocking, but desktop results to `not-authoritative`. Treat trust, timeout, invocation, capability, and malformed-output failures as `unverified`; unproved contexts cannot claim support.

## Architecture Boundary and Public Seam

The boundary is native client payload normalization outside Gate core; the public seam is the shared adapter conformance suite. First red test: the same deny decision blocks the Git fixture while each desktop fixture displays a structured non-authoritative preflight result.

## Safeguards and Invariants

- `SG-SUPPORT-001`: no integration is called supported before its declared surface passes the baseline, and lack of native blocking does not disqualify a conforming preflight.

## Prohibited Behavior and Non-goals

No client-specific policy, native payload leakage into core, support claim for remote/cloud/chat-only contexts, additional v1 clients, or desktop authorization.

## Risk and Decision Impacts

- `RISK-004`: accepted conditionally; exact adapter fixtures are a mandatory release gate.
- `Q-003`: no additional client enters v1; later clients require a new Wayfinder effort and compatibility evidence.
- `Q-004`: support is capability-based and proven by exact release-manifest versions and outcomes, not a permanent allowlist.

## Acceptance Criteria

- [ ] `AC-ADAPT-001`: the same decision blocks Git on deny while desktop adapters normalize triggers and present structured `not-authoritative` feedback.
- [ ] `AC-ADAPT-002`: every named desktop target passes the shared baseline; defined failures are `unverified`; unsupported contexts cannot claim support; exact versions and outcomes are recorded.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-ADAPT-001`, `AC-ADAPT-002`, `SG-SUPPORT-001`: shared conformance and failure fixtures | `npm run test:unit` | Yes — configured unit suite proves adapter normalization |
| smoke | both | `AC-ADAPT-002`: installed plugin surfaces expose dormant adapters and run the exact client fixtures | `npm run test:install` | Yes — configured install smoke protects cross-client distribution |
| e2e | both | `AC-ADAPT-001`, `AC-ADAPT-002`: Git and three desktop surfaces present role-correct outcomes | `gate-adapter-conformance` capability introduced by this slice | Yes — the final selectors depend on the new adapters |

Frontend build and browser evidence are inapplicable; these are local process adapters, not repository frontend code.

## Blocked By

`TB-011` — adapters consume the activated runtime, identity, trust, and hook authority contract.

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
