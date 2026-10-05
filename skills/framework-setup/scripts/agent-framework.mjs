#!/usr/bin/env node
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
 * Usage:
 *   agent-framework setup [--json] [--project <directory>]       (guided in an interactive terminal)
 *   agent-framework config show [--json] [--project <directory>]
 *   agent-framework config suggest [--json] [--project <directory>]
 *   agent-framework report --html [--out <path>] [--project <directory>]
 *   agent-framework config <revision> <value> [--<option> <value>] [--confirm <token>] [--acknowledge-weakening] [--json] [--project <directory>]
 *
 * Exit status follows the Gate's: `0` nothing further to do, `1` steps remain
 * (for `config show`: no Gate section, a section that does not resolve, or a
 * value that differs from the pinned one; for `config suggest`: no Gate
 * section, or proposals; for a revision: its confirmation, or the re-pin it
 * continued into; for `report`: the page is written and setup or config show
 * names something further), `2` the command could not run, the revision was
 * refused, or no report was written.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  readFile,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  configureGate,
  discoverGateConfigurationFacts,
  discoverProject,
  draftGatePolicy,
  draftMigrationMapping,
  gatePolicyKeys,
  gateRevisions,
  migrateConfiguration,
  previewConfigurationMigration,
  previewGateConfiguration,
  previewGateRevision,
  reviseGate,
  withheldRevision,
} from './configure.mjs';
import { isCliEntryPoint } from './lib/cli-entry-point.mjs';
import { locateGateCommand, runGateCommand } from './lib/gate-command.mjs';
import { processTerminal } from './lib/terminal.mjs';

/** The document an agent parses. Versioned, so a later field is an addition rather than a surprise. */
export const DOCUMENT_VERSION = 'agent-framework/setup/1';

/** The `config show` document, versioned the same way. */
export const CONFIG_DOCUMENT_VERSION = 'agent-framework/config-show/1';

/** The `config suggest` document, versioned the same way. */
export const SUGGEST_DOCUMENT_VERSION = 'agent-framework/config-suggest/1';

/** The `config <revision>` document, versioned the same way. */
export const REVISION_DOCUMENT_VERSION = 'agent-framework/config-revision/1';

export const EXIT_DONE = 0;

export const EXIT_STEPS_REMAIN = 1;

export const EXIT_UNRUNNABLE = 2;

const USAGE = [
  'usage: agent-framework setup [--json] [--project <directory>]',
  '       agent-framework config show [--json] [--project <directory>]',
  '       agent-framework config suggest [--json] [--project <directory>]',
  '       agent-framework report --html [--out <path>] [--project <directory>]',
  ...Object.entries(gateRevisions).map(([name, { argument, options }]) => [
    `       agent-framework config ${name} <${argument}>`,
    ...options.map((option) => `[--${option} <${option}>]`),
    '[--confirm <token>] [--acknowledge-weakening] [--json] [--project <directory>]',
  ].join(' ')),
].join('\n');

const ENTRY_SCRIPT = fileURLToPath(import.meta.url);

const CONFIGURE_SCRIPT = path.join(path.dirname(ENTRY_SCRIPT), 'configure.mjs');

/** The steps the Gate module performs, named when it is absent (`FR-GUIDE-009`). */
const GATE_STEPS = Object.freeze(['configure-gate', 'doctor', 'activate']);

const LIMIT = 'setup wrote nothing, confirmed nothing, and registered nothing; each step is performed only by the command it names, which previews first where it writes.';

const CONFIG_LIMIT = 'config show wrote nothing and changed nothing; a Sensitive runtime input is shown by name and the source it resolves from, never by value.';

const SUGGEST_LIMIT = 'config suggest wrote nothing and applied nothing; a proposal is applied only by running its command, reading the preview it prints, and confirming that preview with its own token. An example environment file is read for key names only, and an environment file not at all.';

/**
 * The one revision each kind of proposal names. None binds a check or touches
 * a Verification profile command (`SG-OWNER-001`).
 */
const PROPOSAL_REVISIONS = Object.freeze({
  'dependency-root': Object.freeze({ operation: 'add-dependency-root', fact: 'dependencyRoots', value: 'root' }),
  'sensitive-input': Object.freeze({ operation: 'add-sensitive-input', fact: 'sensitiveInputs', value: 'name' }),
  'environment-file': Object.freeze({ operation: 'add-environment-file', fact: 'environmentFiles', value: 'file' }),
});

const REVISION_LIMIT = 'a config revision writes only the Gate configuration section of .agent-framework.yaml, only with the token of the preview that showed the change, and keeps every other byte; it confirms no re-pin — the Gate confirms its own preview with its own token.';

/**
 * The finding a revised configuration raises on an activated clone: the
 * section no longer reproduces what the Activation receipt pinned. The remedy
 * `gate status` names for it is the re-pin a confirmed revision continues
 * into; which subcommand performs it is the Gate's to say (`TB-074`).
 */
const CONFIGURATION_DRIFT = 'control-surface-drift:trusted-configuration';

/**
 * The Gate's own selector that acknowledges a weakening its re-pin preview
 * names, and the refusal that preview gives a weaker candidate without it.
 * Passed through and reported, never judged here (`SG-CFG-001`).
 */
const ACKNOWLEDGE_WEAKENING = '--acknowledge-weakening';

const WEAKENING_UNACKNOWLEDGED = 'weakening-unacknowledged';

/**
 * How guided setup performs a planned step, kept on the step under a symbol so
 * that no plan document — text or `--json` — changes by a byte (`TB-072`).
 * `kind` is `unpreviewed`, `migration`, `gate-configuration`, `doctor`, or
 * `gate` with the Gate subcommands the step names, in order.
 */
const PERFORM = Symbol('perform');

const performedAs = (step, perform) => Object.assign(step, { [PERFORM]: perform });

/**
 * Characters a POSIX shell passes through unchanged outside quotes; anything
 * else is single-quoted. The same rule the Gate prints its own instructions
 * with, restated because a skill never imports another skill's files.
 */
const SHELL_BARE = /^[A-Za-z0-9_@%+=:,./-]+$/;

const quoteForShell = (value) => (
  SHELL_BARE.test(value) || /^<[A-Za-z]+>$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
);

const command = (role, argv) => ({ role, argv, run: argv.map(quoteForShell).join(' ') });

const configureCommand = (role, projectRoot, ...argv) => command(
  role,
  ['node', CONFIGURE_SCRIPT, '--project', projectRoot, ...argv],
);

const exists = (candidate) => stat(candidate).then(() => true, () => false);

/**
 * Where the maintainer's draft for this clone goes: the temporary directory,
 * never the clone, under a name fixed by the clone's path, so a repeated setup
 * names the same file and nobody invents a draft path.
 */
const draftPath = (projectRoot, name) => path.join(
  tmpdir(),
  `agent-framework-${createHash('sha256').update(projectRoot).digest('hex').slice(0, 12)}-${name}.json`,
);

/** A draft the maintainer already wrote, parsed; `refusal` when it does not parse. */
const readDraft = async (file) => {
  try {
    return { candidate: JSON.parse(await readFile(file, 'utf8')), refusal: null };
  } catch (error) {
    return { candidate: null, refusal: `${file} is not JSON: ${error.message}` };
  }
};

const baseSetupStep = (projectRoot, discovery) => performedAs({
  id: 'configure-project',
  owner: 'framework-setup',
  summary: 'write .agent-framework.yaml (schema version 3) and the tracker documents from discovery; every value not passed is the discovered one, and AGENTS.md is never written.',
  decisions: [
    `tracker: ${discovery.recommendedTracker} (discovered default)`,
    `backend: ${discovery.backend} (discovered)`,
    `frontend: ${discovery.frontend} (discovered)`,
  ],
  refusal: null,
  commands: [configureCommand('configure', projectRoot, '--tracker', discovery.recommendedTracker)],
}, { kind: 'unpreviewed' });

/**
 * The schema v4 migration, with the decisions its own preview reports.
 *
 * `current` is true only when the clone is at schema version 3 now; a later
 * migration has no preview to ask yet, so it names its commands and no
 * decisions.
 */
const migrationStep = async (projectRoot, { current }) => {
  const mapping = draftPath(projectRoot, 'migration-mapping');
  const drafted = await exists(mapping);
  const preview = configureCommand('preview', projectRoot, '--migrate-v4', '--mapping', mapping);
  let decisions = [];
  let refusal = null;

  if (current) {
    const draft = drafted ? await readDraft(mapping) : { candidate: {}, refusal: null };

    refusal = draft.refusal;

    if (draft.candidate !== null) {
      try {
        const report = await previewConfigurationMigration({ projectRoot, mappings: draft.candidate });

        decisions = report.ambiguities.map((ambiguity) => `${ambiguity.path}: ${ambiguity.required.join(', ')}`);
      } catch (error) {
        refusal = error.message;
      }
    }
  }

  return performedAs({
    id: 'migrate-schema-v4',
    owner: 'framework-setup',
    summary: `migrate .agent-framework.yaml from schema version 3 to 4: ${drafted ? 'answer every null in' : 'draft'} the mapping at ${mapping}, preview it, and confirm exactly that preview.`,
    decisions,
    refusal,
    commands: [
      ...(drafted ? [] : [configureCommand('draft', projectRoot, '--draft-mapping', '--out', mapping)]),
      preview,
      command('confirm', [...preview.argv, '--confirm', '<previewHash>']),
    ],
  }, { kind: 'migration' });
};

/**
 * Gate configuration, owned by `framework-setup`. When the clone can be
 * configured now, the candidate — the maintainer's draft, else the owning
 * drafter's — is put to the owning preview and any refusal is reported as is.
 */
const gateConfigurationStep = async (projectRoot, { current }) => {
  const policy = draftPath(projectRoot, 'gate-policy');
  const drafted = await exists(policy);
  const preview = configureCommand('preview', projectRoot, '--configure-gate', '--policy', policy);
  let refusal = null;

  if (current) {
    try {
      const draft = drafted
        ? await readDraft(policy)
        : { candidate: await draftGatePolicy({ projectRoot }), refusal: null };

      refusal = draft.refusal;

      if (draft.candidate !== null) {
        await previewGateConfiguration({ projectRoot, policy: draft.candidate });
      }
    } catch (error) {
      refusal = error.message;
    }
  }

  return performedAs({
    id: 'configure-gate',
    owner: 'framework-setup',
    summary: `configure the dormant Gate: ${drafted ? 'review' : 'draft'} the policy at ${policy} — its required and advisory checks are the provider's defaults, not a decision — preview it, and confirm exactly that preview.`,
    decisions: [],
    refusal,
    commands: [
      ...(drafted ? [] : [configureCommand('draft', projectRoot, '--draft-policy', '--out', policy)]),
      preview,
      command('confirm', [...preview.argv, '--confirm', '<previewHash>']),
    ],
  }, { kind: 'gate-configuration' });
};

const gateCommand = (role, prefix, ...argv) => command(role, [...prefix, ...argv]);

const doctorStep = (prefix, verdict = null) => performedAs({
  id: 'doctor',
  owner: 'change-evaluation-gate',
  summary: verdict === null
    ? 'ask what this machine can do for the configured Gate before activating; it writes nothing under the clone.'
    : 'gate doctor predicts activation would stop; resolve what it names, then run it again.',
  decisions: [],
  refusal: verdict === null ? null : `${verdict.stop.reasonCode}: ${verdict.stop.detail}`,
  commands: [gateCommand('observe', prefix, 'doctor')],
}, { kind: 'doctor' });

const previewedGateCommands = (prefix, subcommand) => [
  gateCommand('preview', prefix, subcommand),
  gateCommand('confirm', prefix, subcommand, '--confirm', '<token>'),
];

const activationStep = (prefix) => performedAs({
  id: 'activate',
  owner: 'change-evaluation-gate',
  summary: 'activate the configured clone: preview, read it, and confirm exactly that preview with the token it prints.',
  decisions: ['client: git, unless --client <adapter-id> names another'],
  refusal: null,
  commands: previewedGateCommands(prefix, 'activate'),
}, { kind: 'gate', subcommands: ['activate'] });

/**
 * One remedy `gate status` names, as a step: the Gate's own identifier and
 * instruction, and each subcommand the Gate names for it previewed and then
 * confirmed, in the Gate's order (`TB-074`). Which remedy, in what order, and
 * what performs it are all the Gate's; a remedy it names no subcommand for is
 * the maintainer's own act, stated in the Gate's words. A remedy performed by
 * `activate` alone is the activation step setup already plans, with its
 * decision.
 */
const remedyStep = (prefix, remedy) => (remedy.subcommands.length === 1 && remedy.subcommands[0] === 'activate'
  ? { ...activationStep(prefix), id: remedy.remedy }
  : performedAs({
    id: remedy.remedy,
    owner: 'change-evaluation-gate',
    summary: remedy.instruction,
    decisions: [],
    refusal: null,
    commands: remedy.subcommands.flatMap((subcommand) => previewedGateCommands(prefix, subcommand)),
  }, { kind: 'gate', subcommands: [...remedy.subcommands] }));

const failure = (reasonCode, detail) => ({ failure: { reasonCode, detail } });

/**
 * Ask the Gate where a schema v4 clone stands, and name what its own
 * observations say comes next.
 */
const gatePlan = async ({ projectRoot, gate, environment, status: asked = null }) => {
  const status = asked ?? await runGateCommand(gate, { cwd: projectRoot, args: ['status'], environment });

  if (status.failure) {
    return status;
  }

  const { observation } = status.document;
  const prefix = observation.next.shortcut === null ? gate.display : observation.next.shortcut.split(' ');
  const observed = { state: observation.state, health: observation.health };

  if (observation.state === 'installed') {
    if (!observation.next.informational.includes('gate-policy-missing')) {
      return failure(
        'gate-installed-unguided',
        `gate status reports this clone installed for ${observation.next.informational.join(', ') || 'no stated reason'}, which setup does not guide: ${observation.findings.map((finding) => finding.detail).join(' ')}`,
      );
    }

    return {
      state: 'gate-unconfigured',
      observed,
      doctor: null,
      steps: [
        await gateConfigurationStep(projectRoot, { current: true }),
        doctorStep(gate.display),
        activationStep(gate.display),
      ],
    };
  }

  // A Gate from before remedies carried their subcommands: say so, never guess one.
  const unnamed = observation.next.remedies.find((remedy) => !Array.isArray(remedy.subcommands));

  if (unnamed !== undefined) {
    const release = observation.release ? `${observation.release.id} ${observation.release.version}` : 'a release it does not name';

    return failure(
      'gate-remedy-subcommands-missing',
      `\`${[...gate.display, 'status', '--json'].join(' ')}\` names no subcommands for the ${unnamed.remedy} remedy: the installed Gate (${release}, ${gate.detail}) predates remedy subcommands. Update the Gate module; setup does not guess which command performs a remedy.`,
    );
  }

  let doctor = null;

  if (observation.state === 'configured') {
    const doctored = await runGateCommand(gate, { cwd: projectRoot, args: ['doctor'], environment });

    if (doctored.failure) {
      return doctored;
    }

    doctor = {
      proceeds: doctored.document.observation.verdict.proceeds,
      stop: doctored.document.observation.verdict.stop,
    };
  }

  return {
    state: observation.state,
    observed,
    doctor,
    steps: [
      ...(doctor === null || doctor.proceeds ? [] : [doctorStep(prefix, doctor)]),
      ...observation.next.remedies.map((remedy) => remedyStep(prefix, remedy)),
    ],
  };
};

/**
 * Where this clone stands, and every remaining step in order. `status` is a
 * `gate status` answer the caller already holds, so it is not asked twice.
 */
const planSetup = async ({ projectRoot, environment, status = null }) => {
  const discovery = await discoverProject(projectRoot);
  const schemaVersion = discovery.existingConfiguration.schemaVersion;
  const gate = await locateGateCommand({ environment });
  const gateSteps = async (current) => (gate.available
    ? [await gateConfigurationStep(projectRoot, { current }), doctorStep(gate.display), activationStep(gate.display)]
    : []);
  const base = { gate, doctor: null, observed: null };

  if (schemaVersion === null || schemaVersion < 3) {
    return {
      ...base,
      state: schemaVersion === null ? 'no-configuration' : `schema-v${schemaVersion}`,
      steps: [
        baseSetupStep(projectRoot, discovery),
        await migrationStep(projectRoot, { current: false }),
        ...await gateSteps(false),
      ],
    };
  }

  if (schemaVersion === 3) {
    return {
      ...base,
      state: 'schema-v3',
      steps: [await migrationStep(projectRoot, { current: true }), ...await gateSteps(false)],
    };
  }

  if (schemaVersion !== 4) {
    return failure(
      'schema-unsupported',
      `.agent-framework.yaml declares schema version ${schemaVersion}; framework-setup reads schema versions 3 and 4 only.`,
    );
  }

  if (!gate.available) {
    return { ...base, state: 'schema-v4', steps: [] };
  }

  const planned = await gatePlan({ projectRoot, gate, environment, status });

  return planned.failure ? { ...planned, gate } : { ...base, ...planned };
};

const parseArguments = (argv) => {
  const [first, second] = argv;
  const revision = first === 'config' && Object.hasOwn(gateRevisions, second ?? '') ? gateRevisions[second] : null;
  const subcommand = first === 'config' && (['show', 'suggest'].includes(second) || revision !== null) ? `config ${second}` : first;

  if (!['setup', 'config show', 'config suggest', 'report'].includes(subcommand) && revision === null) {
    return null;
  }

  const report = subcommand === 'report';
  const rest = argv.slice(['setup', 'report'].includes(subcommand) ? 1 : 2);
  const options = {
    subcommand,
    json: false,
    html: false,
    out: null,
    project: null,
    revision: null,
    confirmation: null,
    acknowledgeWeakening: false,
  };
  const valued = new Set([
    '--project',
    ...(report ? ['--out'] : []),
    ...(revision === null ? [] : ['--confirm', ...revision.options.map((option) => `--${option}`)]),
  ]);

  if (revision !== null) {
    options.revision = { operation: second };
  }

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];

    if (argument === '--json' && !report) {
      options.json = true;
    } else if (argument === '--html' && report) {
      options.html = true;
    } else if (argument === ACKNOWLEDGE_WEAKENING && revision !== null) {
      options.acknowledgeWeakening = true;
    } else if (valued.has(argument) && rest[index + 1] !== undefined) {
      const value = rest[index + 1];

      if (argument === '--project') {
        options.project = value;
      } else if (argument === '--out') {
        options.out = value;
      } else if (argument === '--confirm') {
        options.confirmation = value;
      } else {
        options.revision[argument.slice(2)] = value;
      }

      index += 1;
    } else if (revision !== null && !argument.startsWith('--') && options.revision[revision.argument] === undefined) {
      options.revision[revision.argument] = argument;
    } else {
      return null;
    }
  }

  const incomplete = (revision !== null && options.revision[revision.argument] === undefined) || (report && !options.html);

  return incomplete ? null : options;
};

/** The located Gate command, or why it is unavailable. */
const gateText = (gate) => (gate.available ? `${gate.command} — ${gate.detail}` : `unavailable — ${gate.detail}`);

/** What `gate doctor` predicted for activation, as setup's document holds it. */
const setupDoctorText = (doctor) => (doctor.proceeds ? 'activation would proceed' : `activation would stop (${doctor.stop.reasonCode})`);

/** The one next command, or the instruction when the step has none. */
const nextText = (next) => (next === null ? 'nothing' : (next.command ?? next.instruction));

const unavailableText = (unavailable) => `unavailable: ${unavailable.join(', ')} — Gate steps are unavailable because the Gate module is not installed.`;

/** The plan as text. `limit` is false only where a guided run, which did confirm, ends with its own. */
const render = (document, { limit = true } = {}) => {
  const lines = [
    'agent-framework setup',
    `project: ${document.project}`,
  ];

  if (document.failure !== null) {
    lines.push(`failed: ${document.failure.reasonCode} — ${document.failure.detail}`, ...(limit ? [LIMIT] : []), '');

    return lines.join('\n');
  }

  lines.push(`state: ${document.state}`);

  if (document.health !== null) {
    lines.push(`health: ${document.health}`);
  }

  lines.push(`gate: ${gateText(document.gate)}`);

  if (document.doctor !== null) {
    lines.push(`doctor: ${setupDoctorText(document.doctor)}`);
  }

  lines.push(`steps: ${document.steps.length}`);

  for (const [index, step] of document.steps.entries()) {
    lines.push(`  ${index + 1}. ${step.id} (${step.owner}) — ${step.summary}`);

    for (const decision of step.decisions) {
      lines.push(`     decide: ${decision}`);
    }

    if (step.refusal !== null) {
      lines.push(`     refused: ${step.refusal}`);
    }

    for (const entry of step.commands) {
      lines.push(`     $ ${entry.run}`);
    }
  }

  if (document.unavailable.length > 0) {
    lines.push(unavailableText(document.unavailable));
  }

  lines.push(
    `next: ${nextText(document.next)}`,
    `run every command from ${document.project}.`,
    ...(limit ? [LIMIT] : []),
    '',
  );

  return lines.join('\n');
};

/** The Gate command as a document names it. */
const describeGate = (gate) => ({
  available: gate.available,
  located: gate.located,
  command: gate.display === null ? null : gate.display.map(quoteForShell).join(' '),
  detail: gate.detail,
});

/** The first remaining step, as the one next command. */
const nextOf = (steps) => {
  const first = steps[0] ?? null;

  return first === null ? null : {
    step: first.id,
    command: first.commands[0]?.run ?? null,
    instruction: first.summary,
  };
};

/**
 * A JSON value with every object's keys in one order, so two values compare
 * equal exactly when they hold the same data.
 */
const canonical = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
};

/** One key of one subcontract, as `{ declared, value }`; an absent key is not declared. */
const declaredAt = (subcontract, key) => (
  subcontract !== null && typeof subcontract === 'object' && Object.hasOwn(subcontract, key)
    ? { declared: true, value: subcontract[key] }
    : { declared: false, value: null }
);

const isNameList = (entry) => !entry.declared
  || (Array.isArray(entry.value) && entry.value.every((item) => typeof item === 'string'));

/**
 * One value of the working section beside the pinned one.
 *
 * `marking` is `null` when nothing is pinned, `unrecoverable` when the Gate
 * knows the pinned section only by its identity, and otherwise `matches` or
 * `differs`. A differing list of names also says which names were added and
 * which removed.
 */
const shownValue = ({ key, working, pinned }) => {
  const value = declaredAt(working, key);
  const pinnedValue = pinned === undefined || pinned === null ? null : declaredAt(pinned, key);
  let marking = null;

  if (pinned === null) {
    marking = 'unrecoverable';
  } else if (pinnedValue !== null) {
    marking = value.declared === pinnedValue.declared && canonical(value.value) === canonical(pinnedValue.value)
      ? 'matches'
      : 'differs';
  }

  const listed = marking === 'differs' && isNameList(value) && isNameList(pinnedValue);
  const names = (entry) => (entry.declared ? entry.value : []);

  return {
    key,
    ...value,
    pinned: pinnedValue,
    marking,
    added: listed ? names(value).filter((name) => !names(pinnedValue).includes(name)) : null,
    removed: listed ? names(pinnedValue).filter((name) => !names(value).includes(name)) : null,
  };
};

/**
 * Every subcontract by name, each value marked against the pinned section.
 * `pinned` is `undefined` when nothing is pinned and `null` when the pinned
 * values are unrecoverable. A key only the pinned section declares is shown
 * too, as not set.
 */
const shownSubcontracts = (working, pinned) => gatePolicyKeys.map((name) => {
  const pinnedSubcontract = pinned === undefined || pinned === null ? pinned : (pinned[name] ?? {});
  const keys = [...new Set([
    ...Object.keys(working[name] ?? {}),
    ...Object.keys(pinnedSubcontract ?? {}),
  ])];

  return {
    name,
    values: keys.map((key) => shownValue({ key, working: working[name] ?? {}, pinned: pinnedSubcontract })),
  };
});

/**
 * The Sensitive runtime inputs by name and the source each resolves from, as
 * `gate doctor --json` resolves them for a check. Only names, sources, and
 * file statuses are copied out of its document, field by field, so no value
 * can pass through here (`SG-GUIDE-002`, `SG-SECRET-001`).
 */
const observeRuntimeInputs = async ({ projectRoot, gate, environment }) => {
  const doctored = await runGateCommand(gate, { cwd: projectRoot, args: ['doctor'], environment });

  if (doctored.failure) {
    return doctored;
  }

  const inputs = doctored.document.observation.runtimeInputs;

  return {
    runtimeInputs: {
      resolved: inputs.resolved.map(({ name, source }) => ({ name, source })),
      unresolved: inputs.unresolved.map(({ name }) => ({ name })),
      environmentFiles: inputs.environmentFiles.map(({ path: file, status }) => ({ path: file, status })),
    },
  };
};

/**
 * A clone with no Gate section: say so, and name the next step setup's own
 * plan names for it.
 */
const unconfiguredSection = async ({ projectRoot, environment, status = null }) => {
  const plan = await planSetup({ projectRoot, environment, status });

  return plan.failure ? plan : { state: plan.state, gate: plan.gate, section: null, next: nextOf(plan.steps) };
};

/**
 * The Gate configuration section as `gate status --json` observes it, for the
 * `config` subcommand named `reader`.
 *
 * Returns `{ gate, status, observation }` for a clone that has a section; a
 * clone with none is answered as `unconfiguredSection` answers it, and a Gate
 * that cannot be asked, or that predates the observed section, as a failure.
 */
const observeSection = async ({ projectRoot, environment, reader }) => {
  const discovery = await discoverProject(projectRoot);

  if (discovery.existingConfiguration.schemaVersion !== 4) {
    return unconfiguredSection({ projectRoot, environment });
  }

  const gate = await locateGateCommand({ environment });

  if (!gate.available) {
    return {
      gate,
      ...failure(
        'gate-unavailable',
        `the Gate configuration section is read only through the Gate's own command, and ${gate.detail}.`,
      ),
    };
  }

  const status = await runGateCommand(gate, { cwd: projectRoot, args: ['status'], environment });

  if (status.failure) {
    return { ...status, gate };
  }

  const { observation } = status.document;
  const { configuration } = observation;

  // A Gate from before the section was observable: say so, never read it some other way.
  if (configuration === undefined) {
    const release = observation.release ? `${observation.release.id} ${observation.release.version}` : 'a release it does not name';

    return {
      gate,
      ...failure(
        'gate-configuration-unobserved',
        `\`${[...gate.display, 'status', '--json'].join(' ')}\` reports no configuration section: the installed Gate (${release}, ${gate.detail}) predates it. Update the Gate module; ${reader} reads the section only through the Gate's own command.`,
      ),
    };
  }

  if (configuration.pinned === null && configuration.working.reasonCode === 'gate-policy-missing') {
    return unconfiguredSection({ projectRoot, environment, status });
  }

  return { gate, status, observation };
};

/** The Gate configuration section this clone runs, and what its receipt pinned. */
const showConfiguration = async ({ projectRoot, environment }) => {
  const observed = await observeSection({ projectRoot, environment, reader: 'config show' });

  if (observed.observation === undefined) {
    return observed;
  }

  const { gate, status, observation } = observed;
  const { working, pinned } = observation.configuration;

  const declaresInputs = (working.policy?.evidence?.sensitive_inputs ?? []).length > 0;
  const inputs = declaresInputs ? await observeRuntimeInputs({ projectRoot, gate, environment }) : { runtimeInputs: null };

  if (inputs.failure) {
    return { ...inputs, gate };
  }

  const plan = await planSetup({ projectRoot, environment, status });

  return {
    state: observation.state,
    gate,
    section: {
      resolved: working.resolved,
      reasonCode: working.reasonCode,
      detail: working.detail,
      identity: working.identity,
      pinned: pinned === null ? null : {
        identity: pinned.identity,
        source: pinned.source,
        recovered: pinned.policy !== null,
        matches: working.identity === pinned.identity,
      },
    },
    subcontracts: working.policy === null
      ? []
      : shownSubcontracts(working.policy, pinned === null ? undefined : pinned.policy),
    runtimeInputs: inputs.runtimeInputs,
    next: plan.failure ? null : nextOf(plan.steps),
  };
};

/** One shown value as text: its JSON, or `(not set)`. */
const shownValueText = (value) => (value.declared ? JSON.stringify(value.value) : '(not set)');

/** How one value compares with the pinned one, in words; `null` when nothing is pinned. */
const markingText = (value) => {
  const pinned = value.pinned?.declared ? JSON.stringify(value.pinned.value) : '(not set)';
  const changes = [
    ...(value.added?.length ? [`added ${value.added.join(', ')}`] : []),
    ...(value.removed?.length ? [`removed ${value.removed.join(', ')}`] : []),
  ];

  return {
    matches: 'matches the pinned value',
    differs: `differs from the pinned value ${pinned}${changes.map((change) => `; ${change}`).join('')}`,
    unrecoverable: 'unrecoverable: the pinned value is known only by the section identity',
  }[value.marking] ?? null;
};

/** One value's line: the working value, then how it compares with the pinned one. */
const renderValue = (value) => {
  const marking = markingText(value);

  return `  ${value.key}: ${shownValueText(value)}${marking === null ? '' : ` — ${marking}`}`;
};

/** How the section as a whole stands against what the Activation receipt pinned. */
const renderSection = (section) => {
  const lines = [];

  if (!section.resolved) {
    lines.push(`section: does not resolve — ${section.reasonCode}: ${section.detail}`);
  } else if (section.pinned === null) {
    lines.push('section: not pinned — this clone has no Activation receipt, so no value is compared.');
  } else if (section.pinned.matches) {
    lines.push(`section: matches what the Activation receipt pinned (${section.pinned.identity})`);
  } else {
    lines.push(`section: differs from what the Activation receipt pinned (pinned ${section.pinned.identity}, working ${section.identity})`);
  }

  if (section.pinned !== null) {
    lines.push(section.pinned.recovered
      ? `pinned values: read from ${section.pinned.source}, which reproduces the pinned identity`
      : 'pinned values: unrecoverable — no document reproduces the pinned identity, so only the section as a whole is compared.');
  }

  return lines;
};

/** A Sensitive runtime input by name and source, or as unresolved; never a value (`SG-GUIDE-002`). */
const resolvedInputText = (input) => `${input.name}: from ${input.source}`;

const unresolvedInputText = (input) => `${input.name}: unresolved — no source sets it`;

const environmentFileText = (file) => `environment file ${file.path}: ${file.status}`;

const renderConfiguration = (document) => {
  const lines = [
    'agent-framework config show',
    `project: ${document.project}`,
  ];

  if (document.failure !== null) {
    lines.push(`failed: ${document.failure.reasonCode} — ${document.failure.detail}`, CONFIG_LIMIT, '');

    return lines.join('\n');
  }

  lines.push(`state: ${document.state}`);

  if (document.gate !== null) {
    lines.push(`gate: ${gateText(document.gate)}`);
  }

  if (document.section === null) {
    lines.push('section: none — .agent-framework.yaml has no Gate configuration section.');
  } else {
    lines.push(...renderSection(document.section));
  }

  for (const subcontract of document.subcontracts) {
    lines.push(`${subcontract.name}:`, ...subcontract.values.map(renderValue));
  }

  if (document.runtimeInputs !== null) {
    lines.push(
      'runtime inputs:',
      ...document.runtimeInputs.resolved.map((input) => `  - ${resolvedInputText(input)}`),
      ...document.runtimeInputs.unresolved.map((input) => `  - ${unresolvedInputText(input)}`),
      ...document.runtimeInputs.environmentFiles.map((file) => `  ${environmentFileText(file)}`),
    );
  }

  lines.push(
    `next: ${nextText(document.next)}`,
    CONFIG_LIMIT,
    '',
  );

  return lines.join('\n');
};

const hasDifference = (shown) => shown.section === null
  || !shown.section.resolved
  || shown.section.pinned?.matches === false;

const runConfigShow = async ({ projectRoot, environment }) => {
  const shown = (await exists(projectRoot))
    ? await showConfiguration({ projectRoot, environment })
    : failure('project-missing', `${projectRoot} does not exist.`);
  const exitStatus = shown.failure ? EXIT_UNRUNNABLE : (hasDifference(shown) ? EXIT_STEPS_REMAIN : EXIT_DONE);

  return {
    document: {
      document: CONFIG_DOCUMENT_VERSION,
      command: 'config show',
      ok: !shown.failure,
      exitStatus,
      project: projectRoot,
      state: shown.state ?? null,
      gate: shown.gate === undefined ? null : describeGate(shown.gate),
      section: shown.section ?? null,
      subcontracts: shown.subcontracts ?? [],
      runtimeInputs: shown.runtimeInputs ?? null,
      next: shown.next ?? null,
      failure: shown.failure ?? null,
      limit: CONFIG_LIMIT,
    },
    render: renderConfiguration,
  };
};

const runSetup = async ({ projectRoot, environment }) => {
  const planned = (await exists(projectRoot))
    ? await planSetup({ projectRoot, environment })
    : failure('project-missing', `${projectRoot} does not exist.`);
  const steps = planned.steps ?? [];
  const exitStatus = planned.failure ? EXIT_UNRUNNABLE : (steps.length === 0 ? EXIT_DONE : EXIT_STEPS_REMAIN);

  return {
    document: {
      document: DOCUMENT_VERSION,
      command: 'setup',
      ok: !planned.failure,
      exitStatus,
      project: projectRoot,
      state: planned.state ?? null,
      health: planned.observed?.health ?? null,
      gate: planned.gate === undefined ? null : { ...describeGate(planned.gate), observed: planned.observed ?? null },
      doctor: planned.doctor ?? null,
      steps,
      unavailable: planned.gate?.available === false ? [...GATE_STEPS] : [],
      next: nextOf(steps),
      failure: planned.failure ?? null,
      limit: LIMIT,
    },
    render,
  };
};

/**
 * The Framework command that previews or confirms one revision, as a
 * maintainer types it: the operation, its value, its options, and the token
 * when confirming.
 */
const revisionCommand = (projectRoot, revision, confirmation = null, acknowledgeWeakening = false) => {
  const { argument, options } = gateRevisions[revision.operation];

  return command(confirmation === null ? 'preview' : 'confirm', [
    'node',
    ENTRY_SCRIPT,
    'config',
    revision.operation,
    revision[argument],
    ...options.flatMap((option) => (revision[option] === undefined ? [] : [`--${option}`, revision[option]])),
    '--project',
    projectRoot,
    ...(confirmation === null ? [] : ['--confirm', confirmation]),
    ...(acknowledgeWeakening ? [ACKNOWLEDGE_WEAKENING] : []),
  ]);
};

/**
 * On an activated clone, the Gate's own preview of the re-pin it names for the
 * configuration a confirmed revision just wrote.
 *
 * `gate status` is asked which remedy answers the changed configuration and
 * which subcommand performs it, so this holds no remedy mapping (`TB-074`).
 * The Gate must read the section as exactly the candidate written, and its
 * preview must name that candidate's identity; otherwise no re-pin is offered.
 * The preview is the Gate's own `--json` document, its weakenings, refusal,
 * and token reported as it states them (`SG-CFG-001`); it is acknowledged
 * exactly when the maintainer passed `--acknowledge-weakening`. A weaker
 * candidate the Gate refuses unacknowledged is offered the Gate's own
 * acknowledged preview as the next command, never a token. Nothing is
 * confirmed.
 */
const repinPreview = async ({ projectRoot, gate, environment, observation, policy, acknowledgeWeakening }) => {
  const working = observation.configuration?.working;

  if (working === undefined) {
    const release = observation.release ? `${observation.release.id} ${observation.release.version}` : 'a release it does not name';

    return failure(
      'gate-configuration-unobserved',
      `the revision was written, but \`${[...gate.display, 'status', '--json'].join(' ')}\` reports no configuration section: the installed Gate (${release}, ${gate.detail}) predates it, so the candidate the Gate reads cannot be compared with the one written. Update the Gate module.`,
    );
  }

  if (canonical(working.policy) !== canonical(policy)) {
    return failure(
      'repin-candidate-mismatch',
      `the revision was written, but the Gate reads a different Gate configuration section than the candidate it wrote (${working.reasonCode ?? 'another value'}), so no re-pin preview is offered for it. Run \`agent-framework config show\`.`,
    );
  }

  const remedy = observation.next.remedies.find((entry) => (entry.findings ?? []).includes(CONFIGURATION_DRIFT)) ?? null;

  if (remedy === null || !Array.isArray(remedy.subcommands) || remedy.subcommands.length !== 1) {
    return failure(
      'repin-unnamed',
      `the revision was written, but gate status names no single subcommand that re-pins the changed configuration; it says: ${observation.next.instruction}.`,
    );
  }

  const [subcommand] = remedy.subcommands;
  const previewed = await runGateCommand(gate, {
    cwd: projectRoot,
    args: [subcommand, ...(acknowledgeWeakening ? [ACKNOWLEDGE_WEAKENING] : [])],
    environment,
  });

  if (previewed.failure) {
    return previewed;
  }

  const repin = previewed.document.observation;

  if (repin.candidate?.identity !== working.identity) {
    return failure(
      'repin-candidate-mismatch',
      `the revision was written, but \`${[...gate.display, subcommand, '--json'].join(' ')}\` previews ${repin.candidate?.identity ?? 'no candidate'}, not the written candidate ${working.identity}; nothing was re-pinned.`,
    );
  }

  const prefix = observation.next.shortcut === null ? gate.display : observation.next.shortcut.split(' ');

  return {
    repin: {
      subcommand,
      owner: 'change-evaluation-gate',
      trusted: repin.trusted,
      candidate: repin.candidate,
      transition: repin.transition,
      acknowledgedWeakening: repin.acknowledgedWeakening,
      dependencyRoots: repin.dependencyRoots,
      dependencyProvisioning: repin.dependencyProvisioning,
      refusal: repin.refusal,
      confirmationToken: repin.confirmationToken,
      commands: repinCommands(prefix, subcommand, repin),
    },
  };
};

/**
 * What follows the Gate's re-pin preview: its own confirmation, carrying the
 * acknowledgement its token binds; for a weaker candidate it refused
 * unacknowledged, its own preview again with the acknowledgement; otherwise
 * nothing.
 */
const repinCommands = (prefix, subcommand, repin) => {
  if (repin.confirmationToken !== null) {
    return [gateCommand(
      'confirm',
      prefix,
      subcommand,
      ...(repin.acknowledgedWeakening === true ? [ACKNOWLEDGE_WEAKENING] : []),
      '--confirm',
      repin.confirmationToken,
    )];
  }

  return repin.refusal?.reasonCode === WEAKENING_UNACKNOWLEDGED
    ? [gateCommand('preview', prefix, subcommand, ACKNOWLEDGE_WEAKENING)]
    : [];
};

/**
 * Preview or confirm one revision through `framework-setup`'s own operation,
 * then say what follows: on an activated clone the re-pin preview, else
 * nothing. The operation's refusal is reported as it gives it.
 */
const reviseConfiguration = async ({ projectRoot, environment, revision, confirmation, acknowledgeWeakening }) => {
  let revised;

  try {
    revised = confirmation === null
      ? await previewGateRevision({ projectRoot, revision })
      : await reviseGate({ projectRoot, revision, confirmation });
  } catch (error) {
    return failure(error.reasonCode ?? 'revision-refused', error.message);
  }

  const gate = await locateGateCommand({ environment });
  const done = { gate, revised, state: null, repin: null };

  if (!gate.available) {
    return done;
  }

  const status = await runGateCommand(gate, { cwd: projectRoot, args: ['status'], environment });

  if (status.failure) {
    return { ...done, ...status };
  }

  const { observation } = status.document;

  if (confirmation === null || observation.state !== 'activated') {
    return { ...done, state: observation.state };
  }

  return {
    ...done,
    state: observation.state,
    ...await repinPreview({ projectRoot, gate, environment, observation, policy: revised.policy, acknowledgeWeakening }),
  };
};

/** What comes after a revision: its confirmation, the re-pin's, or nothing. */
const revisionNext = ({ projectRoot, revised, repin, applied, acknowledgeWeakening }) => {
  if (!applied) {
    const confirm = revisionCommand(projectRoot, revised.revision, revised.previewHash, acknowledgeWeakening);

    return { step: 'confirm-revision', command: confirm.run, instruction: 'confirm exactly this preview with its token.' };
  }

  if (repin === null) {
    return null;
  }

  if (repin.confirmationToken !== null) {
    return { step: repin.subcommand, command: repin.commands[0].run, instruction: `confirm the Gate's ${repin.subcommand} preview with its own token.` };
  }

  return repin.commands.length === 0
    ? { step: repin.subcommand, command: null, instruction: repin.refusal?.next ?? repin.refusal?.detail ?? `the Gate offers no token for this ${repin.subcommand}.` }
    : {
      step: repin.subcommand,
      command: repin.commands[0].run,
      instruction: `the Gate offers no token for a candidate weaker than the trusted policy until the weakening is acknowledged: preview its ${repin.subcommand} acknowledged, read the weakenings it names, and confirm that preview with its own token.`,
    };
};

const runConfigRevision = async ({ projectRoot, environment, revision, confirmation, acknowledgeWeakening }) => {
  const outcome = (await exists(projectRoot))
    ? await reviseConfiguration({ projectRoot, environment, revision, confirmation, acknowledgeWeakening })
    : failure('project-missing', `${projectRoot} does not exist.`);
  const revised = outcome.revised ?? null;
  const applied = revised !== null && confirmation !== null;
  const repin = outcome.repin ?? null;
  const exitStatus = outcome.failure
    ? EXIT_UNRUNNABLE
    : (!applied || repin !== null ? EXIT_STEPS_REMAIN : EXIT_DONE);

  return {
    document: {
      document: REVISION_DOCUMENT_VERSION,
      command: `config ${revision.operation}`,
      ok: !outcome.failure,
      exitStatus,
      project: projectRoot,
      owner: 'framework-setup',
      // A value typed as `NAME=value` is never echoed back (`SG-GUIDE-002`).
      revision: revised?.revision ?? withheldRevision(revision),
      applied,
      acknowledgeWeakening,
      subcontract: revised?.subcontract ?? null,
      changes: revised?.changes ?? [],
      previewHash: revised?.previewHash ?? null,
      state: outcome.state ?? null,
      gate: outcome.gate === undefined ? null : describeGate(outcome.gate),
      repin,
      next: revised === null || outcome.failure ? null : revisionNext({ projectRoot, revised, repin, applied, acknowledgeWeakening }),
      failure: outcome.failure ?? null,
      limit: REVISION_LIMIT,
    },
    render: renderRevision,
  };
};

/** One revision's value and options as a maintainer typed them. */
const describeRevision = (revision) => {
  const definition = gateRevisions[revision.operation];

  return [
    revision.operation,
    revision[definition.argument],
    ...definition.options.flatMap((option) => (revision[option] === undefined ? [] : [`--${option}`, revision[option]])),
  ].filter((part) => part !== undefined).join(' ');
};

/** The re-pin preview, as the Gate states it. */
const renderRepin = (repin) => {
  const weakenings = repin.transition?.weakenings ?? [];
  const provisioning = repin.dependencyProvisioning;
  const lines = [
    `re-pin: the Gate's ${repin.subcommand} preview for the written candidate (${repin.owner})`,
    `  trusted: ${repin.trusted?.identity ?? 'none'}`,
    `  candidate: ${repin.candidate.identity}`,
    ...(repin.acknowledgedWeakening === true ? ['  weakening acknowledged: yes — the token binds the acknowledgement; confirm with it as printed'] : []),
    `  weakenings: ${repin.transition === null ? 'not judged — no trusted policy was recovered' : (weakenings.length === 0 ? 'none' : weakenings.map((weakening) => `${weakening.code} ${weakening.checkId}`).join(', '))}`,
    `  dependency roots: ${(repin.dependencyRoots ?? []).map((root) => `${root} (${typeof provisioning === 'string' ? provisioning : (provisioning?.[root] ?? 'unrecorded')})`).join(', ') || 'none'}`,
  ];

  if (repin.refusal !== null) {
    lines.push(`  refused: ${repin.refusal.reasonCode}${repin.refusal.detail ? ` — ${repin.refusal.detail}` : ''}`);
  }

  if (repin.confirmationToken !== null) {
    lines.push(`  token: ${repin.confirmationToken}`);
  }

  return lines;
};

const renderRevision = (document) => {
  const lines = [
    `agent-framework ${document.command}`,
    `project: ${document.project}`,
    `revision: ${describeRevision(document.revision)} (${document.subcontract ?? 'refused'}, owned by ${document.owner})`,
  ];

  if (document.changes.length > 0) {
    lines.push(document.applied
      ? `applied: .agent-framework.yaml, Gate configuration section — ${document.changes.length} line${document.changes.length === 1 ? '' : 's'} changed; every other byte kept:`
      : `preview: .agent-framework.yaml, Gate configuration section — ${document.changes.length} line${document.changes.length === 1 ? '' : 's'} would change; every other byte is kept:`);

    for (const change of document.changes) {
      lines.push(`  line ${change.line} (${change.subcontract}):`, `- ${change.before}`, `+ ${change.after}`);
    }
  }

  if (document.failure !== null) {
    lines.push(`failed: ${document.failure.reasonCode} — ${document.failure.detail}`, REVISION_LIMIT, '');

    return lines.join('\n');
  }

  if (!document.applied) {
    lines.push(`token: ${document.previewHash}`);
  }

  if (document.gate !== null && !document.gate.available) {
    lines.push(`gate: unavailable — ${document.gate.detail}; no re-pin step can be named.`);
  } else if (document.state === 'activated' && !document.applied) {
    lines.push(`state: activated — confirming continues into the Gate's preview of the re-pin it names for the changed configuration; that preview has its own token, names any weakening of the trusted policy, and offers no token for one until it is acknowledged (${ACKNOWLEDGE_WEAKENING}${document.acknowledgeWeakening ? ', passed through on confirming' : ''}).`);
  } else if (document.state !== null) {
    lines.push(`state: ${document.state}${document.state === 'activated' ? '' : ' — the clone is not activated, so nothing is re-pinned.'}`);
  }

  if (document.repin !== null) {
    lines.push(...renderRepin(document.repin));
  }

  lines.push(
    `next: ${nextText(document.next)}`,
    `run every command from ${document.project}.`,
    REVISION_LIMIT,
    '',
  );

  return lines.join('\n');
};

/**
 * Every proposal the repository's facts imply, each proved against
 * `framework-setup`'s own revision preview (`FR-GUIDE-007`, `TB-071`).
 *
 * A fact becomes a proposal only when the named revision previews: one that
 * would change nothing is already declared and is left out, and a key the Gate
 * policy validator refuses as a name is counted, never shown, because such a
 * line may hold a value (`SG-GUIDE-002`). Any other refusal is the section's
 * own, so no proposal could apply, and it is reported as the operation gives
 * it. Each preview's token is discarded: nothing is applied by suggesting
 * (`SG-GUIDE-001`).
 */
const provenProposals = async ({ projectRoot, facts }) => {
  const proposals = [];
  const refusedNames = [];

  for (const [kind, { operation, fact, value }] of Object.entries(PROPOSAL_REVISIONS)) {
    for (const entry of facts[fact]) {
      const revision = { operation, [gateRevisions[operation].argument]: entry[value] };

      try {
        await previewGateRevision({ projectRoot, revision });
      } catch (error) {
        if (error.reasonCode === 'nothing-to-revise') {
          continue;
        }

        if (error.reasonCode === 'candidate-invalid' && kind === 'sensitive-input') {
          refusedNames.push(entry.evidence[0].path);
          continue;
        }

        return failure(error.reasonCode ?? 'revision-refused', error.message);
      }

      proposals.push({
        kind,
        subcontract: gateRevisions[operation].subcontract,
        value: entry[value],
        evidence: entry.evidence,
        revision,
        command: revisionCommand(projectRoot, revision),
      });
    }
  }

  return { proposals, refusedNames };
};

/**
 * What this repository implies the Gate configuration section should declare
 * and does not, with evidence and the command that previews each. A clone with
 * no section names setup's next step and proposes nothing.
 */
const suggestConfiguration = async ({ projectRoot, environment }) => {
  const observed = await observeSection({ projectRoot, environment, reader: 'config suggest' });

  if (observed.observation === undefined) {
    return observed;
  }

  const { gate, observation } = observed;
  const facts = await discoverGateConfigurationFacts({ projectRoot, environment });
  const proven = await provenProposals({ projectRoot, facts });

  if (proven.failure) {
    return { ...proven, gate, state: observation.state };
  }

  const skipped = [
    ...facts.unassigned.map(({ path: file, count }) => ({ path: file, reason: 'not-an-assignment', count })),
    ...[...new Set(proven.refusedNames)].map((file) => ({
      path: file,
      reason: 'name-refused',
      count: proven.refusedNames.filter((refused) => refused === file).length,
    })),
  ];

  return {
    state: observation.state,
    gate,
    section: { resolved: observation.configuration.working.resolved, identity: observation.configuration.working.identity },
    proposals: proven.proposals,
    skipped,
    next: proven.proposals.length === 0 ? null : {
      step: 'choose-proposal',
      command: null,
      instruction: 'choose a proposal and run its command: it previews that one change and prints the token that applies it; nothing is applied by suggesting.',
    },
  };
};

const PROPOSAL_NOUNS = Object.freeze({
  'dependency-root': 'dependency root',
  'sensitive-input': 'Sensitive runtime input',
  'environment-file': 'environment file',
});

/** One piece of evidence as a maintainer reads it. */
const describeEvidence = (evidence) => ({
  manifest: `${evidence.path} (manifest)`,
  'lock-file': `${evidence.path} (lock file)`,
  'install-directory': `${evidence.path}/ (installed directory)`,
  'example-name': `${evidence.path} line ${evidence.line} names it`,
  'git-ignored': `${evidence.path} is present and Git ignores it`,
}[evidence.fact]);

const SKIPPED_REASONS = Object.freeze({
  'not-an-assignment': 'assigns no NAME=',
  'name-refused': 'names a key the Gate policy validator refuses as a Sensitive runtime input name',
});

const renderSuggestion = (document) => {
  const lines = [
    'agent-framework config suggest',
    `project: ${document.project}`,
  ];

  if (document.failure !== null) {
    lines.push(`failed: ${document.failure.reasonCode} — ${document.failure.detail}`, SUGGEST_LIMIT, '');

    return lines.join('\n');
  }

  lines.push(`state: ${document.state}`);

  if (document.gate !== null) {
    lines.push(`gate: ${gateText(document.gate)}`);
  }

  if (document.section === null) {
    lines.push('section: none — .agent-framework.yaml has no Gate configuration section, so nothing is proposed.');
  }

  lines.push(`proposals: ${document.proposals.length}`);

  for (const [index, proposal] of document.proposals.entries()) {
    lines.push(
      `  ${index + 1}. ${PROPOSAL_NOUNS[proposal.kind]} ${proposal.value} (${proposal.subcontract})`,
      `     evidence: ${proposal.evidence.map(describeEvidence).join('; ')}`,
      `     $ ${proposal.command.run}`,
    );
  }

  for (const skipped of document.skipped) {
    lines.push(`skipped: ${skipped.count} ${skipped.count === 1 ? 'line' : 'lines'} of ${skipped.path} that ${SKIPPED_REASONS[skipped.reason]} (${skipped.reason}) — not shown, since such a line may hold a value.`);
  }

  lines.push(
    `next: ${nextText(document.next)}`,
    `run every command from ${document.project}.`,
    SUGGEST_LIMIT,
    '',
  );

  return lines.join('\n');
};

const runConfigSuggest = async ({ projectRoot, environment }) => {
  const suggested = (await exists(projectRoot))
    ? await suggestConfiguration({ projectRoot, environment })
    : failure('project-missing', `${projectRoot} does not exist.`);
  const proposals = suggested.proposals ?? [];
  const exitStatus = suggested.failure
    ? EXIT_UNRUNNABLE
    : (suggested.section === null || proposals.length > 0 ? EXIT_STEPS_REMAIN : EXIT_DONE);

  return {
    document: {
      document: SUGGEST_DOCUMENT_VERSION,
      command: 'config suggest',
      ok: !suggested.failure,
      exitStatus,
      project: projectRoot,
      state: suggested.state ?? null,
      gate: suggested.gate === undefined ? null : describeGate(suggested.gate),
      section: suggested.section ?? null,
      proposals,
      skipped: suggested.skipped ?? [],
      next: suggested.next ?? null,
      failure: suggested.failure ?? null,
      limit: SUGGEST_LIMIT,
    },
    render: renderSuggestion,
  };
};

/* ---------------------------------------------------------------------------
 * The report: one static page a maintainer can read or share (`FR-GUIDE-008`,
 * `TB-073`).
 *
 * The page is rendered from the documents `setup --json` and
 * `config show --json` print — the same functions build them — so it cannot
 * disagree with either, and from the doctor's findings copied field by field
 * out of `gate doctor --json`. It holds no script, stylesheet, font, image, or
 * link, and every string it shows is escaped. It is written only outside the
 * clone, judged on the real path, and never over an existing file; nothing
 * under the clone changes (`SG-GUIDE-001`, `SG-GUIDE-002`). A Sensitive
 * runtime input appears by name and source only (`SG-SECRET-001`).
 * ------------------------------------------------------------------------- */

const REPORT_LIMIT = 'report writes one static HTML file, only outside the clone and never over an existing file; it changes nothing under the clone, confirms nothing, and shows a Sensitive runtime input by name and source only.';

const REPORT_PREFIX = 'agent-framework-report-';

/** The lifecycle states `gate doctor` answers for: a configured Gate section. */
const DOCTOR_STATES = Object.freeze(['configured', 'activated']);

const HTML_ESCAPES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' });

const MARKUP = Symbol('markup');

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);

const interpolate = (value) => {
  if (Array.isArray(value)) {
    return value.map(interpolate).join('');
  }

  if (value === null || value === undefined) {
    return '';
  }

  return value[MARKUP] ?? escapeHtml(value);
};

/**
 * Markup with every interpolated value escaped, unless it is itself markup
 * built here; an array is each item in turn. Nothing reaches the page
 * unescaped by forgetting to escape it.
 */
const html = (strings, ...values) => ({
  [MARKUP]: strings.reduce((built, text, index) => built + text + (index < values.length ? interpolate(values[index]) : ''), ''),
});

const REPORT_STYLE = [
  ':root { color-scheme: light dark; --ink: #1d232a; --muted: #5b6672; --line: #d5dbe1; --panel: #f4f6f8; --page: #ffffff; --warn: #8a4b00; }',
  '@media (prefers-color-scheme: dark) { :root { --ink: #e4e8ec; --muted: #a3adb8; --line: #3a434d; --panel: #1f252b; --page: #14181c; --warn: #f0b35a; } }',
  'body { margin: 0 auto; max-width: 60rem; padding: 1.5rem 1rem 3rem; background: var(--page); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; }',
  'h1 { font-size: 1.6rem; margin: 0 0 0.5rem; } h2 { font-size: 1.2rem; margin: 2rem 0 0.5rem; border-bottom: 1px solid var(--line); padding-bottom: 0.25rem; } h3 { font-size: 1rem; margin: 1.25rem 0 0.25rem; }',
  'dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; margin: 0.5rem 0; } dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }',
  'code, pre { font: 13px/1.45 ui-monospace, monospace; } pre { background: var(--panel); padding: 0.5rem 0.75rem; margin: 0.25rem 0; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; }',
  'table { border-collapse: collapse; width: 100%; margin: 0.25rem 0; } th, td { text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); padding: 0.3rem 0.5rem; overflow-wrap: anywhere; } th { color: var(--muted); font-weight: 600; }',
  'li { margin: 0.25rem 0; } .muted { color: var(--muted); } .refused { color: var(--warn); } footer { margin-top: 2.5rem; color: var(--muted); font-size: 0.9rem; }',
].join('\n');

/**
 * Where the page goes: `--out` as given, else a fresh name in the temporary
 * directory. The directory is resolved by the operating system — symbolic
 * links, then `..` — and the file named in it is the one checked and written,
 * so no spelling of a path reaches the clone. Refused, with nothing written,
 * when that path is inside the clone, already exists, or names no file in an
 * existing directory.
 */
const reportTarget = async ({ cwd, projectRoot, out }) => {
  let clone;

  try {
    clone = await realpath(projectRoot);
  } catch {
    return failure('project-missing', `${projectRoot} does not exist.`);
  }

  const requested = out === null
    ? path.join(tmpdir(), `${REPORT_PREFIX}${randomUUID()}.html`)
    : (path.isAbsolute(out) ? out : `${cwd}${path.sep}${out}`);
  const name = path.basename(requested);

  if (['', '.', '..'].includes(name) || requested.endsWith(path.sep)) {
    return failure('report-target-invalid', `${requested} names no file to write the report to.`);
  }

  let directory;

  try {
    directory = await realpath(path.dirname(requested));
  } catch {
    directory = null;
  }

  if (directory === null || !(await stat(directory)).isDirectory()) {
    return failure('report-directory-missing', `${path.dirname(requested)} is not an existing directory; report creates no directory.`);
  }

  const target = path.join(directory, name);

  if (target === clone || target.startsWith(`${clone}${path.sep}`)) {
    return failure(
      'report-inside-clone',
      `${requested} is ${target}, inside the clone ${clone}; a report is never written inside the clone (SG-GUIDE-002). Name a path outside it with --out, or omit --out for the temporary directory.`,
    );
  }

  if (await lstat(target).then(() => true, () => false)) {
    return failure('report-target-exists', `${target} already exists; report never overwrites a file. Remove it or name another path with --out.`);
  }

  return { target };
};

/**
 * The doctor's findings for a configured clone, copied field by field out of
 * `gate doctor --json` so no value can pass through (`SG-GUIDE-002`); its
 * Sensitive runtime inputs are the configuration's, shown there. Not asked
 * without the Gate module or a configured Gate section.
 */
const observeDoctor = async ({ projectRoot, environment, setup }) => {
  if (setup.gate?.available !== true) {
    return { asked: false, reason: `the Gate module is unavailable: ${setup.gate?.detail ?? 'it was not located'}.` };
  }

  if (!DOCTOR_STATES.includes(setup.state)) {
    return { asked: false, reason: `gate doctor answers for a configured Gate section, and this clone is ${setup.state ?? 'not readable'}.` };
  }

  const gate = await locateGateCommand({ environment });
  const doctored = await runGateCommand(gate, { cwd: projectRoot, args: ['doctor'], environment });
  const asked = `${describeGate(gate).command} doctor --json`;

  if (doctored.failure) {
    return { asked: true, command: asked, failure: doctored.failure };
  }

  const { observation } = doctored.document;
  const { verdict, runners, hooks } = observation;

  return {
    asked: true,
    command: asked,
    failure: null,
    state: observation.state,
    configuration: {
      resolved: observation.configuration.resolved,
      checks: [...(observation.configuration.checks ?? [])],
      reasonCode: observation.configuration.reasonCode,
      detail: observation.configuration.detail,
    },
    verdict: {
      proceeds: verdict.proceeds,
      reached: [...verdict.reached],
      stop: verdict.stop === null ? null : { step: verdict.stop.step, reasonCode: verdict.stop.reasonCode, detail: verdict.stop.detail },
    },
    runners: runners === null ? null : {
      resolved: runners.resolved.map(({ checkId, role, runner, executable, version }) => ({ checkId, role, runner, executable, version })),
      unresolved: runners.unresolved.map(({ checkId, role, runner, reason }) => ({ checkId, role, runner, reason })),
    },
    dependencyRoots: (observation.dependencies?.roots ?? []).map(({ root, strategy, status, mechanism }) => ({ root, strategy, status, mechanism })),
    hooks: hooks === null ? null : {
      hook: hooks.hook,
      ownership: hooks.ownership,
      action: hooks.action,
      valid: hooks.valid,
      reasonCode: hooks.reasonCode,
    },
    answeredByActivation: observation.answeredByActivation.map(({ step }) => step),
    limit: observation.limit,
  };
};

const doctorVerdictText = (verdict) => (verdict.proceeds
  ? 'activation would proceed'
  : `activation would stop at ${verdict.stop.step ?? 'configuration'} (${verdict.stop.reasonCode})`);

const dependencyRootText = (entry) => `${entry.root}: ${entry.strategy}, ${entry.status}${entry.mechanism === null ? '' : `, ${entry.mechanism}`}`;

const failureMarkup = (id, failed) => html`<p id="${id}" class="refused">failed: ${failed.reasonCode} — ${failed.detail}</p>`;

const commandMarkup = (run) => html`<pre><code>$ ${run}</code></pre>`;

/** Gate state and health, as `setup --json` names them. */
const stateMarkup = (setup) => html`<section>
<h2>Gate state and health</h2>
<dl>
<dt>state</dt><dd id="state">${setup.state ?? '(none)'}</dd>
<dt>health</dt><dd id="health">${setup.health ?? '(not reported)'}</dd>
<dt>gate</dt><dd id="gate">${setup.gate === null ? 'not located' : gateText(setup.gate)}</dd>
${setup.doctor === null ? '' : html`<dt>doctor</dt><dd id="setup-doctor">${setupDoctorText(setup.doctor)}</dd>`}
</dl>
${setup.failure === null ? '' : failureMarkup('setup-failure', setup.failure)}
</section>`;

/** Every remaining step and the next command, as `setup --json` names them. */
const stepsMarkup = (setup) => html`<section>
<h2>Next steps</h2>
<p>next: <code id="next">${nextText(setup.next)}</code></p>
${setup.steps.length === 0 ? '' : html`<ol>
${setup.steps.map((step, index) => html`<li id="step-${index + 1}"><strong>${step.id}</strong> (${step.owner}) — ${step.summary}
${step.decisions.map((decision) => html`<div>decide: ${decision}</div>`)}
${step.refusal === null ? '' : html`<div class="refused">refused: ${step.refusal}</div>`}
${step.commands.map((entry) => commandMarkup(entry.run))}
</li>
`)}</ol>`}
${setup.unavailable.length === 0 ? '' : html`<p id="unavailable">${unavailableText(setup.unavailable)}</p>`}
<p class="muted">Run every command from <code>${setup.project}</code>. Each step is performed only by the command it names, which previews first where it writes.</p>
</section>`;

/** The doctor's findings, in the Gate's own words. */
const doctorMarkup = (doctor) => {
  if (!doctor.asked) {
    return html`<section>
<h2>Doctor findings</h2>
<p id="doctor-unasked">not asked — ${doctor.reason}</p>
</section>`;
  }

  if (doctor.failure !== null) {
    return html`<section>
<h2>Doctor findings</h2>
<p class="muted">From <code>${doctor.command}</code>.</p>
${failureMarkup('doctor-failure', doctor.failure)}
</section>`;
  }

  const { verdict, runners, hooks, configuration } = doctor;

  return html`<section>
<h2>Doctor findings</h2>
<p class="muted">From <code>${doctor.command}</code>: what a new activation would find on this machine.</p>
<dl>
<dt>observed state</dt><dd>${doctor.state}</dd>
<dt>verdict</dt><dd id="doctor-verdict">${doctorVerdictText(verdict)}</dd>
${verdict.stop === null ? '' : html`<dt>stopped by</dt><dd class="refused">${verdict.stop.detail}</dd>`}
<dt>steps reached</dt><dd>${verdict.reached.join(', ') || 'none'}</dd>
<dt>configuration</dt><dd>${configuration.resolved ? `resolves; checks ${configuration.checks.join(', ') || 'none'}` : `does not resolve — ${configuration.reasonCode}: ${configuration.detail}`}</dd>
<dt>dependency roots</dt><dd id="doctor-roots">${doctor.dependencyRoots.map(dependencyRootText).join('; ') || 'none declared'}</dd>
<dt>hook</dt><dd>${hooks === null ? 'not inspected' : `${hooks.hook}: ${hooks.ownership}, ${hooks.action}${hooks.valid ? '' : ` (${hooks.reasonCode})`}`}</dd>
<dt>answered only by activation</dt><dd>${doctor.answeredByActivation.join(', ')}</dd>
</dl>
${runners === null ? '' : html`<table>
<tr><th>check</th><th>role</th><th>runner</th><th>resolves to</th></tr>
${runners.resolved.map((entry) => html`<tr><td>${entry.checkId}</td><td>${entry.role}</td><td>${entry.runner}</td><td><code>${entry.executable}</code>${entry.version === null ? '' : ` (${entry.version})`}</td></tr>
`)}${runners.unresolved.map((entry) => html`<tr class="refused"><td>${entry.checkId}</td><td>${entry.role}</td><td>${entry.runner}</td><td>unresolved — ${entry.reason}</td></tr>
`)}</table>`}
<p class="muted">${doctor.limit}</p>
</section>`;
};

/** The effective Gate configuration section, as `config show --json` shows it. */
const configurationMarkup = (shown) => {
  if (shown.failure !== null) {
    return html`<section>
<h2>Effective configuration</h2>
${failureMarkup('configuration-failure', shown.failure)}
</section>`;
  }

  return html`<section>
<h2>Effective configuration</h2>
${shown.section === null
    ? html`<p id="configuration-none">section: none — .agent-framework.yaml has no Gate configuration section.</p>`
    : renderSection(shown.section).map((line) => html`<p>${line}</p>`)}
${shown.subcontracts.map((subcontract) => html`<h3>${subcontract.name}</h3>
${subcontract.values.length === 0 ? html`<p class="muted">no keys set</p>` : html`<table>
<tr><th>key</th><th>value</th><th>against the pinned section</th></tr>
${subcontract.values.map((value) => {
    const id = `configuration.${subcontract.name}.${value.key}`;

    return html`<tr><td>${value.key}</td><td><code id="${id}">${shownValueText(value)}</code></td><td id="${id}.marking">${markingText(value) ?? 'not compared — nothing is pinned'}</td></tr>
`;
  })}</table>`}
`)}
${shown.runtimeInputs === null ? '' : html`<h3>Sensitive runtime inputs</h3>
<p class="muted">By name and the source each resolves from; never a value.</p>
<ul>
${shown.runtimeInputs.resolved.map((input) => html`<li id="runtime-input.${input.name}">${resolvedInputText(input)}</li>
`)}${shown.runtimeInputs.unresolved.map((input) => html`<li id="runtime-input.${input.name}">${unresolvedInputText(input)}</li>
`)}${shown.runtimeInputs.environmentFiles.map((file) => html`<li>${environmentFileText(file)}</li>
`)}</ul>`}
</section>`;
};

/** The whole page. Everything but `generatedAt` is a function of the documents. */
const reportPage = ({ setup, shown, doctor, generatedAt, regenerate }) => html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gate report — ${path.basename(setup.project)}</title>
<style>
${{ [MARKUP]: REPORT_STYLE }}
</style>
</head>
<body>
<header>
<h1>Gate report</h1>
<dl>
<dt>project</dt><dd><code id="project">${setup.project}</code></dd>
<dt>generated</dt><dd><time id="generated" datetime="${generatedAt}">${generatedAt}</time></dd>
<dt>regenerate</dt><dd><code id="regenerate">${regenerate}</code></dd>
</dl>
<p class="muted">A static snapshot: it does not change when the clone does. Run the command above for a current page; it writes a new file in the temporary directory.</p>
</header>
<main>
${stateMarkup(setup)}
${stepsMarkup(setup)}
${doctorMarkup(doctor)}
${configurationMarkup(shown)}
</main>
<footer>
<p>Rendered by agent-framework report from the documents <code>agent-framework setup --json</code> and <code>agent-framework config show --json</code> print, with the findings of <code>gate doctor --json</code>. ${REPORT_LIMIT}</p>
</footer>
</body>
</html>
`[MARKUP];

const renderReport = (document) => [
  'agent-framework report',
  `project: ${document.project}`,
  ...(document.failure === null
    ? [`report: ${document.report}`]
    : [`failed: ${document.failure.reasonCode} — ${document.failure.detail}`]),
  REPORT_LIMIT,
  '',
].join('\n');

/**
 * Write the page. Every refusal comes before anything is asked or written;
 * the file is created exclusively, so a file that appears meanwhile is not
 * overwritten either. Exit status: `0` the page is written and neither setup
 * nor config show names anything further, `1` the page is written and one of
 * them does (or could not run, which the page states), `2` nothing was
 * written.
 */
const runReport = async ({ cwd, projectRoot, environment, out }) => {
  const document = {
    document: 'agent-framework/report/1',
    command: 'report',
    ok: false,
    exitStatus: EXIT_UNRUNNABLE,
    project: projectRoot,
    report: null,
    generatedAt: null,
    failure: null,
    limit: REPORT_LIMIT,
  };
  const located = await reportTarget({ cwd, projectRoot, out });

  if (located.failure) {
    return { document: { ...document, failure: located.failure }, render: renderReport };
  }

  const { document: setup } = await runSetup({ projectRoot, environment });
  const { document: shown } = await runConfigShow({ projectRoot, environment });
  const doctor = await observeDoctor({ projectRoot, environment, setup });
  const generatedAt = new Date().toISOString();
  const page = reportPage({
    setup,
    shown,
    doctor,
    generatedAt,
    regenerate: command('regenerate', ['node', ENTRY_SCRIPT, 'report', '--html', '--project', projectRoot]).run,
  });

  try {
    await writeFile(located.target, page, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    return {
      document: {
        ...document,
        failure: error.code === 'EEXIST'
          ? { reasonCode: 'report-target-exists', detail: `${located.target} already exists; report never overwrites a file. Remove it or name another path with --out.` }
          : { reasonCode: 'report-unwritable', detail: `${located.target} could not be written: ${error.message}` },
      },
      render: renderReport,
    };
  }

  const exitStatus = setup.exitStatus === EXIT_DONE && shown.exitStatus === EXIT_DONE ? EXIT_DONE : EXIT_STEPS_REMAIN;

  return {
    document: { ...document, ok: true, exitStatus, report: located.target, generatedAt },
    render: renderReport,
  };
};

/* ---------------------------------------------------------------------------
 * Guided setup in an interactive terminal (`FR-GUIDE-003`, `FR-GUIDE-004`,
 * `TB-072`).
 *
 * The plan above, performed one step at a time. Each step is re-derived from
 * the clone as it is after the last one, so the run follows exactly the order
 * `setup` prints, and only that order is this command's own decision
 * (`SG-OWNER-001`). Each step shows the owning operation's complete preview,
 * asks only what that operation cannot derive — the migration's open
 * decisions, the client to activate, a weakening's acknowledgement — offering
 * the owning draft as the default, and confirms only on an explicit `yes`,
 * with that preview's own token, through the operation that owns it. Any other
 * answer, end of input, or a refusal by the owning operation stops the run
 * with nothing further confirmed; a refused step is reported in the owning
 * operation's words and never retried. Consent is asked again for every step
 * and is never remembered (`SG-GUIDE-001`).
 * ------------------------------------------------------------------------- */

/** The guided run's record, returned in-process to the caller that drove it. */
export const GUIDED_DOCUMENT_VERSION = 'agent-framework/setup-guided/1';

/**
 * The channel a guided confirmation declares to the Gate, in the Gate's own
 * vocabulary (`gate <command> --consent-channel`), so every Lifecycle event the
 * confirmation appends records that consent came through this prompt
 * (`RISK-011`). The Gate records it as self-declared; this command records
 * nothing of its own.
 */
const GUIDED_CONSENT_CHANNEL = 'interactive-guided-setup';

/** The one answer that confirms. `y`, an empty line, and end of input do not. */
const AFFIRMATIVE = 'yes';

const GUIDED_INTRO = `each step shows the owning operation's complete preview and asks only what that operation cannot derive; only the answer ${AFFIRMATIVE} confirms exactly that preview, through the operation that owns it, and any other answer stops with nothing further confirmed.`;

const GUIDED_LIMIT = `guided setup confirmed only what was answered ${AFFIRMATIVE} after its complete preview, each through the operation that owns it with that preview's own token; it wrote no draft and asked again for every step.`;

const performed = (summary) => ({ done: true, summary });

const stopped = (reasonCode, detail) => ({ done: false, stop: { reasonCode, detail } });

const DECLINED = stopped('declined', `the answer was not ${AFFIRMATIVE}, so nothing was confirmed; the clone stays at the last completed step.`);

const INPUT_ENDED = stopped('input-ended', 'input ended before the question was answered, so nothing was confirmed; the clone stays at the last completed step.');

/** Text shown inside a preview, indented so it reads as the preview's own. */
const indented = (text) => text.replace(/\n$/, '').split('\n').map((line) => `    ${line}`);

/** A decision as typed: read as JSON when it parses as JSON, else as text; empty takes the default. */
const readDecision = (answer, fallback) => {
  const text = answer.trim();

  if (text === '') {
    return fallback;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** What one guided run says and asks, on the terminal it was given. */
const guidedIo = (terminal) => ({
  say: (...lines) => terminal.write(`${lines.join('\n')}\n`),
  ask: (question) => terminal.ask(question),
  decide: async (label, fallback) => {
    const shown = fallback === null || fallback === undefined ? '' : ` [${typeof fallback === 'string' ? fallback : JSON.stringify(fallback)}]`;
    const answer = await terminal.ask(`decide ${label}${shown}: `);

    return answer === null ? null : { typed: answer.trim(), value: readDecision(answer, fallback ?? null) };
  },
  /** `null` when the answer is consent to exactly this preview; otherwise why nothing is confirmed. */
  withheld: async (label, token) => {
    const answer = await terminal.ask(`confirm ${label} exactly as previewed (${token})? type ${AFFIRMATIVE} to confirm; anything else stops: `);

    if (answer === null) {
      return INPUT_ENDED;
    }

    return answer.trim().toLowerCase() === AFFIRMATIVE ? null : DECLINED;
  },
});

/**
 * The schema v4 migration: its own report's open decisions asked, each
 * defaulting to the owning draft's value, then its preview, then its
 * confirmation with that preview's hash.
 */
const guideMigration = async ({ projectRoot, io }) => {
  let report;
  let draft;

  try {
    report = await previewConfigurationMigration({ projectRoot, mappings: {} });
    draft = await draftMigrationMapping({ projectRoot });
  } catch (error) {
    return stopped('migration-refused', error.message);
  }

  const mappings = {
    profiles: { ...draft.profiles },
    commands: Object.fromEntries(Object.entries(draft.commands).map(([commandPath, fields]) => [commandPath, { ...fields }])),
  };

  if (report.ambiguities.length > 0) {
    io.say(`decisions: the migration report leaves ${report.ambiguities.length} open; each default is the owning draft's, and an answer is read as JSON when it parses as JSON.`);
  }

  for (const ambiguity of report.ambiguities) {
    for (const field of ambiguity.required) {
      const isProfile = Object.hasOwn(mappings.profiles, ambiguity.path);
      const answer = await io.decide(
        `${ambiguity.path} ${field} (${JSON.stringify(ambiguity.value)})`,
        isProfile ? mappings.profiles[ambiguity.path] : mappings.commands[ambiguity.path]?.[field],
      );

      if (answer === null) {
        return INPUT_ENDED;
      }

      if (isProfile) {
        mappings.profiles[ambiguity.path] = answer.value;
      } else {
        mappings.commands[ambiguity.path] = { ...mappings.commands[ambiguity.path], [field]: answer.value };
      }
    }
  }

  let preview;

  try {
    preview = await previewConfigurationMigration({ projectRoot, mappings });
  } catch (error) {
    return stopped('migration-refused', error.message);
  }

  if (preview.status !== 'ready') {
    return stopped('migration-requires-mapping', `the migration preview still requires ${preview.ambiguities.map((ambiguity) => `${ambiguity.path}: ${ambiguity.required.join(', ')}`).join('; ')}.`);
  }

  io.say(
    'preview (framework-setup, migrate-schema-v4):',
    `  mapping: ${JSON.stringify(mappings)}`,
    `  .agent-framework.yaml, from schema version ${preview.fromVersion} to ${preview.toVersion}, would read:`,
    ...indented(preview.proposedConfiguration),
    `  previewHash: ${preview.previewHash}`,
  );

  const withheld = await io.withheld('migrate-schema-v4', preview.previewHash);

  if (withheld !== null) {
    return withheld;
  }

  try {
    await migrateConfiguration({ projectRoot, mappings, confirmation: preview.previewHash });
  } catch (error) {
    return stopped('migration-refused', error.message);
  }

  return performed(`.agent-framework.yaml is at schema version 4, written exactly as previewed (${preview.previewHash}).`);
};

/**
 * Gate configuration: the owning drafter's policy — its checks are the
 * provider's defaults, not a decision — previewed, then confirmed with that
 * preview's hash.
 */
const guideGateConfiguration = async ({ projectRoot, io }) => {
  let policy;
  let preview;

  try {
    policy = await draftGatePolicy({ projectRoot });
    preview = await previewGateConfiguration({ projectRoot, policy });
  } catch (error) {
    return stopped('gate-configuration-refused', error.message);
  }

  io.say(
    'preview (framework-setup, configure-gate):',
    "  policy: the owning draft; its required and advisory checks are the provider's defaults, not a decision:",
    ...indented(JSON.stringify(policy, null, 2)),
    '  .agent-framework.yaml would read:',
    ...indented(preview.proposedConfiguration),
    `  previewHash: ${preview.previewHash}`,
  );

  const withheld = await io.withheld('configure-gate', preview.previewHash);

  if (withheld !== null) {
    return withheld;
  }

  try {
    await configureGate({ projectRoot, policy, confirmation: preview.previewHash });
  } catch (error) {
    return stopped('gate-configuration-refused', error.message);
  }

  return performed(`the dormant Gate is configured, written exactly as previewed (${preview.previewHash}).`);
};

/**
 * The first Gate subcommand a step names: its `--json` preview shown whole, as
 * the Gate states it; for a weaker candidate the Gate refuses, the weakening it
 * names typed back before its acknowledged preview is asked for
 * (`SG-CFG-001`); then its own token, confirmed on `yes` with the consent
 * channel declared. A step naming several subcommands is performed one at a
 * time, the next step re-derived from Gate status after each.
 */
const guideGateSubcommand = async ({ projectRoot, environment, gate, step, io }) => {
  const [subcommand] = step[PERFORM].subcommands;

  if (subcommand === undefined) {
    return stopped('maintainer-step', `gate status names a step the maintainer performs, with no command: ${step.summary}`);
  }

  const selectors = [];

  if (subcommand === 'activate') {
    const client = await io.decide('client (the adapter to activate)', 'git');

    if (client === null) {
      return INPUT_ENDED;
    }

    // An empty answer is the Gate's own default, so nothing is passed for it.
    if (client.typed !== '') {
      selectors.push('--client', client.typed);
    }
  }

  const preview = async () => {
    const previewed = await runGateCommand(gate, { cwd: projectRoot, args: [subcommand, ...selectors], environment });

    if (!previewed.failure) {
      io.say(
        `preview (change-evaluation-gate, ${[...gate.display, subcommand, ...selectors, '--json'].map(quoteForShell).join(' ')}), as the Gate states it:`,
        ...indented(JSON.stringify(previewed.document.observation, null, 2)),
      );
    }

    return previewed;
  };
  let previewed = await preview();

  if (previewed.failure) {
    return stopped(previewed.failure.reasonCode, previewed.failure.detail);
  }

  if (previewed.document.observation.refusal?.reasonCode === WEAKENING_UNACKNOWLEDGED) {
    const { refusal, transition } = previewed.document.observation;
    const named = (transition?.weakenings ?? []).map((weakening) => `${weakening.code} ${weakening.checkId}`).join(', ');

    if (named === '') {
      return stopped(refusal.reasonCode, refusal.detail ?? 'the Gate refuses a weaker candidate and names no weakening to acknowledge.');
    }

    io.say(`the Gate offers no token for a candidate weaker than the trusted policy until the weakening is acknowledged; it names: ${named}`);

    const typed = await io.ask(`acknowledge the weakening by typing it exactly as named (${named}); anything else stops: `);

    if (typed === null || typed.trim() !== named) {
      return stopped(refusal.reasonCode, `the weakening was not typed back, so nothing was acknowledged or confirmed. ${refusal.detail ?? ''}`.trim());
    }

    selectors.push(ACKNOWLEDGE_WEAKENING);
    previewed = await preview();

    if (previewed.failure) {
      return stopped(previewed.failure.reasonCode, previewed.failure.detail);
    }
  }

  const { observation } = previewed.document;

  if (typeof observation.confirmationToken !== 'string') {
    return stopped(
      observation.refusal?.reasonCode ?? 'no-token',
      observation.refusal?.detail ?? `the Gate offers no token for this ${subcommand} preview.`,
    );
  }

  const withheld = await io.withheld(`gate ${subcommand}`, observation.confirmationToken);

  if (withheld !== null) {
    return withheld;
  }

  const confirmed = await runGateCommand(gate, {
    cwd: projectRoot,
    args: [subcommand, ...selectors, '--confirm', observation.confirmationToken, '--consent-channel', GUIDED_CONSENT_CHANNEL],
    environment,
  });

  if (confirmed.failure) {
    return stopped(confirmed.failure.reasonCode, confirmed.failure.detail);
  }

  const { mutation } = confirmed.document;

  if (mutation?.performed !== true) {
    return stopped(mutation?.reasonCode ?? 'not-performed', mutation?.summary ?? `the Gate did not perform the ${subcommand}.`);
  }

  return performed(`${mutation.summary} consent channel: ${GUIDED_CONSENT_CHANNEL}, declared to the Gate, which records it as self-declared.`);
};

/** Perform one planned step as its kind says; the plan supplies the Gate and doctor's verdict. */
const guideStep = ({ projectRoot, environment, planned, step, io }) => ({
  unpreviewed: async () => stopped(
    'step-unpreviewed',
    `${step.id} writes .agent-framework.yaml with no preview to confirm, so guided setup does not perform it (SG-GUIDE-001). Run it yourself, then run agent-framework setup again: ${step.commands[0].run}`,
  ),
  migration: () => guideMigration({ projectRoot, io }),
  'gate-configuration': () => guideGateConfiguration({ projectRoot, io }),
  // The plan names doctor first only when its verdict is a stop.
  doctor: async () => stopped(
    planned.doctor?.stop?.reasonCode ?? 'doctor-stop',
    `gate doctor predicts activation would stop: ${planned.doctor?.stop?.detail ?? step.summary}`,
  ),
  gate: () => guideGateSubcommand({ projectRoot, environment, gate: planned.gate, step, io }),
}[step[PERFORM].kind])();

/**
 * Walk the clone through every remaining step, then print where it stands
 * exactly as `setup` prints it.
 */
const runGuidedSetup = async ({ projectRoot, environment, terminal }) => {
  const io = guidedIo(terminal);
  const completed = [];
  let stop = null;
  let last = null;

  io.say('agent-framework setup — guided', `project: ${projectRoot}`, GUIDED_INTRO);

  while (stop === null && await exists(projectRoot)) {
    const planned = await planSetup({ projectRoot, environment });

    if (planned.failure) {
      stop = { step: null, ...planned.failure };
      break;
    }

    const [step] = planned.steps;

    if (step === undefined) {
      break;
    }

    if (step.id === last) {
      stop = { step: step.id, reasonCode: 'step-repeated', detail: `${step.id} completed, and the owning observation names it again; setup does not repeat a step.` };
      io.say(`stopped: ${stop.reasonCode} — ${stop.detail}`);
      break;
    }

    // A Gate step is introduced in the Gate's own words; a framework-setup
    // step's printed summary names draft files this run never writes.
    io.say('', `step ${completed.length + 1}: ${step.id} (${step.owner})${step.owner === 'change-evaluation-gate' ? ` — ${step.summary}` : ''}`);

    const outcome = await guideStep({ projectRoot, environment, planned, step, io });

    if (!outcome.done) {
      stop = { step: step.id, ...outcome.stop };
      io.say(`stopped: ${stop.reasonCode} — ${stop.detail}`);
      break;
    }

    io.say(`done: ${outcome.summary}`);
    completed.push({ step: step.id, owner: step.owner, summary: outcome.summary });
    last = step.id;
  }

  const { document: plan } = await runSetup({ projectRoot, environment });
  const exitStatus = stop === null ? plan.exitStatus : Math.max(EXIT_STEPS_REMAIN, plan.exitStatus);

  io.say('', 'where this clone stands now:');
  terminal.write(render(plan, { limit: false }));
  io.say(GUIDED_LIMIT);

  return {
    exitCode: exitStatus,
    stdout: '',
    stderr: '',
    document: {
      document: GUIDED_DOCUMENT_VERSION,
      command: 'setup',
      exitStatus,
      project: projectRoot,
      consentChannel: GUIDED_CONSENT_CHANNEL,
      completed,
      stopped: stop,
      plan,
      limit: GUIDED_LIMIT,
    },
  };
};

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
  }[options.subcommand] ?? runConfigRevision;
  const { document, render: rendered } = await run({
    cwd,
    projectRoot,
    out: options.out,
    environment,
    revision: options.revision,
    confirmation: options.confirmation,
    acknowledgeWeakening: options.acknowledgeWeakening,
  });

  return {
    exitCode: document.exitStatus,
    stdout: options.json ? `${JSON.stringify(document, null, 2)}\n` : rendered(document),
    stderr: '',
    document,
  };
};

if (isCliEntryPoint(import.meta.url)) {
  const terminal = processTerminal();
  let result;

  try {
    result = await runFrameworkCommand({
      cwd: process.cwd(),
      argv: process.argv.slice(2),
      environment: process.env,
      terminal,
    });
  } finally {
    terminal.close();
  }

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
