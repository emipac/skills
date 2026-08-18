# Never restarted work the operator stopped

Delivered TB-027, a defect slice found on a real Cursor session: the maintainer
stopped the agent, the `stop` hook fired anyway, preflight answered with a
`followup_message`, the client submitted it as the next user message, and the
agent started again. Stopping it again did the same thing. The loop ended only
when the hook was commented out.

- Read the turn, through the adapter's own declaration. `nativeIdentity` gains
  a `turn` block naming the field that carries the status, the values that mean
  *completed*, the values that mean *interrupted*, and the field carrying the
  client's iteration counter. Cursor declares all four; Git and the two other
  desktop surfaces declare `turn: null`, because no captured payload from them
  has ever carried one and they keep the behaviour they have always had.
- Answered only a completed turn. An interrupted one produces nothing on the
  agent's channel — not an `unverified` presentation, not a silent pass, simply
  nothing, because the operator asked for nothing. The `stop` event fires for
  both a finished turn and a stopped one, so firing is not by itself
  `work-complete`; only the declared completed values are.
- Refused to guess an unfamiliar status. A value in neither declared list, and
  a payload missing the declared field entirely, is `unverified` through the
  declared channel rather than assumed to mean the turn finished. An unknown
  status is not evidence of completion (`NFR-REL-003`).
- Bounded repetition on the gate's own side. The declared feedback block gains
  `maxIterations`, and Cursor declares two: the first answer says what failed,
  the second gives one turn to act on it, and a third repetition of an
  unchanged verdict has nothing to add. The client's counter is honoured where
  it advances — and every captured payload from the observed loop reported
  zero, so the bound that actually holds is the gate counting its own
  append-only evidence for repeats of the same evaluation identity. An
  evaluation identity is a function of what was evaluated, so a repeated
  identity is the same verdict about unchanged content.
- Made silence legible. Every deliberate silence writes one stderr line saying
  why. The client shows hook stderr in its own panel, which is how every
  decision in this investigation was read, so a maintainer can tell "nothing
  was wrong" from "I was told not to speak" while the agent's channel stays
  empty.
- Reported a hook that names no adapter. A registration wired without
  `--adapter` returned in 73ms having read nothing and looked exactly like a
  clean turn — the one silence that could not be distinguished from success.
  It now says so on stderr. This is a small addition beyond the ticket's
  wording, made because building the stderr channel while leaving the worst
  silence unaddressed would have been incoherent.
- Built payloads that model a real client. `buildNativePayload` constructs from
  the declaration, so it now carries a completed turn for any surface that
  declares one; a fixture payload without it modelled a client that does not
  exist and hid every rule that reads it.
- Left the authoritative path untouched. `git commit` is an explicit operator
  action; nothing here changes `gate-precommit.mjs`, `runHook`, or what a
  commit is allowed to do.

Scope held: no blocking preflight, no exit status carrying a decision, no
retry or backoff, no client name or native field name outside `adapters.mjs`,
and no suppression of feedback on a completed turn whose verdict merely
repeats.

One unrelated repair travelled with this slice. `gate-hook-conformance-smoke`'s
`desktop-registration` scenario expected a registered command with no
arguments, while TB-025 had already made desktop registration name the adapter
it answers. The capability was red on the branch before this work started —
verified by stashing these changes and re-running it — and its expectation now
matches the shipped behaviour.

Verification: `npm run test:unit` (345 passing, including nine new
`tests/gate-preflight-runner.test.mjs` cases), `npm run validate` (29 skills,
241 Markdown files), `npm run test:install`, and regression runs of all nine
capabilities — `gate-runtime-binding-smoke`, `gate-fix-smoke`,
`gate-evidence-prune-smoke`, `gate-activation-smoke`,
`gate-hook-conformance-smoke`, `gate-lifecycle-smoke`,
`gate-adapter-conformance` (with `packaged-preflight-answers-client` extended
to drive an aborted turn and an adapterless registration),
`gate-security-control-smoke`, and `gate-runtime-portability`.

SRS revision `0.2.6` is drafted and awaiting approval: the iteration bound
extends `FR-ADAPT-004`'s feedback enumeration and `AC-ADAPT-002`. The
turn-status half needed no amendment — `FR-ADAPT-003` already requires
normalizing a native event to the trigger it actually means.
