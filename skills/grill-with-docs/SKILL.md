---
name: grill-with-docs
description: A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go.
---

Read `.agent-framework.yaml`; run `/framework-setup` if it is missing.

Run a `/grilling` session using `/domain-modeling`, one decision at a time.
Record each accepted decision immediately in its owning artifact:

- intended behavior, constraints, risks, or acceptance outcomes → use
  `/srs-modeling` to create or refine the configured SRS;
- implementation-independent terminology → configured domain glossary;
- durable architectural rationale → ADR.

Do not duplicate the same decision across artifacts. The SRS may link the
glossary or ADR that owns supporting language or rationale.
