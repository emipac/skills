# Evaluation process contract

The gate exposes one versioned process operation: `evaluate(request) -> decision`.
A returned decision is transport success even when authorization is denied.
`gate fix` and installation are separate interfaces.

Protocol version: `1.0`.

## Casing boundary

The process contract — request, decision, and the delegated executor seam — is
camelCase. The [provider check descriptor contract](provider-descriptor-contract.md)
is snake_case. Descriptors are consumed by evaluation and are never embedded in
a decision; a decision carries check *results*.

## Request

The request names what to grade and who is asking. It never carries
client-native payloads, verification commands, or policy overrides; unknown
fields are rejected rather than ignored.

| Field | Meaning |
| --- | --- |
| `protocolVersion` | Supported process protocol version |
| `operation` | Always `evaluate` |
| `repository.root` | Absolute repository root |
| `change.kind` | Exact snapshot target: `git-index` or `worktree` |
| `change.baseRevision` | Revision the snapshot is taken against |
| `evaluation.purpose` | `change-acceptance-and-regression` or `regression-only` |
| `evaluation.contractRef` | Optional repository-owned delivery-contract reference, or `null` |
| `invocation.role` | Enforcement role: `authoritative` or `preflight` |
| `invocation.trigger` | Normalized trigger: `commit-attempt` or `work-complete` |
| `invocation.adapter` | Adapter `id`, `surface`, `version`, and declared `capabilities` |
| `invocation.sessionId` | Session identity |

## Decision

| Field | Meaning |
| --- | --- |
| `protocolVersion` | Process protocol version |
| `evaluationId` | Reproducible identity of this evaluation binding |
| `outcome` | `passed`, `failed`, `unverified`, or `bypassed` |
| `authorization` | `allow`, `deny`, or `not-authoritative` |
| `task` | Evaluation scope identity, purpose, delivery-contract status, and delivery-contract identity or `null` |
| `snapshot` | Evaluated snapshot kind, identity, base revision, and execution root |
| `environment` | Environment identity, isolation, snapshot binding, mutability, history visibility, cache policy |
| `configurationId` | Trusted configuration identity |
| `profile` | Resolved verification profile |
| `checks` | Ordered check results with graders, assertions, and preserved attempts |
| `advisories` | Advisory check identities that did not pass |
| `bypass` | Bypass data or `null` |
| `coverage` | Evaluation `scope`, `requiredClaims`, `provedClaims`, `gaps`, `acceptanceCriteria`, `provedAcceptanceCriteria`, `acceptanceGaps`, and `limitations` |
| `integrity` | Configuration, runner, provider versions, environment, and snapshot identities, changed Grader surfaces, control-surface visibility, and served-source runtime binding |
| `evidence` | Evidence identity, format, whether the envelope was persisted, and the store reference or `null` |
| `delegation` | The Verification seam, the imported Evidence ladder, and the invoked command roles |
| `diagnostics` | Evaluation-level reason codes and readable details |

Authorization is independent of the outcome: a `preflight` role always returns
`not-authoritative`, and only an `authoritative` role maps `passed` or
`bypassed` to `allow` and everything else to `deny`.

## Snapshot isolation

Evaluation materializes the exact proposed snapshot in a separate execution
root and derives the snapshot identity from that root, so the returned identity
can never name a tree different from the one the checks ran against
(`SG-EVAL-001`). The live worktree is never graded and never written to. After
the checks run, the execution-root identity is re-derived; any difference is
`snapshot-mismatch` and the decision becomes `unverified`.

Materialization writes no Git object, no index, and no commit. This is
isolation from accidental interference, not a sandbox against hostile code.

## What each snapshot kind contains

| Kind | Content set |
| --- | --- |
| `git-index` | Exactly the index, materialized by `git checkout-index --all` |
| `worktree` | Tracked paths, plus untracked-and-not-ignored paths, minus paths the worktree no longer holds |

A `worktree` snapshot is the change a maintainer would see, so a file the agent
created is graded and a file it deleted is materialized by absence — neither
listed nor written, and therefore outside the identity. Both sides of a rename
are reported in the changed paths: the source is gone and the destination is
new. A copy names only its destination, because its source is unchanged.

Git-ignored content never enters a snapshot. Ignore rules are Git's, applied by
asking `git status` without `--ignored` rather than re-implemented here. The one
way git-ignored content legitimately reaches an execution root is the declared
dependency roots of the [Gate policy contract](gate-policy-contract.md), and
those stay outside the snapshot identity.

Only the expected absence of a deleted path stops being a failure. A path Git
still reports that cannot be read is `snapshot-mismatch`, as before.

### Known limitations

A snapshot carries file content and nothing else. These are stated rather than
partly modelled:

- **File modes.** A permission change, including making a file executable, is
  not part of the snapshot identity and no check sees it.
- **Symlink targets.** A symbolic link is materialized by reading through it,
  so the link's target is not graded and a retargeting alone is invisible.
- **Submodules.** A submodule's recorded commit is not part of the snapshot and
  its working tree is never materialized.

A change consisting only of one of these is a change this gate cannot grade.

## Delegation

Ordered check resolution and execution are delegated to `verify-change`
(`SG-OWNER-001`). The Evidence ladder stage order is imported from
`verify-change`, never restated here, and evaluation invokes a descriptor's
non-mutating `evaluate` command only — a `fix` command is unreachable from this
seam.

## Attempts and reason codes

Every attempt is preserved with a reason classification. The gate never retries
silently and never selects the convenient attempt when equivalent attempts
disagree.

| Reason code | Outcome |
| --- | --- |
| `grader-positive` | `passed` |
| `grader-negative` | `failed` |
| `not-applicable` | `not-applicable` |
| `prerequisite-missing` | `unverified` |
| `configuration-invalid` | `unverified` |
| `timeout` | `unverified` |
| `budget-exhausted` | `unverified` |
| `crash` | `unverified` |
| `malformed-output` | `unverified` |
| `snapshot-mismatch` | `unverified` |
| `integrity-drift` | `unverified` |
| `coordination-failure` | `unverified` |
| `attempt-conflict` | `unverified` |

Required checks bind conjunctively: an advisory outcome never compensates for a
required one, and an evaluation-level diagnostic that normalizes to
`unverified` normalizes the whole decision.

## Policy

Which identities are required, the confirmed total budget, and whether a
supported bypass exists are decided by repository policy through the
[Gate policy contract](gate-policy-contract.md). Policy is applied over the
completed decision: `bypass` carries the bypass record or `null`, and the
outcome becomes `bypassed` only when an explicit, snapshot-bound, one-shot
grant is accepted. A bypass never rewrites a check and never removes a failure.

## Coordination

A host may bind a coordination seam around `evaluate`. It serializes execution
per resolved Git common directory, shares only matching in-flight bindings, lets
authoritative Git advance ahead of queued preflights, keeps cancellation
subscriber-local, and requires explicit audited stale-lock recovery. A lease that
cannot be obtained ends the evaluation before anything is materialized or
executed: the decision is `unverified` with the `coordination-failure` reason
code, which an authoritative role can only ever turn into `deny`. The rules are
defined by the
[evaluation coordination contract](evaluation-coordination-contract.md).

A gate with no coordination bound is a single-client gate and never claims to
have serialized anything.

## Evidence persistence

`evidence.persisted` and `evidence.reference` are filled in by the bound
Evidence store. An unbound gate still returns a complete decision with a stable
evidence identity, `persisted: false`, and a `null` reference. Where the store
lives, what an envelope carries, the fixed retention ceilings, redaction at the
persistence boundary, manual preview-bound pruning, and the immutable Lifecycle
event record are defined by the
[bounded Evidence and Lifecycle event contract](bounded-evidence-contract.md).

Persistence never invents a pass and never rewrites a check. It has exactly one
way to change a decision: a capture the store cannot prove safe makes the
decision `unverified` with the `sensitive-capture-unsafe` reason code.
