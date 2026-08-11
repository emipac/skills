# Protected policy transitions, Sensitive inputs, and control-surface drift

Delivered TB-014, the security slice: a change can no longer weaken the policy
that judges it, an approved Sensitive runtime input leaves no raw value behind,
and independent drift of the Gate control surface stops the Gate from
authorizing anything.

- Added `scripts/lib/security-control.mjs` with three seams and one stated trust
  boundary. Existing modules were extended in place; nothing was forked.
- **Dual-policy transitions.** `evaluatePolicyTransition` grades a
  policy-surface change under both the prior Trusted configuration and the
  candidate it proposes. The candidate is validated separately as a candidate,
  the transition takes the stricter of the two outcomes, and trust advances only
  when both policies pass **and** an approval names the exact candidate content
  hash. A candidate that demotes the one required check the change fails passes
  its own weaker policy, fails the Trusted policy, and neither advances trust nor
  authorizes. `policyWeakenings` names what was relaxed, but the protection is
  that the Trusted policy decides — not the diagnostic list.
- **Sensitive runtime inputs.** `materializeRuntimeInputs` copies only the input
  names the Activation receipt pinned into a `0600` directory inside the
  isolated materialization, records name and source only, and `release()`
  removes that directory — bounded to the one path it created. An unconfirmed
  input is refused by name and its value is never read, copied, or reported. The
  module reads no ambient environment and no credential store; values arrive
  from the caller.
- **Control-surface drift.** `reconcileControlSurface` reconciles all seven
  pinned surfaces — runtime, adapters, managed hooks, receipt, trusted
  configuration, Command descriptors, and providers. `gate status` now accepts an
  observed control surface and reports `broken` on independent drift; `evaluate`
  now accepts one and emits `integrity-drift`, which normalizes an authoritative
  decision to `unverified` / `deny` without rewriting what any check reported.
  Reconciliation repairs nothing, writes nothing, and appends no event: recovery
  stays a confirmed operator action.
- **Grader changes stay visibility.** An edited test, script, provider, or Gate
  configuration is reported through `visibleGraderSurfaces` with
  `classification: 'none'`. A control-surface edit inside the change sets
  `policyTransitionRequired` — a stricter route, not an accusation, and a
  different thing from drift of the machine.
- **Honest trust boundary.** `TRUST_BOUNDARY` states, as data carried on every
  reconciliation result, that this is a cooperative local process running with
  the machine owner's own permissions; that reconciliation reports what changed
  rather than resisting the owner; and that nothing here is tamper-proof or a
  sandbox. A test scans every module, script, and contract document under
  `skills/change-evaluation-gate/` and fails on any unqualified claim of
  resistance, containment, or encryption.
- Extended the secret-canary pattern established by TB-008: the fixtures plant a
  synthetic canary raw, base64, base64url, hex, and percent-encoded, and assert
  absence across every retained byte — configuration, decisions, envelopes,
  blobs, Lifecycle events, the Activation receipt, and the execution root.
- Added the `gate-security-control-smoke` capability, which proves the packaged
  runtime-input, drift, and policy-transition behavior against throwaway Git
  repositories, a real Evidence store, a real child-process check that echoes
  the approved value in three forms, and a real isolated materialization.

Scope held: no release qualification, no compatibility manifest, and no version
bump — all TB-015. No Git state, hook, or credential store of this repository was
read or written; every fixture is a throwaway repository under the OS temporary
directory, guarded by `assertThrowawayRepository`.

Verification: `npm run test:unit` (232 passing, 221 before this slice),
`npm run gate-security-control-smoke`, plus regression runs of
`npm run gate-runtime-binding-smoke`, `npm run gate-fix-smoke`,
`npm run gate-evidence-prune-smoke`, `npm run gate-activation-smoke`,
`npm run gate-hook-conformance-smoke`, `npm run gate-lifecycle-smoke`,
`npm run gate-adapter-conformance`, `npm run validate`, and
`npm run test:install`.
