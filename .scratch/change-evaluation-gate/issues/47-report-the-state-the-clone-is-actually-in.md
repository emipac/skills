# TB-047 — Report the state the clone is actually in

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 47-report-the-state-the-clone-is-actually-in
Draft key: TB-047

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

`gate status` reports the lifecycle state the clone is in. A clone with no Gate
policy is reported as installed, not configured, so a maintainer and an agent
reading that report are told the truth.

## SRS Traceability

- `FR-LIFE-009`, `FR-CFG-001`
- `AC-LIFE-004`, `AC-CFG-001`
- `SG-LIFE-001`, `SG-TRUST-001`
- `NFR-OPER-001`
- `RISK-004`

## Defect this contract fixes

Raised by an external audit and reproduced in this repository, whose
`.agent-framework.yaml` contains no `evaluation_gate` section at all:

```
$ grep -c evaluation_gate .agent-framework.yaml
0
$ node skills/change-evaluation-gate/scripts/gate.mjs status
state: configured
health: healthy
$ node skills/change-evaluation-gate/scripts/gate.mjs activate
change-evaluation-gate: .agent-framework.yaml declares no evaluation_gate
section, so this clone has no Gate policy to enforce.
```

Two commands on the same surface give opposite answers about the same clone.
`activate` is right and `status` is wrong.

Verified: `statusGate` decides the lifecycle state from one fact — whether an
Activation receipt exists. It never opens `.agent-framework.yaml` and never
looks for an `evaluation_gate` section, so every clone without a receipt is
reported `configured` whether or not it holds any policy.

`AC-CFG-001` states the rule this breaks: an absent `evaluation_gate` means
**not configured**. `FR-CFG-001` says the same. The state machine the whole
skill is organised around — installed, configured, activated — has three states
and `statusGate` can only ever report two of them.

This is worse than a mislabel because of what the skill instructs. `SKILL.md`
tells an agent: *"When reporting on a clone the surface observed, report the
state that surface found … and never infer a state the surface did not report."*
An agent doing exactly as told will tell a maintainer their repository is
configured when it holds no policy. The instruction is correct; the surface
under it is not.

Verified: the authoritative runner and the activation command both resolve the
configuration and both refuse correctly with a policy-missing reason. Only
`status` skips that step. The codebase warns against exactly this in its own
comments — a second answer waiting to disagree with the first — and this is one.

## Domain Concepts

Lifecycle state, Gate policy section, Activation receipt, Health, Observation.

## Approach and Tradeoffs

Verified: `resolveConfiguration` is already what both runners and the activation
command use to answer the same question, and the operator surface already calls
it for other commands. There is an existing answer to "does this clone hold a
policy"; `statusGate` is the one caller that does not ask.

Proposed — have status ask the same question the runner asks. The implementer
establishes how `statusGate` receives that answer without `lifecycle.mjs`
growing its own configuration reader, so there is one definition of "configured"
rather than a second one that can disagree.

Proposed — three states, reported distinctly. A clone with no policy is
`installed`; a clone with policy and no receipt is `configured`; a clone with a
receipt is `activated`. The implementer confirms every existing consumer of the
reported state tolerates the third value, and states what it found.

Proposed — health is not the same question as state. An unconfigured clone is
not unhealthy: there is nothing to enforce and nothing to reconcile, which is a
correct and untroubled condition. The implementer decides what health an
installed clone reports and says why, rather than making `broken` mean "not set
up".

Proposed — keep the finding, fix the state. The existing `activation-absent`
finding is informational and correct; an unconfigured clone should say what is
missing in terms a maintainer can act on, which is the policy rather than the
receipt.

Deliberately not a change to what `activate`, the runners, or any other command
already report. They are right today. Deliberately not a repair, a prompt, or a
suggestion to configure — observation stays observation.

## Architecture Boundary and Public Seam

The boundary is between the state a clone is in and the state the observation
surface reports. The public seam is `statusGate`'s state determination and the
document the operator surface renders from it.

First red test: `gate status` on a clone whose configuration holds no
`evaluation_gate` section reports a state that is not `configured`, where today
it reports `configured` and `healthy`.

## Safeguards and Invariants

- `SG-LIFE-001`: observation still writes nothing, repairs nothing, and records
  no Lifecycle event. The clone and its Evidence store stay byte-for-byte
  unchanged, directories included.
- `SG-TRUST-001`: the report still states the local trust boundary and claims
  nothing it did not establish.
- `FR-LIFE-009`: `healthy`, `degraded`, and `broken` keep their meanings for an
  activated clone, and drift is still never repaired automatically.
- `AC-CFG-001`: absent `evaluation_gate` means not configured, everywhere that
  question is answered.
- `NFR-OPER-001`: the report names what is missing well enough to act on without
  reading another file.
- The evaluation runtime is untouched.

## Prohibited Behavior and Non-goals

Do not let `statusGate` grow its own configuration reader. Do not change what
`activate`, the runners, or any other lifecycle command report. Do not repair,
prompt, suggest, or write anything from an observation. Do not change the
`healthy`/`degraded`/`broken` meanings for an activated clone. Do not make an
unconfigured clone report `broken` merely for being unconfigured. Do not change
the schema, the policy shape, or what counts as a valid `evaluation_gate`
section.

## Risk and Decision Impacts

- `RISK-004`: an observation surface exists so drift and loss are visible. One
  that misreports the base state undermines the disposition that made reporting
  the accepted mitigation.
- No authorization changes. Nothing here alters a decision, an outcome, or what
  a commit may do.

## Acceptance Criteria

- [ ] `AC-CFG-001`, `FR-CFG-001`: `gate status` on a clone whose configuration
  holds no `evaluation_gate` section reports a state distinct from `configured`,
  and names the missing policy rather than the missing receipt.
- [ ] A clone holding a policy and no receipt still reports `configured`, and an
  activated clone still reports `activated`.
- [ ] `FR-LIFE-009`, `AC-LIFE-004`: an activated clone's `healthy`, `degraded`,
  and `broken` reporting is unchanged, proved against the existing drift
  fixtures.
- [ ] `SG-LIFE-001`: every one of those runs leaves the clone and its Evidence
  store byte-for-byte unchanged, directories included.
- [ ] `gate status` and `gate activate` agree about whether a clone holds a
  policy, proved by a fixture that runs both against the same clone.
- [ ] `--json` and the human rendering report the same state from the same run.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CFG-001`, `AC-LIFE-004`: no-policy, policy-without-receipt, activated, and status-agrees-with-activate fixtures against the real surface | `npm run test:unit` | Yes — the unit suite owns the lifecycle library and the operator surface |
| smoke | both | `FR-LIFE-009`: a real clone observed through the packaged command before and after its policy is configured reports two different states, and writes nothing either time | `gate-lifecycle-smoke`, extended by this slice | Yes — that capability already drives real clones through the packaged command |

Frontend build and browser evidence are inapplicable; this slice changes local
observation.

## Blocked By

None.

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

## Why existing coverage missed this

Every status fixture configures a policy before observing, because a fixture is
built to exercise the health reporting that only an activated or configured
clone has. The unconfigured clone is the state no fixture starts from, so the
one branch that cannot distinguish it has never been reached. `TB-040`'s own
acceptance criteria asked for `healthy`, `degraded`, and `broken` and never
asked which lifecycle state the surface names.
