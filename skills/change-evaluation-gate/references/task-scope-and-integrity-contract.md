# Task scope and Grader integrity contract

## Contents

- [Evaluation scope](#evaluation-scope)
- [Check assertions](#check-assertions)
- [Changed Grader surfaces](#changed-grader-surfaces)
- [Served-source binding](#served-source-binding)
- [Capability](#capability)

A decision states three things beyond its check results: what the evaluation was
allowed to claim, what it changed about the things that judge it, and whether
served evidence was tied to the snapshot it claims to be about.

## Evaluation scope

Task-specific acceptance coverage exists only when a repository-owned delivery
contract is readable inside the materialized Evaluation snapshot and declares
stable acceptance identities under its acceptance-criteria section. The contract
is read from the snapshot, never from the mutable live worktree.

**Built and not switched on.** Both production runners pass
`contractRef: null`, so every decision the Gate produces today is
`not-declared` and `regression-only`: `acceptanceCriteria`,
`provedAcceptanceCriteria`, and `acceptanceGaps` are always empty, the only
limitation is the fixed regression-only one, and the acceptance-coverage
machinery below computes nothing on any run. Switching it on means a runner
passes the repository's delivery-contract reference. The resolver and its tests
stay as built rather than being removed (`TB-051`).

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

A declared surface Git does not track is **unversioned**, not changed
(`TB-066`). A worktree change's path set holds every untracked path, because a
file the agent just created is new work an applicability rule must see; but an
untracked declared surface has no version for the change to have moved it
from, and on a clone whose `.agent-framework.yaml` was never committed it was in
that set on every snapshot. So the untracked paths are carried out of the same
single `git status` parse (`listPathChanges` in `scripts/lib/snapshot.mjs`)
beside the changed ones, and `integrity.unversionedGraderSurfaces` lists every
declared surface among them, in the same entry shape and order. A path is never
in both lists, and the contract refuses a decision that reports one twice. Every
declared kind is reported this way, a test matched by a declared glob included:
an untracked test is the same fact about the same class of file, and no runner
declares test globs today. An untracked file nothing declares is ordinary new
work and is in neither list. Every decision records the list — a commit's too,
although its `git-index` snapshot still excludes untracked paths exactly as
before — and a no-subject decision records it with `identity: null`, because
nothing was materialized.

`integrity.controlSurfaceChanged` is `true` when a tracked `gate-configuration`
or `provider` surface changed; an unversioned one never sets it. Reporting a
changed or an unversioned surface is visibility, not a malicious
classification: neither changes the outcome by itself, and neither word implies
anybody did anything (`AC-SEC-001`). The dual-policy transition that a
control-surface change requires is owned by the configuration-transition slice
(`SG-CFG-001`).

Every changed surface is also named, by kind and path, on each declared
preflight feedback channel — on a passing turn too — and never truncated there
(`TB-064`; see the [adapter conformance contract](adapter-conformance-contract.md)).
An unversioned surface is named there once, under the channel's own once-only
rule, and stated standing by `gate status` as an informational
`grader-surface-unversioned` finding whose `next:` line names the maintainer's
remedy: commit it. The Gate never stages or commits it, and a clone may run
with it unversioned indefinitely (`FR-LIFE-009`, `SG-TRUST-001`).

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

**Built and not switched on.** No production runner binds a runtime resolver,
so the proof above is never attempted: a check declaring `smoke` or `browser`
evidence is `unverified` on every run with `prerequisite-missing`, a reason no
reader can act on because no runtime was ever asked. Switching it on means a
runner binds that resolver. The binding module and the smoke below stay as
built rather than being removed (`TB-051`).

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
