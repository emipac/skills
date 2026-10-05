# Trusted what a client can actually grant

Delivered TB-046. Every declared adapter can now be activated. An adapter's trust
model names something the Gate can establish, the contract says what each model
means, and no adapter can declare a model that nothing defines and nothing
proves.

- All four adapters declare `repository-hook-registration`, and trust dispatch
  derives from the adapter registry rather than restating it.
- Activating each declared adapter on a configured fixture completes, registers
  exactly its declared surface, and writes a receipt — where `cursor` and
  `claude-code-desktop` could not complete before (`AC-LIFE-009`,
  `FR-LIFE-004`).
- Every declared trust model is defined by the adapter conformance contract, and
  a declared model the contract does not define fails a test (`AC-ADAPT-003`,
  `FR-ADAPT-008`).
- An unrecognized trust model is still refused rather than granted or paused.
- A client review that happens after registration is recorded, never awaited.
- An activation that fails after trust still leaves the clone configured with no
  receipt and no registration, for a desktop adapter as well as for Git
  (`AC-LIFE-002`).

Evidence added: `tests/gate-activation-command.test.mjs` and
`tests/gate-adapters.test.mjs`, with `gate-activation-smoke` and
`gate-adapter-conformance` extended.
