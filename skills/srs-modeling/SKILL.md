---
name: srs-modeling
description: Create, refine, or audit a comprehensive Software Requirements Specification. Use when a project needs a durable SRS baseline, requirements must be updated without rewriting unrelated sections, or traceability and acceptance coverage need review.
---

# SRS Modeling

Maintain the SRS as the canonical statement of intended system behavior and
constraints. Code is implementation truth; the SRS is not a mirror of code.

Read `.agent-framework.yaml`. If it is missing, run `/framework-setup`. Load the
configured SRS, glossary, ADR paths, project guidelines, and protected files.
Read [the SRS contract](references/srs-contract.md) before changing an SRS.
If the configured SRS path is explicitly `null`, stop and use
`/framework-setup` to confirm a path before creation or refinement.

Choose exactly one mode from the user's request and current repository state.

## Create

Use when the configured SRS does not exist or the user requests a new baseline.

1. Read [the template](references/srs-template.md). Explore existing product
   documentation and code before asking questions; repository facts are
   discovered, not interviewed.
2. Run `/grilling` with `/domain-modeling`, one decision at a time. Start with
   purpose, scope, actors, and boundaries, then walk capabilities, safeguards,
   quality attributes, risks, and acceptance evidence.
3. Record each accepted decision immediately:
   - intended behavior, constraints, risks, and acceptance criteria → SRS;
   - implementation-independent terminology → configured glossary;
   - durable architectural rationale → ADR.
4. Represent unknowns as stable `Q-NNN` rows. Never invent an answer or hide an
   unresolved dependency in prose.
5. Allocate stable IDs under the contract. Write the SRS at the configured path
   with status `Draft`; never modify a protected file.
6. Run the deterministic audit, then perform the semantic audit below. Continue
   until every known decision is recorded and every unknown is visible.

Creation is complete when the document has every contract section, all known
requirements are acceptance-covered, unresolved questions are explicit, and
the audit has no errors. Open-question warnings may remain while status is
`Draft` or `Review`.

## Refine

Use when an SRS already exists and requirements or decisions changed.

1. Run the deterministic audit to establish the starting state.
2. Name the refinement boundary: affected requirement, safeguard, risk,
   question, and acceptance IDs. Identify sections that must remain untouched.
3. Resolve factual gaps from the repository. Use `/grilling` and
   `/domain-modeling` only for decisions requiring the user.
4. Edit surgically. Preserve unrelated wording, ordering, IDs, and status. Never
   renumber or reuse an ID; retire or supersede it according to the contract.
5. Update both directions of affected traceability: requirements to acceptance
   criteria and safeguards to the requirements they protect.
6. Route accepted terminology and architectural rationale to their owning
   artifacts immediately. Link them from the SRS instead of duplicating them.
7. Run both audits. Report the exact IDs changed, retired, added, and left open.

Refinement is complete when every affected ID is internally consistent, every
unaffected section remains unchanged, and no new audit error exists.

## Audit

Use when the user asks whether an SRS is complete, consistent, or ready.

Run:

```bash
node <installed-skill-directory>/scripts/audit-srs.mjs <configured-srs-path> --json
```

The deterministic audit checks required sections, stable and duplicate IDs,
requirement references, acceptance coverage, safeguards, template placeholders,
and visible open questions. It never edits the SRS.

Then review semantics in this order:

1. **Ownership** — behavior is in the SRS, terms in the glossary, rationale in
   ADRs, and implementation detail in code or feature specs.
2. **Clarity** — each normative statement is singular, unambiguous, and uses
   canonical domain language.
3. **Coverage** — actors, happy paths, boundary cases, failure paths,
   authorization, lifecycle transitions, and non-functional measures are
   represented where applicable.
4. **Safeguards** — negative-space constraints state what must remain true and
   what happens on violation.
5. **Traceability** — every active requirement reaches at least one observable
   acceptance criterion; every reference resolves.
6. **Readiness** — blocking questions, unmitigated high risks, contradictions,
   and unverifiable criteria prevent `Approved` status.

Report findings by severity with the affected stable IDs. Distinguish mechanical
audit errors from semantic findings and open-question warnings. Audit is
complete only after every section and every active ID has been considered.

## Guardrails

- Treat existing `AGENTS.md` files as read-only inputs.
- Keep physical file, class, method, table, annotation, and framework-widget
  inventories out of the generic SRS unless they are externally contractual.
- Preserve sources and rationale by links; avoid copying the same decision into
  multiple artifacts.
- Promote status to `Approved` only when audits pass, acceptance coverage is
  complete, and no blocking question or unmitigated high risk remains.
