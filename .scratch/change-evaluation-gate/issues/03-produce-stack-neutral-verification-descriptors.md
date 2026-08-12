# TB-003 — Produce stack-neutral Verification descriptors

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent
Blocked by:
Tracker ID: 03-produce-stack-neutral-verification-descriptors
Draft key: TB-003

**Status:** ready-for-agent
**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

Laravel and one reference non-Laravel provider can emit versioned, shell-free check descriptors that the Gate consumes identically, while missing or unproved commands remain visible capability gaps.

## SRS Traceability

- `FR-CFG-003`, `FR-CFG-004`, `FR-CFG-007`, `FR-PROF-001`, `FR-PROF-002`, `FR-PROF-003`, `FR-PROF-004`, `FR-PROF-006`, `FR-PROF-007`, `FR-PROF-008`, `NFR-MAINT-001`, `NFR-SEC-002`
- `AC-CFG-002`, `AC-PROF-001`, `AC-PROF-002`, `AC-PROF-003`, `AC-PROF-004`
- `SG-CMD-001`, `SG-OWNER-001`

## Domain Concepts

Command descriptor, Grader surface, Check assertion, Check attempt, and Verification Evidence ladder.

## Approach and Tradeoffs

Deepen the existing Verification provider seam so providers emit logical runners, argument arrays, roots, timeouts, environment names, source scopes, policy bindings, claims, and ordered stages. Keep stack knowledge inside providers; Gate core sees one versioned contract. Allow new capabilities without a core branch, but require a contract version change for new stages or outcomes.

## Architecture Boundary and Public Seam

The boundary is `verify-change` ownership of applicable checks and commands; the public seam is the provider-to-evaluation descriptor contract. First red test: Laravel and a non-Laravel fixture emit valid descriptors consumed by the same contract validator with no stack-name branch.

## Safeguards and Invariants

- `SG-CMD-001`: descriptors never use shell parsing, unresolved executables, or hidden complex behavior outside a declared repository script.
- `SG-OWNER-001`: Gate core never duplicates provider selection or framework-specific command knowledge.

## Prohibited Behavior and Non-goals

Do not guess commands from filenames, treat unavailable as not-applicable, add framework branches to Gate core, or redefine private provider storage.

## Risk and Decision Impacts

No additional parent risk or resolved-question disposition changes this slice; it preserves the accepted ownership boundary and versioned extension seam.

## Acceptance Criteria

- [x] `AC-CFG-002`: validation rejects shell syntax and unresolved runners, surfaces repository scripts, and activation can resolve, version, pin, and preview approved executables.
- [x] `AC-PROF-001`: Laravel and one non-Laravel provider emit descriptors consumed without a stack-name branch.
- [x] `AC-PROF-002`: Laravel maps confirmed Pint, Rector dry-run, PHPStan or Larastan, Pest, smoke, build, and browser commands to defined stages and claims.
- [x] `AC-PROF-003`: missing commands and unproved capabilities produce visible gaps and no guessed descriptor.
- [x] `AC-PROF-004`: fixtures enforce eight ordered stages, four outcomes, capability extension without a core branch, and contract versioning for semantic expansion.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CFG-002`, `AC-PROF-001`, `AC-PROF-002`, `AC-PROF-003`, `AC-PROF-004`, `SG-CMD-001`, `SG-OWNER-001`: provider contract and negative fixtures | `npm run test:unit` | Yes — configured unit suite is the public provider-contract evidence |

Frontend build and browser execution are inapplicable; this slice defines descriptors and capability gaps rather than changing a frontend.

## Blocked By

None — can start immediately.

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
