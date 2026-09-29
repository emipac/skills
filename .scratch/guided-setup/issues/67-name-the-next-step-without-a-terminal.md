# TB-067 — Name the next step without a terminal

Status: ready-for-agent
Parent: guided-setup-feature-spec
Assignee:
Labels: ready-for-agent, enhancement
Blocked by:
Tracker ID: 67-name-the-next-step-without-a-terminal
Draft key: TB-067

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/guided-setup/issues/guided-setup-feature-spec.md`

## Outcome

A maintainer or agent runs `agent-framework setup` in any clone and, without an
interactive terminal or with `--json`, learns where the clone stands in Gate
adoption, every remaining step in order, and the exact next command with every
parameter it needs — and nothing is written. When the Gate module is not
installed, the same command says Gate steps are unavailable and names only the
setup steps. This slice creates the Framework command itself.

## SRS Traceability

- `FR-GUIDE-001`, `FR-GUIDE-002`, `FR-GUIDE-004`, `FR-GUIDE-009`
- `AC-GUIDE-001`, `AC-GUIDE-002`
- `SG-GUIDE-001`, `SG-DIST-001`, `SG-OWNER-001`
- `RISK-005`

## Domain Concepts

Framework command, Guided setup, Gate lifecycle state, Gate health, Gate
configuration section, Activation consent, Gate module.

## Approach and Tradeoffs

- Verified: `package.json` declares two bins today, `change-evaluation-gate` and
  `change-evaluation-gate-precommit`; there is no `agent-framework` bin.
- Verified: `configure.mjs` exposes `--discover`, `--migrate-v4 --mapping`,
  `--configure-gate --policy`, `--draft-mapping`, `--draft-policy`, each confirmed by
  passing the preview token back with `--confirm`; `gate.mjs` usage lists `status`, `doctor`, `activate`,
  `sync`, `repair`, `deactivate` with `--json`.
- Verified: `gate status --json` returns `observation.state`,
  `observation.health`, and `observation.next` with `instruction`, `remedies`,
  and `informational`; `gate doctor --json` returns `observation.verdict` with
  `proceeds` and `stop.reasonCode` (both executed on this repository, where the
  answer is `gate-policy-missing`).
- Verified: installed skills are copied one directory at a time and may be
  linked (`scripts/smoke-install.mjs`).
- Proposed: the adoption state is derived in this order — no
  `.agent-framework.yaml` → base setup; schema v3 → migration; schema v4 with no
  Gate section → Gate configuration; configured and not activated → doctor then
  activation; activated → whatever `observation.next.remedies` names. The
  implementer confirms each boundary against the owning command's own refusal
  rather than re-deriving it.
- Proposed: the next command is printed with the drafts the owning operation
  would produce inline where the owning command accepts them, and otherwise as
  the draft command followed by the consuming command, so no maintainer has to
  invent a draft path.
- Proposed: the Gate command is located as the `change-evaluation-gate`
  executable on the path, else the installed Gate skill directory beside the
  installed `framework-setup` directory; otherwise the Gate module is absent.
- Tradeoff: one child process per Gate question in exchange for never importing
  a Gate module ([ADR 0004](../../../.agents/adr/0004-framework-command-composes-modules-through-public-interfaces.md)).

## Architecture Boundary and Public Seam

The entry lives in the `framework-setup` module and is exposed as the
`agent-framework` package bin. Public seam: the command run as a child process
with no terminal against adoption-state fixtures. First red test: a schema v3
fixture run with `setup --json` reports state `schema-v3`, a first step naming
the migration, and an exact next command — today the command does not exist.

## Safeguards and Invariants

- `SG-GUIDE-001`: this slice never confirms, writes, registers, or trusts
  anything; a fixture hashes the clone and `.git` before and after.
- `SG-DIST-001`: installing the package or skill changes nothing until the
  command is run; `npm run test:install` keeps asserting no adoption state
  appears.
- `SG-OWNER-001`: every step names the owning command; no lifecycle, migration,
  or validation rule is re-implemented.

## Prohibited Behavior and Non-goals

- No prompt and no confirmation in this slice; interactive consent is `TB-072`.
- No import of any Gate module.
- No configuration revision (`TB-069`), display (`TB-068`), or report (`TB-073`).

## Risk and Decision Impacts

- `RISK-005` (migration changes behavior): mitigated by only naming the owning
  previewed migration.
- ADR 0004 governs placement and Gate access.

## Acceptance Criteria

- [ ] `AC-GUIDE-001`: for each fixture — no configuration, schema v3, schema v4
  unconfigured, configured, activated and healthy, configuration drift, hook
  drift, and Gate module absent — `setup` names the state, the ordered remaining
  steps, and the next command the owning operation requires; healthy reports
  nothing to do; Gate-absent names only setup steps and says Gate steps are
  unavailable.
- [ ] `AC-GUIDE-002`: without a terminal and with `--json`, nothing under the
  clone or `.git` changes, and the JSON document carries the same plan.
- [ ] The installed `framework-setup` skill runs the command from where the
  client placed it and through a link, with identical output.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-GUIDE-001`, `AC-GUIDE-002`, `SG-GUIDE-001`: eight adoption-state fixtures, byte-hash of clone and `.git` before and after, JSON mirror | `npm run test:unit` | Yes — the command's whole behavior is observable here |
| smoke | both | `AC-GUIDE-001`, `SG-DIST-001`: the installed and linked skill expose the command and install creates no adoption state | `npm run test:install` | Yes — placement is the point of ADR 0004 |

Frontend build and browser evidence are inapplicable; this is a terminal
command.

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
