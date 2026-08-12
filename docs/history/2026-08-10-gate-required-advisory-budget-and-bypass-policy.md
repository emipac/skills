# Required, advisory, budget, and bypass policy for the evaluation gate

Delivered TB-005 as the policy layer applied over the completed Change
Evaluation Gate decision.

- Made repository Gate policy authoritative over provider proposals: a provider
  proposes a binding, but only the configured `evaluation_gate` policy decides
  which check identities are required. A check the policy does not name as
  required is recorded as advisory and cannot block.
- Kept required checks conjunctive and advisory checks non-blocking: advisory
  success never compensates for a required failure and advisory failure is never
  silently promoted to blocking.
- Bound final authorization to the exact current snapshot, configuration,
  environment, and runner and provider tool environment. A completed pass from
  an earlier evaluation cannot authorize a changed snapshot; it becomes
  `unverified` with a `snapshot-mismatch` or `integrity-drift` diagnostic.
  Reauthorization is only ever as strict as the recorded decision and never
  upgrades a recorded `unverified` because its checks read positively.
- Added plan validation for the five policy subcontracts. A missing subcontract,
  a non-positive total budget, an identity bound as both required and advisory,
  a duplicate identity, a required identity listed as budget-skippable, an
  enabled bypass with no configured marker, and any command-ownership property
  are all rejected. An unusable policy is one `configuration-invalid` diagnostic
  and the evaluation fails closed instead of running with invented limits.
- Enforced both bounds during execution: the project-confirmed per-check timeout
  and the remaining total budget, whichever runs out first. A timed-out check
  terminates its whole process group rather than only its direct child, so
  background completion cannot authorize the current commit.
- Skipped only advisory work the project explicitly listed as budget-skippable,
  recorded it as `budget-exhausted` and kept it visible as an advisory. Required
  work is never skipped: it is attempted with the remaining budget, and required
  coverage the budget cannot cover at all is blocking `unverified`.
- Implemented the supported bypass as a distinct snapshot-bound outcome. Bypass
  is disableable; a grant is refused when bypass is disabled, no marker is
  configured, the reason or a policy-required reference is missing, the grant
  names a different snapshot, the one-shot grant was already consumed, or the
  decision passed on its own. An accepted grant returns `bypassed`, never
  `passed`, preserves every failed and unverified check exactly as graded,
  records actor, reason, reference, snapshot identity and preserved failures,
  carries an evidence identity, and supplies the configured commit-visible
  marker.
- Stated the trust limit in the record itself: bypass and local enforcement are
  cooperative and report `tamperEvident: false`.

Contract amendment: added the additive `budget-exhausted` reason code, which
normalizes to `unverified` like every other harness failure family, and
documented the Gate policy contract alongside the evaluation process contract.

Scope held: Grader-surface integrity and runtime binding, the mutating `gate
fix` operation, evidence persistence and pruning, coordination and locking, and
activation and hooks remain unimplemented. The activated-commit fixture is a
test fixture representing the activated state, not the activation transaction.

Verification: `npm run test:unit` (129 passing), `npm run validate`, and
`npm run test:install`.
