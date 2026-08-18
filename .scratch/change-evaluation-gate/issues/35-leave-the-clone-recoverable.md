# TB-035 — Leave the clone in a state the maintainer can recover

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 35-leave-the-clone-recoverable
Draft key: TB-035

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

An activation that fails leaves a clone the maintainer can either use or fix,
and says which. It never reports success while its receipt is unwritten, never
claims a clean rollback it did not achieve, and never accepts a hook program
that merely crashed as one that enforces.

## SRS Traceability

- `FR-LIFE-004`, `FR-LIFE-005`, `FR-LIFE-019`
- `AC-LIFE-002`, `AC-EVAL-001`
- `SG-LIFE-001`, `SG-HOOK-001`
- `NFR-REL-002`, `NFR-REL-003`
- `RISK-001`

## Defect this contract fixes

Raised by an external audit of `HEAD` `9569362` as *"activation and lifecycle
operations are not transaction-safe: exceptions can strand trust or adapter
changes; failed compensation may still report success; a crashing hook can pass
self-test; activation can succeed without persisting its receipt."*

Four failure modes, one shape: the transaction reports an outcome it has not
established.

- **A receipt that was never stored.** Activation can complete its steps and
  report `activated` without the receipt reaching disk. The receipt is the only
  thing the hook reads to know what was activated, so a clone in that state has
  a registered hook and nothing for it to honour — every commit denies with
  `activation-receipt-missing`, and the maintainer was told activation
  succeeded.
- **A crash mistaken for enforcement.** `TB-020` proved the registered program
  denies a subject it must deny, and accepts any non-zero exit as proof. A
  program that crashes before reading the subject also exits non-zero. `TB-020`
  distinguishes `hook-program-cannot-start` and `hook-program-unproved` for
  the cases it anticipated; the audit finds paths where a crash still reads as
  a denial.
- **Compensation that failed but reported success.** A rollback whose
  compensating action throws can still return a clean `rollback.failures: []`,
  so a clone that is half-unwound looks fully unwound.
- **An exception after a mutation.** A throw between two gate-owned changes can
  strand established trust or a registered adapter with nothing recording that
  it happened.

For a single-developer local workflow, none of these is an attack. They are all
the same practical harm: **the maintainer is told one thing and the clone is in
another state**, and the recovery path they would reach for depends on knowing
which.

## Domain Concepts

Activation transaction, Journal, Compensating action, Activation receipt,
Self-test, Lifecycle event, Clone state.

## Approach and Tradeoffs

**Say `partial` when it is partial.** The transaction reports three states
rather than two: `activated`, `configured` (fully unwound, safe to retry), and
a distinct `recovery-required` carrying exactly which compensating actions
failed and what remains on disk. Today's binary answer is why a half-unwound
clone can look clean. This is a reporting change, not a new framework.

**Publish the receipt before Git is enabled, and prove it landed.**
`ACTIVATION_STEPS` already puts `receipt` before `git-enablement` for this
reason; the step must confirm the write by reading it back, and fail the
transaction if it cannot. A registered hook whose receipt is absent is the one
outcome activation must never produce.

**A crash is not a denial.** The self-test's refusal must come from the program
having *read the subject and judged it*, which the subject's own `selfTestId`
already makes checkable. A non-zero exit with no evidence of having answered is
`hook-program-unproved`, not proof.

**Compensation reports what it did.** Every compensating action's failure is
captured and travels in `rollback.failures`; the transaction's outcome is
derived from that list rather than assumed. No compensation is retried and none
is invented.

**Deliberately not a transaction framework.** No two-phase commit, no
write-ahead log, no generalized saga. The journal and its compensations already
exist; this slice makes them honest about their own outcome. The audit's own
recommendation is to avoid an elaborate framework, and this holds to that.

## Architecture Boundary and Public Seam

The boundary is the activation transaction's own reporting: what it claims
about the clone versus what it established. The public seam is the transaction
result — its state, its rollback report — and the receipt-persistence
confirmation.

First red test: an activation whose receipt write fails reports a state that is
not `activated` and leaves no registered hook, where today it can report
success with no receipt on disk.

## Safeguards and Invariants

- `SG-LIFE-001`: a failed activation leaves the clone configured, with no
  receipt and no registration — or, when it cannot achieve that, says so
  explicitly rather than claiming it.
- `NFR-REL-002`: the receipt is published by a single atomic rename and
  confirmed before authoritative Git is enabled.
- `NFR-REL-003`: a self-test refusal must be a decision the program made, not
  an exit status the shell produced.
- `SG-HOOK-001`: nothing here overwrites a hook, changes a shared hooks path,
  or rewrites part of a client configuration file the adapter does not own.
- `FR-LIFE-019`: recovery stays a confirmed operator action. This slice
  reports what needs recovering; it repairs nothing.

## Prohibited Behavior and Non-goals

Do not build a general transaction manager, a write-ahead log, or a retry
policy. Do not repair drift, re-register a hook, or re-establish trust
automatically. Do not add an activation step — `ACTIVATION_STEPS` and its order
are settled, and `git-enablement` stays last. Do not change what activation
proves about adapters. Do not extend this to `gate update`, `gate repair`, or
`gate deactivate`, which the lifecycle command contract owns.

## Risk and Decision Impacts

- `RISK-001`: the accepted residual is a maintainer who knowingly bypasses a
  gate they activated. A clone that reports activated while enforcing nothing
  is an unknowing bypass, which the disposition does not cover.
- `NFR-REL-002`'s claim that an interrupted transaction leaves either a whole
  receipt or none is exactly what this restores.

## Acceptance Criteria

- [ ] `AC-LIFE-002`, `NFR-REL-002`: an activation whose receipt cannot be
  written or read back reports a non-activated state and leaves no registered
  hook; a clone in that state commits exactly as it did while configured.
- [ ] `SG-LIFE-001`: a rollback whose compensating action fails reports
  `recovery-required` naming each failed action and what remains, and never
  reports a clean unwind.
- [ ] `NFR-REL-003`: a hook program that crashes without answering the
  self-test subject fails the step as unproved, distinctly from one that
  answered by denying.
- [ ] `SG-LIFE-001`: an exception thrown after any gate-owned mutation is
  caught, the mutation is compensated or reported, and the transaction never
  ends by propagating it.
- [ ] `AC-LIFE-002`: a successful activation is unchanged — same steps, same
  order, same receipt, `git-enablement` still last.
- [ ] Every state the transaction can report is reachable in a fixture, so no
  reported state is one nobody has seen.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-LIFE-002`, `NFR-REL-002`, `SG-LIFE-001`: receipt-write failure, failed-compensation, post-mutation-throw, and crashing-self-test fixtures against the real transaction | `npm run test:unit` | Yes — the unit suite owns the activation transaction |
| smoke | both | `AC-LIFE-002`, `AC-EVAL-001`: a throwaway clone whose activation fails at each of those points is left committing exactly as it did while configured, or reports `recovery-required` naming what remains | `gate-activation-smoke`, extending `rollback-leaves-no-trace` | Yes — that scenario already drives a real injected failure and real commits |

Frontend build and browser evidence are inapplicable; this slice changes local
transaction reporting.

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

`rollback-leaves-no-trace` injects one failure, immediately before Git
enablement, and asserts a clean unwind — the path where compensation succeeds.
Every fixture that exercises rollback does so with compensating actions that
work, so a compensation that fails has never been observed, and the reporting
that would have to describe it has never been exercised. The receipt-write
failure is the same shape: the step is proved to write, never proved to notice
that it did not.
