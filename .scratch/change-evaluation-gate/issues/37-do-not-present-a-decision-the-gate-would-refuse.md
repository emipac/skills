# TB-037 — Do not present a decision the gate itself would refuse

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: done, defect
Blocked by:
Tracker ID: 37-do-not-present-a-decision-the-gate-would-refuse
Draft key: TB-037

**Status:** done

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A preflight tells an agent about a decision the gate can actually read. One
that fails the evaluation contract is presented as `unverified` through the
declared channel — the same answer every other unreadable result already gets —
instead of being rendered as a list of checks nobody produced.

## SRS Traceability

- `FR-ADAPT-003`, `FR-ADAPT-005`, `FR-EVAL-002`
- `AC-ADAPT-001`, `AC-ADAPT-002`, `AC-EVAL-002`
- `SG-SUPPORT-001`
- `NFR-REL-003`

## Defect this contract fixes

Found while reviewing `TB-033`, which made the authoritative runner judge every
decision with `validateDecision` before it may exit `0`. The preflight runner
gained no equivalent: `runPreflight` hands whatever `runAdapterEvaluation`
returns straight to `presentDecision` and `formatFeedback`. So the two runners
now disagree about what a readable decision is, and the preflight is the
permissive one — it will render a decision the authoritative runner would
refuse, as though it were a set of real check results.

**This is deliberately a small ticket, and the severity is low.** It was
checked before being written:

- **It cannot block a commit.** `presentDecision` derives `authorization` from
  `authorizationFor(adapter.role, outcome)`, which returns `not-authoritative`
  for any non-authoritative role; `blocking` is `authorization === 'deny'`,
  which a preflight adapter can never reach. `gate-preflight.mjs` always exits
  `0`, and the client declares no exit-code contract for the event that starts
  it. Three independent reasons, any one sufficient.
- **It cannot contaminate an authoritative decision.** The two runners are
  separate processes running separate evaluations. They share one Evidence
  store, but `TB-027`'s repetition budget only counts log entries matching the
  same `evaluationId`, and that identity encodes role, trigger, and adapter —
  so a preflight evaluation and a commit evaluation can never collide.

What it can do is spend a turn. A malformed decision rendered as failing checks
becomes a `followup_message`, which the client submits as the next user
message, so the agent is asked to fix findings that were never produced.
`TB-027` bounds that — at most `maxIterations` for unchanged content, and never
on an interrupted turn — so this is noise inside a bounded loop rather than the
unbounded one that ticket closed.

The second consequence is a record: the preflight persists evidence through the
same wiring `TB-026` built, so a decision the contract would reject can be
stored as an envelope. That is a wrong record rather than a wrong
authorization, and it is the reason this is worth fixing at all rather than
merely noting.

## Domain Concepts

Decision contract, Decision presentation, Feedback channel, Preflight role,
Enforcement authority, Evidence envelope.

## Approach and Tradeoffs

**Reuse the refusal that already exists.** `runPreflight` already has an
`unverified(…)` presentation for an unreadable payload, an unmatched event, an
unresolvable repository root, and an internal failure. A decision that fails
the contract is the same family and takes the same path — the ticket adds a
condition, not a mechanism.

**Judge with the contract, not with a field check.** `validateDecision` is the
same function `TB-033` wired into the authoritative runner. Both runners
consult one definition of a complete decision; a second, looser one living in
the preflight is exactly the divergence this ticket exists to remove.

**Say what happened, briefly.** The presented detail names that the decision
could not be read and how many contract findings there were. A preflight
message is submitted to an agent as a prompt, so a full dump of findings would
put a wall of contract text where a short instruction belongs.

**Do not persist an unreadable decision.** Evidence exists to record what was
evaluated. A decision the contract rejects is not a record of an evaluation,
and storing it makes the store less trustworthy rather than more complete.

**Nothing about authority changes.** Preflight stays `not-authoritative` and
non-blocking whatever it presents. This slice narrows what it is willing to say
about a decision, not what it is allowed to do.

## Architecture Boundary and Public Seam

The boundary is between the decision the shared evaluation seam returns and the
feedback the preflight renders from it. The public seam is the preflight's
contract check and the `unverified` presentation it produces.

First red test: `runPreflight` with an injected `evaluate` returning
`{ authorization: 'allow', outcome: 'passed' }` presents `unverified` through
the declared channel — where today it renders that decision as a preflight
result.

## Safeguards and Invariants

- `SG-SUPPORT-001`: preflight remains `not-authoritative` and non-blocking, and
  the program still always exits `0`.
- `AC-EVAL-002`: both runners judge decision completeness with the same
  contract function; neither carries its own definition.
- `NFR-REL-003`: an unreadable decision presents as `unverified`, which is
  already how every other unreadable result is answered on this surface.
- `TB-027`'s rules are untouched: an interrupted turn is still answered with
  nothing, and the repetition budget still applies.
- A decision that passes the contract is presented exactly as it is today.

## Prohibited Behavior and Non-goals

Do not make preflight blocking, and do not use the exit status to signal
anything. Do not add a second completeness rule. Do not dump every contract
finding into a message an agent will be prompted with. Do not change
`presentDecision`, `formatFeedback`, or the adapter declarations. Do not touch
the authoritative runner — `TB-033` settled it.

## Risk and Decision Impacts

- No disposition changes. Authority, blocking behaviour, and exit status are
  all unchanged; this narrows a message and prevents one class of junk record.

## Acceptance Criteria

- [x] `AC-ADAPT-002`, `NFR-REL-003`: a decision that fails `validateDecision`
  is presented as `unverified` and `not-authoritative` through the declared
  feedback channel, driven through the real `runPreflight`.
- [x] `AC-EVAL-002`: the preflight judges completeness with `validateDecision`;
  a source scan finds no second completeness rule in the preflight runner.
- [x] `AC-ADAPT-001`: a decision that passes the contract is presented exactly
  as it is today — a failing required check still names that check, and a
  passing turn still produces no follow-up.
- [x] `FR-EVID-001`: a decision the contract rejects leaves no Evidence
  envelope. Held at the seam the preflight owns; see the decision recorded
  below for what this does and does not guarantee.
- [x] `SG-SUPPORT-001`: the presented result is `not-authoritative` and
  non-blocking, and the program exits `0`, whatever the decision was.
- [x] The presented message states that the decision could not be read without
  reproducing every contract finding.

## Decisions this slice recorded

**The defect was narrower than this ticket described, and the fix is the half
that was genuinely missing.** `runAdapterEvaluation` has validated its
evaluation seam's return with `validateDecision` since `TB-013`, and refuses a
rejected decision with `failedPresentation`. So the preflight never rendered a
malformed decision as check results: the observed behaviour was already
`unverified` and `not-authoritative`. What was actually missing is what
`AC-EVAL-002` names — the preflight making its own judgement of the decision by
the same rule, rather than depending on a check that happens to live in a shared
adapter helper — and a message fit for the channel. The red test failed on the
message, which named one contract finding (`decision-field-missing at
decision.protocolVersion`) and no count.

**The shared rule is `contractFindings`, not `validateDecision` directly.**
`TB-033` wrapped `validateDecision` in `hook-runner.mjs` so a throw is still a
refusal. That wrapper is now exported and the preflight consults it, so both
runners share one definition *and* one behaviour under an unexpected error.
The only edit to the authoritative runner is the `export` keyword; nothing it
does changed.

**`FR-EVID-001` cannot be held as absolutely as this ticket assumes.** The
Evidence append happens inside `evaluate`, in `persistEvidence`, before the
decision is returned. The preflight opens the store in `evaluateActivated` and
hands it to `evaluate`; it appends nothing itself. So a decision `evaluate`
builds, appends, and then returns malformed is already an envelope before any
check the preflight can make. Preventing that would mean validating inside
`evaluate` — which is the authoritative runner's shared path and out of scope
here. What this slice guarantees is what the preflight actually owns: a
decision returned across its evaluation seam is judged before it is presented,
and nothing is persisted by the preflight on that path.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-ADAPT-002`, `AC-EVAL-002`, `NFR-REL-003`: malformed-decision fixtures through the real `runPreflight`, a well-formed regression, and the single-rule source scan | `npm run test:unit` | Yes — the unit suite owns the preflight runner |

No smoke row. `gate-adapter-conformance` already drives the packaged preflight
program against a real clone, and a real clone cannot produce a malformed
decision — reaching this path needs the injected seam the focused layer owns.
Its existing scenario is the regression that well-formed decisions still
present unchanged.

Frontend build and browser evidence are inapplicable; this slice changes local
presentation.

## Blocked By

None. `TB-033` wired `validateDecision` into the authoritative runner and made
it total, which is what this reuses.

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

The preflight fixtures drive real evaluations, which always return complete
decisions, and inject failures only as thrown errors — a shape the runner
already answers. No fixture has ever handed the preflight a decision that was
*returned* but incomplete, because until `TB-033` there was no definition of
incomplete that any runner consulted.
