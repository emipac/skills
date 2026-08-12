# TB-002 — Configure the Gate as a dormant opt-in module

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent
Blocked by: 01-expand-verification-configuration-to-schema-v4
Tracker ID: 02-configure-the-gate-as-a-dormant-opt-in-module
Draft key: TB-002

**Status:** ready-for-agent
**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A maintainer can install the Gate module and explicitly add its five-part repository policy while the repository remains configured but inactive, with no receipt, hook, trust change, or implied adoption.

## SRS Traceability

- `FR-CFG-001`, `FR-CFG-002`, `FR-LIFE-001`, `FR-LIFE-002`, `FR-LIFE-003`, `FR-LIFE-012`, `FR-LIFE-013`
- `AC-CFG-001`, `AC-LIFE-001`, `AC-LIFE-006`
- `SG-CFG-001`, `SG-DIST-001`, `SG-OWNER-001`
- `Q-005`

## Domain Concepts

Gate module, Gate configuration section, Gate policy, Gate lifecycle state, and Adapter distribution.

## Approach and Tradeoffs

Expose the Gate as an independently selectable released module and add an initially unselected `framework-setup` configuration branch. Keep the repository policy limited to required and advisory check identities, total budget, bypass, execution, and evidence while Verification remains the sole command owner. Whole-plugin installation may bundle dormant assets but cannot change repository or clone state.

## Architecture Boundary and Public Seam

The boundary is distribution plus `framework-setup` configuration ownership; the public seam is module installation and the lifecycle configuration command. First red test: installing the whole plugin and running setup without selecting the Gate leaves no `evaluation_gate` section, receipt, or managed hook.

## Safeguards and Invariants

- `SG-DIST-001`: distribution never configures or activates the Gate.
- `SG-OWNER-001`: Gate policy references Verification checks and never duplicates command definitions.
- `SG-CFG-001`: the configured policy cannot authorize its own weakening.

## Prohibited Behavior and Non-goals

Do not infer consent from installed assets, create clone-local state during configuration, add global activation, or move command ownership out of `verify-change`.

## Risk and Decision Impacts

- `Q-005`: Gate configuration exists only in schema v4 and remains separate from clone-local activation.

## Acceptance Criteria

- [x] `AC-CFG-001`: absence means not configured; presence means configured only; exactly five policy subcontracts are accepted and Verification retains command ownership.
- [x] `AC-LIFE-001`: project or global distribution never activates a repository, and a fresh clone has no receipt or managed hook.
- [x] `AC-LIFE-006`: selective installers expose the module independently, whole-plugin installation leaves it dormant, and setup leaves configuration unselected until confirmed.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CFG-001`, `SG-OWNER-001`: schema fixtures prove the five policy subcontracts and Verification ownership | `npm run test:unit` | Yes — configured unit suite exercises setup configuration |
| smoke | both | `AC-LIFE-001`, `AC-LIFE-006`, `SG-DIST-001`: isolated installs remain dormant | `npm run test:install` | Yes — configured install smoke proves distribution without adoption |

Frontend build and browser evidence are inapplicable because the configured frontend profile is `none`.

## Blocked By

`TB-001` — schema v4 must exist before its optional Gate section can be configured.

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
