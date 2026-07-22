# <Feature name> — Feature Contract

## Feature Contract

| Field | Value |
| --- | --- |
| Status | draft |
| SRS baseline | <Configured path and version> |
| Decision sources | <Conversation, wayfinder map, issue, or prototype links> |

## Problem and Outcome

<User problem and one cohesive observable outcome.>

## SRS Traceability

| Requirement IDs | Acceptance IDs | Safeguard IDs | Scope |
| --- | --- | --- | --- |
| <FR/NFR IDs> | <AC IDs> | <SG IDs or None> | <Included boundary> |

## User Stories and Scenarios

1. As a <canonical actor>, I want <behavior>, so that <outcome>.

Include happy, boundary, failure, recovery, lifecycle, and authorization
scenarios that materially apply.

## Approach and Decisions

- <Delivery-facing decision and material tradeoff; link ADRs for durable rationale.>

## Public Interfaces and Test Seams

| Seam | Behavior observed | Acceptance IDs | Prior art |
| --- | --- | --- | --- |
| <Highest practical public interface> | <Observable result> | <AC IDs> | <Existing test pattern> |

## Safeguards and Prohibited Behavior

- <SG ID and invariant or prohibited outcome.>

## Risks, Gaps, and Assumptions

| ID | Type | Description | Blocks readiness | Resolution |
| --- | --- | --- | --- | --- |
| GAP-001 | <Risk/Gap/Dependency/Assumption/Implicit decision> | <Finding> | <Yes/No> | <Accepted resolution or Open> |

## Acceptance Criteria

| ID | Criterion | Evidence seam |
| --- | --- | --- |
| <AC ID> | <Observable pass/fail outcome> | <Agreed public seam> |

## Verification Strategy

<Required evidence layers and configured capabilities; ticket contracts select
exact commands.>

## Out of Scope

- <Explicit non-goal and boundary.>

## Readiness

- [ ] Every in-scope requirement maps to acceptance evidence.
- [ ] Public test seams are agreed.
- [ ] Safeguards and prohibited behavior are explicit.
- [ ] Blocking gaps and assumptions are resolved.
- [ ] Out-of-scope behavior is explicit.
