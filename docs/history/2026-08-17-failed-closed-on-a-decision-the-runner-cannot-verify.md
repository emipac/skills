# Failed closed on a decision the runner cannot verify

Delivered TB-033, a defect slice found by an external audit of the shipped
code: the authoritative pre-commit hook exited `0` for a decision of exactly
`{ authorization: 'allow', outcome: 'passed' }` — no checks, no evidence, no
evaluation identity, no snapshot — because `report()` required only that two
fields were strings.

- Named the miniature version of the same mistake. The evidence guard added by
  `TB-026` read `decision.evidence?.persisted === false`, which denies a
  decision that *states* persistence failed and passes one that says nothing at
  all, since `undefined === false` is `false`. It was written against the input
  it handles and never against the input it exists for, while the rule the
  whole feature rests on is that absence of evidence is never success
  (`NFR-REL-003`).
- Gave completeness back to the contract that defines it. `validateDecision`
  has been thoroughly tested since the process contract was written and had no
  production caller — the fifth instance of the shape `TB-023`, `TB-024`,
  `TB-026` and `TB-031` all had. `report()` now judges every decision by it and
  keeps no second rule of its own, proved by a source scan as well as by
  behaviour, because a weaker second definition of "complete" living beside the
  real one is how this defect existed.
- Stated the denial in the contract's own words. A refused decision prints the
  first six findings by path and message and summarizes the rest, so a
  maintainer reading `git commit` output is told which part of the decision
  could not be read rather than that something unspecified went wrong.
- Made the evidence rule a presence rule. An `allow` is authorized only when
  `evidence.persisted` is `true` and the reference carries the `evidenceId` the
  envelope can be read back by; absent, `false`, and malformed claims all take
  the same denial with `evidence-persistence-failed`.
- Made the validator total. `validateDecision` reached `.some` on
  `decision.checks` and `.entries()` on `changedGraderSurfaces` without
  establishing either was a list, so the runtime-binding and Grader-surface
  rules threw a `TypeError` on inputs the validator exists to reject. A
  `members()` helper reads a non-list as empty; the wrong-typed member is
  already reported in its own right, so no finding was withheld. A validator
  that throws on malformed input turns a refusal into a crash, and the crash
  path is the one that can be trusted least.
- Kept the runner's refusal total anyway. `report()` wraps the validator and
  denies on a throw, because this is the function that decides whether a commit
  is authorized and it never lets an unexpected error read as the absence of a
  problem.
- Closed the attempt-level half absorbed from `TB-029`. A check whose program
  could not be launched is now `unverified` with a new `launch-failed` reason
  in the existing unverified family, so policy, authorization, evidence and
  every adapter handle it without being taught anything. In the preserved
  evidence under `real-project-evidence/`, five checks exited `127` in one to
  five milliseconds having launched nothing and were every one reported as
  `failed` / `grader-negative` — the maintainer was told their formatter and
  their static analysis had rejected work neither had read.
- Put that signal where it is known rather than where it could be guessed.
  Bounded execution verifies, immediately before spawning, that the executable
  and the interpreter the receipt pinned are both still executable, and reports
  `launch-failed` from an exec-level `ENOENT`, `ENOEXEC`, `EACCES`, `EPERM` or
  `EISDIR`. Nothing is derived from the exit status: a fixture whose tool
  genuinely exits `127` under declared `success_exit_codes: [127]` is still
  read as the verdict it is.
- Proved every regression through the real `runHook` rather than through the
  library functions in isolation, using its injected `evaluate` seam and a
  decision captured from a real evaluation with exactly one part removed.
  Testing `validateDecision` alone would have repeated the exact defect this
  ticket is about.

Scope held: no policy entered the runner and no authorization was re-derived —
`authorizationFor` still owns that; no decision-repair path, because a decision
that cannot be verified is refused rather than patched; no exit-code allowlist
and no classification from an exit code alone; no change to denial semantics
for a genuine failing check, to `success_exit_codes`, to the Evidence ladder,
or to attempt reduction; the preflight runner's presentation was not touched,
being `not-authoritative` by construction. Fail-closed did not become
fail-always: the unchanged commit fixtures in `gate-activation-smoke` still
allow a passing change through a real `git commit`.

Verification: `npm run test:unit` (368 passing, up from 361), `npm run
validate` (29 skills, 253 Markdown files), `npm run test:install`, and
regression runs of all nine capabilities — `gate-runtime-binding-smoke`,
`gate-fix-smoke`, `gate-evidence-prune-smoke`, `gate-activation-smoke`,
`gate-hook-conformance-smoke`, `gate-lifecycle-smoke`,
`gate-adapter-conformance`, `gate-security-control-smoke`, and
`gate-runtime-portability`.
