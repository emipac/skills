# TB-015 — Qualify the Gate-capable 0.9.0 release

Status: open
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

- [ ] `AC-ADAPT-002`: each supported local surface passes its shared baseline, defined failures are `unverified`, unsupported contexts cannot claim support, and exact versions and outcomes are recorded.
- [ ] `AC-PORT-001`: every claimed environment passes executable, stream, JSON, timeout, process-tree, Git-index, linked-worktree, path, declared-write, immutability, and non-interactive fixtures.

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
