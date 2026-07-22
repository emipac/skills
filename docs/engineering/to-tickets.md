# To Tickets

```bash
npx skills add emipac/skills --skill to-tickets
```

[Source](https://github.com/emipac/skills/tree/main/skills/to-tickets)

`to-tickets` decomposes one `ready-for-tickets` feature contract into an
acyclic graph of vertical tracer-bullet delivery contracts.

Every ready contract includes:

- one complete, independently verifiable outcome sized for a fresh context;
- SRS requirement, acceptance, and safeguard traceability;
- canonical domain concepts and architecture boundary;
- an agreed public seam and describable first red test;
- safeguards, invariants, prohibited behavior, and non-goals;
- acceptance criteria and a configured verification matrix;
- explicit blockers and unresolved assumptions;
- a checked `ready-for-agent` gate.

The upstream wide-refactor exception remains: mechanical blast-radius changes
use expand–migrate–contract rather than artificial user-facing slices.

Local Markdown contracts can be checked with the bundled auditor, which
detects missing fields, references outside the feature contract, unresolved
start-blocking assumptions, unknown blockers, self-blockers, and cycles. Real
trackers use the same body gate plus native blocker relationships.

```text
feature contract → delivery contracts → blocker frontier → implement
```
