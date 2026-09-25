# TB-064 — Say why, in the channel that asks for the change

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: done, defect
Blocked by:
Tracker ID: 64-say-why-in-the-channel-that-asks-for-the-change
Draft key: TB-064

**Status:** done

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

The desktop channel that tells an agent to go and change a project tells it
everything the decision knows about why — including that the Gate itself has
drifted, that a declared dependency root was never provided, and that this very
change edited the configuration doing the grading. An agent acting on preflight
feedback acts on the decision, not on a fragment of it.

## SRS Traceability

- `FR-ADAPT-005`, `FR-EVAL-009`, `FR-POL-003`
- `AC-ADAPT-002`, `AC-SEC-001`
- `SG-SUPPORT-001`, `SG-CFG-001`, `SG-TRUST-001`
- `NFR-OPER-001`, `NFR-SEC-004`
- `RISK-008`, `RISK-004`

## Defect this contract fixes

`NFR-OPER-001` requires a decision to expose "stable check identities,
attempts, reason codes, assertions, coverage gaps, **Grader surface changes**,
and evidence identity sufficient to diagnose a denial without reading
client-native logs."

The decision does. The channel does not.

### Verified, at `adapters.mjs:862-898`

`formatFeedback` composes exactly one sentence, by a three-way choice:

```js
if (view?.failure) {
  message = `Preflight (not a commit decision): unverified — ${view.failure.detail ?? …}.`;
} else if (failing.length > 0) {
  message = `Preflight (not a commit decision): ${failing.map(…).join('; ')}.`;
} else {
  message = `Preflight (not a commit decision): ${view?.outcome ?? 'unverified'}.`;
}
```

`view.presentation` carries `evaluationId`, `outcome`, `authorization`, and
`checks`. It carries no `diagnostics`, and `diagnostics` appears nowhere in
`adapters.mjs` or `preflight-runner.mjs`. So whenever at least one check is not
`passed`, the message is a list of failing check identities and **every
diagnostic the decision recorded is dropped**. When every check passes and a
diagnostic still made the evaluation `unverified`, the message is the single
word `unverified`.

### What that cost, on a real project

A maintainer activated a clone, an agent worked, and the preflight answered.
Across three turns the channel said, in full:

1. `Preflight (not a commit decision): unverified.`
2. `Preflight (not a commit decision): configuration.format.formatter: failed
   (grader-negative); …static-analysis.1: failed; …static-analysis.2: failed;
   …broad-tests.test: failed.`
3. `Preflight (not a commit decision): …static-analysis.1: failed
   (grader-negative).`

The decision behind the final state of that clone, read directly from the
runner, was:

| | |
| --- | --- |
| every check | `passed` |
| outcome | `unverified` |
| `integrity.controlSurfaceChanged` | `true` |
| diagnostic | `integrity-drift` — the `command-descriptors` surface |
| diagnostic ×3 | `dependency-root-unavailable` — three declared roots absent from the project |
| `integrity.changedGraderSurfaces` | `[{ kind: 'gate-configuration', path: '.agent-framework.yaml' }]` |

None of the six reached the agent or the maintainer. The agent, told only that
checks failed, worked the failures: it corrected two genuinely wrong check
descriptors, found and fixed a real test-pollution defect, and also annotated a
facade to satisfy a resolution that threw only because the snapshot lacked a
service's configuration — the environment fault the framework's own guidance
says not to answer by editing the project. Each turn it was told less than the
Gate knew. It never learned that its descriptor edits had drifted the control
surface, that a commit would now be denied, or that it had edited the
configuration that grades it.

### Why this is the serious shape of the defect

`FR-EVAL-009` and `RISK-008` exist because a change can weaken the surface
judging it. The Gate *detects* that, records it, and — on the one channel that
exists to prompt an agent into changing a project — says nothing about it. A
silent `changedGraderSurfaces` is visibility that does not reach a viewer.

`AC-SEC-001` requires control-surface drift to produce `broken` health and an
`unverified` authoritative result. It does. But the maintainer's own feedback
loop reported four failing checks and then one, which reads as progress, while
the clone was unverifiable throughout.

## Domain decisions this contract settles

**The channel reports the decision, not a summary of its checks.** Anything the
decision states as a reason a maintainer or agent must act on belongs in the
message: diagnostics with their reason codes, unprovided dependency roots,
control-surface drift, and changed Grader surfaces. The channel stays one
message; it stops being one clause.

**A changed Grader surface is always said, even when everything passed.** This
is the one fact whose whole purpose is to be seen by someone other than the
change's author. It is stated as observation and never as accusation —
`SG-CFG-001`: reporting a changed surface is visibility, never a malicious
classification.

**An `unverified` decision never reads as a clean or improving one.** A message
whose only content is a shrinking list of failing checks, while the outcome is
`unverified` for an unrelated reason, is the defect. The outcome is stated
whenever it is not `passed`.

**The channel stays a channel.** No adapter learns a new capability, no client
is named in Gate core (`SG-OWNER-001`), and nothing here changes what any
decision *is*. This slice changes only what a declared feedback channel is
handed and how it renders it.

## Domain Concepts

Feedback channel, Decision diagnostics, Reason code, Grader surface change,
Control-surface drift, Preflight presentation, Diagnosability.

## Approach and Tradeoffs

Verified: `formatFeedback({ adapterId, view })` renders from `view`, and
`view.presentation` is assembled by the preflight runner from the decision. The
seam is the presentation, not the adapter: widening what the presentation
carries widens every declared channel at once, with no adapter-specific
knowledge.

Verified: every fact this contract needs is already on the decision —
`diagnostics[].reasonCode` and `.detail`, `integrity.changedGraderSurfaces`,
`integrity.controlSurfaceChanged`, `outcome`, `authorization`. Nothing new is
computed; something already computed stops being discarded.

Proposed — carry diagnostics and Grader surface changes on the presentation,
and render them after the check summary in one message. The implementer
establishes the order and states it; the failing checks a maintainer can act on
directly should not be buried behind environment reasons, and environment
reasons must not be lost behind them.

Proposed — bound the message. A decision can carry many diagnostics, and one
channel is a single string an agent reads in a prompt. The implementer
establishes a cap, states it, and makes truncation explicit — never silent, and
never dropping the drift or the Grader surface, which are the two that change
what a reader should do next.

Proposed — keep a passing turn silent. `formatFeedback` already returns the
adapter's declared silence for `outcome === 'passed'` with no failure, and
`TB-039`'s reason for that is unchanged. A turn that is genuinely clean says
nothing; a turn that is `unverified` says why, even with no failing check.

Deliberately not changing any adapter declaration, feedback field, trust model,
blocking behaviour, or the non-authoritative role of preflight. Deliberately
not adding a second place a decision is explained; the evidence record and this
channel say the same thing because they are rendered from the same decision.

## Architecture Boundary and Public Seam

The boundary is between what a decision records and what the channel prompting
an agent is handed. The public seam is the preflight presentation and
`formatFeedback`'s rendering of it.

First red test: an evaluation whose checks all pass but whose control surface
drifted produces a channel message naming `integrity-drift` and the drifted
surface, where today it produces the single word `unverified`.

## Safeguards and Invariants

- `NFR-OPER-001`: every reason code on the decision is reachable from the
  channel message or named by an explicit, stated truncation.
- `FR-EVAL-009`, `RISK-008`, `SG-CFG-001`: a changed Grader surface is reported
  whenever one is recorded, as observation, with no classification of intent.
- `AC-SEC-001`, `NFR-SEC-004`: a drifted control surface is never rendered as a
  check-level result and never reads as progress.
- `FR-ADAPT-005`: trust, invocation, timeout, capability, and malformed-output
  failures keep reporting `unverified` exactly as they do today.
- `SG-SUPPORT-001`: no adapter's declared tier, capability, or channel changes.
- `SG-OWNER-001`: no client name enters Gate core.
- `SG-TRUST-001`: the channel describes; it resists nothing.
- A genuinely passing turn stays silent, byte-identical to today.

## Prohibited Behavior and Non-goals

Do not let preflight block, authorize, or change its non-authoritative role. Do
not add a feedback channel to an adapter that declares none, and do not change
any adapter's declared field or tier. Do not classify a changed Grader surface
as hostile, or infer intent from one. Do not emit an unbounded message. Do not
break a passing turn's silence. Do not change the decision itself — this slice
renders what is already there.

## Risk and Decision Impacts

- `RISK-008`: a Grader surface weakened by the change being evaluated. Detection
  without delivery is the risk in its quietest form; this closes the delivery.
- `RISK-004`: client behaviour differs. The message stays one declared field, so
  a client that renders it at all renders this.
- No disposition changes; no safeguard is withdrawn.

## Acceptance Criteria

- [x] `NFR-OPER-001`: a decision carrying diagnostics renders each one's reason
  code in the channel message, proved for `integrity-drift`,
  `dependency-root-unavailable`, and `configuration-invalid`.
- [x] `FR-EVAL-009`, `SG-CFG-001`: a decision whose `changedGraderSurfaces` is
  non-empty names each changed surface in the message, with no word implying
  intent — proved including the case where every check passed. (Proved for a
  `passed` outcome too: a turn is silent only when it passed with no
  diagnostic and no changed Grader surface.)
- [x] `AC-SEC-001`, `NFR-SEC-004`: an evaluation whose checks all pass and whose
  control surface drifted produces a message naming the drift and the drifted
  surface, and never a message that reads as passing.
- [x] Failing checks keep their own summaries, and a message carrying both a
  failing check and a diagnostic carries both. (Order: outcome, failing
  checks, drift, other diagnostics, changed Grader surfaces, then what was
  left out.)
- [x] The message is bounded by a stated cap; truncation is explicit and never
  drops a control-surface drift or a changed Grader surface. (`FEEDBACK_LIMITS`:
  8 failing checks, 8 non-drift diagnostics, 400 characters per entry; omitted
  entries are counted and named by reason code with the evaluation id. Drift
  and Grader surfaces are uncapped, so the bound on them is structural: a
  surface is recorded only for a declared path. A caller declaring test globs
  to `evaluate` could record more; neither runner does.)
- [x] `FR-ADAPT-005`, `AC-ADAPT-002`: every existing adapter conformance
  expectation holds unchanged, including the declared silence of a clean turn.
  (Both conformance scripts pass unchanged. One unit fixture, "a passing Cursor
  stop payload produces no follow-up", had left `.agent-framework.yaml` and
  its check script uncommitted, so its turn carried two changed Grader
  surfaces; it now commits them and grades an ordinary passing edit. Its
  expectation, silence, is unchanged.)
- [x] `SG-OWNER-001`: no client, tool, or framework name added to
  `scripts/lib/`.
- [x] The evidence record and the channel message name the same reason codes for
  one evaluation.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `NFR-OPER-001`, `FR-EVAL-009`, `AC-SEC-001`, `SG-CFG-001`: diagnostics-rendered, grader-surface-named, drift-with-all-checks-passing, failing-check-plus-diagnostic, message-bounded, clean-turn-silent, and no-intent-language fixtures against the real presentation and `formatFeedback` | `npm run test:unit` | Yes — the unit suite owns the preflight runner and the adapter surface |
| smoke | both | `FR-ADAPT-005`, `AC-ADAPT-002`: the declared conformance baseline for every adapter still passes, and a real preflight on a drifted clone delivers the drift through the declared channel | `gate-adapter-conformance` and `gate-hook-conformance-smoke`, extended by this slice | Yes — channel delivery is only observable through a real adapter declaration |

Frontend build and browser evidence are inapplicable; this slice changes what
one local feedback channel is handed.

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

Every adapter fixture asserts the shape of the channel — that a clean turn is
silent, that a failing check is named, that a malformed payload is
`unverified` — because the conformance contract is about the channel's
declaration. No fixture builds a decision carrying a diagnostic *and* a failing
check and asks what the maintainer is told, because until a real project drifted
its own descriptors mid-session, nothing had produced that combination outside a
deliberate integrity fixture, and the integrity fixtures read the decision
directly rather than the channel.
