# Transactional authoritative Git activation

Delivered TB-010 as the step that turns a configured clone into an activated
one — and, just as importantly, as the step that can fail at any point without
leaving a repository that refuses to work.

- Added the clone-local Activation transaction: a fixed nine-step pipeline that
  validates repository identity, previews the exact hook locations and resolved
  commands, takes consent bound to that exact preview, resolves every logical
  runner to a platform executable, establishes client-controlled trust,
  validates the existing hook chain, self-tests the evaluation process and the
  selected adapters, publishes a pinned receipt, and enables authoritative Git
  **last**.
- Journalled every gate-owned change with its compensating action. A failure at
  any step unwinds the journal in reverse and leaves the clone configured, with
  no receipt and no registration. Failure injection covers runner resolution,
  withheld trust, a failing evaluation self-test, a failing adapter self-test, a
  receipt that cannot be published, and the moment immediately before Git
  enablement.
- Made hook registration non-destructive. An existing `pre-commit` hook is never
  overwritten; a `core.hooksPath` owned by anything but this clone's own
  configuration, or pointing outside the clone, is refused rather than rewritten;
  and the gate-owned shim is published by one atomic rename.
- Made the adapter set all-or-nothing: an adapter becomes active only after it
  proves itself, and the first failure unwinds every adapter already registered.
- Made rollback refuse to repair drift it did not cause. A registered hook that
  changed on disk is reported and left in place, never deleted.
- Made an unrecordable activation no activation: if the transition cannot be
  appended to the Lifecycle event log, authoritative Git is withdrawn again.
- Added the Activation receipt to the existing clone-local store as current
  state rather than history — published and withdrawn atomically, while every
  transition still appends an immutable `activation` Lifecycle event. It pins
  the previewed identities, configuration identity, runtime and adapter
  versions, hook locations, trust state, runtime input **names**, and self-test
  results.
- Refused every prohibited entry point: activation during install or setup,
  global activation, implied or reused consent, consent for another clone, and
  enabling Git before the self-tests pass. Trust is never granted on the
  operator's behalf.
- Added the `gate-activation-smoke` capability, which activates a throwaway
  clone for real and then proves the result is authoritative: a real `git commit`
  is blocked when the required check fails and allowed when it passes.

Scope held: no ordered hook-chain composition strategy or paused-and-resumed
trust identity, no `gate update`/`status`/`repair`/`deactivate`/`uninstall`, no
desktop adapters, and no approval or injection of runtime input values. This
slice registers a hook only where none exists and records input names only.

Verification: `npm run test:unit` (188 passing), `npm run gate-activation-smoke`,
`npm run gate-runtime-binding-smoke`, `npm run gate-fix-smoke`,
`npm run gate-evidence-prune-smoke`, `npm run validate`, and
`npm run test:install`.
