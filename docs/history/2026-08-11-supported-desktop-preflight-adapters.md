# Supported desktop preflight adapters

Delivered TB-013 as the slice that lets three desktop clients show a developer
what the Gate thinks — without any of them being able to decide anything.

- Added the adapter layer: the authoritative Git integration plus Claude Code
  Desktop's local Code tab, Codex Desktop with a local project, and Cursor IDE's
  local Agent, as the complete v1 set. `Q-003` is respected: no fourth client.
- Made one decision serve every surface. Authorization is re-derived from the
  adapter's Enforcement role through the existing `authorizationFor` policy
  seam, so a `deny` blocks the authoritative Git surface with a non-zero status
  while the identical decision presents on every desktop surface as structured
  `not-authoritative` preflight feedback that blocks nothing. A preflight
  surface cannot present `allow` or `deny` however the decision it was handed
  was authorized.
- Kept adapters thin. They normalize, confirm trust, invoke the shared
  `evaluate(request) -> decision` seam non-interactively under a declared
  timeout, and present. They reimplement no policy and choose no checks.
- Made each adapter declare its own event, blocking, trust, repository,
  session, filesystem, Git, and invocation capabilities. A declaration that
  omits a category, or invents one, is rejected rather than defaulted, so no
  adapter can inherit another client's contract.
- Normalized each surface's own deterministic completion event to
  `work-complete`, and `before-commit-attempt` only where the surface provides
  one — Codex Desktop provides none and does not invent it. A native event a
  surface does not declare, including another client's event name, normalizes
  to nothing.
- Closed the native boundary. Exactly three values are read out of a native
  payload through that adapter's own declared field paths; nothing else is ever
  copied. The request reaching gate core is asserted to be the process
  contract's exact shape, and gate core still carries no branch on a client
  name.
- Made every defined failure honest. Trust failure, invocation failure,
  timeout, capability mismatch, and malformed output each present as
  `unverified` with a contract reason code, and none of them is mistakable for
  a clean preflight. On the authoritative surface an `unverified` outcome can
  only ever become `deny`.
- Added the shared compatibility baseline: ten checks executed against a real
  repository and real Git, never inferred from the declaration, each recorded
  with the exact Gate, Git, Node.js, client, and operating-system versions it
  was observed under.
- Made Support tier capability-based and evidence-based. All three desktop
  surfaces declare no native blocking and are `supported` anyway; remove the
  baseline evidence and the same surface drops to `experimental`. CLI, SSH,
  remote, cloud, and background-agent variants are `experimental`; a context
  without repository filesystem, process execution, and Git access is
  `unsupported` whatever it claims.
- Added the `gate-adapter-conformance` capability, which activates a throwaway
  clone with all four adapters, has a real `git commit` really refused, reads
  the decision that refused it back off disk, and presents that same decision on
  all three desktop surfaces. It requires no desktop client to be installed:
  each surface is driven by an injected native payload built from that adapter's
  own declared field paths, offline.
- Extended the install smoke so the distributed plugin proves its adapters stay
  dormant: the library and its contract ship, and no activation receipt exists.

Scope held: no dual-policy transition or sensitive runtime inputs (TB-014), and
no release qualification, compatibility manifest, or `0.9.0` version bump
(TB-015). This slice records exact versions and outcomes per surface; assembling
them into a release manifest belongs to TB-015.

Verification: `npm run test:unit` (221 passing), `npm run test:install`,
`npm run gate-adapter-conformance`, `npm run validate`, and regression runs of
`gate-runtime-binding-smoke`, `gate-fix-smoke`, `gate-evidence-prune-smoke`,
`gate-activation-smoke`, `gate-hook-conformance-smoke`, and
`gate-lifecycle-smoke`.
