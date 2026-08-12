# TB-001 — Expand verification configuration to schema v4

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent
Blocked by:
Tracker ID: 01-expand-verification-configuration-to-schema-v4
Draft key: TB-001

**Status:** ready-for-agent
**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

An existing framework repository can preview and explicitly migrate its schema v3 verification contract to schema v4, including explicit backend and frontend profile presence, without changing established verification behavior, configuring the Gate, or activating enforcement.

## SRS Traceability

- `FR-CFG-008`, `FR-CFG-009`
- `AC-CFG-005`
- `SG-CFG-002`
- `RISK-005`, `Q-005`

## Domain Concepts

Command descriptor, Verification profile, Source scope, Gate configuration section, Gate lifecycle state, and Trusted gate configuration.

## Approach and Tradeoffs

Extend the existing `framework-setup` configuration seam with a backward-compatible v4 reader and an explicit previewed migration transaction. Schema v4 distinguishes a proved-absent `none` profile from conservative `unknown`, supports backend-only, frontend-only, full-stack, and `tooling` configurations, and applies shared, tied, or unmatched paths only to configured active profiles. Convert only unambiguous commands and profile presence, require maintainer mapping for ambiguity, write atomically, and preserve v3 on every refusal or failure. This keeps migration separate from Gate adoption and retains v3 read support throughout `0.x`.

## Architecture Boundary and Public Seam

The boundary is `framework-setup` configuration ownership; the public seam is the lifecycle migration command and its preview/result contract. First red test: a schema v3 fixture containing an ambiguous command is previewed, writes nothing, and reports the required mapping.

## Safeguards and Invariants

- `SG-CFG-002`: migration never guesses command or profile presence, rewrites v3 without confirmation, targets an inactive profile with scopes or commands, or configures or activates the Gate as a side effect.

## Prohibited Behavior and Non-goals

Do not remove v3 read support, infer Gate consent, activate hooks, reinterpret `unknown` as `none`, invent command or profile mappings, or redesign private serialization beyond the observable migration contract.

## Risk and Decision Impacts

- `RISK-005`: accepted conditionally; backward compatibility, profile-presence symmetry, and ambiguity-rejecting atomic migration are mandatory release evidence.
- `Q-005`: fixes `0.9.0` as the first Gate-capable release, with v3 and v4 reads, explicit v4 profile absence, and v4-only Gate configuration.

## Acceptance Criteria

- [x] `AC-CFG-005`: `0.9.0` reads v3 and v4; v4 accepts backend-only, frontend-only, full-stack, and tooling-only profiles; inactive profiles receive no scopes or commands; only v4 can configure the Gate; migration is previewed and atomic; command or profile ambiguity writes nothing until mapped; and migration never configures or activates.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CFG-005`, `SG-CFG-002`: profile-matrix and migration fixtures prove active-scope selection, preview, ambiguity refusal, atomicity, and no Gate adoption | `npm run test:unit` | Yes — configured unit tests exercise the lifecycle migration seam |
| broad-tests | both | `AC-CFG-005`: existing schema v3 behavior remains readable and unchanged | `npm run test:unit` | Yes — configured regression suite protects established setup behavior |

Frontend build and browser evidence are inapplicable because the configured frontend profile is `none` and this slice changes no frontend surface.

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
