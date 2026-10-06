# TB-076 — Judge a pull request under the base branch's rules

Status: ready-for-agent
Parent: ci-enforcement-feature-spec
Assignee:
Labels: ready-for-agent, enhancement
Blocked by:
Tracker ID: 76-judge-a-pull-request-under-the-base-branchs-rules
Draft key: TB-076

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/ci-enforcement/issues/ci-enforcement-feature-spec.md`

## Outcome

`gate ci --base BASE --head HEAD --out DIRECTORY` evaluates a pull
request's head commit authoritatively, without a clone-local activation. It
uses the policy and the Command descriptors on the base commit and resolves each
runner on the CI machine. It materializes the exact committed tree of the head,
writes the decision and its Evidence under the output directory, and exits with
a distinct status for passed, failed, unverified, and could not run. For the
same tree and policy it reaches the same check outcomes as `gate check --staged`
on an activated clone.

## SRS Traceability

- `FR-CI-001`, `FR-CI-002`, `FR-CI-004`, `NFR-REL-005`
- `AC-CI-001`
- `SG-CI-001`, `SG-EVAL-001`, `SG-TRUST-001`
- `RISK-001`, `RISK-007`

## Domain Concepts

Trusted gate configuration, Command descriptor, Evidence envelope, execution
root, snapshot identity.

## Approach and Tradeoffs

- Verified: the Gate materializes only `git-index` and `worktree` snapshots
  (`SNAPSHOT_KINDS` in `snapshot.mjs`).
- Verified: every authoritative evaluation pins runners from the Activation
  receipt (`pinnedRunners(checks, { receipt })` in `preflight-runner.mjs`), and
  CI has no receipt.
- Proposed: a third snapshot kind for a committed tree. It reuses capture,
  identity, dependency provisioning, and redaction unchanged. The head's tree
  is read from Git objects, never from the checkout's working files.
- Proposed: the trusted configuration is read from the base commit's
  `.agent-framework.yaml`, through the same resolver the runners use. Runners
  are resolved and pinned for this one evaluation from the base commit's
  descriptors.
- Proposed: the role is authoritative, and the evaluation reuses the existing
  `evaluate` path. No parallel evaluator is written.
- Proposed: the decision and Evidence go under `--out`, which must lie outside
  the tracked tree. The exit statuses are stated in the command's help.
- Mark each proposal confirmed or changed in the commit body. The maintainer's
  refactor has split several Gate modules into folders, so locate the current
  homes of these functions by running a search rather than trusting these file
  names.

## Architecture Boundary and Public Seam

The Gate's command surface and snapshot capture. Public seam: `gate ci` run as a
child process on fixture repositories with base and head commits. First red
test: a fixture whose head passes its required check exits 0 under the base
policy, and one whose head fails it exits 1. Today `gate ci` does not exist.

## Safeguards and Invariants

- `SG-CI-001`: the head's own `.agent-framework.yaml` never governs its own
  evaluation. A head that edits the policy is still judged by the base commit's
  policy in this slice; weakening handling is TB-077.
- `SG-EVAL-001`: checks run against the materialized committed tree, never the
  checkout.
- `SG-TRUST-001`: the output says this is a required CI check. It does not claim
  protection from a repository administrator.

## Prohibited Behavior and Non-goals

- No activation, receipt, hook, or registration is read or written.
- No bypass handling, release pin, or workflow generation (TB-077 to TB-079).

## Risk and Decision Impacts

- `RISK-001`: this slice is the mitigation's core.
- `RISK-007`: a flaky required check fails CI. It is reported, not retried.

## Acceptance Criteria

- [ ] `AC-CI-001`: on fixtures with base and head commits, a passing head exits
  0 and a failing head exits 1, both under the base policy. Decision and
  Evidence files are under `--out`, an unresolvable prerequisite is
  `unverified` with its own status, and a malformed invocation is "could not
  run".
- [ ] `NFR-REL-005`: on the same tree and policy, `gate ci` and
  `gate check --staged` on an activated twin reach the same check identities
  and outcomes.
- [ ] `SG-CI-001`: a head that changes `.agent-framework.yaml` is evaluated
  under the base commit's policy, proved by a head whose own policy would
  pass a check the base policy requires.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CI-001`, `NFR-REL-005`, `SG-CI-001`: pass, fail, unverified, could-not-run, equivalence, and base-policy fixtures | `npm run test:unit` | Yes — every rule is observable at the command |
| smoke | both | `NFR-REL-005`: on a real clone, `gate ci` and the real hook agree on one tree | `gate-hook-conformance-smoke`, extended by this slice | Yes — equivalence is only meaningful against the real hook |

Frontend build and browser evidence are inapplicable.

## Blocked By

None — can start immediately.

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
