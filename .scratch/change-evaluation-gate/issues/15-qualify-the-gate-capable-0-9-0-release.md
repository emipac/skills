# TB-015 — Qualify the Gate-capable 0.9.0 release

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent
Blocked by: 07-fix-laravel-code-explicitly-and-reevaluate, 09-coordinate-concurrent-evaluations-safely, 13-deliver-supported-desktop-preflight-adapters, 14-protect-policy-transitions-sensitive-inputs-and-drift
Tracker ID: 15-qualify-the-gate-capable-0-9-0-release
Draft key: TB-015

**Status:** ready-for-agent
**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

The first Gate-capable `0.9.0` release candidate carries exact runtime, client, migration, security, and operational evidence for every support claim without turning tested versions into a permanent allowlist.

## SRS Traceability

- `NFR-COMP-001`, `NFR-PORT-001`, `NFR-PORT-002`
- `AC-ADAPT-002`, `AC-PORT-001`
- `SG-CMD-001`, `SG-SUPPORT-001`
- `RISK-002`, `RISK-003`, `RISK-004`, `RISK-005`, `RISK-006`, `RISK-007`, `RISK-008`, `RISK-009`, `Q-001`, `Q-004`, `Q-006`

## Domain Concepts

Runtime portability baseline, Client compatibility baseline, Support tier, Active gate release, and Gate module.

## Approach and Tradeoffs

Execute the authoritative Git, three supported desktop adapter, runtime portability, migration, redaction, integrity, hook, rollback, and trust fixtures on each exact version combination claimed. Publish versions and pass/fail outcomes as an evidence snapshot. Keep untested versions unverified rather than denied and retain visible timing and flaky-attempt risks.

## Architecture Boundary and Public Seam

The boundary is release qualification over the already implemented evaluation, lifecycle, and adapter seams; the public seam is the compatibility manifest and reproducible conformance results. First red test: a manifest claiming one environment without its required portability outcome fails qualification.

## Safeguards and Invariants

- `SG-CMD-001`: portability proves shell-free runner resolution and declared repository-script behavior.
- `SG-SUPPORT-001`: no surface is supported without its release-blocking baseline and exact outcomes.

## Prohibited Behavior and Non-goals

Do not silently omit failed fixtures, convert evidence into a permanent version allowlist, qualify additional clients, claim CI or server authority, or close open latency and flaky-check risks without evidence.

## Risk and Decision Impacts

- `RISK-002`, `RISK-004`, `RISK-005`, `RISK-006`, `RISK-008`, and `RISK-009`: conditionally accepted only behind their mandatory runtime, adapter, migration, redaction, integrity, and portability release evidence.
- `RISK-003` and `RISK-007`: remain open medium-impact delivery risks and must stay visible with timing and attempt evidence.
- `Q-001`: the durable approved SRS remains the stable-ID projection while Wayfinder remains authoritative.
- `Q-004`: exact tested versions and outcomes prove capability-based support without a permanent allowlist.
- `Q-006`: release qualification completes the mandatory compatibility and conformance portion of the contract-complete handoff.

## Acceptance Criteria

- [x] `AC-ADAPT-002`: each supported local surface passes its shared baseline, defined failures are `unverified`, unsupported contexts cannot claim support, and exact versions and outcomes are recorded.
- [x] `AC-PORT-001`: every claimed environment passes executable, stream, JSON, timeout, process-tree, Git-index, linked-worktree, path, declared-write, immutability, and non-interactive fixtures.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| broad-tests | both | `AC-ADAPT-002`, `SG-SUPPORT-001`: full adapter and regression contracts | `npm run test:unit` | Yes — configured repository test suite must pass |
| smoke | both | `AC-ADAPT-002`: released skills and adapters install coherently across clients | `npm run test:install` | Yes — configured install smoke is release-blocking |
| e2e | both | `AC-PORT-001`, `SG-CMD-001`: exact runtime portability matrix on every claimed environment | `gate-runtime-portability` capability introduced by this slice | Yes — the final selector is the release matrix itself |

Frontend build and browser evidence are inapplicable to repository frontend code; client and runtime fixtures are covered by adapter and portability conformance.

## Blocked By

- `TB-007` — explicit Laravel fix and reevaluation must be qualified.
- `TB-009` — concurrency and linked-worktree behavior must be qualified.
- `TB-013` — all supported adapter fixtures must exist.
- `TB-014` — trusted policy, redaction, and drift safeguards must exist.

## Qualification landed 2026-08-11 — AC-PORT-001 met, AC-ADAPT-002 still open

The compatibility manifest, its qualification rules, and the
`gate-runtime-portability` capability landed. The capability detects this
environment, reads the release version from `package.json`, executes all eleven
`AC-PORT-001` fixtures against throwaway repositories, runs every adapter's
shared baseline, gathers real timing and conflicting-attempt evidence, and
qualifies the manifest. Exit status is 0 only when every fixture holds and the
manifest qualifies.

**`AC-PORT-001` is met.** One environment is claimed — the machine this ran on,
detected rather than declared: macOS 26.6.1, arm64, kernel 25.6.0, Node
v24.6.0, npm 11.5.1, git 2.51.0. All eleven fixtures passed on it, each with a
recorded outcome and duration. Every other operating system and runtime
combination is recorded `unverified` with a stated reason — untested, not
refused, per `Q-004`. The matrix is a function of what is claimed, and claiming
one environment is what one machine can evidence.

**`AC-ADAPT-002` is NOT met and stays unticked, here and in `TB-013`.** No
surface reached `supported`. The shared baseline still runs on payloads this
repository builds from the declaration under test, so `classifySupport` returns
`experimental` / `client-invocation-not-observed` for all four surfaces,
including authoritative Git. The manifest therefore records no exact client
version for any surface, which is the clause `AC-ADAPT-002` most directly
requires. Qualification does not merely permit this outcome — it enforces it:
the declared tier is re-derived from the same baseline and any disagreement,
overstated or understated, fails the release.

What remains, for whoever picks this up: a baseline run driven by a real client
invocation for at least one surface, recording that client's exact version. The
exact steps are `PROMOTION_REQUIREMENTS` in
`skills/change-evaluation-gate/scripts/lib/release-qualification.mjs` and
section 5 of
`skills/change-evaluation-gate/references/release-qualification-contract.md`.

`RISK-003` and `RISK-007` remain OPEN and visible in the manifest, each with
evidence observed by this run: measured timing for the bounded and terminated
checks, and two genuinely conflicting attempts of one unchanged check, recorded
rather than retried away.

No version bump was performed. `package.json` stays at its current version; the
release pull request's `changeset version` step produces `0.9.0` from the
pending minor changesets, and the manifest reads the version at generation time
so it can never disagree with the package.

## Closed 2026-08-11 — AC-ADAPT-002 met by a client-driven baseline

The open clause was "each supported local surface passes its shared baseline"
and "exact versions are recorded", neither of which a fixture-driven run can
establish, because the fixture and the declaration under test came from the same
source.

`runCompatibilityBaseline` now accepts the client's own payload and drives every
check through it. `captured-client-invocation` can no longer be asserted — a run
that claims it without supplying an invocation records itself as
`synthetic-fixture`. `gate-client-baseline.mjs` is the runner a client hook
invokes to produce that evidence, and `gate-runtime-portability` carries a
recorded baseline into the manifest rather than re-deriving it, honouring only
records whose run actually earned the label.

**Cursor 3.15.6: `supported`**, 11 of 11 baseline checks, `payloadSource:
captured-client-invocation`, version from `payload.cursor_version` in the same
invocation as the capture.

`git`, `claude-code-desktop`, and `codex-desktop` remain `experimental` /
`client-invocation-not-observed`, which is the honest record: their
declarations are corrected against real captures, but no client-driven baseline
has been run for them. Under `Q-004` that is unverified, never denied, and the
manifest states the procedure to promote each one.

## Unresolved Assumptions

None.

## Readiness

- [x] The outcome is a complete vertical behavior.
- [x] Acceptance criteria trace to the SRS and feature contract.
- [x] The public seam and first red test are identified.
- [x] Safeguards and non-goals are explicit.
- [x] Risks and resolved decisions are traced to the parent contract.
- [x] Blocking edges exist and are acyclic.
- [x] No unresolved assumption blocks the start.
- [x] The ticket fits one fresh implementation context.
- [x] User-facing and frontend evidence requirements are covered or explicitly inapplicable.
