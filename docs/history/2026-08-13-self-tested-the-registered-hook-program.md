# Self-tested the registered hook program before enabling Git

Delivered TB-020, a defect slice: activation would accept a hook program that
enforces nothing, pass its own self-test, write a receipt, and report a healthy
activated clone with no enforcement at all.

- Closed the hole where presence was the whole check. `registerOwnedHook` asked
  only that an `interpreter` and a `script` be there. A real activation attempt
  pointed that program at `scripts/lib/evaluate.mjs`, a pure library: running it
  prints nothing and exits `0`, and a `pre-commit` hook exiting `0` allows the
  commit. Nothing in the transaction had ever executed the one artifact it
  writes into `.git/hooks/pre-commit`.
- Extended the existing `self-test` step rather than adding one.
  `ACTIVATION_STEPS` is unchanged and `git-enablement` is still last
  (`FR-LIFE-004`). The step now proves the evaluation process, then the hook
  program, then every selected adapter.
- Proved denial, not liveness. The program is executed against a change it must
  deny and must exit non-zero. A program that starts, prints nothing, and exits
  `0` satisfies every weaker check — does it exist, is it executable, does it
  run — and is exactly the failure this defect produced, so only the refusal is
  asserted.
- Ran the proof against a throwaway subject the transaction creates and removes.
  The maintainer's own work is never the subject, activation never depends on
  the clone happening to contain a failing change, and nothing is left behind.
  The subject's path is named in `CHANGE_EVALUATION_GATE_SELF_TEST`, so a
  program can tell that it is being proved rather than run against somebody's
  work, and it pins a `selfTestId`, `expect: "denied"`, and the failing required
  check that makes the subject deniable.
- Distinguished a refusal from a crash. A program that never starts is
  `hook-program-cannot-start` and one killed before it answers is
  `hook-program-unproved`: their non-zero results are the shell and the clock,
  not a decision. Neither is mistaken for proof of denial (`NFR-REL-003`).
- Refused, and never repaired. Every failure fails the step with
  `hook-program-self-test-failed`, so the journal unwinds and the clone is left
  configured with no receipt and no registered hook (`SG-LIFE-001`). What to do
  about a broken runner is the operator's decision.
- Recorded the proof. The receipt's `selfTests[]` now carries a `hook-program`
  entry with the exit status it was proved by, so an activated clone states what
  was proved rather than implying it.
- Kept the accepted residual risk to its accepted shape. Proving the program
  denies is not a claim that enforcement cannot later be removed or bypassed by
  the machine owner (`SG-TRUST-001`, `RISK-001`).
- Extended `gate-activation-smoke` with a fourth scenario,
  `hook-program-self-test`, which activates a throwaway clone with a program that
  exits `0` for everything and requires the refusal, no receipt, no hook, no
  leftover subject, one recorded failure, and a clone that still commits exactly
  as it did while merely configured.
- Updated the fixture runners that had relied on activation never executing
  them. Each now answers the self-test explicitly instead of passing by accident.

Scope held: no new activation step, no change to `gate status` reconciliation of
an already-registered program, and no work on the packaged runner itself, which
`TB-018` owns.

Verification: `npm run test:unit` (264 passing), `npm run validate` (29 skills,
214 Markdown files), `npm run test:install`, and regression runs of all nine
capabilities — `gate-runtime-binding-smoke`, `gate-fix-smoke`,
`gate-evidence-prune-smoke`, `gate-activation-smoke`,
`gate-hook-conformance-smoke`, `gate-lifecycle-smoke`,
`gate-adapter-conformance`, `gate-security-control-smoke`, and
`gate-runtime-portability`.
