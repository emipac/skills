# Task scope and Grader integrity contract

A decision states three things beyond its check results: what the evaluation was
allowed to claim, what it changed about the things that judge it, and whether
served evidence was tied to the snapshot it claims to be about.

## Evaluation scope

Task-specific acceptance coverage exists only when a repository-owned delivery
contract is readable inside the materialized Evaluation snapshot and declares
stable acceptance identities under its acceptance-criteria section. The contract
is read from the snapshot, never from the mutable live worktree.

| `task.contractStatus` | Meaning |
| --- | --- |
| `valid` | The reference resolved and declares at least one stable acceptance ID |
| `not-declared` | The request named no delivery contract |
| `missing` | The reference does not resolve inside the evaluated snapshot |
| `invalid` | The reference resolved but declares no acceptance criterion |

`task.purpose` and `coverage.scope` are always equal. A requested
`change-acceptance-and-regression` scope is honored only by a `valid` contract;
every other combination degrades to `regression-only` and records the reason in
`coverage.limitations` (`FR-EVAL-007`).

`SG-SCOPE-001` is enforced as a contract invariant, not only as behavior: a
`regression-only` decision must carry an empty `acceptanceCriteria`,
`provedAcceptanceCriteria`, and `acceptanceGaps`, must carry at least one
limitation, and must contain no acceptance-linked Check assertion. Broad tests
are regression evidence, never implicit task acceptance.

## Check assertions

Every applicable check reports at least one atomic Check assertion
(`FR-PROF-005`). A check that declares no evidence claim still asserts under its
own stable check identity, so a decision never contains a silent check.

| Assertion field | Meaning |
| --- | --- |
| `id` | The declared evidence claim, or the check identity when none is declared |
| `kind` | `acceptance` when the claim is a stable acceptance ID requested by a valid contract, otherwise `regression` |
| `outcome` | The check outcome this assertion carries |
| `summary` | Readable summary of what decided it |

An acceptance criterion is proved only by a **passed required** acceptance
assertion. Everything the contract requested and nothing proved it is an
explicit entry in `coverage.acceptanceGaps`.

## Changed Grader surfaces

A Grader surface is anything that decides evidence. `integrity.changedGraderSurfaces`
lists every declared surface this change modified, sorted by kind then path
(`FR-EVAL-009`).

| Kind | Declared by |
| --- | --- |
| `gate-configuration` | The Gate control-surface configuration paths |
| `provider` | Declared provider sources, keyed by provider identity |
| `test` | Declared test globs |
| `verification-script` | `repository-script` Command descriptors already validated by the descriptor contract |

Every surface entry names its `kind`, repository-relative `path`, owning
`checkId` and `role` or `null`, and the `identity` of the content that was
actually evaluated. Surfaces are declared, never guessed: an undeclared path is
not reported.

`integrity.controlSurfaceChanged` is `true` when a `gate-configuration` or
`provider` surface changed. Reporting a changed surface is visibility, not a
malicious classification: it never changes the outcome by itself. The
dual-policy transition that a control-surface change requires is owned by the
configuration-transition slice (`SG-CFG-001`).

## Served-source binding

A check whose Command descriptor declares a `smoke` or `browser` evidence
category depends on what a runtime served. Such a check runs only after the
gate proves the runtime is serving the materialized snapshot's source
(`FR-EVAL-010`).

Proof is content, never coincidence. The gate asks the project's **existing**
local runtime for each declared probe and compares the served bytes against the
snapshot's bytes. It never launches an alternate application runtime, and a
matching path, a reachable port, or a runtime that merely answers proves
nothing.

| `integrity.runtimeBinding` | Meaning |
| --- | --- |
| `required` | Whether any applicable check produced served evidence |
| `proved` | `true`, `false`, or `null` when binding was never required |
| `reasonCode` | `snapshot-mismatch` when the served source differs, `prerequisite-missing` when the binding could not be probed at all |
| `snapshotId` | The snapshot the binding was proved against |
| `servedSourceId` | Identity of the proved served source, or `null` |
| `probes` | Each probe path with its expected identity, served identity, and whether it matched |

Failure to prove the binding is `unverified` and the check never executes:
a result produced against an unknown source is not evidence. Absence of evidence
is never success (`SG-EVAL-002`, `NFR-SEC-001`).

## Capability

`gate-runtime-binding-smoke` exercises this binding end to end against a real
loopback HTTP runtime and a real materialized snapshot:

```bash
npm run gate-runtime-binding-smoke -- --json
```

It is non-interactive and offline, uses throwaway repositories and ephemeral
ports, never touches the host repository's Git state, and exits non-zero when a
runtime serving the live worktree, a runtime with no declared probe, an
unreachable runtime, or a missing runtime fails to produce `unverified`.
