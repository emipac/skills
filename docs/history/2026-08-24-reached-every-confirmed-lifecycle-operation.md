# Reached every confirmed lifecycle operation

Delivered TB-041. Every lifecycle operation that writes — recovering drift,
taking a release, removing the Gate, cleaning configuration, pruning evidence,
recovering a stale lock — is now reachable by a maintainer and by an agent,
always as a preview the operator reads and a separate confirmation of that exact
preview, and always recorded.

- A clone with a clobbered managed hook block is restored by a confirmed
  `gate repair` to exactly what the receipt authorizes, and is left unrepaired by
  every other command (`FR-LIFE-019`, `AC-LIFE-010`).
- For every operation, a confirmation that does not reproduce its preview
  writes nothing and states why, proved by comparing the whole clone and store
  before and after (`NFR-REL-002`).
- A single invocation that would both preview and confirm is refused, with the
  reason.
- Deactivation removes only unchanged Gate-owned registrations and the receipt;
  uninstall removes only project assets and keeps shared configuration, global
  assets, and all historical Evidence (`AC-LIFE-005`).
- An ordinary distribution bump only makes a candidate release available
  (`AC-LIFE-007`, `FR-LIFE-014`).
- Creating the coordination directory moved off the read path, so inspecting a
  lock no longer creates one.

Evidence added: `tests/gate-coordination.test.mjs` and
`tests/gate-operator-surface.test.mjs`, with `gate-lifecycle-smoke` extended.
`SKILL.md` and the lifecycle command contract document every operation.
