# TB-079 — Write the GitHub workflow in one confirmed step

Status: ready-for-agent
Parent: ci-enforcement-feature-spec
Assignee:
Labels: ready-for-agent, enhancement
Blocked by: 76-judge-a-pull-request-under-the-base-branchs-rules, 78-trust-only-the-pinned-gate-and-nothing-left-behind
Tracker ID: 79-write-the-github-workflow-in-one-confirmed-step
Draft key: TB-079

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/ci-enforcement/issues/ci-enforcement-feature-spec.md`

## Outcome

`agent-framework ci add github` previews a GitHub Actions workflow for the
project and writes it only with the preview's token. The workflow:

- runs on pull requests;
- installs the pinned framework release and the project's dependencies;
- supplies the declared Sensitive runtime inputs from repository secrets;
- runs `gate ci` against the pull request's base and head with the expected
  release and the maintainer-label approval;
- uploads the Evidence.

The command changes no repository setting. It prints the branch-protection step
(mark the check as required) and the approval label to create. `remove` reverses
exactly what `add` wrote.

## SRS Traceability

- `FR-CI-006`
- `AC-CI-004`
- `SG-CI-002`, `SG-DIST-001`
- `RISK-013`

## Domain Concepts

Framework command, Sensitive runtime input, Gate release.

## Approach and Tradeoffs

- Verified: `framework-setup`'s guardrail registration (FS-006, FS-007) is the
  pattern for an opt-in, previewed, token-confirmed write of a file framework
  setup does not otherwise own. Follow it, and its module layout after the
  maintainer's refactor (`scripts/lib/configure/…`, `scripts/lib/agent-framework/…`).
- Proposed: the dependency steps come from what the project already declares:
  the Verification profile, lock files, and `dependency_roots`. Nothing is
  guessed, and a step that cannot be derived is named for the maintainer.
- Proposed: each declared Sensitive runtime input maps to a repository secret
  of the same name, and the command lists the secrets to create. No value is
  ever read or written.
- To confirm by running it: whether `npx skills add emipac/skills@VERSION`
  installs an exact release (feature contract `GAP-002`). If it does not, pin
  through the package instead, and state which.

## Architecture Boundary and Public Seam

The Framework command and its `configure.mjs` direct path on fixtures. First red
test: `ci add github` on a configured Laravel fixture previews a workflow that
runs `gate ci` with the pinned release, and writes nothing without the token.

## Safeguards and Invariants

- `SG-DIST-001`: installing never adds a workflow; only the confirmed preview
  does.
- `SG-CI-002`: no secret value is ever read, written, or printed.
- An existing workflow file of the same name is refused with nothing written.

## Prohibited Behavior and Non-goals

- No change to GitHub settings, branch protection, secrets, or labels; those
  steps are only named for the maintainer.
- No other CI systems.

## Risk and Decision Impacts

- `RISK-013`: the workflow declares what the checks need and names anything it
  cannot derive.

## Acceptance Criteria

- [ ] `AC-CI-004` (generation half): `ci add github` previews the exact workflow
  and writes it only with its token. It names the branch-protection step, the
  approval label, and the secrets to create. It refuses an existing file and
  writes nothing without the token. `remove` reverses it exactly.
- [ ] The generated workflow passes `actionlint` or an equivalent structural
  check in the test suite, and runs `gate ci` with the base, head, expected
  release, output directory, and approval input.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CI-004`, `SG-CI-002`, `SG-DIST-001`: preview, confirm, remove, existing-file, secrets-named, and no-value fixtures | `npm run test:unit` | Yes — observable at the command |
| smoke | both | the installed skill generates the workflow | `npm run test:install` | Yes — maintainers run the installed copy |

Frontend build and browser evidence are inapplicable.

## Blocked By

- `TB-076` — `gate ci` itself.
- `TB-078` — the expected-release input the workflow passes.

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
