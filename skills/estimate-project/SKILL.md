---
name: estimate-project
description: Produce professional, implementation-phase-driven project estimates in minimum and maximum person-days (man-days or mandays) from a comprehensive PRD or SRS. Use for customer proposals, delivery budgets, milestone roadmaps, or AI-assisted human-in-the-loop effort forecasts that must include engineering, project management, manual testing, dependencies, assumptions, and risks.
---

# Estimate Project

Create a customer-ready estimate as an experienced tech lead. Build the estimate
from independently verifiable implementation phases, not from a feature list or
a generic percentage uplift.

Read [the estimation model](references/estimation-model.md) before sizing. Read
[the dependency model](references/dependency-model.md) whenever third-party
services or client-provided inputs are involved. Read
[the document template](references/estimate-template.md) before drafting the
deliverable.

## Process

1. **Establish the basis.** Read the complete PRD or SRS, linked artifacts, and
   relevant repository context. Extract scope, acceptance criteria, non-functional
   requirements, integrations, data migration, deployment, dependencies,
   exclusions, and unresolved decisions. Ask only about missing decisions that
   would materially change scope or architecture; otherwise state conservative
   assumptions.

   Assign stable IDs to every third-party dependency and client-provided input.
   When details are missing, estimate against the simplest credible best-case
   scenario and state it explicitly. Record the evidence still needed, owner,
   due date when known, affected phases, estimate effect, risk, and the condition
   that triggers re-estimation.

   Completion criterion: every estimated outcome traces to source scope, and
   every material unknown is an assumption, dependency, exclusion, or risk.
   Every integration and client input has a stable ID and a visible disposition.

2. **Define the delivery model.** State that estimates assume senior engineering
   work is AI-assisted with a human accountable for architecture, generated-code
   review, automated verification, security, and acceptance. Define one person-day
   as one focused contributor day. Treat effort and elapsed calendar duration as
   different measures.

   Completion criterion: productivity assumptions, team shape, working-day
   convention, and included delivery activities are explicit.

3. **Decompose into vertical phases.** Create the smallest independently
   demonstrable phases that deliver behavior through all affected layers. Reuse
   tracer-bullet decomposition principles. Invoke `$to-tickets` only when ready
   feature contracts exist and the user explicitly wants tracker tickets;
   otherwise keep decomposition inside the estimate.

   Include implementation and automated verification in each delivery task.
   Add explicit project-management and manual-testing tasks to every phase. Add
   discovery, design, migration, infrastructure, security, documentation,
   deployment, training, or UAT support only when the source scope requires them.

   Cap the primary implementation task at three person-days. Split broader
   features into multiple end-to-end phases before sizing. Permit a larger row
   only for a genuinely indivisible cutover or integration and identify the
   reason, evidence, and risk in the estimate.

   Completion criterion: every in-scope requirement is covered, no work is
   counted twice, each phase has an observable exit condition, and no primary
   implementation row exceeds three person-days without a documented exception.

4. **Size each phase.** Apply the estimation model to the delivery task first,
   then add project management and manual testing as visible rows. Use minimum
   and maximum person-days; let the maximum absorb named row-level risk. Split
   implementation work that exceeds a credible focused phase unless an explicit
   spike or indivisible integration justifies it.

   Completion criterion: moderate delivery tasks receive about one person-day,
   complex tasks receive at least two to three person-days, and every range has
   evidence in scope, complexity, or risk. Any phase above the sizing cap returns
   to decomposition before the document is drafted.

5. **Build milestones and roadmap.** Group larger projects into customer-visible
   milestones with exit criteria. Order phases by dependencies and identify safe
   parallel lanes. Derive elapsed duration from staffing, dependencies, review
   gates, and stakeholder availability rather than equating total person-days to
   calendar days.

   Completion criterion: the roadmap has a feasible critical path, milestone
   totals reconcile with phase totals, and no parallelism assumption is hidden.

6. **Write and audit the estimate.** Use the document template and required task
   table columns exactly. Sum row ranges into phase, milestone, and project totals.
   Check traceability, arithmetic, missing cross-cutting work, duplicated effort,
   optimistic AI assumptions, dependency coverage, risk treatment, and
   consistency between tables. Confirm every dependency ID is referenced by its
   affected phase or explicitly marked as project-wide.
   Write to the requested path and format; when none is requested, return a
   complete Markdown document without modifying the project.

   Completion criterion: a customer can understand what is included, how effort
   was derived, what may change it, and what each milestone delivers.

## Guardrails

- Present ranges as estimates, not commitments or guarantees.
- Keep implementation phases outcome-oriented; avoid horizontal frontend,
  backend, database, and testing phases unless they independently deliver value.
- Bake AI assistance into task sizing; never apply an unexplained productivity
  discount to a conventional estimate.
- Keep project management and manual testing visible for every phase.
- Reject oversized feature buckets disguised as phases; decompose them until
  the implementation row is normally one day for moderate work or two to three
  days for complex work.
- Use named row-level risks instead of a hidden blanket contingency. Add a
  separate reserve only for a specific unresolved exposure and explain it.
- Keep missing third-party or client details visible. A best-case assumption is
  an estimating basis, not a claim that the dependency is confirmed.
- Preserve source requirement identifiers where available.
- Distinguish person-days, team capacity, and elapsed working days throughout.
