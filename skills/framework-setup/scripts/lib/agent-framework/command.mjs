/**
 * The Framework command: `agent-framework`.
 *
 * One command over the two modules a maintainer adopts the Gate through
 * (ADR 0004). It lives in the always-installed `framework-setup` module, uses
 * that module's own functions in-process — read-only and preview-only — and
 * reaches the Change Evaluation Gate only by running the Gate's own command
 * with `--json` (`lib/gate-command.mjs`). It never imports a Gate module.
 *
 * `setup` derives where the clone stands in Gate adoption from each owning
 * command's own observation, and names every remaining step in order with the
 * exact command that performs it (`FR-GUIDE-001`, `FR-GUIDE-002`). It holds no
 * lifecycle, migration, or validation rule of its own (`SG-OWNER-001`):
 *
 * - the schema version is `framework-setup` discovery's reading;
 * - the migration's open decisions are its own preview's ambiguities, and a
 *   draft it would refuse is reported with its own refusal;
 * - the Gate section's absence, the Gate lifecycle state, and every recovery
 *   are `gate status --json`'s `observation.state` and `observation.next`,
 *   down to the subcommands that perform each remedy — a Gate whose document
 *   does not name them is refused, never guessed for (`TB-074`);
 * - whether activation would stop is `gate doctor --json`'s `verdict`.
 *
 * Printed, the plan confirms, writes, registers, and trusts nothing
 * (`SG-GUIDE-001`), and without the Gate module it names only
 * `framework-setup` steps and says the Gate steps are unavailable
 * (`FR-GUIDE-009`).
 *
 * In an interactive terminal, and without `--json`, `setup` performs that plan
 * (`FR-GUIDE-003`, `FR-GUIDE-004`, `TB-072`): step by step, each owning
 * operation's complete preview is shown, only what it cannot derive is asked
 * (the migration's open decisions, the client to activate, a weakening's
 * acknowledgement), and only an explicit `yes` confirms exactly that preview,
 * with its own token, through the operation that owns it — the Gate's with
 * `--consent-channel interactive-guided-setup`, so its Lifecycle event records
 * how consent arrived (`RISK-011`). It repeats until Gate status names nothing
 * further; any other answer, or a refusal, stops with nothing further
 * confirmed. Base setup has no preview, so it is named and never performed.
 *
 * `config show` presents the Gate configuration section by its five
 * subcontracts, read-only (`FR-GUIDE-005`, `TB-068`). The section, and on an
 * activated clone the section the Activation receipt pinned, are
 * `gate status --json`'s `observation.configuration`; each value is marked as
 * matching or differing from the pinned one, or as unrecoverable when no
 * document reproduces the pinned identity. Sensitive runtime inputs are named
 * with the source `gate doctor --json` resolves them from, never a value
 * (`SG-GUIDE-002`). A clone with no Gate section names setup's next step.
 *
 * `config suggest` lists what the repository already implies the section should
 * declare and does not (`FR-GUIDE-007`, `TB-071`): dependency roots, Sensitive
 * runtime input names from an example environment file, and environment files
 * Git ignores, as `framework-setup`'s `discoverGateConfigurationFacts` reads
 * them from its own tables (`SG-OWNER-001`). Each proposal names its evidence
 * and the `config <revision>` command that previews it, and is proved by
 * previewing that revision; an already-declared item is left out. It reads key
 * names, never values (`SG-GUIDE-002`), and applies nothing (`SG-GUIDE-001`).
 *
 * `config <revision>` revises the Gate configuration section by one named
 * revision (`FR-GUIDE-006`, `TB-069`, `TB-070`) — in `execution`
 * `add-dependency-root`, `remove-dependency-root`,
 * `set-dependency-provisioning`, `add-budget-skippable`,
 * `remove-budget-skippable`; in `evidence` `add-sensitive-input`,
 * `remove-sensitive-input`, `add-environment-file`,
 * `remove-environment-file`; in `checks` `promote-check`, `demote-check`,
 * `remove-check`; `set-budget`; and `set-bypass` — as `framework-setup`'s
 * `gateRevisions` table names them. A Sensitive runtime input is named, never
 * valued (`SG-GUIDE-002`). It only drives `framework-setup`'s own
 * revision operation (ADR 0004): without `--confirm` it shows that operation's
 * preview — the exact lines that change, before and after — and the exact
 * command that confirms it; with `--confirm <token>` it passes that token, and
 * nothing else, to the operation, which writes only when the token is the
 * preview's own. It never confirms on anyone's behalf and never prompts. On an
 * activated clone a confirmed revision continues into the Gate's own preview
 * of the re-pin `gate status` names for the changed configuration, run as the
 * Gate's command with `--json`, for exactly the candidate written; that
 * preview's token is the Gate's to confirm, never this command's.
 *
 * Whether a candidate is weaker than the trusted policy is the Gate's
 * judgement alone (`SG-CFG-001`): the revision preview names none, and the
 * re-pin preview reports the weakenings and refusal exactly as the Gate states
 * them. `--acknowledge-weakening` is passed through to that preview, as the
 * Gate's own selector, so an acknowledged weaker candidate is offered the
 * Gate's token; without it the Gate refuses, and the next command is the
 * Gate's own acknowledged preview.
 *
 * `report --html` writes one self-contained static HTML page a maintainer can
 * read or share (`FR-GUIDE-008`, `TB-073`): Gate state and health, the
 * remaining steps and next command, the doctor's findings, and the effective
 * configuration. It is rendered from the documents `setup --json` and
 * `config show --json` print, and from `gate doctor --json`'s findings copied
 * field by field, so it cannot disagree with them. It holds no script,
 * stylesheet, font, image, or link, escapes every string it shows, and carries
 * its generation time and the command that regenerates it. It goes to a fresh
 * name in the temporary directory, or to `--out`; a path whose real location
 * is inside the clone, or that already exists, is refused with nothing written
 * (`SG-GUIDE-002`). A Sensitive runtime input appears by name and source only.
 *
 * `guardrail add <client>` and `guardrail remove <client>` register and
 * unregister the destructive-command guardrail with Claude Code (FS-006) or
 * Cursor (FS-007) through `framework-setup`'s own previewed operation: without
 * `--confirm` they show the exact `.claude/settings.json` or
 * `.cursor/hooks.json` change and its token; with `--confirm <token>` that
 * operation writes exactly that change. `setup` never registers it and never
 * names it as a step.
 *
 * Usage:
 *   agent-framework setup [--json] [--project <directory>]       (guided in an interactive terminal)
 *   agent-framework config show [--json] [--project <directory>]
 *   agent-framework config suggest [--json] [--project <directory>]
 *   agent-framework report --html [--out <path>] [--project <directory>]
 *   agent-framework config <revision> <value> [--<option> <value>] [--confirm <token>] [--acknowledge-weakening] [--json] [--project <directory>]
 *   agent-framework guardrail add|remove claude-code|cursor [--confirm <token>] [--json] [--project <directory>]
 *
 * Exit status follows the Gate's: `0` nothing further to do, `1` steps remain
 * (for `config show`: no Gate section, a section that does not resolve, or a
 * value that differs from the pinned one; for `config suggest`: no Gate
 * section, or proposals; for a revision: its confirmation, or the re-pin it
 * continued into; for `report`: the page is written and setup or config show
 * names something further; for `guardrail`: its confirmation), `2` the command
 * could not run, the revision or guardrail change was refused, or no report
 * was written.
 */

import path from 'node:path';
import process from 'node:process';

import { USAGE, parseArguments } from './arguments.mjs';
import { runConfigRevision } from './config/revision.mjs';
import { runConfigShow } from './config/show.mjs';
import { runConfigSuggest } from './config/suggest.mjs';
import { EXIT_UNRUNNABLE } from './contracts.mjs';
import { runGuardrail } from './guardrail/command.mjs';
import { runReport } from './report/command.mjs';
import { runGuidedSetup } from './setup/guided.mjs';
import { runSetup } from './setup/plan.mjs';

/**
 * Run one Framework command invocation and return what it printed, without
 * touching the process — the seam tests and later subcommands drive.
 *
 * `terminal` is where guided setup asks its questions (`lib/terminal.mjs`).
 * `setup` is guided only when the terminal says it is interactive and no
 * `--json` was asked for; otherwise — and for every other subcommand — the
 * terminal is not touched and the output is exactly the printed plan.
 */
export const runFrameworkCommand = async ({ cwd, argv, environment = process.env, terminal = null }) => {
  const options = parseArguments(argv);

  if (options === null) {
    return { exitCode: EXIT_UNRUNNABLE, stdout: '', stderr: `${USAGE}\n`, document: null };
  }

  const projectRoot = path.resolve(cwd, options.project ?? '.');

  if (options.subcommand === 'setup' && !options.json && terminal?.interactive === true) {
    return runGuidedSetup({ projectRoot, environment, terminal });
  }

  const run = {
    setup: runSetup,
    'config show': runConfigShow,
    'config suggest': runConfigSuggest,
    report: runReport,
    guardrail: runGuardrail,
  }[options.subcommand] ?? runConfigRevision;
  const { document, render: rendered } = await run({
    cwd,
    projectRoot,
    out: options.out,
    environment,
    revision: options.revision,
    confirmation: options.confirmation,
    acknowledgeWeakening: options.acknowledgeWeakening,
    guardrail: options.guardrail,
  });

  return {
    exitCode: document.exitStatus,
    stdout: options.json ? `${JSON.stringify(document, null, 2)}\n` : rendered(document),
    stderr: '',
    document,
  };
};
