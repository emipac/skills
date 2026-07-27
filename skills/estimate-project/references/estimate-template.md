# Customer project estimate template

Use this structure unless the user supplies a required format. Keep the tone
commercially clear, technically defensible, and free of internal implementation
jargon.

## 1. Executive summary

- Project and intended business outcome
- Estimated total: **<minimum>–<maximum> person-days**
- Estimated elapsed delivery: **<minimum>–<maximum> working days/weeks** with
  **<staffing assumption>**
- Number of phases and milestones
- Confidence level and the two or three largest estimate drivers

## 2. Estimation basis

State source documents and versions, scope cut-off date, person-day definition,
AI-assisted human-in-the-loop assumption, team shape, quality activities, and
whether customer UAT effort is included.

## 3. Scope, assumptions, and exclusions

List in-scope outcomes with source requirement IDs where available. Separate:

- assumptions used to estimate;
- explicit exclusions;
- customer or third-party dependencies;
- open decisions that make downstream estimates provisional.

### Dependency and client-input register

Use stable IDs and reference them from affected implementation phases and risks:

| ID | Type | Dependency or required input | Status | Best-case estimating assumption | Evidence or details needed | Owner / due date | Affected phases | Estimate effect and re-estimation trigger |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DEP-001 | Third-party service | <Service/capability> | Unconfirmed | <e.g. documented REST/JSON API, OAuth 2.0, sandbox available> | <Protocol, API docs, auth, samples, limits, SLA> | <Client/vendor role and date> | <Phase IDs> | <Risk to maximum; evidence/event requiring re-estimation> |
| INPUT-001 | Client input | <Data/files/rules/decision> | Pending | <Usable representative sample in agreed format> | <Sample, dictionary, volume, quality, mappings> | <Client role and date> | <Phase IDs> | <Risk to effort or elapsed time; re-estimation trigger> |

Allowed statuses are `Confirmed`, `Unconfirmed`, `Pending`, and `Blocked`.
Never present a best-case assumption as confirmed dependency behavior.

## 4. Implementation phases

Create one subsection per phase. State the outcome, source requirements,
dependency/input IDs, and exit criteria, followed by this exact table shape:

| Feature | Task name | Description | Estimated min man-days | Estimated max man-days | Risks |
| --- | --- | --- | ---: | ---: | --- |
| <Feature/outcome> | Implementation and automated verification | <Vertical behavior and observable completion> | <MD> | <MD> | <Named risks or None> |
| <Feature/outcome> | Project management | <Refinement, coordination, reporting, acceptance> | <MD> | <MD> | <Named risks or None> |
| <Feature/outcome> | Manual testing | <Exploratory, regression, evidence, and retest scope> | <MD> | <MD> | <Named risks or None> |
| **Phase subtotal** |  |  | **<MD>** | **<MD>** |  |

Add rows for discovery, architecture, migration, infrastructure, security,
deployment, documentation, training, or UAT support only when required. Keep PM
and manual testing as explicit rows in every phase. Keep the primary
implementation row at or below 3.0 person-days; split the phase or document the
rare indivisible exception before continuing.

## 5. Milestones

For a project with more than five phases, more than roughly ten person-days, or
multiple independently releasable outcomes, group phases into milestones:

| Milestone | Included phases | Customer-visible exit criteria | Dependencies | Min person-days | Max person-days |
| --- | --- | --- | --- | ---: | ---: |
| <Name> | <Phase IDs> | <Demonstrable or releasable outcome> | <Prior milestone/external dependency> | <MD> | <MD> |

Milestone totals must equal the included phase totals.

## 6. Delivery roadmap

| Roadmap window | Phases or milestone | Delivery focus | Parallelism and staffing | Exit gate |
| --- | --- | --- | --- | --- |
| <Week/day range> | <IDs> | <Outcome> | <People/roles and safe parallel lanes> | <Acceptance gate> |

Explain the critical path, external wait states, release gates, and why elapsed
duration differs from total person-days. Include required-by dates for client
inputs and third-party access where delay would move a milestone.

## 7. Risk register

| Risk | Probability | Impact | Estimate effect | Mitigation or decision needed | Owner |
| --- | --- | --- | --- | --- | --- |
| <Named exposure> | <Low/Medium/High> | <Low/Medium/High> | <Affected phase or range> | <Action> | <Role> |

Do not repeat every row risk. Promote only project-level or cross-phase risks.

## 8. Summary

| Scope | Min person-days | Max person-days |
| --- | ---: | ---: |
| Engineering delivery and automated verification | <MD> | <MD> |
| Project management | <MD> | <MD> |
| Manual testing and QA | <MD> | <MD> |
| Other explicitly included work | <MD> | <MD> |
| **Project total** | **<MD>** | **<MD>** |

Close with milestone totals, estimated elapsed duration, staffing assumption,
confidence, exclusions, customer responsibilities, and the events that require
re-estimation. List unresolved dependency IDs that keep figures provisional.
State that the range is a planning estimate rather than a fixed commercial
commitment unless a separate contract says otherwise.
