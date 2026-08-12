# Corrected desktop preflight adapter declarations

Reopened TB-013 after driving all three real desktop clients refuted 13 of its
14 declared mappings, left 1 unverified, and left none standing. The first pass
was internally consistent and externally fictional: it invented a payload shape,
wrote fixtures in that shape, and passed.

- Replaced every declared native field and event value with the observed one.
  All three clients send `hook_event_name`, `session_id`, and
  `transcript_path`. Claude Code and Codex send the event value `Stop` and a
  `cwd`; Cursor sends `stop` in lowercase, an array-valued `workspace_roots`,
  and a self-reported `cursor_version`.
- Made the repository root **resolved, never assumed**. The path a client sends
  is a candidate: the same field was observed carrying a repository root under
  one client and a directory that is not one under another. The adapter now
  walks upward to a real repository root and reports `unverified` when no
  repository contains the path. It never falls back to the candidate, because a
  guessed repository root is worse than an admitted missing one.
- Gave Cursor's array of workspace roots an explicit rule instead of a field
  rename. Exactly one element yields a candidate; zero or several yield none,
  because a multi-root workspace has no single repository root and selecting an
  element would be a guess.
- Dropped `commit-attempt` from `claude-code-desktop` entirely, including its
  `normalizedTriggers`. That client's hook events are enumerated and none of
  them is a before-commit event, so the mapping follows the conservative
  non-declaration `codex-desktop` already made — the one call the first pass got
  right, and the one it reached by refusing to invent.
- Added `unverifiedTriggers`, because an unobserved trigger is not the same as a
  known-absent one. Cursor's `commit-attempt` was never observed and never
  disproven; it is recorded there and kept out of `nativeEvents` and
  `normalizedTriggers`, so nothing can normalize to it while the open question
  stays visible to release qualification.
- Kept three separate declarations. `hook_event_name` and `session_id` are
  universal today and Claude Code and Codex are near-identical, which makes one
  shared mapping the obvious refactor and the wrong one: today's convergence is
  an observation, not a guarantee, and Cursor already diverges on event casing,
  field name, and field shape.
- Kept trigger matching exact-string. `Stop` and `stop` are a real per-client
  distinction, and a case-insensitive compare would erase it and let one adapter
  accept another client's event.
- Made the compatibility baseline record **how it was driven**, and made the
  Support tier honour it. A baseline whose fixtures were built from the
  declaration under test cannot establish that the declaration matches the
  client; the fixture and the thing under test come from the same source. A
  fixture-driven pass now classifies `experimental` with reason
  `client-invocation-not-observed`, and an unstated provenance records as
  synthetic rather than assumed real.
- Extended `gate-adapter-conformance` with a fourth scenario that drives every
  surface through a path that is a repository root, a path inside one, a path
  inside none, and a multi-root workspace, against real repositories on disk.

Support tier: **all three desktop surfaces are `experimental`**, not
`supported`. Their declarations now rest on real captured payloads and each
passes the offline baseline, but no adapter has been driven end to end by a real
client invocation, and the only exact client version known came from a capture
rather than a baseline run. `AC-ADAPT-001` is met; `AC-ADAPT-002` remains open
and its checkbox unticked.

Boundary held under real evidence rather than assumption: the captured payloads
carry conversation content and personal data, which is precisely what the
normalize-a-fixed-few-fields boundary exists for. No captured value entered this
repository — every fixture uses synthetic values with the real shape.

Scope held: the hook-registration divergence across clients (different files,
nesting, discriminators, and schema versioning) affects activation and health
reconciliation rather than adapter declarations and is deferred to its own
delivery contract. Release qualification, the compatibility manifest, and the
`0.9.0` bump remain TB-015.

Verification: `npm run test:unit` (239 passing), `npm run test:install`,
`npm run gate-adapter-conformance`, `npm run validate`, and regression runs of
`gate-runtime-binding-smoke`, `gate-fix-smoke`, `gate-evidence-prune-smoke`,
`gate-activation-smoke`, `gate-hook-conformance-smoke`, `gate-lifecycle-smoke`,
and `gate-security-control-smoke`.
