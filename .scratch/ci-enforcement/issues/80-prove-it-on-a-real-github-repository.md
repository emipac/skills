# TB-080 — Prove it on a real GitHub repository

Status: ready-for-agent
Parent: ci-enforcement-feature-spec
Assignee:
Labels: ready-for-agent, enhancement
Blocked by: 77-make-a-weaker-policy-wait-for-a-maintainer, 79-write-the-github-workflow-in-one-confirmed-step
Tracker ID: 80-prove-it-on-a-real-github-repository
Draft key: TB-080

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/ci-enforcement/issues/ci-enforcement-feature-spec.md`

## Outcome

The generated workflow is observed working on a real GitHub repository, and
the result is recorded in this repository:

- a passing pull request goes green;
- a failing one goes red with the check's reason;
- a weakening one goes red until the maintainer label is applied.

The framework guide gains a short, junior-friendly "Turning on CI enforcement"
section that walks through these steps in order: run the command, create the
secrets and the label, and mark the check required.

## SRS Traceability

- `FR-CI-006`
- `AC-CI-004`
- `SG-CI-002`
- `RISK-013`

## Domain Concepts

Framework command, Gate release.

## Approach and Tradeoffs

- Proposed: an agent prepares a disposable repository and the exact steps, as
  with the Cursor observation. The maintainer runs the pull requests on GitHub
  and pastes back the results and the workflow logs. The agent records them in
  `.scratch/ci-enforcement/github-actions-observation.md`, with personal data
  removed.
- If the real run disagrees with the fixtures, record the difference, fix it in
  this slice if it is small, and otherwise stop and report.

## Architecture Boundary and Public Seam

The generated workflow on GitHub Actions. First red test: before this slice no
observation exists, and the guide has no CI section.

## Safeguards and Invariants

- `SG-CI-002`: the recorded logs contain no secret value; check them before
  committing.

## Prohibited Behavior and Non-goals

- No change to the maintainer's real repositories; the observation uses a
  disposable one.

## Risk and Decision Impacts

- `RISK-013`: the observation is the mitigation's proof.

## Acceptance Criteria

- [ ] `AC-CI-004` (real half): the observation records a green, a red, and a
  weakening-then-approved pull request, together with the framework release
  and the date.
- [ ] The guide's CI section exists, matches what was observed, and links from
  Section 04's quick start.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CI-004`: the recorded real-repository observation and the guide section that links to it | `npm run validate` | Yes — the guide and records must validate |

Unit and smoke evidence are inapplicable: the behavior is proved by the real run
recorded here. Frontend build and browser evidence are inapplicable.

## Blocked By

- `TB-077` — the weakening path to observe.
- `TB-079` — the workflow to observe.

## Unresolved Assumptions

None.

## Readiness

- [x] The outcome is a complete vertical behavior.
- [x] Acceptance criteria trace to the SRS and feature contract.
- [x] The public seam and first red test are identified.
- [x] Safeguards and non-goals are explicit.
- [x] Risks and resolved decisions are traced to the parent contract.
- [x] Blocking edges exist and are acyclic.
- [x] No unresolved assumption blocks the start.
- [x] The ticket fits one fresh implementation context.
- [x] User-facing and frontend evidence requirements are covered or explicitly inapplicable.
