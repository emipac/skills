# TB-051 — Claim only what the Gate does today

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 51-claim-only-what-the-gate-does-today
Draft key: TB-051

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A maintainer reading the skill learns what the Gate does now and what is built
but not switched on, and can tell the two apart. Three capabilities that are
implemented and unreachable are described as not yet in use, in the same place
they are currently described as working.

## SRS Traceability

- `FR-COORD-001`, `FR-EVAL-006`, `FR-ADAPT-007`
- `AC-COORD-001`, `AC-EVAL-002`
- `SG-COORD-001`, `SG-SUPPORT-001`, `SG-TRUST-001`
- `NFR-OPER-001`
- `RISK-002`

## Defect this contract fixes

An external audit found six subsystems that are fully implemented, unit-tested,
and documented in a reference contract, and that no entry point can reach. Three
of them are also *claimed*, which turns an unused capability into a false
statement.

Verified: `SKILL.md` line 64 states that the skill defines "how concurrent
evaluations across clients and linked worktrees serialize per Git common
directory". Verified: neither production runner passes a coordination seam to
`evaluate`, so `evaluate` takes its uncoordinated branch every time. Nothing
serializes anything.

Verified: `hook-runner.mjs:991` and `preflight-runner.mjs:333` both hardcode
`contractRef: null`. Every decision the Gate produces therefore carries empty
acceptance-criteria arrays and a fixed regression-only limitation, and the
acceptance-coverage machinery computes nothing on every run.

Verified: runtime binding is never bound, so any check that would be graded
against served source is permanently `unverified` for a reason no reader can
act on.

The audit's recommendation was to delete all six. **That is rejected**, and the
reason is recorded here so it is not revisited: this project has repeatedly
found that unreachable-but-correct code was worth reaching rather than removing
— `TB-040`, `TB-041`, `TB-042` and `TB-044` each connected a complete subsystem
that no entry point could invoke. Deletion forecloses that. The defect is not
that the code exists; it is that the documentation promises three things the
runtime does not do.

## Domain decisions this contract settles

**Not on yet, and said so — for coordination, delivery contracts, and runtime
binding.**

All three stay exactly where they are: no file is deleted, no export removed, no
test dropped, no reference contract retired. What changes is that the skill
stops describing them as working and starts describing them as built and not
switched on, with what it would take to switch each one on.

**Bypass is not in this contract.** It is the fourth unreachable subsystem and it
was decided differently — a policy switch that appears to work and does nothing
is a worse failure than a documented gap. `TB-052` owns it.

**Coordination carries one extra fact the audit established.** Half of that
module can never work in this deployment model, and the documentation should say
so rather than leaving a future maintainer to rediscover it. Every hook
invocation is its own process, so the in-process half — the queue, the
subscriber map, the in-flight sharing — has nobody to share with. Only the file
lock could ever apply here. That is a fact about the deployment, not a defect in
the code, and it is exactly the sort of thing that is expensive to learn twice.

## Domain Concepts

Coordination lock, In-process sharing, Delivery contract, Acceptance coverage,
Runtime binding, Served source, Reachability.

## Approach and Tradeoffs

Verified: `SKILL.md` already distinguishes what the Gate does from what a
reference contract defines, and already carries an honest statement of the trust
boundary. There is an established voice for saying what the Gate cannot do; this
extends it rather than inventing a convention.

Verified: `gate locks` exists and reports a lock nothing acquires. The audit
reproduced it. That command's own output is a place a reader will meet this
question, so it is a candidate location for the statement.

Proposed — correct the three claims where they are made, not in a new section.
A reader who reaches the coordination sentence should learn there that it is not
switched on. The implementer decides whether each reference contract also needs
a line and says which it changed.

Proposed — say what switching it on would require, briefly. "Not on yet" without
a next step invites the same audit finding again. For coordination that includes
the in-process limitation above; for delivery contracts it is that both runners
pass no contract reference; for runtime binding it is that no runner binds a
resolver.

Proposed — make the decision durable in the repository, not only in this ticket.
Whether that is a note in the reference contracts, a line in the SRS revision
history, or something else is the implementer's call — but a future audit
finding the same six subsystems should find the decision beside them rather than
re-raise it.

Deliberately not deleting, moving, or reducing any of the three subsystems, and
not removing any test or reference contract. Deliberately not wiring any of them
— that is a separate decision per subsystem, and this contract only stops the
documentation claiming they are wired.

## Architecture Boundary and Public Seam

The boundary is between what the skill says the Gate does and what the runtime
does. The public seam is the skill documentation a maintainer and an agent read,
and the reference contracts it points at.

First red test: not applicable in the usual sense — this slice changes prose. The
equivalent proof is that a reader following each claim to its implementation
finds a statement that it is not switched on, and that the repository validator
and the full suite pass unchanged.

## Safeguards and Invariants

- `SG-TRUST-001`: the skill states what the Gate does and does not do. A claim it
  cannot honour is the same class of problem as implying enforcement it lacks.
- `SG-SUPPORT-001`: nothing is described as working without evidence that it
  works. This applies the rule already used for adapter support tiers.
- `SG-COORD-001`: the safeguard remains in the SRS and remains unimplemented; the
  documentation now says which.
- `NFR-OPER-001`: a reader can act on what they are told — each statement names
  what would have to change.
- No behavior changes at all. No file under `scripts/lib/` is modified.

## Prohibited Behavior and Non-goals

Do not delete, move, or shrink any module, export, test, or reference contract.
Do not wire coordination, delivery contracts, or runtime binding. Do not touch
bypass — `TB-052` owns it. Do not change any runtime behavior, decision, or
output. Do not remove `gate locks` or any other command. Do not amend the SRS
requirements themselves; if a requirement now reads as unimplemented, that is
the true state and this contract records it rather than changing it.

## Risk and Decision Impacts

- `RISK-002`: isolation and concurrency limits are accepted on the basis that
  they are explicit. Three of them were not explicit — they were described as
  handled.
- No disposition changes. No safeguard is withdrawn; the ones that are
  unimplemented are now identified as such.

## Acceptance Criteria

- [ ] `SG-COORD-001`, `AC-COORD-001`: the coordination claim in `SKILL.md` states
  that serialization is implemented and not switched on, and names the
  in-process limitation that no future wiring can remove.
- [ ] `AC-EVAL-002`: the delivery-contract behavior is described as not in use,
  and a reader learns that every decision therefore carries empty acceptance
  coverage rather than being left to infer it.
- [ ] Runtime binding is described as not in use, and a reader learns that a
  served-source check is `unverified` for that reason.
- [ ] Each statement names what switching it on would require.
- [ ] The decision is recorded somewhere a future reader meets beside the code,
  not only in this ticket.
- [ ] `npm run validate`, `npm run test:unit`, and `npm run test:install` pass
  unchanged, and no file under `skills/change-evaluation-gate/scripts/lib/` is
  modified.
- [ ] Bypass is untouched.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-EVAL-002`, `AC-COORD-001`: the released-skill and Markdown validation still passes, no library file changed, and the coordination behaviour the concurrency fixtures cover is unaltered because nothing in this slice touches it | `npm run validate` and `npm run test:unit` | Yes — the validator owns released-skill documentation and the unit suite proves no behavior moved |

Smoke, frontend build, and browser evidence are inapplicable; this slice changes
documentation only and alters no runtime path.

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

Documentation is validated for structure, links, and released-skill parity —
never against the runtime it describes. A sentence claiming a behavior no test
exercises is indistinguishable, to every check this repository runs, from a
sentence claiming a behavior that works. The subsystems themselves are
thoroughly tested in isolation, which is what made the claims read as safe.
