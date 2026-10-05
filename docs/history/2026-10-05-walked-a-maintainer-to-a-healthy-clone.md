# Walked a maintainer to a healthy clone

Delivered TB-072, the interactive half of the Guided setup feature
(`FR-GUIDE-001`, `FR-GUIDE-003`, `FR-GUIDE-004`, `NFR-REL-004`). TB-067's
`agent-framework setup` named every remaining adoption step and its exact next
command, but a maintainer still ran each one by hand: two drafts written to the
temporary directory and edited, three tokens copied back, and the order kept in
their head. `RISK-011` was accepted on condition that the channel consent came
through is recorded, and nothing in the Gate could record it.

- Made `setup` guided when standard input and output are both terminals and no
  `--json` is asked for. It performs the plan one step at a time, re-deriving
  each step from the clone as the last one left it, so the order is TB-067's
  plan and nothing else (`SG-OWNER-001`). Each step shows the owning
  operation's complete preview: the migrated file and its hash, the drafted Gate
  policy and the file it would write, or the Gate's own `--json` preview.
- Asked only what the owning operation cannot derive: the migration report's
  open decisions, each defaulting to `draftMigrationMapping`'s value, with an
  answer read as JSON when it parses as JSON; the client to activate (`git`, the
  Gate's own default, passing nothing when the answer is empty); and, when
  `gate sync` refuses a weaker candidate, the weakening it names typed back
  exactly before its acknowledged preview is asked for (`SG-CFG-001`).
- Confirmed only on an explicit `yes`, with exactly the shown preview's token,
  through the owning operation: `migrateConfiguration` and `configureGate`
  in-process, and the Gate as its own command (ADR 0004). Any other answer, end
  of input, or the owning operation's refusal stops the run in that operation's
  words, with the clone at the last completed step. No step is retried, no
  answer is carried to the next step or run, and a step that completes and is
  named again stops the run. A Gate remedy naming several subcommands is
  performed one subcommand at a time.
- Left base setup unperformed. `configureProject` writes with no preview or
  token, so a clone with no configuration is told the command to run
  (`SG-GUIDE-001`).
- Recorded the consent channel in the Gate (feature contract `GAP-005`).
  Running an activation showed `--actor` lands only in the receipt's trust
  record, only on `activate`; `sync`, `repair`, and `deactivate` carry nothing,
  and no Lifecycle event says how consent arrived. `gate activate`, `sync`,
  `repair`, and `deactivate` now accept `--consent-channel`, from the declared
  vocabulary `interactive-guided-setup`. It is not part of any token. Opening
  the Evidence store with it puts it on every Lifecycle event that confirmation
  appends, refusals included, as `consent: { channel, provenance:
  "self-declared" }`; an event without it is byte-for-byte what it was, and the
  receipt never carries it.
- Kept TB-067's output. Without the interactive flag, or with `--json`, the
  entry prints the plan byte for byte as before and never touches the terminal.
  The bin's terminal (`lib/terminal.mjs`, on Node's line reader) reads nothing
  until it asks.

Verification: the first red test drove a schema v3 clone with scripted answers
and failed against the previous entry, which printed the plan and exited 1; it
now ends activated and healthy with nothing further to do.
`npm run test:unit` (784 passing, 1 skipped, three runs) also covers the
configured, unconfigured, configuration-drift, hook-drift, runtime-drift, and
already-healthy clones, the Gate-absent narrowing, a clone with no
configuration, `no`, `y`, an empty answer, and end of input at the migration's
confirmation, `no` at activation and the question asked again on the next run,
a preview changed before the `yes` (migration and activation), a hand-weakened
policy refused until the weakening is typed, doctor predicting a stop, the
unchanged non-interactive and `--json` output, guided and direct twins at the
same path, a secret canary, the process terminal over streams, and the Gate's
selector on its own. `gate-activation-smoke` gained
`guided-setup-to-activated`: a real schema v3 clone walked to activated, the
channel on the activation's event, and real commits allowed and denied by the
hook. `npm run test:install` and the other gate smokes pass; `npm run validate`
reports only the pre-existing frontmatter errors in the uncommitted
`skills/implement/SKILL.md`.

Limits. The channel is self-declared, as an actor is: the Gate cannot observe a
terminal, and an agent with one can still answer (`RISK-011`, accepted).
`framework-setup`'s migration and Gate configuration confirmations record no
channel, since that module keeps no record of its own; the Activation consent
that later pins their result does. A guided receipt equals a direct one apart
from the instants and random self-test subjects any two activations differ by.
The complete Gate preview is shown as its `--json` observation.
