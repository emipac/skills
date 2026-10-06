# TB-078 — Trust only the pinned Gate, and nothing left behind

Status: ready-for-agent
Parent: ci-enforcement-feature-spec
Assignee:
Labels: ready-for-agent, enhancement
Blocked by: 76-judge-a-pull-request-under-the-base-branchs-rules
Tracker ID: 78-trust-only-the-pinned-gate-and-nothing-left-behind
Draft key: TB-078

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/ci-enforcement/issues/ci-enforcement-feature-spec.md`

## Outcome

`gate ci` refuses to judge with the wrong Gate. When it is told which framework
release the project expects and a different release is running, it returns
`unverified` and names both releases. It also never honors a bypass grant,
never writes a secret value to output or Evidence, and never changes the
checkout it evaluates.

## SRS Traceability

- `FR-CI-005`
- `AC-CI-003`
- `SG-CI-002`, `SG-SECRET-001`
- `RISK-006`

## Domain Concepts

Gate release, bypass grant, Sensitive runtime input, Evidence envelope.

## Approach and Tradeoffs

- Verified: declared Sensitive runtime inputs resolve from the environment
  first, and redaction is armed before the first Evidence write (TB-045,
  TB-059).
- Proposed: an expected-release input, for example `--expect-release VERSION`,
  is compared with the running Gate's own release. A missing input is a
  could-not-run usage error, because CI must always pin.
- Proposed: a grant file present in the checkout or the Evidence store is
  ignored, and the decision says it was ignored.

## Architecture Boundary and Public Seam

`gate ci` on fixtures. First red test: `--expect-release` naming another
release returns `unverified` with both releases named.

## Safeguards and Invariants

- `SG-CI-002`: no bypass is honored, no secret value appears anywhere, and the
  checkout's bytes are unchanged.
- `SG-SECRET-001`: redaction holds for the values CI supplies.

## Prohibited Behavior and Non-goals

- No automatic install or upgrade of the Gate.

## Risk and Decision Impacts

- `RISK-006`: covered by the canary assertion.

## Acceptance Criteria

- [ ] `AC-CI-003`: a mismatched release is `unverified`; a missing
  expected-release input is "could not run"; a bypass grant in the checkout is
  ignored and reported as ignored; a secret canary from the environment appears
  in no output or Evidence; the checkout's bytes are unchanged.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CI-003`, `SG-CI-002`, `SG-SECRET-001`: mismatch, missing pin, grant, canary, and unchanged-checkout fixtures | `npm run test:unit` | Yes — observable at the command |

Smoke evidence is inapplicable: TB-076's smoke covers the real clone, and these
checks are fully observable on fixtures. Frontend build and browser evidence
are inapplicable.

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
