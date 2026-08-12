# TB-020 — Self-test the registered hook program before enabling Git

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 20-self-test-the-registered-hook-program
Draft key: TB-020

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

Activation proves that the hook program it is about to register actually denies
a change it should deny, so a program that cannot enforce is refused before Git
is enabled rather than installed and trusted.

## SRS Traceability

- `FR-LIFE-004`, `NFR-REL-003`
- `AC-LIFE-002`
- `SG-LIFE-001`, `SG-TRUST-001`
- `RISK-001`

## Defect this contract fixes

`FR-LIFE-004` requires activation to self-test selected adapters **and runtime**
before enabling authoritative Git. The registered hook program is that runtime,
and it is the one artifact activation never executes.

Two gaps combine:

`registerOwnedHook` accepts any program whose interpreter and script are
present:

```js
if (!program?.interpreter || !program?.script) {
  throw new Error('Activation requires a hook program to register.');
}
```

Presence is the whole check. Nothing establishes that the named script can
evaluate anything.

The `self-test` step then runs `selfTestEvaluation` and `selfTestAdapter`, both
injected dependencies. They prove the evaluation process and the adapters work.
Neither executes the program that will be written into `.git/hooks/pre-commit`.

A real activation attempt pointed its hook program at `scripts/lib/evaluate.mjs`,
a pure library. Running it prints nothing and exits `0`, so the installed hook
would have allowed every commit. Activation would have accepted that program,
passed its self-test, written a receipt, and enabled Git — reporting a healthy
activated clone with no enforcement at all.

`TB-018` supplies a correct packaged runner. It does not close this hole: any
other program that exits `0` is still accepted on the same terms. This contract
closes it for every program, including ones nobody has written yet.

## Domain Concepts

Activation transaction, Managed hook registration, Activation receipt, Gate
health, and Enforcement role.

## Approach and Tradeoffs

Extend the existing `self-test` step to execute the registered hook program
against a known-failing evaluation and require a non-zero exit. A program that
allows what it must deny fails the step, the transaction unwinds, and the clone
stays configured with no receipt and no hook.

Proving denial rather than merely proving the program runs is the point. A
program that starts, prints nothing, and exits `0` satisfies every weaker check
and is exactly the failure this defect produced.

The self-test runs against a throwaway snapshot rather than the maintainer's own
work, so activation never depends on the clone happening to contain a failing
change, and never leaves anything behind.

Keeping this in the existing `self-test` step preserves the frozen
`ACTIVATION_STEPS` order and the guarantee that Git is enabled last. No new step
is added.

## Architecture Boundary and Public Seam

The boundary is the activation transaction's self-test step. The public seam is
the activation result: which self-tests ran, their outcomes, and the reason code
of a refusal. First red test: activation whose hook program exits `0` for a
change that must be denied fails at `self-test`, and the clone is left
configured with no receipt and no registered hook.

## Safeguards and Invariants

- `SG-LIFE-001`: a failed self-test unwinds every gate-owned change and exposes
  no partial activated state.
- `NFR-REL-003`: a hook program that cannot be proved to deny is treated as
  unproved and refused, never accepted on the assumption it works.
- `SG-TRUST-001`: proving the program denies is not a claim that it cannot later
  be removed or bypassed by the machine owner.

## Prohibited Behavior and Non-goals

Do not add a step to `ACTIVATION_STEPS` or move `git-enablement` from last. Do
not evaluate the maintainer's working tree as the self-test subject, leave the
throwaway subject behind, or repair a failing program. Do not extend this
contract into the runner's own implementation, which `TB-018` owns, or into
`gate status` reconciliation of an already-registered program.

## Risk and Decision Impacts

- `RISK-001`: the accepted residual risk is that a machine owner may deliberately
  bypass or remove local enforcement. It was never that activation would report a
  healthy enforced clone that enforces nothing. This contract keeps the risk to
  its accepted shape.

## Acceptance Criteria

- [ ] `AC-LIFE-002`: activation whose registered hook program exits `0` for a
  change that must be denied fails at the `self-test` step, and the clone is left
  configured with no receipt and no registered hook.
- [ ] `AC-LIFE-002`: activation whose hook program correctly denies that change
  completes, records the hook-program self-test and its outcome in the receipt,
  and still enables Git last.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-LIFE-002`, `SG-LIFE-001`, `NFR-REL-003`: self-test fixtures for a program that wrongly allows, a program that correctly denies, and a program that cannot start, each proving the resulting state | `npm run test:unit` | Yes — configured unit suite owns the activation transaction |
| smoke | both | `AC-LIFE-002`: a packaged activation refuses a non-enforcing hook program and leaves no receipt or hook behind | `gate-activation-smoke` capability extended by this slice | Yes — the existing activation selector already drives real activation and must cover the refusal |

Frontend build and browser evidence are inapplicable; this slice changes a
lifecycle transaction, not a frontend surface.

## Blocked By

None. `TB-010` delivered the activation transaction and its self-test step, and
is done. `TB-018` supplies a conforming runner but is not required to build or
test this refusal, which is proved with fixture programs that deliberately
misbehave.

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

Every activation fixture supplies a hook program that behaves, so the step named
`self-test` was never asked to catch one that does not. The injected
`selfTestEvaluation` and `selfTestAdapter` dependencies made the transaction
testable and, in doing so, made it possible for the suite to prove a runtime
that never existed. This contract asserts the refusal directly, which is the
only form of the test that could have failed before it was written.
