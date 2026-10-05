# Named the next adoption step without a terminal

Delivered TB-067, the first Guided setup slice. Adopting the Gate took about
seven commands across two modules, three confirmation tokens, and two JSON
drafts whose paths the maintainer had to invent, and nothing said which of
those steps a given clone still needed. An agent without a terminal had no way
to ask.

- Created the Framework command. `agent-framework` is a new package bin whose
  entry lives in the always-installed `framework-setup` skill, as
  [ADR 0004](../../.agents/adr/0004-framework-command-composes-modules-through-public-interfaces.md)
  decided, so a skill-only install carries it too.
- Reported where a clone stands. `setup`, with or without `--json`, names the
  adoption state (`no-configuration`, `schema-v3`, `gate-unconfigured`,
  `configured`, or `activated` with the Gate's health), every remaining step in
  order with the command that owns it, the decisions left to the maintainer,
  and the exact next command. A healthy clone reports nothing to do.
- Took every boundary from its owner. `framework-setup` discovery supplies the
  schema version; its migration and Gate-policy previews supply open decisions
  and refusals verbatim; `gate status --json` supplies the Gate state and the
  remedy for drift; `gate doctor --json` says whether activation would stop. No
  lifecycle, migration, or validation rule was re-implemented (`SG-OWNER-001`).
- Named drafts instead of asking for them. Migration and policy drafts get a
  fixed path in the temporary directory, keyed by the clone, so nobody invents
  one and the clone stays clean.
- Reached the Gate only as a program: `change-evaluation-gate` on `PATH`, else
  the installed Gate skill beside `framework-setup`, resolved from the entry's
  real path so a linked client directory finds the same sibling. Without
  either, `setup` names only setup steps and states that the Gate steps are
  unavailable (`FR-GUIDE-009`).
- Wrote, confirmed, and registered nothing, and never prompted
  (`SG-GUIDE-001`). Exit status follows the Gate's: 0 nothing further, 1 steps
  remain, 2 could not run.

Scope held: no interactive consent (that is TB-072), no configuration display
or revision, no report, and no import of any Gate module.

Verification: `npm run test:unit` (717 passing) drives the command as a child
process against every adoption-state fixture, hashes the clone and `.git`
across text and `--json` runs, checks repeat runs are byte-identical, and pastes
each printed next command into a shell to prove it is exact. `npm run
validate` passes, and `npm run test:install` now runs `setup` from the installed
and the linked skill, compares the output, checks it found the installed Gate,
and checks no adoption state appeared.

Two limits were recorded. `configure-gate` still reaches the Gate policy
validator by a relative sibling import, so with the Gate on `PATH` but not
installed beside `framework-setup`, the Gate-configuration step reports that
import's refusal instead of a plan. The remedy-to-subcommand spelling was a
small table in the Framework command; TB-074 removed it the same day.
