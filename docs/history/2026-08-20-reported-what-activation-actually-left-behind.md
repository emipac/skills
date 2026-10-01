# Reported what activation actually left behind

Delivered TB-035. A failed activation now leaves a clone the maintainer can
either use or fix, and says which. It never reports success while its receipt is
unwritten, never claims a clean rollback it did not achieve, and never accepts a
hook program that merely crashed as one that enforces.

- An activation whose receipt cannot be written or read back reports a
  non-activated state and leaves no registered hook, so the clone commits
  exactly as it did while configured (`AC-LIFE-002`, `NFR-REL-002`).
- A rollback whose compensating action fails reports a state distinct from a
  clean unwind, naming each failed action and what remains (`SG-LIFE-001`).
- A hook program that crashes without answering the self-test subject fails the
  step as unproved, distinctly from one that answered by denying
  (`NFR-REL-003`).
- An exception thrown after any Gate-owned mutation is caught, and the mutation
  is compensated or reported.

Evidence added: `tests/gate-activation.test.mjs`,
`tests/gate-hook-conformance.test.mjs`, and `tests/gate-lifecycle.test.mjs`,
with `gate-activation-smoke`, `gate-adapter-conformance`,
`gate-hook-conformance-smoke`, and `gate-lifecycle-smoke` extended. The
activation-transaction contract records the reported states.
