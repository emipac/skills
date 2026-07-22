# <Project name> — Software Requirements Specification

## 1. Document Control

| Field | Value |
| --- | --- |
| Project | <Project name> |
| Version | <Document version> |
| Status | Draft |
| Product owner | <Accountable owner> |
| Last updated | <YYYY-MM-DD> |
| Sources | <Links to source documents or decision maps> |

### Revision history

| Version | Date | Status | Change | Decision source |
| --- | --- | --- | --- | --- |
| <Version> | <YYYY-MM-DD> | Draft | Initial baseline | <Source> |

## 2. Purpose and Scope

### Purpose

<The problem, intended outcomes, and why this SRS exists.>

### In scope

- <Durable product boundary.>

### Success measures

- <Observable product or operational measure.>

## 3. Product Context

### Current state

<Existing workflow or system context.>

### Target state and boundaries

<System responsibilities, external actors, upstream/downstream systems, and
trust boundaries.>

### Assumptions and dependencies

- <Assumption or dependency; uncertain items also receive a Q-NNN row.>

## 4. Domain Concepts and Actors

Use terms from the configured glossary. Define new canonical terms there and
link them here; do not duplicate glossary definitions.

### Domain relationships and invariants

| Concept | Responsibility | Relationships and invariants | Glossary source |
| --- | --- | --- | --- |
| <Concept> | <What it represents> | <Durable relationships, lifecycle, or invariant> | <Glossary link> |

### Actors and authorization boundaries

| Actor | Goal | Authority and boundary |
| --- | --- | --- |
| <Actor> | <Goal> | <Permitted scope and separation-of-duty boundary> |

### Information lifecycle

| Information or record | Created by | Lifecycle and retention | Access and audit boundary | Requirement IDs |
| --- | --- | --- | --- | --- |
| <Logical information concept, not a physical table> | <Actor or system> | <State transitions, retention, deletion, export> | <Who may access or change it and what is audited> | <Relevant FR/NFR IDs> |

## 5. Architecture Constraints and Decisions

Record only durable constraints that affect product behavior or delivery.
Link ADRs for rationale rather than copying them.

| Constraint or ADR | Consequence for the system |
| --- | --- |
| <ADR link or durable constraint> | <Observable consequence> |

## 6. Functional Requirements

| ID | Area | Requirement | Priority | Source | Status |
| --- | --- | --- | --- | --- | --- |
| FR-AREA-001 | <Area> | <One observable behavior using canonical terms.> | Must | <Source> | Draft |

## 7. Non-functional Requirements

| ID | Quality area | Requirement | Measure | Scope | Status |
| --- | --- | --- | --- | --- | --- |
| NFR-AREA-001 | <Security, performance, accessibility, reliability, audit, localization, privacy, maintainability, or operability> | <Constraint> | <Objective threshold or verification method> | <Affected behavior> | Draft |

## 8. Safeguards

| ID | Protects | Constraint | Violation response | Rationale source |
| --- | --- | --- | --- | --- |
| SG-AREA-001 | FR-AREA-001, NFR-AREA-001 | <Invariant, prohibited outcome, compatibility promise, or security boundary> | <Reject, roll back, alert, audit, or recover> | <Source or ADR> |

## 9. Scenarios and Use Cases

| Scenario | Actor and trigger | Preconditions | Observable outcome | Requirement IDs |
| --- | --- | --- | --- | --- |
| <Happy, boundary, failure, recovery, or authorization scenario> | <Actor and event> | <State> | <Outcome> | FR-AREA-001 |

## 10. Risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| RISK-001 | <Uncertain event and consequence> | <Low/Medium/High> | <Low/Medium/High> | <Reduction or contingency> | <Owner> | Open |

## 11. Open Questions

| ID | Question | Blocks | Owner | Status | Resolution |
| --- | --- | --- | --- | --- | --- |
| Q-001 | <One decision that cannot be discovered from the repository> | <Requirement IDs or readiness decision> | <Decision owner> | Open | — |

## 12. Acceptance Criteria

| ID | Requirement IDs | Criterion | Evidence seam |
| --- | --- | --- | --- |
| AC-AREA-001 | FR-AREA-001, NFR-AREA-001 | <Specific externally observable pass/fail outcome> | <Highest practical public test or review seam> |

## 13. Traceability and Readiness

Acceptance Criteria `Requirement IDs` are the canonical requirement-to-evidence
mapping. Safeguards `Protects` are the canonical negative-space mapping.

Before changing status, run `scripts/audit-srs.mjs` from the installed
`srs-modeling` skill and record:

- mechanical audit result: <Pass/Fail>;
- uncovered active requirements: <IDs or None>;
- unresolved blocking questions: <IDs or None>;
- unmitigated high risks: <IDs or None>;
- semantic review result: <Pass/Fail and review source>.

## 14. Out of Scope

- <Explicitly excluded behavior and why it is outside this baseline.>

## Optional Appendices

Link durable supporting diagrams or source records. Keep framework menus,
physical schema inventories, file plans, and method-level designs in delivery
artifacts or code unless they are externally contractual.
