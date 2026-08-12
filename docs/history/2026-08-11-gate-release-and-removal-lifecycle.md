# Managed the active release and removal lifecycle

Delivered TB-012 as the step that lets an activated clone take a new release,
be observed without being changed, be recovered explicitly, and be removed
without taking anything with it that was never the Gate's.

- Separated ordinary distribution from activation (`FR-LIFE-014`). Installing a
  newer skill, plugin, or package makes a *candidate* release visible and does
  nothing else; `inspectRelease` reports the difference and states plainly that
  it advances nothing. Only an explicit, successful `gate update` moves the
  Active gate release.
- Made `gate update` atomic by construction rather than by compensation
  (`FR-LIFE-008`). `UPDATE_STEPS` is frozen and ends at `release-switch`, so
  nothing before the switch touches the published receipt and a failure at any
  earlier step leaves the previous release byte for byte where it was. A
  candidate that changes protocol version, or a migration that cannot be undone,
  is refused before anything runs; migrations that did run unwind
  last-applied-first. The switch itself is one atomic receipt write, and the new
  receipt records the receipt id, release, preview, and migrations it superseded.
- Made `gate status` genuinely free of side effects (`FR-LIFE-009`). It opens
  nothing for writing, appends no Lifecycle event — deliberately not even a
  `drift-detected` one — and repairs nothing. Health is graded by *authority*,
  not by count: a lost non-authoritative adapter is `degraded`, a lost
  authoritative adapter or a missing or tampered registration is `broken`, and
  a configured-but-not-activated clone is `healthy` because nothing is being
  enforced. Both the unit suite and the capability prove purity by comparing a
  full byte-level snapshot of the clone before and after observation.
- Closed TB-011's known gap: **a durable content identity for the gate-written
  hook block**. The registration names the receipt that authorized it and the
  receipt must name the registration — a cycle no hash closes. It is broken by
  hashing the registration with exactly that one self-referential line replaced
  by a placeholder, which makes the identity computable *before* the receipt
  exists and pinnable inside it as `receipt.hookChain.blockIdentity`. The elided
  value is not lost: it is the receipt's own `receiptId`, compared literally. The
  two checks together cover every byte of the registration with no circularity,
  and they are what let `gate status`, `gate repair`, and `gate deactivate` work
  from a published receipt in a later process rather than from an in-flight
  rollback journal.
- Made every removal path conservative and never partial (`SG-LIFE-001`,
  `NFR-REL-002`). `gate deactivate` proves every registration removable before
  it removes the first one and refuses the whole operation on drift;
  `gate uninstall` requires a prior deactivation and refuses, by construction,
  anything outside the project, the shared configuration file, anything under
  the Evidence store, and any asset the maintainer has since edited;
  `gate cleanup` removes only previewed top-level Gate keys and never deletes
  the shared file. Cleanup is line-oriented rather than a
  parse-and-reserialize, because reserializing would rewrite comments, quoting,
  and ordering that have nothing to do with the Gate.
- Kept recovery explicit (`FR-LIFE-019`). Drift survives status, an ordinary
  update, and a distribution bump, and changes only through a confirmed
  `gate repair` or a new Activation transaction. `restoreHookRegistration`
  refuses unless the registration it is about to write reproduces the identity
  the receipt pinned and the surrounding chain is still the chain the activation
  promised to preserve.
- Added the two operator commands TB-008 and TB-009 deliberately deferred here:
  `gate prune` (preview and confirm, delegating to the store's own pruning seam,
  removing blobs and never envelopes, events, pruning records, or tombstones)
  and `gate locks` (read-only inspection that never acquires and never recovers;
  a live holder is nobody's to take).
- Added the `gate-lifecycle-smoke` capability. It activates real throwaway
  clones, composes into a hook they already had, proves the gate really blocks a
  commit, deactivates, and proves the same commit then succeeds *and* the
  repository's own hook chain still runs — with an unrelated hook, the unrelated
  keys of a shared configuration file, historical Evidence, and a global asset
  outside the project all asserted to survive.

Contract amendment, accepted and applied: the Activation receipt's `hookChain`
gained the additive `blockIdentity` field. Two TB-011 assertions that compared
`hookChain` by deep equality were updated to include it; no TB-011 behavior
changed.

Verified with `npm run test:unit` (213 passing), `npm run validate`,
`npm run test:install`, and all six Gate capabilities — `gate-runtime-binding-smoke`,
`gate-fix-smoke`, `gate-evidence-prune-smoke`, `gate-activation-smoke`,
`gate-hook-conformance-smoke`, and the new `gate-lifecycle-smoke` — each exiting 0.

The three desktop adapters (TB-013), the dual-policy transition and sensitive
runtime inputs (TB-014), and release qualification with the `0.9.0` version bump
(TB-015) remain out of scope.
