# To Spec

```bash
npx skills add emipac/skills --skill to-spec
```

[Source](https://github.com/emipac/skills/tree/main/skills/to-spec)

`to-spec` synthesizes one cohesive feature contract from the resolved
conversation and configured SRS. It does not reopen the interview or invent
missing decisions.

The contract carries:

- SRS requirement, acceptance, safeguard, risk, and question references;
- user outcomes and boundary scenarios;
- delivery-facing decisions and public evidence seams;
- safeguards, prohibited behavior, and non-goals;
- concept, behavior, authorization, dependency, architecture, and risk gaps;
- a verification strategy and binary `ready-for-tickets` gate.

Blocking gaps route back to `grill-with-docs` or `srs-modeling`. A parent
feature contract is not marked `ready-for-agent`; only its later delivery
contracts are implementable.

The bundled auditor checks local Markdown contracts for required sections, SRS
reference integrity, acceptance detail, blocking gaps, placeholders, and
readiness completion.

```text
grill-with-docs → srs-modeling → to-spec → to-tickets → implement
```
