# Qualified the Gate-capable release candidate

Delivered TB-015, the final Change Evaluation Gate slice: a compatibility
manifest that carries observed evidence, a qualification pass that refuses any
claim the evidence beside it does not produce, and the
`gate-runtime-portability` capability that executes the matrix and generates
both.

- Added `scripts/lib/release-qualification.mjs`. `buildCompatibilityManifest`
  assembles a record; `qualifyRelease` reads it and fails a release on any claim
  that outruns its evidence. Nothing here runs a fixture and nothing derives a
  fact — outcomes arrive already observed.
- **The version is read, never written.** `readReleaseVersion` reads
  `package.json`, and qualification fails a manifest whose version disagrees
  with the package on disk or that was sourced anywhere else. A test scans the
  generator for version literals and fails on any. **No version bump was
  performed:** the release pull request's `changeset version` step produces
  `0.9.0` from the pending minor changesets, and a manifest that read a literal
  could disagree with the package from the moment it was written.
- **The matrix is a function of what is claimed.** A claimed environment owes an
  outcome for all eleven fixtures `AC-PORT-001` names, from the contract's list
  rather than the manifest's. Omitting one fails; recording an unnamed outcome
  in its place fails; reporting a real failure honestly and claiming the
  environment anyway fails; and a manifest that claims nothing at all fails.
- **One environment is claimed** — the machine the capability ran on, detected
  rather than declared: macOS 26.6.1, arm64, kernel 25.6.0, Node v24.6.0, npm
  11.5.1, git 2.51.0. Every other operating system and runtime combination is
  recorded `unverified` with a stated reason. Untested is not refused, tested
  versions are an evidence snapshot rather than a standing allowlist, and a
  manifest presenting its snapshot as an allowlist fails qualification (`Q-004`).
- **A support tier is derived, never declared.** Qualification recomputes each
  tier through `classifySupport` and rejects any disagreement in either
  direction — an overstated tier and an understated one are the same defect. A
  surface must also carry an outcome for every shared baseline check and the
  exact versions it ran under.
- **All four surfaces are `experimental` / `client-invocation-not-observed`**,
  including authoritative Git. The baseline still runs on payloads this
  repository builds from the declaration under test, so no exact client version
  exists to record. `AC-ADAPT-002` is NOT met and stays unticked in TB-015 and
  in TB-013, which stays reopen.
- **`experimental` has a stated exit.** `PROMOTION_REQUIREMENTS` and section 5 of
  the new [release qualification contract](../../skills/change-evaluation-gate/references/release-qualification-contract.md)
  name the seven things a real client-driven run must record: the captured
  payload shape, the captured event name including its casing, the registration
  file and schema, the exact client version, every shared baseline outcome, how
  a repository root was resolved, and a re-run of qualification. No captured
  payload value entered this repository; real payloads carry conversation text
  and personal data, and only shapes and key names are recorded.
- **`RISK-003` and `RISK-007` stay open and visible**, each with evidence this
  run observed: measured durations for the bounded and terminated checks, and
  two genuinely conflicting attempts of one unchanged check — the check really
  is flaky, both attempts are recorded, and neither was retried away. Closing
  either risk without evidence fails qualification.
- **Nothing is presented as more than it is.** The manifest states local Git as
  its only authority with server-side and continuous-integration authority both
  false, and carries the trust boundary statement from `security-control.mjs`
  verbatim rather than restating it. A rewritten boundary fails qualification.
  TB-014's overclaim scan passes over every new module and document unchanged.
- Added the `gate-runtime-portability` capability, which executes all eleven
  fixtures against throwaway Git repositories with real child processes: direct
  executable resolution with verbatim arguments and shell text refused before
  execution, both standard streams captured, structured JSON across a real
  process boundary, a bounded check stopped at its timeout, a descendant that
  writes nothing after its tree is terminated, a real Git index distinct from
  its worktree, a linked worktree resolving to one canonical common directory
  and one Evidence store, a repository root containing spaces and non-ASCII
  characters, writes confined to the materialized execution root, a byte-identical
  source repository across an evaluation, and a check with no terminal, an
  immediate end-of-file on standard input, and no undeclared environment name
  from the invoking process.

Scope held: no version bump, no fourth client, no promotion of any surface, and
no modification to `adapters.mjs` or any other slice's delivered behavior. No
Git state or hook of this repository was read or written; every fixture is a
throwaway repository under the OS temporary directory, guarded by
`assertThrowawayRepository`.

Verification: `npm run test:unit` (251 passing, 239 before this slice),
`npm run validate` (29 skills, 205 Markdown files), `npm run test:install`,
`npm run gate-runtime-portability`, plus regression runs of
`npm run gate-runtime-binding-smoke`, `npm run gate-fix-smoke`,
`npm run gate-evidence-prune-smoke`, `npm run gate-activation-smoke`,
`npm run gate-hook-conformance-smoke`, `npm run gate-lifecycle-smoke`,
`npm run gate-adapter-conformance`, and `npm run gate-security-control-smoke` —
all exit 0.
