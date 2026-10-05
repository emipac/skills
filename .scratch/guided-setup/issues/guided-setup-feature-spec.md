# Guided Setup — Feature Contract

Status: open
Parent:
Assignee:
Labels:
Blocked by:

## Feature Contract

| Field | Value |
| --- | --- |
| Status | ready-for-tickets |
| SRS baseline | [Change Evaluation Gate SRS v0.3.0 — Approved](../../../docs/specifications/change-evaluation-gate-srs.md) |
| Decision sources | Maintainer conversation of 2026-09-29: a thin top-level command over both modules; guided setup and configuration editing only (no installation); a static HTML report instead of a local UI; a new package bin rather than a new released skill; an interactive answer after the complete preview is consent, never without a terminal; only the Gate configuration section is editable; the report goes to the temporary directory by default; placement in `framework-setup` with Gate access only through its `--json` command, the `agent-framework` bin name, the scripted-terminal and child-process test seams, the SRS `0.3.0` rows, and `RISK-011` were approved. [ADR 0004](../../../.agents/adr/0004-framework-command-composes-modules-through-public-interfaces.md) records placement. |

## Problem and Outcome

Adopting the Gate on a project takes about seven commands, three confirmation
tokens, and two JSON drafts written to disk, edited, and passed back by path:
base setup, `--draft-mapping` then `--migrate-v4 --mapping` then `--confirm`,
`--draft-policy` then `--configure-gate --policy` then `--confirm`, `gate
doctor`, `gate activate --client` then `--confirm`. Every later change to
dependency roots, their provisioning, Sensitive runtime inputs, environment
files, budget-skippable checks, the budget, or bypass is a hand edit of `.agent-framework.yaml`
followed by `gate sync`, `--acknowledge-weakening` when needed, and `--confirm`.
A maintainer has to remember which module owns which step, every flag, and the
key paths inside the Gate configuration section. Every command in that list was
observed in the current `configure.mjs` argument parser and `gate.mjs` usage.

Outcome: one Framework command walks a maintainer from any adoption state to a
healthy activated clone, and revises the Gate configuration section through
named operations, without adding any way to write, confirm, or activate that
the owning operations do not already provide. An agent or CI without a terminal
gets the same plan and the exact next command instead of a prompt.

## SRS Traceability

| Requirement IDs | Acceptance IDs | Safeguard IDs | Risk IDs | Question IDs | Scope |
| --- | --- | --- | --- | --- | --- |
| `FR-GUIDE-001`, `FR-GUIDE-004`, `FR-GUIDE-009` | `AC-GUIDE-001` | `SG-GUIDE-001`, `SG-OWNER-001`, `SG-DIST-001` | `RISK-005` | None | State-derived guided setup across every adoption state, and the Gate-absent narrowing |
| `FR-GUIDE-002`, `FR-GUIDE-003`, `NFR-REL-004` | `AC-GUIDE-002` | `SG-GUIDE-001`, `SG-CFG-001` | `RISK-011`, `RISK-008` | None | Consent: none without a terminal; an answer after the complete preview in one; equivalence with the direct commands |
| `FR-GUIDE-005`, `FR-GUIDE-006`, `FR-GUIDE-007` | `AC-GUIDE-003` | `SG-GUIDE-001`, `SG-GUIDE-002`, `SG-OWNER-001`, `SG-CFG-001` | `RISK-012`, `RISK-008` | None | Display, revision, and proposals for the Gate configuration section only |
| `FR-GUIDE-008` | `AC-GUIDE-004` | `SG-GUIDE-002`, `SG-SECRET-001` | `RISK-006` | None | Static read-only report |

## User Stories and Scenarios

1. As a Repository maintainer adopting the Gate, I want one command that tells
   me and walks me through the next step, so that I never look up a flag or
   write a draft file.
2. As a Repository maintainer whose project needs a new dependency root, I want
   to add it by name with its provisioning, see the exact file change, and
   re-pin in the same flow, so that I never hand-edit YAML keys.
3. As an agent without a terminal, I want the remaining plan and the exact next
   command, so that I can hand the confirmation to the maintainer rather than
   be refused without guidance.
4. As a Repository maintainer, I want one page summarizing the clone's Gate
   state, so that I can read or share it without running several commands.

Scenarios that materially apply:

- **Happy path, fresh project.** Schema v3 → migration preview with ambiguities
  asked, defaulting to the draft → confirm → policy preview with the draft
  policy → confirm → doctor → activation preview → confirm → status healthy
  with nothing further to do.
- **Boundary, already healthy.** Guided setup reports nothing to do and
  changes nothing.
- **Recovery.** Configuration drift leads to the `gate sync` preview; hook drift
  to `gate repair`; runtime or adapter drift to deactivate then activate —
  exactly the remedy Gate status names.
- **Failure.** A step refused by its owning operation (for example doctor
  predicts activation would stop) is reported with the owning reason and the
  flow stops without changing anything further.
- **Weakening.** A revision or re-pin whose candidate is weaker than the trusted
  policy is refused until the maintainer types the acknowledgement.
- **Non-interactive.** Piped input, CI, or `--json`: no prompt, no confirmation,
  plan plus the exact next command.
- **Gate module absent.** Setup and migration steps run; Gate steps are listed
  as unavailable, never attempted.
- **Authorization.** Only the Repository maintainer at an interactive terminal
  can give consent by answering the Framework command; everyone else passes the
  owning preview's own token explicitly with `--confirm`, exactly the consent
  the owning commands already accept.

## Approach and Decisions

- **Decided — composition only.** Every write, confirmation, registration, and
  trust step is the owning operation's own preview and hash-bound confirmation.
  The Framework command chooses the step, collects the answers, and passes the
  owning preview's own token back. It holds no lifecycle or validation logic.
- **Decided — consent.** In an interactive terminal the complete preview is
  shown and an explicit affirmative confirms that preview's token; a weakening
  also needs a typed acknowledgement naming it. Without a terminal the Framework
  command confirms nothing on its own; it may pass on a token the caller
  supplies explicitly with `--confirm`, which the owning operation then checks
  exactly as it would from its own command line (Product Owner, 2026-10-05,
  amending `SG-GUIDE-001`). This matches the glossary's existing **Activation
  consent** rule that interactive activation requires confirmation.
- **Decided — scope of revision.** Only the Gate configuration section's five
  subcontracts: `checks` (required and advisory identities), `budget`,
  `bypass`, `execution` (dependency roots, dependency provisioning,
  budget-skippable checks), and `evidence` (Sensitive runtime inputs,
  environment files). Verified: the Gate policy's reserved-property list
  forbids `allowed_environment` and every other descriptor field in this
  section, so a check's allowed environment stays with the Verification profile
  commands and `framework-setup`'s own flows (`SG-OWNER-001`).
- **Decided — revision owner.** Verified: `configureGate` refuses a clone whose
  Gate is already configured, so nothing revises an existing section today.
  Revision is a new previewed, hash-bound operation owned by `framework-setup`,
  which owns the configuration file, validated by the same Gate policy
  validator `configure-gate` already loads. The Framework command only drives
  it.
- **Decided — report.** One self-contained HTML file, written to the temporary
  directory or an explicit path outside the clone, holding state, doctor
  findings, the effective configuration, and next steps. No server.
- **Decided — distribution.** A new package bin, not a new released skill.
- **Decided — placement and coupling ([ADR 0004](../../../.agents/adr/0004-framework-command-composes-modules-through-public-interfaces.md)).** Skills are
  installed one directory at a time and clients place them independently
  (observed in `scripts/smoke-install.mjs`: `npx skills add … --copy`, and
  linked `.claude/skills` → `.agents/skills` layouts), so a bin outside any
  skill is absent from skill-only installs and a relative import between two
  installed skills is not reliable. The Framework command's entry lives in the
  always-installed `framework-setup` module and uses its setup, migration,
  policy-drafting, and revision functions in-process. It never imports a Gate
  module — the existing policy-validator import inside `framework-setup` is
  reused, not repeated — and reaches the Gate only by running the Gate's own
  command with `--json`, which already returns a
  versioned document carrying each preview's `confirmationToken` (observed in
  `operator-surface.mjs`). It finds that command as the executable on the path,
  else the installed Gate skill beside `framework-setup`, else treats the Gate
  module as absent. The package bin points at the same entry.
- **Decided — name.** The bin is `agent-framework`, with
  `setup`, `config show`, one `config` subcommand per named revision, `config suggest`, and `report`
  subcommands.
- **Decided — revision writer.** No YAML library is a runtime dependency.
  Verified: `configure-gate` renders the section as one flow-JSON line per
  subcontract. A revision rewrites only a section in exactly that form, and
  compares every other byte before and after (`RISK-012`). A hand-written
  section — block YAML, a comment or blank line inside it, other JSON spacing —
  is refused by line number with nothing written, and is never converted
  (Product Owner, 2026-10-05).
- **Tradeoff accepted.** Going through the Gate's command interface costs one
  process per step. It buys independence of the two modules and makes the
  Framework command exercise the same surface agents use.

## Public Interfaces and Test Seams

| Seam | Behavior observed | Acceptance IDs | Prior art |
| --- | --- | --- | --- |
| Framework command run as a child process without a terminal, with and without `--json` | Plan and exact next command per adoption state; nothing written; Gate-absent narrowing | `AC-GUIDE-001`, `AC-GUIDE-002` | `tests/gate-activation-command.test.mjs` spawns `gate.mjs` against configured clones |
| Framework command's exported entry driven with a scripted terminal (input answers, output capture, interactive flag) | Previews shown in full, answers confirm exactly the previewed identity, weakening refused until acknowledged, flow reaches a healthy status | `AC-GUIDE-001`, `AC-GUIDE-002` | `tests/gate-operator-surface.test.mjs` drives `runOperatorCommand` in-process |
| Guided run versus the direct command sequence on twin fixtures | Byte-identical configuration and receipt; identical Lifecycle event types | `AC-GUIDE-002` | `tests/framework-setup.test.mjs` byte-identical repeat-run assertions |
| Framework command `config` subcommands on configured and activated fixtures | Display marks pinned and differing values; revisions preview, refuse invalid candidates, apply only with the token, leave other bytes identical, and continue into the re-pin preview | `AC-GUIDE-003` | `tests/framework-setup.test.mjs` configure-gate preview/confirm tests; `gate sync` tests in `tests/gate-operator-surface.test.mjs` |
| Framework command `report` with a secret canary fixture | One self-contained file at the temporary or explicit path, refused inside the clone, canary absent | `AC-GUIDE-004` | `tests/gate-evidence-secrets.test.mjs` canary pattern |
| `npm run test:install` | The installed `framework-setup` skill exposes the command from where the client placed it, through a link as well | `AC-GUIDE-001` | `scripts/smoke-install.mjs` installed-command comparison |

## Safeguards and Prohibited Behavior

- `SG-GUIDE-001`: never write, confirm, register, or establish trust except
  through the owning operation's preview and hash-bound confirmation; without an
  interactive terminal, never confirm on its own — only pass on a token the
  caller supplied explicitly. Violation: refuse the step, change nothing, name
  the owning command.
- `SG-GUIDE-002`: no Sensitive runtime value in any display or report; no report
  inside the clone.
- `SG-OWNER-001`: never add, remove, or rescope Verification profile commands;
  never duplicate `framework-setup` command ownership inside the Gate or the
  Gate's lifecycle logic inside the Framework command.
- `SG-CFG-001`: a revision or re-pin never weakens the trusted policy without
  the hash-bound approval and typed acknowledgement.
- `SG-DIST-001`: installing the package or skill never configures or activates
  anything; the command does nothing until run.
- Prohibited: auto-answering a prompt, remembering consent across steps or
  runs, retrying a refused step silently, reading or printing a secret value,
  and reaching the Gate by importing its modules.

## Risks, Gaps, and Assumptions

| ID | Type | Description | Impact | Blocks readiness | Resolution |
| --- | --- | --- | --- | --- | --- |
| RISK-011 | Risk | An agent in an interactive terminal answers a guided confirmation. | High | No | Accepted by the Product Owner on 2026-09-29 with the SRS mitigation: terminal-only prompts, complete preview, typed weakening acknowledgement, consent channel recorded. |
| RISK-012 | Risk | A revision changes bytes outside the Gate configuration section or loses comments. | Medium | No | Mitigated by section-only rewrite, byte comparison, and refusal when the section is ambiguous. |
| RISK-008 | Risk | A revision weakens a Grader surface. | High | No | Mitigated: revisions end in the existing `gate sync` weakening detection and acknowledgement. The narrower-than-desired weakening detection is a known limit tracked outside this feature. |
| RISK-005 | Risk | Guided migration changes established verification behavior. | High | No | Mitigated: the owning previewed, ambiguity-rejecting migration is reused unchanged. |
| RISK-006 | Risk | The report leaks a secret. | High | No | Mitigated by `SG-GUIDE-002` and a canary test. |
| GAP-001 | Implicit decision | Placement in `framework-setup` and composition over the Gate's `--json` command interface. | High | No | Resolved — ADR 0004. |
| GAP-002 | Implicit decision | Bin and subcommand names. | Low | No | Resolved — `agent-framework`. |
| GAP-003 | Dependency | The SRS rows added in `0.3.0` are in `Review`. | High | No | Resolved — approved in SRS `0.3.0`. |
| GAP-004 | Assumption | An interactive terminal can be detected and scripted without new dependencies. | Low | No | Accepted — Node's built-in terminal detection and line reader, with an injectable terminal for tests. |
| GAP-005 | Dependency | Some Gate previews may not carry every field a prompt needs, for example the weakening list in `--json`. | Medium | No | Accepted — each ticket that finds a missing field adds it to the Gate's observation document as its own change, not a Framework-command workaround. |

## Acceptance Criteria

| ID | Criterion | Evidence seam |
| --- | --- | --- |
| AC-GUIDE-001 | From each adoption-state fixture — schema v3, schema v4 unconfigured, configured, activated and healthy, configuration drift, hook drift, and Gate module absent — guided setup names the step the owning command requires, asks only the underivable decisions, and run to completion reaches Gate status with nothing further to do or, without the Gate module, completed setup with Gate steps stated as unavailable. | Scripted-terminal and child-process runs of the Framework command |
| AC-GUIDE-002 | Without a terminal guided setup changes nothing and prints the plan and exact next command; in a terminal an affirmative answer confirms exactly the previewed identity, a weakening is refused until acknowledged, and the resulting configuration, receipt, and events equal those of the direct command sequence. | Guided versus direct twin-fixture comparison |
| AC-GUIDE-003 | The configuration display marks pinned and differing values; each revision refuses an invalid candidate, previews the exact change, applies only with its token, leaves every byte outside the Gate configuration section unchanged, and continues into the re-pin preview on an activated clone; a proposal never writes by itself. | Framework command `config` runs with byte comparison |
| AC-GUIDE-004 | The report is one file that makes no external request, is written to the temporary directory or the explicit path, is refused inside the clone, and contains no secret canary value. | Framework command `report` run with a secret canary |

## Verification Strategy

Unit and integration evidence through `npm run test:unit`, the configured
`both` test command, for every acceptance criterion; install evidence through
`npm run test:install` for the command's reachability from an installed and a
linked skill; `npm run validate` for manifests and links. The guided flow is
user-facing, so each ticket that adds a guided step also extends the
`gate-activation-smoke` capability with a real-clone scenario driven end to end.
No frontend build applies.

## Out of Scope

- A local UI server or any interactive browser surface; only the static report.
- Adding, removing, or rescoping Verification profile commands.
- Installing, updating, or removing skills, packages, or the Gate module.
- Changing any owning operation's preview, validation, consent, or refusal
  semantics, except adding a field to the Gate's `--json` document that a
  prompt needs (`GAP-005`).
- Broadening policy-weakening detection.

## Readiness

- [x] Every in-scope requirement maps to acceptance evidence.
- [x] Public test seams are agreed.
- [x] Safeguards and prohibited behavior are explicit.
- [x] Risks and resolved decisions have explicit dispositions.
- [x] Blocking gaps and assumptions are resolved.
- [x] Out-of-scope behavior is explicit.
