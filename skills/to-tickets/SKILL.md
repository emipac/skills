---
name: to-tickets
description: Break a ready feature contract into independently verifiable tracer-bullet delivery contracts with explicit blocking edges and readiness gates, then publish them to the configured tracker.
---

# To Tickets

Transform one `ready-for-tickets` feature contract into a blocker graph of
vertical delivery contracts. Read `.agent-framework.yaml`, its tracker adapter,
the configured SRS, glossary, and relevant ADRs. Run `/framework-setup` when
configuration is missing.

Read [the delivery contract](references/delivery-contract.md) before drafting.

## Process

1. **Validate the parent.** Read the full feature contract and its source issue
   comments. Confirm status `ready-for-tickets`, resolve every SRS reference,
   and refuse decomposition while a blocking gap, undecided seam, or scope
   addition remains.

   Completion criterion: the parent is a closed decision surface; tickets need
   no product decisions to begin.

2. **Explore delivery boundaries.** Inspect the current codebase, existing
   public seams, configured verification commands, glossary, and ADRs. Identify
   optional prefactoring that makes the feature easy without changing behavior.

3. **Draft tracer bullets.** Each ticket cuts a narrow but complete path through
   every affected layer, is independently demoable or verifiable, and fits one
   fresh context. Preserve the upstream wide-refactor exception: use
   expand–migrate–contract when a mechanical blast radius cannot land as green
   vertical slices.

4. **Write delivery contracts.** Assign temporary draft keys `TB-NNN` and use
   [the template](references/delivery-contract.md#template). Every contract
   carries its SRS/AC/SG IDs, outcome, domain concepts, approach and tradeoffs,
   architecture boundary, public seam, safeguards, prohibited behavior,
   verification matrix, assumptions, and blockers.

5. **Wire the graph.** Add only genuine start-blocking edges. Create all tracker
   issues first when native identifiers are needed, then wire native blocking
   relationships in a second pass. The graph must be acyclic; its frontier is
   every open contract with all blockers complete.

6. **Run the readiness gate.** For local Markdown contracts run:

   ```bash
   node <skill-directory>/scripts/audit-ticket-contracts.mjs \
     <ticket-directory> --spec <feature-spec-path>
   ```

   Apply the same gate to tracker-native contracts. A ticket is
   `ready-for-agent` only when it is vertical, traceable, independently
   verifiable, sized for one context, has an agreed first red seam, has an
   explicit verification matrix, and has no unresolved start-blocking
   assumption.

7. **Confirm and publish.** Present titles, outcomes, blockers, and public seams
   as a numbered list. Ask the user to approve granularity and edges. Publish
   through the configured adapter in dependency order. After publication, the
   tracker issue ID is canonical; retain `TB-NNN` only as a readable mapping to
   the approved draft graph. Apply `ready-for-agent` only after the gate passes.
   Never modify or close the parent feature contract.

Completion criterion: every in-scope parent acceptance ID is covered by at
least one ready ticket, every ticket passes independently, and the graph has no
unknown edge or cycle.

## Guardrails

- Prefer vertical behavior over component-oriented Operations sequences.
- Keep file, class, method, annotation, and exhaustive schema inventories out
  of contracts; a decision-rich prototype excerpt is the narrow exception.
- Treat ticket contracts as constraints with room for TDD learning, not
  immutable generation scripts.
- Preserve every existing `AGENTS.md` exactly.
