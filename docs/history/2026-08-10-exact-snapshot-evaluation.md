# Exact-snapshot evaluation through the Verification seam

Delivered TB-004 as the evaluation process seam of the Change Evaluation Gate
module.

- Added the versioned `evaluate(request) -> decision` process contract at
  protocol version 1.0, with an exact snapshot target, optional
  delivery-contract reference, Enforcement role, normalized trigger, adapter
  capability identity, and session identity.
- Rejected unknown request fields so a client cannot smuggle client-native
  payloads, verification commands, or policy overrides through the seam.
- Returned one complete decision envelope carrying evaluation and protocol
  identity, outcome, authorization, Evaluation scope, snapshot and environment
  identity, ordered check results with code-grader metadata, atomic Check
  assertions, preserved Check attempts, advisories, coverage, integrity,
  delegation, diagnostics, and evidence identity.
- Kept transport success independent of authorization: a preflight role is
  always `not-authoritative`, and only an authoritative role maps `passed` to
  `allow`.
- Materialized the exact proposed snapshot in a separate execution root for
  both `git-index` and `worktree` targets, deriving the snapshot identity from
  the execution root so a decision can never name a tree different from the one
  the checks ran against. Materialization writes no Git object, no index, and
  no commit.
- Re-derived the execution-root identity after evaluation so a change to
  evaluated source during a check is `snapshot-mismatch` and `unverified`.
- Delegated ordered check resolution and execution to `verify-change`: the
  Evidence ladder is imported rather than restated, and only a descriptor's
  non-mutating evaluation command is ever invoked.
- Made an identical binding reproducible: the same ordered descriptors, the same
  configured command inputs, and the same decision apart from the host-local
  execution root.
- Preserved every Check attempt with a reason classification, normalized missing
  prerequisites, invalid configuration, timeout, crash, malformed output,
  snapshot mismatch, integrity drift, and coordination failure to `unverified`,
  and classified conflicting equivalent attempts as `attempt-conflict` without
  retrying or choosing a winner.

Scope held: authorization policy and budget/bypass, Grader-surface integrity and
runtime binding, evidence persistence, coordination and locking, and activation
and hooks are declared decision fields only and remain unimplemented.

Verification: `npm run test:unit` (121 passing), `npm run validate`, and
`npm run test:install`.
