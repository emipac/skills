# TB-048 — Do not register a surface that cannot answer

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 48-do-not-register-a-surface-that-cannot-answer
Draft key: TB-048

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A preflight surface whose feedback channel has not been observed says so and is
not registered, instead of registering successfully and then evaluating every
turn into silence. Authoritative Git, which answers by blocking rather than by a
channel, is untouched.

## SRS Traceability

- `FR-ADAPT-004`, `FR-ADAPT-005`, `FR-LIFE-004`
- `AC-ADAPT-002`, `AC-ADAPT-003`, `AC-LIFE-009`
- `SG-SUPPORT-001`, `SG-HOOK-001`, `SG-OWNER-001`
- `NFR-COMP-001`
- `RISK-004`

## Defect this contract fixes

Raised by an external audit. Verified in `adapters.mjs`: `claude-code-desktop`
and `codex-desktop` declare `feedback.channel: null` and `maxIterations: null`.
`formatFeedback` returns the declared silence form for a null channel, and
`gate-preflight.mjs` always exits `0`. So on those two surfaces a turn
materializes a snapshot, spawns every configured check, appends an Evidence
envelope, and emits nothing at all.

That is the defect `gate-preflight.mjs`'s own header says it was written to
prevent — a maintainer pointing a desktop hook at the wrong program and getting
a silent no-op — reintroduced through a different door, now with the full cost
of an evaluation paid on every turn.

**This became reachable because of `TB-046`.** Before that slice those two
adapters could not activate at all: they declared a trust model no surface could
grant, so activation paused forever. Collapsing every adapter to
`repository-hook-registration` made them activatable for the first time, and
made a state the runtime was never designed to handle possible.

### What the audit got wrong, and it matters

Verified: **authoritative `git` also declares `feedback.channel: null`.** That is
correct and permanent — `git` declares `blocking.native: true`, so a non-zero
exit *is* the answer and no channel is needed. A rule refusing every adapter with
a null channel would refuse the only integration that enforces anything.

Verified: the adapter conformance contract permits it explicitly — *"An adapter
that declares no feedback channel returns none."* So `channel: null` is a legal
declaration, not a violation.

### The real problem

One value carries two unrelated meanings, and nothing can tell them apart:

| Adapter | What `channel: null` means | Status |
| --- | --- | --- |
| `git` | no channel needed; it answers by blocking | permanent, correct |
| `claude-code-desktop` | how this surface takes an answer back has not been observed | provisional |
| `codex-desktop` | the same | provisional |

The support tiers already carry the second meaning — both are `experimental` /
`client-invocation-not-observed`, deliberately, because neither has been driven
by a real client invocation. Only `cursor` was, which is why only `cursor`
declares a real channel and is `supported`.

The runtime cannot see that distinction. It reads one absence and treats a
surface that is deliberately silent exactly like a surface nobody has observed
yet.

This is the shape `TB-046` settled for trust models: a declaration must name
something, and a value nothing can act on must fail rather than silently do
nothing. The same rule has not been applied to feedback.

## Domain decisions this contract settles

**Unobserved is not the same as silent, and neither is a defect.**

`claude-code-desktop` and `codex-desktop` are intentionally unproved. They are
future work, not broken declarations, and this contract does not invent channels
for them. What it fixes is that an unobserved surface currently registers as
though it were ready and then discards every answer.

When a maintainer drives one of those clients with a real invocation and
observes how it takes an answer back, they fill in the declaration and the
surface starts working — the path `cursor` already took to `supported`. This
contract keeps that path open and makes today's state honest.

## Domain Concepts

Feedback channel, Declared silence, Unobserved surface, Support tier, Preflight
role, Adapter registration.

## Approach and Tradeoffs

Verified: the feedback declaration already carries `channel`, `field`, `none`,
and `maxIterations`, and `formatFeedback` reads only the declaration — it learns
no client field name of its own. The declaration is the right place for this.

Proposed — distinguish the two absences in the declaration. "No channel needed"
and "channel not yet observed" become different statements rather than the same
`null`. The implementer chooses how and states it, and confirms the adapter
declaration validator rejects a surface that says neither.

Proposed — refuse to register a preflight surface that cannot report. A
`preflight`-role adapter with no usable channel is refused at registration with
a reason naming what is missing and why — it has not been observed — rather than
registered against a program it cannot answer through. Authoritative `git` is
unaffected: its role is authoritative and it answers by blocking.

Proposed — do no work that cannot be reported. If such a surface is reached at
runtime anyway, the runner returns before materializing a snapshot or spawning a
check. The implementer confirms this cannot change what an adapter *with* a
channel does.

Proposed — keep the offline baseline working. The shared client baseline
exercises all four surfaces to prove their declarations, and it must keep doing
so. A registration refusal is about wiring a surface into a clone, not about
whether its declaration can be tested. The implementer confirms
`gate-adapter-conformance` still covers every declared surface and says how.

Deliberately not inventing a channel for an unobserved client. Deliberately not
demoting, deleting, or hiding either adapter — they stay declared, stay
`experimental`, and stay testable. Deliberately not changing what `cursor` or
`git` do.

## Architecture Boundary and Public Seam

The boundary is between a surface being declared and a surface being wired into
a clone as something that will report. The public seam is the feedback
declaration, the registration path that consults it, and the refusal it returns.

First red test: activating `claude-code-desktop` refuses with a reason naming
its unobserved channel and registers nothing, where today it registers
successfully and every turn evaluates into silence.

## Safeguards and Invariants

- `SG-SUPPORT-001`: an integration is never labelled supported without evidence.
  This slice makes the runtime agree with the tier rather than changing any tier.
- `SG-HOOK-001`: a refused registration writes nothing; no client configuration
  file is created, altered, or partially written.
- `SG-OWNER-001`: Gate core learns no client name. Whether a surface can report
  stays declared data in the adapter layer.
- `FR-ADAPT-005`: nothing here turns a reporting failure into a pass. A surface
  that cannot report does not evaluate, and nothing it would have said is
  assumed.
- `NFR-COMP-001`: every declared surface still passes the shared baseline.
- `AC-LIFE-009`: activation still leaves no partial adapter set active, and a
  refusal leaves the clone exactly as it was.
- Authoritative Git is unchanged in every respect.

## Prohibited Behavior and Non-goals

Do not refuse an adapter merely for declaring no channel — `git` does and is
correct. Do not invent, guess, or default a channel for an unobserved client.
Do not delete, hide, demote, or promote any adapter, and do not change any
support tier. Do not change `cursor`'s or `git`'s behavior. Do not remove any
surface from the shared client baseline. Do not add a client name or branch to
Gate core. Do not change what `formatFeedback` does for a surface that has a
channel.

## Risk and Decision Impacts

- `RISK-004`: client behavior changes independently of this project, which is
  why a surface must declare what it can do and why an undeclared capability
  must fail rather than be assumed.
- `SG-SUPPORT-001` is unchanged in substance: the tiers were already honest, and
  this makes the runtime behave the way the tiers already read.

## Acceptance Criteria

- [ ] `AC-ADAPT-003`, `SG-HOOK-001`: activating a preflight surface whose channel
  has not been observed is refused with a reason naming what is missing, and no
  client configuration file is created or altered.
- [ ] Authoritative `git` activates exactly as it does today, and its declared
  absence of a channel is never treated as a fault.
- [ ] `cursor` activates and reports exactly as it does today, proved by the
  existing capabilities passing untouched.
- [ ] `FR-ADAPT-005`: a surface that cannot report performs no evaluation —
  no snapshot materialized, no check spawned, no Evidence appended.
- [ ] The declaration distinguishes "no channel needed" from "channel not yet
  observed", and a declaration that says neither is rejected by the validator.
- [ ] `NFR-COMP-001`, `AC-ADAPT-002`: the shared client baseline still exercises
  all four declared surfaces.
- [ ] `AC-LIFE-009`: a refused registration leaves no partial adapter set active
  and leaves the clone exactly as it was.
- [ ] The evaluation runtime for authoritative commits is unchanged.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-ADAPT-003`, `FR-ADAPT-005`: unobserved-surface-refused, git-unaffected, cursor-unchanged, no-work-without-a-channel, and invalid-declaration fixtures against the real registration and runner | `npm run test:unit` | Yes — the unit suite owns the adapter declarations, registration, and the preflight runner |
| smoke | both | `AC-ADAPT-002`, `AC-LIFE-009`: a real clone activated for an unobserved surface registers nothing and says why, while the same clone activates for `git` and for `cursor` as it does today | `gate-activation-smoke` and `gate-adapter-conformance`, extended by this slice | Yes — those capabilities own real activation and the shared baseline |

Frontend build and browser evidence are inapplicable; this slice changes local
adapter declarations and registration.

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

The baseline proves that a declaration is internally consistent and that a
failure becomes `unverified`; it never asks whether a declared surface could
report anything at all. And until `TB-046` these two adapters could not be
activated, so no fixture ever registered one — the state simply did not exist to
be tested. The slice that made them activatable had no reason to ask what
happens after.
