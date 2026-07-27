# Estimation model

## Unit and basis

A person-day, also called a man-day or manday in customer terminology, is one
focused professional contributor day. Estimate the actual
AI-assisted, human-in-the-loop workflow rather than estimating conventionally
and applying a generic discount.

Assume AI accelerates repository exploration, scaffolding, test drafting,
refactoring, documentation, and routine analysis. Retain human accountability
for requirements interpretation, architecture, review, security, integration,
manual validation, stakeholder coordination, and release acceptance.

Include automated tests, code review, static analysis, linting, and focused smoke
verification in the delivery task. Show project management and manual testing as
separate tasks in every phase so customers can see the complete effort.

## Complexity anchors

Size the primary delivery task before support tasks:

| Complexity | Delivery effort | Typical evidence |
| --- | ---: | --- |
| Routine | 0.5–1.0 MD | Established pattern, narrow change, no new boundary |
| Moderate | 1.0–1.5 MD | One vertical outcome, known stack, limited branching or data impact |
| Complex | 2.0–3.0 MD minimum | New integration or boundary, authorization, migration, concurrency, material failure paths, or broad regression surface |
| High uncertainty | Split; add a 1.0–2.0 MD spike | Unproven external system, legacy behavior, ambiguous data, or performance/security research |

Treat one moderate implementation phase as roughly one delivery person-day.
Budget at least two to three delivery person-days for a complex phase. Split a
phase before estimating when its primary implementation task would exceed three
person-days. Use a time-boxed discovery spike when evidence is missing rather
than disguising uncertainty as precision. Exceed the cap only for a genuinely
indivisible cutover or integration and document why it cannot be split.

## Per-phase support tasks

Use these starting ranges, then adjust to actual coordination and regression
surface:

| Task | Moderate phase | Complex phase | Includes |
| --- | ---: | ---: | --- |
| Project management | 0.1–0.25 MD | 0.25–0.5 MD | Refinement, dependency coordination, progress reporting, acceptance coordination |
| Manual testing | 0.15–0.35 MD | 0.35–0.75 MD | Test preparation, exploratory checks, regression checks, evidence, defect retest |

Add customer UAT effort only when the estimate is meant to include customer
labor. Otherwise include engineering support for UAT and state customer effort
as an external dependency.

## Range construction

Build the minimum from the understood happy path plus required quality work.
Build the maximum from plausible named exposures such as:

- unclear acceptance behavior or incomplete source traceability;
- unfamiliar or unstable third-party APIs;
- legacy coupling, poor tests, or data-quality uncertainty;
- permissions, privacy, security, performance, or compliance constraints;
- migration, rollback, deployment, or multi-environment complexity;
- stakeholder response time or external approval gates.

Name the relevant exposure in the row's Risks cell. Do not add the same risk
again as a project contingency. If a risk is too large to bound credibly, make
resolution a discovery phase and mark downstream figures provisional.

## Arithmetic and schedule

Round rows consistently, normally to 0.25 MD, and totals to 0.5 MD. Sum row
minimums and maximums without averaging them. Reconcile phase, milestone, and
project totals.

Before summing, reject any primary implementation row above 3.0 MD unless its
description and Risks cell document the indivisible exception. Return oversized
feature buckets to phase decomposition.

Derive elapsed working days separately:

1. identify the dependency graph and critical path;
2. assign realistic people or roles to safe parallel lanes;
3. apply actual availability and review handoffs;
4. include external waiting time separately from person-day effort;
5. give an elapsed range and state the staffing assumption.

Avoid false parallelism: the same human cannot perform simultaneous work, and
AI concurrency still requires human review and integration capacity.
