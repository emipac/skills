# Activated a clone from a command

Delivered TB-042. A maintainer, or an agent acting for one, can now activate an
already-configured clone by running a command: one invocation shows the exact
preview, a second confirms that preview, and the transaction runs unchanged.
The receipt records what the Gate can prove about that consent and claims
nothing more.

- Supplied the three activation seams that had no defaults, and dispatched trust
  on each adapter's declared model.
- Activating a configured fixture through `gate activate` runs every step in the
  settled order, enables Git last, and leaves commits evaluated authoritatively
  (`AC-LIFE-002`, `FR-LIFE-004`).
- A confirmation naming a different preview, or presented against a changed
  repository or configuration identity, writes nothing and states why
  (`AC-LIFE-008`).
- The receipt's trust record names the consent mechanism that was verified; a
  supplied actor is marked self-declared, and no field asserts a human the
  command could not observe (`FR-LIFE-006`, `SG-TRUST-001`).
- A desktop adapter whose client has not granted trust pauses, leaves no Gate
  integration active, and resumes only with the identities it recorded
  (`AC-LIFE-009`, `FR-LIFE-016`).

Evidence added: `tests/gate-activation-command.test.mjs` and
`tests/gate-operator-surface.test.mjs`, with `gate-activation-smoke` and
`gate-lifecycle-smoke` extended. `README.md`, `SKILL.md`, and the Codex agent
metadata document the command.
