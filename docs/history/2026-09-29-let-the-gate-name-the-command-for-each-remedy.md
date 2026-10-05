# Let the Gate name the command for each remedy

Delivered TB-074, a follow-up to TB-067. The Gate's next-step document named
each remedy with its instruction and the findings it answers, but no command,
so `agent-framework setup` kept its own table turning a remedy's name into Gate
subcommands. That was a second place that knew what performs a remedy — the
workaround ADR 0004 and the Guided setup feature contract's `GAP-005` rule out.

- Recorded the subcommands beside each remedy in the Gate's one remedy table.
  Every remedy in `observation.next.remedies`, as `gate status --json` and
  `gate repair --json` report it, now carries `subcommands`: `["repair"]`,
  `["sync"]`, `["deactivate", "activate"]`, or `["activate"]`, and an empty list
  for a remedy the maintainer performs (correcting the configuration,
  reconciling a client registration, committing a Grader surface).
- Named subcommands only. The prefix and the preview-then-confirm spelling stay
  the caller's.
- Kept the document stable. The field is additive, the identifier stays
  `change-evaluation-gate/observation/1`, and which remedy a finding maps to,
  remedy order, and every instruction's wording are unchanged.
- Removed the Framework command's table. `setup` renders each remedy's commands
  from the Gate's field, and its text and `--json` output are byte-identical to
  before on the configured, healthy, and four drift clones.
- Refused rather than guessed. Against a Gate whose document lacks the field,
  `setup` stops with `gate-remedy-subcommands-missing` (exit 2), naming the
  installed Gate's release and location.

Scope held: no change to remedy mapping, ordering, or wording, and no full
command strings from the Gate.

Verification: `npm run test:unit` (722 passing) covers the subcommands on status
and repair for three drift fixtures, an enumeration that fails for a remedy
without a subcommand list, a source check that the Framework command names no
remedy, and the refusal against a wrapped Gate that strips the field. `npm run
validate` passes; `npm run test:install` now also plans a configured clone
through the installed and linked skill and fails when the installed Gate omits
the field; `gate-lifecycle-smoke`, `gate-activation-smoke`,
`gate-security-control-smoke`, and `gate-hook-conformance-smoke` pass. The SRS
records it as 0.3.1 with no requirement changed.

One limit is stated: `setup` still renders a remedy performed by `activate`
alone as its own activation step, with the client decision. It keys on the
subcommand the Gate names, not on the remedy's identifier.
