# Skipped preflight for an unchanged passed tree

A dirty worktree made every end-of-turn preflight a full evaluation: four
consecutive turns on `myframe-api` changed nothing and each ran five checks for
about 31 seconds and appended an identical `passed` envelope. The idle-turn skip
(`TB-039`) only covers a clean worktree.

- `unchanged-evaluation.mjs` derives the identity a worktree snapshot would get
  from the live files (the same `contentIdentity` over the same listing, no
  copy), predicts the configuration identity through the now-shared
  `configurationIdentityFor`, and scans the newest 25 recorded evaluations for a
  `passed` one with that snapshot identity, configuration identity, and purpose,
  no diagnostic, no changed Grader surface, and no unversioned one (a decision
  states those on every evaluation, `FR-EVAL-009`).
- `evaluateActivatedTree` takes `reuseUnchangedPass`; only `runPreflight` sets
  it. On a match it answers through `evaluateWithoutSubject`, so drift and
  unavailable dependency roots are still reported, nothing is materialized, and
  the decision says `unchanged-since-passed`.
- Failed, `unverified`, and `bypassed` decisions never match. An unreadable file,
  log, or envelope runs the evaluation. `gate check` and the commit hook are
  untouched.

Not covered, and so not reused: ignored files such as `.env`, dependencies
changed without their lock file, a database, the clock.

Scope held: no change to the Evidence store shape, the repeat bound, snapshot or
evaluation identities, or the authoritative path.

Evidence added: `tests/gate-unchanged-pass.test.mjs`.
