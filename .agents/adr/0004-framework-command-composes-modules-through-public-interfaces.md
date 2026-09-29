# The Framework command lives in framework-setup and reaches the Gate only through its command interface

Status: accepted

## Context

Adopting and maintaining the Change Evaluation Gate spans two independently
selectable modules: `framework-setup` owns discovery, schema migration, and Gate
policy drafting; `change-evaluation-gate` owns activation and the rest of the
lifecycle. A maintainer needs one guided command over both
([guided setup feature contract](../../.scratch/guided-setup/issues/guided-setup-feature-spec.md)).

Skills are installed one directory at a time, and clients place and link them
independently (`npx skills add … --copy`; `.claude/skills` linked to
`.agents/skills`). A bin outside every skill is absent from a skill-only
install, and a relative import from one installed skill into another is not
reliable. The Gate module must stay independently selectable and dormant until
activated (`FR-LIFE-012`, `SG-DIST-001`).

## Decision

- The Framework command's entry lives in the always-installed `framework-setup`
  module and uses that module's own functions in-process.
- It reaches the Gate only by running the Gate's own command with `--json` and
  reading the versioned observation document, including each preview's
  confirmation token. The Framework command never imports a Gate module. The
  one existing crossing — `framework-setup` dynamically importing the Gate
  policy validator when it configures the Gate section — predates this
  decision, is the owning validator, and is reused rather than duplicated.
- It locates the Gate command on the path, else as the installed Gate skill
  beside `framework-setup`; otherwise the Gate module is absent and only setup
  steps are offered.
- The package bin `agent-framework` points at the same entry.
- The Framework command owns no write, validation, consent, or lifecycle logic;
  every change goes through the owning operation's preview and hash-bound
  confirmation. Revising an already-configured Gate section is a new previewed
  operation owned by `framework-setup`, which owns the configuration file.

## Consequences

- Works in skill-only and npm installs alike, and exercises the same Gate
  surface agents use.
- One extra process per Gate step.
- A field a prompt needs but the Gate's `--json` document lacks is added to the
  Gate as its own change, never worked around in the Framework command.
