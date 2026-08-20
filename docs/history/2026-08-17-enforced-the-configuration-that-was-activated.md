# Enforced the configuration that was activated

Delivered TB-031, a defect slice raised both by the recorded evidence of real
commits in `real-project-evidence/` and, independently, as a `P0` by an external
audit: activation pinned the approved configuration identity and nothing ever
compared it. `reconcileControlSurface` was complete, correct, and reachable only
from its own tests.

- Wired the reconciliation into the two entry points that reach a maintainer.
  `evaluate` guards it behind `if (dependencies.controlSurface)`, and the only
  callers that ever supplied it were a smoke and a unit test — so the guard read
  as satisfied everywhere it was tested and was false everywhere it mattered.
  Both runners now supply it on every evaluation. This is the fourth instance of
  the shape `TB-023`, `TB-024` and `TB-026` had, and the first where the
  unreached component was a security control.
- Gave the observation one owner. `observeControlSurface` in `hook-runner.mjs`
  assembles what this machine looks like now, and the authoritative runner and
  the packaged preflight runner both reach it — the reason `TB-024` gave
  resolution one owner and `TB-026` gave the Evidence store one wiring. A source
  scan proves there is exactly one definition and exactly two callers, because a
  second copy of the question is how the two would come to disagree.
- Computed the observed configuration identity with `configurationIdentity`, the
  rule the receipt was pinned with. An observation that hashed the file
  differently would report drift on every commit, and one that hashed less than
  the receipt pinned would miss the edit the slice exists to catch.
- Recomputed the receipt's own content identity from the file rather than
  reading the id it states about itself. Without that, an agent that weakened
  the policy and re-pinned the receipt to match would have matched itself, and
  the surface would have been ceremonial.
- Pinned the exact previewed invocation for each resolved runner. The receipt
  pinned the executable and its version, and `evaluation_gate` binds which
  checks are required — neither says what a check is asked to *run*, so a
  widened or redirected argument vector was invisible to every identity in the
  system. The audit named that case explicitly; wiring alone would not have
  closed it.
- Kept a changed Grader surface distinct from drift. A commit that edits
  `.agent-framework.yaml`, a test, or a provider is ordinary work, reported as
  visibility by `TB-006` and never as an accusation; independent drift of a
  pinned surface is a different claim. Both are proved in the same suite so the
  distinction cannot quietly collapse (`FR-EVAL-009`).
- Reported what cannot be observed as drift rather than as a match. A pinned
  hook registration that is gone, unreadable, or malformed observes as absent,
  and a receipt naming provider identities activation never pins cannot be
  matched by this machine at all.
- Said out loud what the observation cannot re-derive. The gate release version
  and `runnerVersion` are declared by the caller that ran activation and are not
  readable from the machine at decision time, so they are carried from the pin
  and the runtime surface asserts what is observable: that the program deciding
  now is this gate, speaking this protocol version.
- Fixed the fixtures rather than loosening the rule. Every hand-written receipt
  in the suites pinned `sha256:configuration` and `sha256:receipt` — identities
  no activation could produce. They now compute what `activate` computes, so the
  suites prove the reconciliation is quiet on a clone that could exist instead
  of proving it never fires.
- Proved every regression through the real `runHook`, the real `runPreflight`,
  and the shipped `gate-precommit.mjs`, and every drift case through a real
  `git commit` in `gate-activation-smoke`. Testing `reconcileControlSurface`
  again would have repeated the exact defect this ticket is about.

Scope held: `reconcileControlSurface`, the closed set of control surfaces, and
the `integrity-drift` reason code were not touched; nothing is repaired,
re-pinned, or re-activated, and the message names `gate repair` and stops there;
a preflight surface reporting drift is still `not-authoritative` and blocks
nothing (`SG-SUPPORT-001`); no lifecycle command surface or health view was
added; the observation opens no file for writing. Detection did not become
resistance — a machine owner can change every identity above, and noticing is
the entire claim (`SG-TRUST-001`, `ASM-001`). Enforcement did not become
paranoia: the unchanged commit fixtures still allow a passing change and deny a
failing one through a real `git commit`, with no added diagnostic.

Verification: `npm run test:unit` (377 passing, up from 369), `npm run validate`
(29 skills, 254 Markdown files), `npm run test:install`, and regression runs of
all nine capabilities — `gate-runtime-binding-smoke`, `gate-fix-smoke`,
`gate-evidence-prune-smoke`, `gate-activation-smoke`,
`gate-hook-conformance-smoke`, `gate-lifecycle-smoke`,
`gate-adapter-conformance`, `gate-security-control-smoke`, and
`gate-runtime-portability`. Red before green was recorded twice: the first unit
fixture allowed the very commit it had just blocked once the required check was
demoted (`passed / allow` with the check still `failed`), and the new
`activated-configuration-binds` scenario moved `HEAD` under a hand-weakened
policy until the observation was wired.
