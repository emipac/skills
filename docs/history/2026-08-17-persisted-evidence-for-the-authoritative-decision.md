# Persisted the Evidence the authoritative decision is made from

Delivered TB-026, a defect slice: the one evaluation that actually gates
work — the authoritative `commit-attempt` — appended nothing to the
clone-local Evidence store, because `runHook` never bound one.

- Found the missing bind. `evaluate` has always persisted through
  `persistEvidence(decision, { store: dependencies.evidenceStore ?? null, ... })`,
  and that dependency resolved to `null` on every commit. No envelope, no log
  entry, no Lifecycle event, and — since output capture also defaulted off —
  no record of what the failing command even printed. A denied commit was
  explained once on stderr and then gone; `RISK-001`'s stated mitigation
  (exact command evidence) did not exist at the moment it mattered.
- Opened the store the receipt already identifies. `openStore` in
  `hook-runner.mjs` builds its identity from facts the runner already has —
  the Git common directory `resolveReceipt` resolved, the receipt's pinned
  gate identity, a best-effort `git config user.name` actor, and the clone's
  own `evaluation_gate.evidence` ceilings — and opens the same store
  `openEvidenceStore` and `TB-008` already built and proved. Nothing about the
  store's contract changed; one caller was wired to it correctly.
- Turned on output capture on the one path that had it off. The envelope's
  whole purpose is a bounded, redacted excerpt of what a check printed;
  `captureOutput: true` is now set on the authoritative executor so that
  purpose is met where a maintainer actually reaches it.
- Wired declared runtime inputs into redaction. The receipt only ever named
  Sensitive inputs, never their values; `declaredSecrets` reads the value
  fresh from this invocation's own environment so a check that happens to
  print one has it caught by the same `createRedactor` mechanism the rest of
  the store already owns.
- Made an unrecorded commit impossible to allow. `evaluate.mjs`'s own
  `persistEvidence` deliberately does not deny a passing decision when the
  store merely fails to write (`NFR-OPER-001`: a store fault is a diagnosable
  local problem, not grounds to withhold a decision) — the one exception is an
  `unsafe-capture` refusal, which already forces `unverified` and therefore
  `deny`. The authoritative path's own contract is stricter: `report()` now
  checks `decision.evidence.persisted` and denies an `allow` whose evidence
  never landed, with a distinct `evidence-persistence-failed` reason naming
  what failed. A store that cannot even be opened denies before evaluation
  starts, for the same reason.
- Left the self-test path untouched. It still returns before the repository,
  configuration, or receipt are ever read, so it opens no store and writes no
  evidence — proven directly rather than assumed.
- Reused one client identity instead of stating it twice. `GIT_ADAPTER` now
  backs both the evaluation request's `invocation.adapter` and the store
  identity's `client`, so the two descriptions of "this runner, acting as
  git-pre-commit" cannot drift apart.
- Added an injectable `openEvidenceStore` seam, the same shape `evaluate` and
  `composeArguments` already have, so the open-failure and append-failure
  paths could be proven deterministically rather than through filesystem
  permission tricks.
- Extended `gate-activation-smoke`'s `authoritative-commit` scenario to read
  the same physical store the packaged runner opened internally after a real
  blocked and a real allowed `git commit`, proving the wiring against the
  actual entry point rather than only against the library function.
- Left the generic unsafe-capture refusal where it already lives. That
  mechanism belongs to `evaluate.mjs` and `evidence-store.mjs` and is already
  proved by `gate-evidence-secrets.test.mjs` and `gate-evidence-prune-smoke`;
  wiring a real store through the authoritative path means it now inherits
  that proof rather than needing a second one.

Scope held: no change to the envelope shape, the retention ceilings, the
redaction rules, or the pruning contract; no automatic deletion or retention;
no preflight runner (`TB-025` reuses this wiring rather than repeating it); no
`gate` lifecycle command surface or evidence-reporting view.

Verification: `npm run test:unit` (331 passing), `npm run validate` (29
skills, 231 Markdown files), `npm run test:install`, and regression runs of
all nine capabilities — `gate-runtime-binding-smoke`, `gate-fix-smoke`,
`gate-evidence-prune-smoke`, `gate-activation-smoke`,
`gate-hook-conformance-smoke`, `gate-lifecycle-smoke`,
`gate-adapter-conformance`, `gate-security-control-smoke`, and
`gate-runtime-portability`.
