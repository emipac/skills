# TB-070 — Declare secrets, checks, and budget by name

Status: done
Parent: guided-setup-feature-spec
Assignee:
Labels: done, enhancement
Blocked by: 69-add-a-dependency-root-without-editing-yaml
Tracker ID: 70-declare-secrets-checks-and-budget-by-name
Draft key: TB-070

**Status:** done

**Parent feature contract:** `.scratch/guided-setup/issues/guided-setup-feature-spec.md`

## Outcome

Through the same revision operation, a maintainer declares a Sensitive runtime
input by name, declares or removes an environment file, moves a check between
required and advisory, sets the total budget, and turns bypass on or off with
its marker and reference rule — one named command each. A change that weakens
the trusted policy says so before it is applied, and on an activated clone the
chained `gate sync` refuses it until the weakening is acknowledged.

## SRS Traceability

- `FR-GUIDE-006`, `NFR-REL-004`
- `AC-GUIDE-003`
- `SG-GUIDE-001`, `SG-GUIDE-002`, `SG-CFG-001`, `SG-SECRET-001`
- `RISK-008`, `RISK-012`

## Domain Concepts

Sensitive runtime input, Gate policy, Trusted gate configuration, Candidate.

## Approach and Tradeoffs

- Verified: evidence entries are `evidence.sensitive_inputs` and
  `evidence.environment_files`; the bypass subcontract requires an explicit
  `enabled` boolean and, when enabled, a commit-visible `marker`.
- Verified: `gate sync` refuses a weaker candidate with
  `weakening-unacknowledged` and names `gate sync --acknowledge-weakening`.
- Proposed: each subcommand reuses `TB-069`'s revision operation; only the
  named change differs.
- Proposed: a secret is declared by name and source only; the command never
  reads or asks for its value.

## Architecture Boundary and Public Seam

The Framework command's `config` subcommands over `TB-069`'s revision
operation. Public seam: the subcommands run as child processes. First red test:
declaring `DB_PASSWORD` from `.env` previews one added evidence entry with the
name and source and no value.

## Safeguards and Invariants

- `SG-GUIDE-002`, `SG-SECRET-001`: a canary value present in the environment
  and in `.env` never appears in the preview, the file, or the output.
- `SG-CFG-001`: demoting or removing a required check reaches `gate sync`'s
  weakening refusal unchanged.
- `SG-GUIDE-001`: nothing written without the token.

## Prohibited Behavior and Non-goals

- No change to what `gate sync` counts as a weakening; broadening it is tracked
  separately.
- No editing of a check's allowed environment or command (`SG-OWNER-001`).

## Risk and Decision Impacts

- `RISK-008`: detection unchanged; this slice makes weakening edits reach it.
- `RISK-012`: the untouched-bytes comparison from `TB-069` applies to every
  subcommand.

## Acceptance Criteria

- [x] `AC-GUIDE-003` (revision half, evidence and policy): each subcommand
  previews, validates, writes only with its token, and leaves other bytes
  identical.
- [x] Demoting a required check on an activated fixture continues into a
  `gate sync` preview that refuses until acknowledged.
- [x] No secret canary value appears anywhere.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-GUIDE-003`, `SG-GUIDE-002`, `SG-CFG-001`, `NFR-REL-004`: each subcommand, invalid bypass, canary, and demote-reaches-weakening fixtures | `npm run test:unit` | Yes — every rule is observable at the command |
| smoke | both | `SG-CFG-001`: on a real activated clone, demote a required check, confirm, and the chained `gate sync` refuses until acknowledged | `gate-security-control-smoke`, extended by this slice | Yes — the weakening path is the security-relevant user path |

Frontend build and browser evidence are inapplicable.

## Blocked By

- `TB-069` — the revision operation and its chain into `gate sync`.

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
