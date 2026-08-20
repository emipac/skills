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

Every claim below was established by reading the executed path in
`activation.mjs`, not inferred. Two of them correct what an earlier draft of
this ticket asserted.

- **Verified — a receipt that was never stored.** The receipt write is guarded:
  `if (evidenceStore) { … activationReceipt().write(receipt) … }`
  (`activation.mjs:1808`), and `evidenceStore` defaults to `null`
  (`activation.mjs:1332`). An activation run without a store therefore walks
  past the `receipt` step, enables authoritative Git, and reports `activated`
  with nothing on disk. The receipt is the only thing the hook reads to know
  what was activated, so that clone has a registered hook and nothing for it to
  honour: every commit denies `activation-receipt-missing` while the maintainer
  was told activation succeeded.
- **Verified — the write is never read back.** Even with a store, `write` is
  called and journalled; nothing confirms the bytes landed before Git is
  enabled.
- **Verified — a crash is accepted as a denial.** `selfTestHookProgram`
  distinguishes a program that could not start (`hook-program-cannot-start`)
  and one that ended without an exit code (`hook-program-unproved`), and treats
  *any* non-zero exit as proof (`activation.mjs:523-548`). A program that
  starts, throws, and exits `1` without ever reading the subject is therefore
  recorded as having enforced. `TB-020`'s own comment admits the gap: "a runner
  that merely crashes would also pass — fail-closed, but for the wrong reason".
- **Verified, and correcting this ticket's earlier claim — compensation
  failures are *not* lost.** `rollback()` collects each failed undo into
  `rollback.failures` (`activation.mjs:1376-1391`). The defect is one level up:
  `refusal()` hard-codes `state: 'configured'` (`activation.mjs:147-157`)
  whatever that list contains, so a clone that is half-unwound reports the same
  state as one that unwound cleanly. The data is there; nothing reads it.
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

Verified: the journal, its compensating actions, and `rollback.failures` all
exist and work. What is missing is that nothing derives the reported outcome
from them. This slice is a reporting change, not a new mechanism.

Verified: `runProgram` captures the hook program's stdout
(`activation.mjs:438-466`), the self-test subject carries a per-run
`selfTestId`, and the shipped runner prints it — `tests/gate-hook-runner.test.mjs`
already asserts `self-test-0001` appears in the denial. So evidence that the
program *read and judged the subject* is available without adding a protocol.

Proposed — say `partial` when it is partial. Report three states rather than
two: `activated`, `configured` (fully unwound, safe to retry), and a distinct
`recovery-required` carrying which compensating actions failed and what remains
on disk. The implementer confirms every state is reachable and that existing
callers reading `state === 'configured'` are not broken by a third value.

Proposed — make the receipt non-optional to the outcome. A transaction that
reports `activated` must have a receipt on disk, so either the store stops
being optional on that path or the absence fails the `receipt` step. The
implementer decides which, and confirms the write landed by reading it back
before `git-enablement`.

Proposed — a crash is not a denial. Require the self-test refusal to carry
evidence that the program answered *this* subject, using the `selfTestId`
already in its output, so a started-then-crashed program is
`hook-program-unproved` rather than proof. The implementer confirms the shipped
runner's output actually satisfies whatever check is chosen, and that a
fixture program which denies correctly still passes.

Proposed — derive the outcome from `rollback.failures` rather than assuming it.
No compensation is retried and none is invented.

Deliberately not a transaction framework. No two-phase commit, no write-ahead
log, no generalized saga. The audit's own recommendation is to avoid an
elaborate framework, and this holds to that.

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
- [ ] `SG-LIFE-001`: a rollback whose compensating action fails reports a state
  distinct from a clean unwind, naming each failed action and what remains. The
  failures are already collected; what must change is that the reported state
  reflects them.
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
