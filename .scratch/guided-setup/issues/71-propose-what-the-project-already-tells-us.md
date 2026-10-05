# TB-071 — Propose what the project already tells us

Status: done
Parent: guided-setup-feature-spec
Assignee:
Labels: done, enhancement
Blocked by: 70-declare-secrets-checks-and-budget-by-name
Tracker ID: 71-propose-what-the-project-already-tells-us
Draft key: TB-071

**Status:** done

**Parent feature contract:** `.scratch/guided-setup/issues/guided-setup-feature-spec.md`

## Outcome

`agent-framework config suggest` lists what the repository already implies the
Gate configuration section should declare and does not: dependency roots from
the dependency manifests and lock files present, Sensitive runtime input names
from an example environment file, and git-ignored environment files. Each
proposal names its evidence and the exact `config` command that would apply it.
Nothing is applied by suggesting.

## SRS Traceability

- `FR-GUIDE-007`
- `AC-GUIDE-003`
- `SG-GUIDE-001`, `SG-GUIDE-002`, `SG-OWNER-001`
- `RISK-006`

## Domain Concepts

Gate configuration section, Sensitive runtime input, Verification profile.

## Approach and Tradeoffs

- Proposed: proposals come from repository facts only — the presence of a
  manifest and its lock file and of the directory it installs into, the key
  names in an example environment file, and which environment files Git
  ignores. The implementer confirms which facts `framework-setup` discovery
  already reads and reuses them rather than adding a second detector.
- Proposed: stack knowledge stays in the provider data `framework-setup`
  already owns, never as a branch in the Gate (`SG-OWNER-001`).
- Tradeoff: proposals can be wrong; they are advice with evidence, and a
  maintainer applies one only through `TB-069` and `TB-070`.

## Architecture Boundary and Public Seam

The Framework command's `config suggest`. Public seam: the command run as a
child process on fixtures. First red test: a fixture with `composer.lock` and a
`vendor/` directory but no declared roots proposes `vendor` with the command
that adds it.

## Safeguards and Invariants

- `SG-GUIDE-001`: suggesting writes nothing; clone and `.git` bytes unchanged.
- `SG-GUIDE-002`: environment values are never read into the output; names only.
- `SG-OWNER-001`: stack knowledge comes from `framework-setup`'s own provider
  data; no stack branch enters the Gate, and no Verification profile command is
  proposed.

## Prohibited Behavior and Non-goals

- No automatic application, no "apply all".
- No proposals for Verification profile commands.

## Risk and Decision Impacts

- `RISK-006`: a canary value in `.env` and `.env.example` never appears.

## Acceptance Criteria

- [x] `AC-GUIDE-003` (proposal half): fixtures produce the expected proposals
  with evidence and apply-commands; already-declared items are not proposed; a
  proposal never writes by itself.
- [x] No environment value appears in the output.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-GUIDE-003`, `SG-GUIDE-001`, `SG-GUIDE-002`: manifest-and-lock, example-env, ignored-env, already-declared, unchanged-bytes, and canary fixtures | `npm run test:unit` | Yes — proposals are fully observable in the output |

Smoke, frontend build, and browser evidence are inapplicable: read-only advice.

## Blocked By

- `TB-070` — every proposal names an existing `config` command.

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
