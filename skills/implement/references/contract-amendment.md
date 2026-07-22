# Contract amendment

Use this record only when implementation learning would change durable intent
or a delivery constraint.

```markdown
## Proposed contract amendment

**Status:** proposed
**Decision owner:** <User or authorized owner>
**Affected IDs:** <SRS, AC, SG, feature, ticket, or ADR references>

### Observed conflict

<What the implementation revealed and the evidence.>

### Proposed delta

<Exact before/after behavioral or boundary change.>

### Rationale and alternatives

<Why the delta is needed, alternatives considered, and tradeoffs.>

### Risk and evidence impact

<Safeguards, non-goals, tests, verification, and compatibility affected.>

### Decision

<Accepted, rejected, or deferred; owner and timestamp.>
```

Accepted amendments update the owning artifact before implementation resumes.
Private file, method, class, or annotation choices stay in code and do not need
an amendment.
