# Drove framework-setup from the plan, and gave newcomers a quick start

The `framework-setup` skill documented every Guided setup command, but its own
workflow predated them. An agent following it guessed the next step, invented
draft paths, never used `config suggest` or the named revisions, never reached
activation, and was told to "rerun the identical configure command" to prove
idempotency — which, on a schema v4 file, rewrites it as v3 and drops the Gate
section (recorded as FS-005).

- Rewrote `SKILL.md` as a lean workflow driven by
  `agent-framework setup --json`: discover, base configuration, an explicit
  opt-in question for the Gate, migration and Gate policy, `config suggest`
  before activation, doctor and activation with the Git-or-Cursor client
  question, then verify and report.
- Stated the rules that keep an agent on the rails: ask the plan for the state
  before and after every step; run its commands verbatim, draft paths included;
  run any preview, but confirm only after the maintainer approves that exact
  preview in the conversation; never answer the interactive prompts or pass
  `--consent-channel`; never hand-edit `evaluation_gate`; run base setup only in
  `no-configuration` or `schema-v3`.
- Moved the command reference and the direct migration and Gate-configuration
  transactions, unchanged, into `references/framework-command.md` and
  `references/schema-and-gate-transactions.md`. `SKILL.md` went from 498 to 226
  lines.
- Added to the framework guide: how to run the `agent-framework` command (direct
  path, alias, or `npm link`); a seven-step quick start for a new project; an
  agent shortcut using the skill; a warning that the guided client question is
  not about the tracker; and how to add Cursor to a clone already activated for
  Git. Corrected the claim that a desktop client is "a separate, later
  invocation".

Verification: `npm run validate`, `npm run test:install`, and
`npm run test:unit` (795 passing).
