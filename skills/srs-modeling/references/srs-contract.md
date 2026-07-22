# SRS contract

The SRS owns durable product intent: behavior, boundaries, quality constraints,
risks, safeguards, and acceptance criteria. It links to the glossary for terms
and ADRs for architectural rationale. It does not inventory implementation.

## Required sections

1. Document Control
2. Purpose and Scope
3. Product Context
4. Domain Concepts and Actors
5. Architecture Constraints and Decisions
6. Functional Requirements
7. Non-functional Requirements
8. Safeguards
9. Scenarios and Use Cases
10. Risks
11. Open Questions
12. Acceptance Criteria
13. Traceability and Readiness
14. Out of Scope

Section numbering may change, but names and ownership remain stable. Optional
appendices may link source material or durable diagrams.

## Stable identifiers

| Artifact | Format | Example |
| --- | --- | --- |
| Functional requirement | `FR-<AREA>-NNN` | `FR-AUTH-001` |
| Non-functional requirement | `NFR-<AREA>-NNN` | `NFR-SEC-001` |
| Safeguard | `SG-<AREA>-NNN` | `SG-AUTH-001` |
| Acceptance criterion | `AC-<AREA>-NNN` | `AC-AUTH-001` |
| Risk | `RISK-NNN` | `RISK-001` |
| Open question | `Q-NNN` | `Q-001` |

`<AREA>` is a short stable domain or quality-area token, not a framework or
folder name. Use uppercase ASCII letters and digits.

Once an ID has appeared in a reviewed baseline:

- never renumber or reuse it;
- change its status to `Retired`, `Superseded`, or `Withdrawn` rather than
  deleting it;
- name its replacement and reason in the requirement text or source field;
- give new behavior a new ID when its observable meaning materially changes.

Editorial clarification may retain an ID when observable meaning is unchanged.

## Normative tables

Functional and non-functional requirement tables start with `ID` and include a
`Status` column. Active statuses are `Draft`, `Review`, and `Approved`.

Acceptance criteria contain a `Requirement IDs` column. This is the canonical
traceability mapping; do not maintain a second duplicated mapping table.

Safeguards contain a `Protects` column naming the requirements whose negative
space they constrain. A safeguard states an invariant or prohibited outcome and
the response when it would be violated.

Open questions contain `Blocks`, `Status`, and `Resolution`. Keep resolved rows
for history. A question blocks approval when `Blocks` names an active
requirement or readiness decision and its status is not resolved.

## Status gate

| Status | Meaning |
| --- | --- |
| Draft | Known decisions recorded; open questions and incomplete coverage may remain visible. |
| Review | Scope is complete enough for stakeholder review; remaining blockers are explicitly assigned. |
| Approved | Mechanical and semantic audits pass, all active requirements have acceptance coverage, and no blocking question or unmitigated high risk remains. |

## Artifact routing

| Information | Owner |
| --- | --- |
| Observable system behavior or constraint | SRS |
| Canonical implementation-independent term | Domain glossary |
| Rationale for a durable technical decision | ADR |
| Feature-sized delivery design | Feature spec |
| File, class, method, schema implementation | Code |
| Executable evidence | Tests |

Link across owners with stable IDs or document paths. Preserve one source of
truth for each meaning.
