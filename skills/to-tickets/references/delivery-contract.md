# Delivery contract

A delivery contract is one independently implementable tracer bullet. It
references durable intent rather than copying it and leaves private
implementation choices to the red-green loop.

## Readiness gate

`ready-for-agent` requires:

- one complete vertical outcome that fits a fresh context;
- SRS requirement, acceptance, and relevant safeguard IDs within the parent
  feature contract;
- canonical domain concepts and respected ADR boundaries;
- one agreed public seam and a describable first failing test;
- explicit invariants, prohibited behavior, and non-goals;
- acceptance criteria observable at that seam;
- a verification matrix using configured commands or capabilities;
- smoke or browser evidence for user-facing behavior;
- a configured production build for affected frontend code;
- existing, acyclic blocker edges;
- no unresolved assumption marked as blocking the start.

## Template

```markdown
# TB-NNN — <Ticket title>

**Status:** draft
**Parent feature spec:** <Tracker reference>

## Outcome

<One complete end-to-end behavior from the user's perspective.>

## SRS Traceability

- <FR/NFR IDs>
- <AC IDs>
- <SG IDs where relevant>

## Domain Concepts

<Canonical terms this slice uses or affects.>

## Approach and Tradeoffs

<Chosen delivery approach and material tradeoffs without a file plan.>

## Architecture Boundary and Public Seam

<Affected boundary, agreed public seam, and first behavior to drive red.>

## Safeguards and Invariants

<Invariant IDs and violation responses this slice preserves.>

## Prohibited Behavior and Non-goals

<Negative-space constraints and explicit exclusions.>

## Acceptance Criteria

- [ ] <AC-ID and observable pass/fail outcome.>

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| <Targeted/static/affected/smoke/build/browser/broad> | <Backend/frontend/both> | <AC/SG IDs and what the row proves> | <Exact configured command or named capability> | <Yes/No with reason> |

## Blocked By

None — can start immediately.

## Unresolved Assumptions

None.

<!-- When assumptions exist, replace None with:
| ID | Assumption | Blocks start | Resolution |
| --- | --- | --- | --- |
| ASM-001 | ... | Yes/No | Open or accepted resolution |
-->

## Readiness

- [ ] The outcome is a complete vertical behavior.
- [ ] Acceptance criteria trace to the SRS and feature spec.
- [ ] The public seam and first red test are identified.
- [ ] Safeguards and non-goals are explicit.
- [ ] Blocking edges exist and are acyclic.
- [ ] No unresolved assumption blocks the start.
- [ ] The ticket fits one fresh implementation context.
- [ ] User-facing and frontend evidence requirements are covered or explicitly inapplicable.
```

Set status to `ready-for-agent` and check every readiness item only after the
gate passes. Tracker-native blocker relationships remain authoritative; the
body keeps a readable edge list.

`TB-NNN` is a temporary key for validating the draft graph before tracker IDs
exist. After publication, the tracker issue ID is the contract's identity and
native blocking relationships are authoritative. Keep the draft key only as a
mapping aid; never treat it as a competing tracker ID.
