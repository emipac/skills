# Lifecycle contract handoff alignment

Aligned `to-spec`, `to-tickets`, and `implement` so a planning artifact cannot
pass its producer gate and then fail a documented consumer requirement.

- Feature contracts now validate acceptance-to-seam mappings, stable risk and
  resolved-question dispositions, high-impact risk responses, and canonical
  readiness items.
- Delivery contracts now validate parent readiness, ticket and parent-wide ID
  coverage, safeguards, risk and decision impacts, planner-supported evidence
  layers, and reasons for required or optional verification.
- `implement` reruns the delivery-contract audit and verification planner
  before the first red-green cycle.
- `verify-change` and `to-tickets` share an integration-tested verification
  layer vocabulary while remaining independently installable.
- The Change Evaluation Gate feature contract now targets approved SRS v0.2.2,
  traces all ten risks and eight resolved questions, records their explicit
  dispositions, and uses the canonical `ready-for-tickets` checklist.
- Published fifteen audited Change Evaluation Gate delivery contracts to the
  local Markdown tracker, wired an acyclic blocker graph, and marked TB-001 and
  TB-003 as the initial `ready-for-agent` frontier.

Verification: `node --test tests/delivery-contracts.test.mjs`, full unit suite,
the SRS and Feature Contract auditors, and repository validation.
