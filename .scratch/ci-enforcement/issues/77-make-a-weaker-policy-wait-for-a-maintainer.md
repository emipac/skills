# TB-077 — Make a weaker policy wait for a maintainer

Status: ready-for-agent
Parent: ci-enforcement-feature-spec
Assignee:
Labels: ready-for-agent, enhancement
Blocked by: 76-judge-a-pull-request-under-the-base-branchs-rules
Tracker ID: 77-make-a-weaker-policy-wait-for-a-maintainer
Draft key: TB-077

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/ci-enforcement/issues/ci-enforcement-feature-spec.md`

## Outcome

A pull request that changes the Gate policy is still judged under the base
branch's policy. If the new policy is weaker, for example a required check
demoted or removed, `gate ci` fails and names the weakening. The workflow
passes in whether a maintainer has applied the approval label. With that
approval, the change is evaluated on its merits and the approval is recorded in
Evidence. A stricter or neutral policy change needs no approval.

## SRS Traceability

- `FR-CI-003`
- `AC-CI-002`
- `SG-CI-001`, `SG-CFG-001`
- `RISK-008`

## Domain Concepts

Trusted gate configuration, Candidate, Grader surface.

## Approach and Tradeoffs

- Verified: `evaluatePolicyTransition` and `policyWeakenings` in
  `security-control.mjs` judge whether a candidate is weaker. Today they flag a
  demoted or removed required check, and `gate sync` uses them.
- Proposed: `gate ci` validates the head's policy as a candidate and runs the
  same judgement against the base policy. An approval input names the
  weakening it approves, so an approval for one weakening cannot cover
  another. The input is something like `--approved-weakening` or an
  environment variable the workflow sets from the label. The implementer
  chooses its form and states it.
- Proposed: an invalid candidate policy fails with the validator's own reason.

## Architecture Boundary and Public Seam

`gate ci` on policy-changing fixtures. First red test: a head that demotes a
required check fails naming `required-check-demoted`. Before this slice it was
judged only under the base policy and never named the weakening.

## Safeguards and Invariants

- `SG-CI-001`: approval never changes which policy judges the code; the base
  policy still does.
- `SG-CFG-001`: a weaker candidate is never accepted without an approval that
  names it.

## Prohibited Behavior and Non-goals

- No broadening of what counts as weaker.
- No reading of GitHub labels from inside the Gate; the workflow supplies the
  approval.

## Risk and Decision Impacts

- `RISK-008`: mitigated here.

## Acceptance Criteria

- [ ] `AC-CI-002`: a demoting head fails, naming the weakening. With approval
  for exactly that weakening it passes, and Evidence records the approval. An
  approval naming a different weakening does not help. A stricter head needs
  no approval. An invalid candidate fails with the validator's reason.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CI-002`, `SG-CI-001`, `SG-CFG-001`: demote, remove, approved, wrongly-approved, stricter, and invalid fixtures | `npm run test:unit` | Yes — observable at the command |
| smoke | both | `SG-CFG-001`: on a real clone, a weakening head fails and passes with the approval | `gate-security-control-smoke`, extended by this slice | Yes — the security-relevant path |

Frontend build and browser evidence are inapplicable.

## Blocked By

- `TB-076` — `gate ci` itself.

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
