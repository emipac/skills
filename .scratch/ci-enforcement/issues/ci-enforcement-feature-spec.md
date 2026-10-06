# CI Enforcement — Feature Contract

Status: open
Parent:
Assignee:
Labels:
Blocked by:

## Feature Contract

| Field | Value |
| --- | --- |
| Status | ready-for-tickets |
| SRS baseline | [Change Evaluation Gate SRS v0.4.0 — Approved](../../../docs/specifications/change-evaluation-gate-srs.md) |
| Decision sources | Maintainer conversation of 2026-10-06. The base branch's configuration is the trusted policy in CI. A pull request that weakens the policy needs a maintainer-applied label. The workflow installs a pinned framework release. GitHub Actions comes first; other systems are later. The branch-protection rule stays a step the maintainer performs. On 2026-10-06 the Product Owner approved the SRS 0.4.0 rows, accepted `RISK-013`, and agreed the test seams. |

## Problem and Outcome

The local Gate can be skipped by whoever owns the machine (`git commit
--no-verify`, never installing it, switching it off), which the SRS states as
`RISK-001` and `SG-TRUST-001`. For a team, and for unattended agents, "it passed
on someone's laptop" is not enough.

Outcome: every pull request on GitHub is checked by the same Gate as a required
check, under the rules on the base branch, so a change cannot weaken the rules
that judge it. A failing or unverified check blocks the merge. The maintainer
turns this on with one previewed command and one GitHub setting.

## SRS Traceability

| Requirement IDs | Acceptance IDs | Safeguard IDs | Risk IDs | Question IDs | Scope |
| --- | --- | --- | --- | --- | --- |
| `FR-CI-001`, `FR-CI-002`, `FR-CI-004`, `NFR-REL-005` | `AC-CI-001` | `SG-CI-001`, `SG-EVAL-001`, `SG-TRUST-001` | `RISK-001`, `RISK-007` | None | Authoritative pull-request evaluation under the base policy |
| `FR-CI-003` | `AC-CI-002` | `SG-CI-001`, `SG-CFG-001` | `RISK-008` | None | Policy-changing pull requests and maintainer approval |
| `FR-CI-005` | `AC-CI-003` | `SG-CI-002`, `SG-SECRET-001` | `RISK-006` | None | Release pin, no bypass, no secret leakage, no writes |
| `FR-CI-006` | `AC-CI-004` | `SG-CI-002`, `SG-DIST-001` | `RISK-013` | None | Generated GitHub Actions workflow and real-repository observation |

## User Stories and Scenarios

1. As a Repository maintainer, I want every pull request checked on GitHub by
   the Gate, so that nothing merges because someone skipped the local hook.
2. As a Repository maintainer, I want a pull request judged by the rules
   already on `main`, so that it cannot loosen its own rules.
3. As a Repository maintainer, I want to approve a deliberate policy weakening
   visibly, so that loosening a rule is a decision rather than an accident.
4. As a maintainer turning this on, I want one command to write the workflow,
   so that I don't hand-write CI configuration.

Scenarios that materially apply:

- **Happy path.** A pull request whose required checks pass gets a green
  required check and can merge.
- **Failure.** A required check fails, and the pull request is blocked with the
  check's own reason and the evidence attached.
- **Unverified.** A prerequisite such as a service, secret, or tool is missing
  in CI. The check is `unverified`, names what is missing, and still blocks.
- **Policy change.** The pull request edits `.agent-framework.yaml`:
  - stricter: judged under the base policy, passes on its merits;
  - weaker: fails naming the weakening, until a maintainer applies the
    approval label, after which it is evaluated with the approval recorded.
- **Release mismatch.** The installed Gate is not the pinned release, so the
  check is `unverified`.
- **Bypass attempt.** A bypass grant committed or present in the checkout is
  ignored.
- **Authorization.** Only a repository administrator can merge past a red
  required check, and GitHub records that override.

## Approach and Decisions

- **Decided: the trust anchor is the base commit.** The policy, check
  identities, and Command descriptors come from the pull request's base commit
  (`FR-CI-002`). Verified: today every authoritative evaluation pins its
  runners from the clone-local Activation receipt (`pinnedRunners` with
  `receipt`), which CI does not have. `gate ci` therefore resolves runners on
  the CI machine from the base commit's descriptors.
- **Decided: weakening approval is a maintainer-applied label** (for example
  `gate-policy-approved`), which the workflow passes to `gate ci`. Verified:
  the weakening judgement already exists (`evaluatePolicyTransition`,
  `policyWeakenings` in `security-control.mjs`) and is reused unchanged. The
  known narrowness of what counts as weaker is unchanged and tracked
  separately.
- **Decided: pinned install.** The generated workflow installs the exact
  framework release the project records. The pin lives in the committed
  workflow and is passed to `gate ci`, which refuses a different release
  (`FR-CI-005`). No new key is added to `.agent-framework.yaml`.
- **Decided: GitHub Actions only** for this feature.
- **Decided: no repository settings are changed.** `agent-framework ci add
  github` writes the workflow file only. It prints the branch-protection step
  (mark the check as required) for the maintainer.
- **Proposed: a third snapshot kind.** Verified: the Gate materializes only
  `git-index` and `worktree` snapshots today (`SNAPSHOT_KINDS`). `gate ci`
  needs the committed tree of the head commit. It is proposed as a new kind that
  reuses the same capture, identity, dependency provisioning, and redaction.
- **Proposed: evidence as files.** Decision and Evidence go under an output
  directory outside the tracked tree, for the workflow to upload as an artifact.
- **Proposed: the source of approved secrets.** Declared Sensitive runtime
  inputs come from repository secrets exported as environment variables.
  Verified: TB-059's resolution already reads the environment first, so no new
  resolution path is needed.
- **Tradeoff.** CI is slower and needs its own environment (`RISK-013`). The
  local Gate stays the early warning, and CI is the final judge.

## Public Interfaces and Test Seams

| Seam | Behavior observed | Acceptance IDs | Prior art |
| --- | --- | --- | --- |
| `gate ci` run as a child process on fixture repositories with base and head commits | Decision, Evidence files, exit status, base-policy trust, equivalence with `gate check --staged` | `AC-CI-001` | `tests/gate-check-command.test.mjs`, `gate-hook-conformance-smoke` |
| `gate ci` on policy-changing fixtures, with and without an approval input | Weakening failure, approval recorded, stricter candidate passing | `AC-CI-002` | `gate sync` weakening tests in `tests/gate-operator-surface.test.mjs` |
| `gate ci` with a mismatched release, a bypass grant, and a secret canary | `unverified` on a release mismatch, grant ignored, canary absent, checkout unchanged | `AC-CI-003` | `tests/gate-evidence-secrets.test.mjs` |
| `agent-framework ci add github` on fixtures, plus a real GitHub repository run | Previewed workflow written only with its token; real green, red, and weakening pull requests | `AC-CI-004` | FS-006 guardrail registration tests; `.scratch/framework-scripts/cursor-before-shell-observation.md` |

## Safeguards and Prohibited Behavior

- `SG-CI-001`: never authorize a pull request under policy or descriptors it
  introduces itself.
- `SG-CI-002`: no bypass in CI, no secret value in output or Evidence, and no
  write to the checkout.
- `SG-EVAL-001`: CI grades the exact committed tree, never a mutable working
  copy.
- `SG-DIST-001`: installing the framework never adds a workflow. Only the
  maintainer's confirmed preview does.
- Prohibited: changing repository settings or branch protection, auto-applying
  the approval label, and treating `unverified` as passing.

## Risks, Gaps, and Assumptions

| ID | Type | Description | Impact | Blocks readiness | Resolution |
| --- | --- | --- | --- | --- | --- |
| RISK-013 | Risk | The CI environment lacks something a check needs. | High | No | Accepted by the Product Owner on 2026-10-06, with the SRS mitigation. |
| RISK-008 | Risk | A pull request weakens a Grader surface. | High | No | Mitigated by `SG-CI-001` and the base-policy trust anchor. |
| RISK-007 | Risk | A flaky required check blocks merges. | High | No | Accepted — the SRS disposition stands: flakes are evidence defects, not averaged. CI makes them visible sooner and blocks until they are fixed. |
| RISK-001 | Risk | A machine owner skips local enforcement. | High | No | Accepted and narrowed — this feature is its mitigation. A repository administrator can still override a required check, and GitHub records the override. |
| RISK-006 | Risk | A secret leaks into CI output or Evidence. | High | No | Accepted — mitigated by `SG-CI-002` and `SG-SECRET-001`, with a canary test in `AC-CI-003`. |
| GAP-001 | Dependency | The SRS rows added in 0.4.0 were in `Review`. | High | No | Resolved — approved in SRS 0.4.0 on 2026-10-06. |
| GAP-002 | Assumption | `npx skills add` can install an exact framework release in CI. | Medium | No | To be confirmed by running it in TB-079. If it cannot, the workflow installs a pinned package release instead. |
| GAP-003 | Dependency | A real GitHub repository is needed for the observation in `AC-CI-004`. | Low | No | The maintainer runs it, as with the Cursor observation. |

## Acceptance Criteria

| ID | Criterion | Evidence seam |
| --- | --- | --- |
| AC-CI-001 | On a fixture repository with base and head commits, `gate ci` passes a head whose required checks pass and fails one whose required check fails, under the base commit's policy. It writes the decision and Evidence under the output directory, exits with the matching status, and agrees with `gate check --staged` on the same tree. | `gate ci` integration test with fixture commits |
| AC-CI-002 | A head commit that demotes a required check is judged under the base policy and fails, naming the weakening. Supplied with a maintainer approval for exactly that weakening, it passes and Evidence records the approval. A stricter candidate needs no approval. | `gate ci` integration test with policy-changing fixtures |
| AC-CI-003 | A Gate release other than the expected one is `unverified`. A bypass grant present in the checkout is ignored. A secret canary supplied from the environment appears in no output or Evidence. Nothing in the checkout changes. | `gate ci` integration test |
| AC-CI-004 | `agent-framework ci add github` previews the exact workflow, writes it only with its token, and names the branch-protection step. On a real GitHub repository the generated workflow passes a passing pull request, fails a failing one, and fails a weakening until the maintainer label is applied. | Framework command integration test and a recorded real-repository observation |

## Verification Strategy

`npm run test:unit` for every `gate ci` and workflow-generation behavior.
Gate smokes are extended where a real clone is needed (`gate-hook-conformance-smoke`
for equivalence, `gate-security-control-smoke` for weakening and bypass). `npm
run test:install` covers the installed skill's command. A recorded observation
on a real GitHub repository covers `AC-CI-004`. No frontend build applies.

## Out of Scope

- GitLab, Bitbucket, and other CI systems.
- Changing GitHub repository settings or branch protection.
- Broadening what counts as a weakening.
- Attestation, signing, or protection from a repository administrator.
- Merge queues and cross-pull-request caching.

## Readiness

- [x] Every in-scope requirement maps to acceptance evidence.
- [x] Public test seams are agreed.
- [x] Safeguards and prohibited behavior are explicit.
- [x] Risks and resolved decisions have explicit dispositions.
- [x] Blocking gaps and assumptions are resolved.
- [x] Out-of-scope behavior is explicit.
