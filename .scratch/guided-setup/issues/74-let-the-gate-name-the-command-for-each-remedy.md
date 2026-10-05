# TB-074 — Let the Gate name the command for each remedy

Status: done
Parent: guided-setup-feature-spec
Assignee:
Labels: done, enhancement
Blocked by:
Tracker ID: 74-let-the-gate-name-the-command-for-each-remedy
Draft key: TB-074

**Status:** done

**Parent feature contract:** `.scratch/guided-setup/issues/guided-setup-feature-spec.md`

## Outcome

Every next-step document the Gate emits names, for each remedy, the Gate
subcommands that perform it, in order, or states that the remedy is the
maintainer's own act. `agent-framework setup` reads those subcommands from the
Gate instead of keeping its own copy of which remedy maps to which command, so
the Gate's single remedy table is once again the only place that knows.

## SRS Traceability

- `FR-GUIDE-001`
- `AC-GUIDE-001`
- `SG-GUIDE-001`, `SG-OWNER-001`

## Domain Concepts

Framework command, Guided setup, Gate health, Activation transaction.

## Approach and Tradeoffs

- Verified: `nextRemedies` in the Gate's remedy module returns
  `{ instruction, shortcut, remedies, informational }`, and each remedy is
  `{ remedy, instruction, findings }`. It carries no command (read at
  `remedies.mjs`, and executed through `gate status --json`, where
  `observation.next` has exactly those keys).
- Verified: `gate status`, `gate repair`, the `integrity-drift` diagnostic, and
  the runner-pin denials all build their next step through `nextRemedies`.
- Verified: `agent-framework.mjs` keeps `REMEDY_SUBCOMMANDS`
  (`activate` → `activate`, `repair` → `repair`, `sync` → `sync`,
  `activation-transaction` → `deactivate`, `activate`) to turn a remedy into
  commands. That is the workaround ADR 0004 and feature contract `GAP-005` rule
  out.
- Proposed: each remedy object gains one additive field listing its Gate
  subcommands in order. It is empty for a remedy the maintainer performs
  (`correct-configuration`, `reconcile-client-registration`,
  `version-control`). It is defined beside `REMEDIES` in the same module, so a
  remedy without a recorded command list fails the existing enumeration tests
  exactly as a remedy without an instruction does. The document identifier
  stays `change-evaluation-gate/observation/1`, since the change only adds a
  field.
- Proposed: the Framework command reads the field and deletes its table. When
  the installed Gate predates the field, `setup` refuses with a stated reason
  naming the installed Gate, rather than guessing a command. The implementer
  confirms this refusal against how `setup` already reports an unusable Gate.
- Tradeoff: two modules change in one slice. It is still one outcome — one
  source of truth for remedy commands — and neither module imports the other.

## Architecture Boundary and Public Seam

Two boundaries: the Gate's remedy module, which is observed through
`gate status --json` and `gate repair --json`, and the Framework command's
`setup`. Public seams: the Gate's operator-surface tests, and `setup` run as a
child process on drift fixtures. First red test: on a configuration-drift
fixture, `gate status --json` names `sync` as the remedy's subcommand — today
the remedy carries no command.

## Safeguards and Invariants

- `SG-OWNER-001`: which remedy applies, in which order, and what performs it are
  all the Gate's. The Framework command renders what the Gate names and holds
  no remedy knowledge of its own. A test asserts `agent-framework.mjs` names no
  remedy identifier.
- `SG-GUIDE-001`: `setup` still writes, confirms, and registers nothing; the
  existing byte-hash fixtures stay green.

## Prohibited Behavior and Non-goals

- No change to which remedy a finding maps to, to remedy ordering, or to any
  instruction's wording.
- No full command strings from the Gate. The caller already owns the prefix and
  the preview-then-confirm spelling; the Gate names subcommands only.
- No interactive behavior (`TB-072`).

## Risk and Decision Impacts

- ADR 0004 consequence: a field a prompt needs is added to the Gate, never
  worked around. This slice removes the one workaround `TB-067` shipped.
- Feature contract `GAP-005`: resolved for remedies.

## Acceptance Criteria

- [x] `AC-GUIDE-001`: for the configuration-drift, hook-drift, and
  runtime-or-adapter-drift fixtures, every remedy in `gate status --json` and
  `gate repair --json` names its subcommands, and `setup`'s steps and next
  command are unchanged from `TB-067`'s output for the same fixtures.
- [x] Every remedy in the Gate's table has a recorded command list, and a
  remedy the maintainer performs has an empty one. The enumeration test fails
  when one is missing.
- [x] `agent-framework.mjs` holds no remedy-to-command mapping, and `setup`
  refuses with a stated reason when the Gate's document lacks the field.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-GUIDE-001`, `SG-OWNER-001`, `SG-GUIDE-001`: remedy-commands on status and repair, enumeration, setup-output-unchanged on drift fixtures, no-table-in-framework-command, and missing-field-refused fixtures | `npm run test:unit` | Yes — both boundaries are observable here |
| smoke | both | `AC-GUIDE-001`: the installed and linked `framework-setup` skill still plans through the installed Gate with identical output | `npm run test:install` | Yes — the field crosses the installed-skill boundary |

Frontend build and browser evidence are inapplicable: this changes a JSON
document and a terminal command's source of truth.

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
