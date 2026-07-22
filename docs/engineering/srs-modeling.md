# SRS Modeling

```bash
npx skills add emipac/skills --skill srs-modeling
```

[Source](https://github.com/emipac/skills/tree/main/skills/srs-modeling)

`srs-modeling` creates, surgically refines, and audits the configured Software
Requirements Specification. It extracts the durable structure of the Oldwood
SRS without carrying over volatile physical schemas, framework UI inventories,
or method-level design.

The skill uses stable requirement, acceptance, safeguard, risk, and question
IDs. Its deterministic audit reports duplicate IDs, broken references, missing
acceptance coverage, unresolved placeholders, and visible open questions; a
semantic pass then reviews clarity, ownership, safeguards, and readiness.
