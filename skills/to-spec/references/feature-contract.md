# Feature contract

A feature contract extracts one cohesive deliverable slice from the SRS. It
owns delivery-facing scope and decisions; the SRS continues to own durable
product intent.

## Analysis matrix

| Dimension | Question | Blocking when |
| --- | --- | --- |
| Concepts | Are actors and domain terms canonical and complete? | A behavior depends on an undefined or conflicting term. |
| Behavior | Are happy, boundary, failure, recovery, and lifecycle paths covered? | An in-scope path has no defined outcome. |
| Acceptance | Does every in-scope FR/NFR reach observable AC evidence? | A requirement or criterion lacks a public seam. |
| Authorization | Are actor scope and prohibited access explicit? | Authority is ambiguous or permits a safeguard bypass. |
| Safeguards | Are relevant SG invariants and violation responses preserved? | A required invariant is absent or weakened. |
| Risk | Are relevant SRS risks mitigated or consciously accepted? | A high-impact risk has no accepted response. |
| Dependencies | Are external and internal prerequisites known? | Work cannot start without an unresolved dependency. |
| Architecture | Are durable boundaries and ADR constraints respected? | The slice requires an undecided durable change. |
| Test seams | Can all criteria be proven through agreed public interfaces? | The proposed evidence depends on private implementation. |
| Scope drift | Does the slice add behavior absent from the SRS? | The addition has not been explicitly accepted into the SRS. |

## Ownership

- SRS: durable behavior, constraints, risks, safeguards, acceptance IDs.
- Feature contract: one cohesive delivery scope, approach, seams, gaps, and
  verification strategy.
- Delivery contracts: independently implementable tracer bullets.
- ADR: rationale for durable architecture decisions.
- Code and tests: implementation truth and executable evidence.

## Readiness

`ready-for-tickets` requires:

- all references resolve against the configured SRS baseline;
- every in-scope requirement maps to detailed acceptance criteria;
- public seams are confirmed;
- safeguards, prohibited behavior, and non-goals are explicit;
- no gap, risk, dependency, assumption, or implicit decision blocks readiness;
- the contract contains no volatile implementation inventory.
