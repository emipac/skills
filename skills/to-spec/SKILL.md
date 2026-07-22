---
name: to-spec
description: Turn the current conversation and SRS baseline into one traceable feature contract, then publish it to the configured tracker without reopening the interview.
---

# To Spec

Synthesize one cohesive feature slice. Do not interview the user again; use the
conversation, configured SRS, glossary, ADRs, and repository as established
inputs. Missing decisions become visible gaps and route back to
`/grill-with-docs` or `/srs-modeling` instead of being invented.

Read `.agent-framework.yaml` and the configured tracker document. Run
`/framework-setup` when configuration is missing. Read
[the feature contract](references/feature-contract.md) before drafting.

## Process

1. **Load durable intent.** Read the configured SRS and collect the in-scope FR,
   NFR, AC, SG, RISK, and Q IDs. Use glossary terms exactly and respect linked
   ADRs. Explore the repository to distinguish existing behavior from requested
   behavior.

   Completion criterion: every proposed behavior has an SRS source or is
   identified as a gap or deliberate scope addition.

2. **Bound one feature.** State the problem, user-visible outcome, actors,
   scenarios, and explicit non-goals. Keep the slice cohesive enough to
   decompose into tracer bullets; do not turn the feature contract into a
   project-wide SRS or implementation inventory.

   Completion criterion: every included behavior contributes to one outcome,
   and excluded adjacent behavior is named.

3. **Run the analysis matrix.** Inspect concept coverage, behavior and failure
   paths, acceptance coverage, authorization, safeguards, risk, dependencies,
   architecture boundaries, public test seams, implicit decisions, and scope
   additions. Record each finding in Risks, Gaps, and Assumptions with whether
   it blocks readiness.

   Completion criterion: every analysis dimension has evidence or a visible
   gap; no blocking row remains unresolved.

4. **Choose public seams.** Prefer existing seams and the highest practical
   boundary. Propose the smallest set that proves all acceptance criteria and
   confirm it with the user. Record prior-art tests and observable outcomes, not
   private methods or file plans.

   Completion criterion: every acceptance ID maps to an agreed evidence seam.

5. **Draft and gate.** Use
   [the feature-spec template](references/feature-spec-template.md). Preserve
   SRS IDs rather than creating replacement requirements. Run the auditor when
   working from local Markdown:

   ```bash
   node <skill-directory>/scripts/audit-feature-spec.mjs <spec-path> \
     --srs <configured-srs-path> --json
   ```

   Apply the same gate to tracker-native drafts. Status is
   `ready-for-tickets` only when traceability resolves, seams are agreed,
   safeguards and non-goals are explicit, and no blocking gap remains.

6. **Publish.** Publish the approved feature contract through the configured
   tracker adapter. It is a parent planning artifact, not an implementation
   issue: do not label it `ready-for-agent`. Preserve the contract status in
   its body and report the tracker URL.

   Completion criterion: one published feature contract contains every section
   and passes the readiness gate without unresolved placeholders.

## Guardrails

- Keep file paths, class inventories, method scripts, annotations, and code out
  of the contract; a decision-rich prototype snippet is the narrow exception.
- Record externally meaningful scope additions in the SRS through
  `/srs-modeling` before marking the feature ready.
- Use safeguards as negative-space constraints, not generic implementation
  advice.
- Preserve existing `AGENTS.md` files exactly.
