# Preserved hook chains and bound activation identity

Delivered TB-011 as the step that lets activation live alongside whatever a
repository already does at commit time, and that refuses to finish a transaction
that is no longer the one the operator approved.

- Added the declared hook composition order (`FR-LIFE-017`): a hook manager's own
  integration point first, then a confirmed marker-delimited block inside an
  existing repository-local hook, and only where no hook exists at all a clearly
  owned shim. The selected strategy is previewed, consented to, and pinned in the
  Activation receipt as the hook's `ownership` label plus a `hookChain` record.
- Made composition preserve *and execute* the prior chain. The gate-owned block
  is placed directly after the shebang rather than appended, because most hooks
  end in `exit 0` and would never reach an appended block. Removing the block
  again reproduces the prior hook byte for byte, and rollback refuses to write
  unless it does.
- Detected hook managers by layout only — no manager is installed or executed, so
  no external toolchain became a test dependency. A manager with a managed hook
  directory is registered into natively; one whose only integration point is a
  declaration (`lefthook.yml`, `.pre-commit-config.yaml`) is refused with
  `hook-manager-manual-registration` rather than edited on the operator's behalf.
- Required an explicit confirmation naming the exact hook by path and content
  identity before composing into it. An unconfirmed hook still refuses with
  `hook-exists`; a hook edited since the operator looked at it refuses with
  `hook-confirmation-mismatch`; a hook that is not a POSIX shell script refuses
  with `hook-chain-uncomposable`.
- Made marker drift require manual resolution. Any gate-owned block already
  present — malformed, duplicated, or perfectly intact — refuses with
  `hook-marker-drift`, and no confirmation can authorize composing into it.
- Kept a shared or global `core.hooksPath` unreachable. It is refused before any
  strategy is considered, a hook confirmation is never permission to reach into
  it, and the setting is never rewritten to escape it.
- Added paused-and-resumed transactions (`FR-LIFE-016`). A client that has not
  answered the trust prompt yet pauses the transaction instead of failing it: the
  journal is still unwound, so no integration is active anywhere, and the result
  carries the transaction identity plus the repository, configuration,
  selected-adapter, and preview identities it may be resumed against. Every one
  is re-derived and compared before consent is read and long before anything is
  written.
- Made non-interactive activation name what it means (`FR-LIFE-015`). A flag says
  "do not ask", never "this is the right repository": without both expected
  identities it refuses with `non-interactive-identity-missing`, and a wrong one
  refuses before any clone-local mutation. Consent is still required separately.
- Added the `gate-hook-conformance-smoke` capability. It composes into a real
  hook whose only job is to leave an observable trace, then proves with real
  `git commit` invocations that the prior chain still runs and that the gate
  still blocks a failing change — the difference between a hook that survives on
  disk and a hook that survives in the chain.

Scope held: no `gate update`/`status`/`repair`/`deactivate`/`uninstall`, no
desktop adapters, no dual-policy transition, and no approval or injection of
runtime input values. This slice binds adapter identity in resumption; the
adapters themselves are TB-013.

Verification: `npm run test:unit` (199 passing), `npm run gate-hook-conformance-smoke`,
`npm run gate-activation-smoke`, `npm run gate-runtime-binding-smoke`,
`npm run gate-fix-smoke`, `npm run gate-evidence-prune-smoke`,
`npm run validate`, and `npm run test:install`.
