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
 * It confirms, writes, registers, and trusts nothing (`SG-GUIDE-001`), and
 * without the Gate module it names only `framework-setup` steps and says the
 * Gate steps are unavailable (`FR-GUIDE-009`).
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
 * `config <revision>` revises the Gate configuration section by one named
 * revision (`FR-GUIDE-006`, `TB-069`) — `add-dependency-root`,
 * `remove-dependency-root`, `set-dependency-provisioning`,
 * `add-budget-skippable`, `remove-budget-skippable`, as `framework-setup`'s
 * `gateRevisions` table names them. It only drives `framework-setup`'s own
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
 * Usage:
 *   agent-framework setup [--json] [--project <directory>]
 *   agent-framework config show [--json] [--project <directory>]
 *   agent-framework config <revision> <value> [--<option> <value>] [--confirm <token>] [--json] [--project <directory>]
 *
 * Exit status follows the Gate's: `0` nothing further to do, `1` steps remain
 * (for `config show`: no Gate section, a section that does not resolve, or a
 * value that differs from the pinned one; for a revision: its confirmation, or
 * the re-pin it continued into), `2` the command could not run or the revision
 * was refused.
 */

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  discoverProject,
  draftGatePolicy,
  gatePolicyKeys,
  gateRevisions,
  previewConfigurationMigration,
  previewGateConfiguration,
  previewGateRevision,
  reviseGate,
} from './configure.mjs';
import { isCliEntryPoint } from './lib/cli-entry-point.mjs';
import { locateGateCommand, runGateCommand } from './lib/gate-command.mjs';

/** The document an agent parses. Versioned, so a later field is an addition rather than a surprise. */
export const DOCUMENT_VERSION = 'agent-framework/setup/1';

/** The `config show` document, versioned the same way. */
export const CONFIG_DOCUMENT_VERSION = 'agent-framework/config-show/1';

/** The `config <revision>` document, versioned the same way. */
export const REVISION_DOCUMENT_VERSION = 'agent-framework/config-revision/1';

export const EXIT_DONE = 0;

export const EXIT_STEPS_REMAIN = 1;

export const EXIT_UNRUNNABLE = 2;

const USAGE = [
  'usage: agent-framework setup [--json] [--project <directory>]',
  '       agent-framework config show [--json] [--project <directory>]',
  ...Object.entries(gateRevisions).map(([name, { argument, options }]) => [
    `       agent-framework config ${name} <${argument}>`,
    ...options.map((option) => `[--${option} <${option}>]`),
    '[--confirm <token>] [--json] [--project <directory>]',
  ].join(' ')),
].join('\n');

const ENTRY_SCRIPT = fileURLToPath(import.meta.url);

const CONFIGURE_SCRIPT = path.join(path.dirname(ENTRY_SCRIPT), 'configure.mjs');

/** The steps the Gate module performs, named when it is absent (`FR-GUIDE-009`). */
const GATE_STEPS = Object.freeze(['configure-gate', 'doctor', 'activate']);

const LIMIT = 'setup wrote nothing, confirmed nothing, and registered nothing; each step is performed only by the command it names, which previews first where it writes.';

const CONFIG_LIMIT = 'config show wrote nothing and changed nothing; a Sensitive runtime input is shown by name and the source it resolves from, never by value.';

const REVISION_LIMIT = 'a config revision writes only the Gate configuration section of .agent-framework.yaml, only with the token of the preview that showed the change, and keeps every other byte; it confirms no re-pin — the Gate confirms its own preview with its own token.';

/**
 * The finding a revised configuration raises on an activated clone: the
 * section no longer reproduces what the Activation receipt pinned. The remedy
 * `gate status` names for it is the re-pin a confirmed revision continues
 * into; which subcommand performs it is the Gate's to say (`TB-074`).
 */
const CONFIGURATION_DRIFT = 'control-surface-drift:trusted-configuration';

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

const baseSetupStep = (projectRoot, discovery) => ({
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
});

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

  return {
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
  };
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

  return {
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
  };
};

const gateCommand = (role, prefix, ...argv) => command(role, [...prefix, ...argv]);

const doctorStep = (prefix, verdict = null) => ({
  id: 'doctor',
  owner: 'change-evaluation-gate',
  summary: verdict === null
    ? 'ask what this machine can do for the configured Gate before activating; it writes nothing under the clone.'
    : 'gate doctor predicts activation would stop; resolve what it names, then run it again.',
  decisions: [],
  refusal: verdict === null ? null : `${verdict.stop.reasonCode}: ${verdict.stop.detail}`,
  commands: [gateCommand('observe', prefix, 'doctor')],
});

const previewedGateCommands = (prefix, subcommand) => [
  gateCommand('preview', prefix, subcommand),
  gateCommand('confirm', prefix, subcommand, '--confirm', '<token>'),
];

const activationStep = (prefix) => ({
  id: 'activate',
  owner: 'change-evaluation-gate',
  summary: 'activate the configured clone: preview, read it, and confirm exactly that preview with the token it prints.',
  decisions: ['client: git, unless --client <adapter-id> names another'],
  refusal: null,
  commands: previewedGateCommands(prefix, 'activate'),
});

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
  : {
    id: remedy.remedy,
    owner: 'change-evaluation-gate',
    summary: remedy.instruction,
    decisions: [],
    refusal: null,
    commands: remedy.subcommands.flatMap((subcommand) => previewedGateCommands(prefix, subcommand)),
  });

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
  const subcommand = first === 'config' && (second === 'show' || revision !== null) ? `config ${second}` : first;

  if (subcommand !== 'setup' && subcommand !== 'config show' && revision === null) {
    return null;
  }

  const rest = argv.slice(subcommand === 'setup' ? 1 : 2);
  const options = { subcommand, json: false, project: null, revision: null, confirmation: null };
  const valued = new Set(['--project', ...(revision === null ? [] : ['--confirm', ...revision.options.map((option) => `--${option}`)])]);

  if (revision !== null) {
    options.revision = { operation: second };
  }

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];

    if (argument === '--json') {
      options.json = true;
    } else if (valued.has(argument) && rest[index + 1] !== undefined) {
      const value = rest[index + 1];

      if (argument === '--project') {
        options.project = value;
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

  return revision !== null && options.revision[revision.argument] === undefined ? null : options;
};

const render = (document) => {
  const lines = [
    'agent-framework setup',
    `project: ${document.project}`,
  ];

  if (document.failure !== null) {
    lines.push(`failed: ${document.failure.reasonCode} — ${document.failure.detail}`, LIMIT, '');

    return lines.join('\n');
  }

  lines.push(`state: ${document.state}`);

  if (document.health !== null) {
    lines.push(`health: ${document.health}`);
  }

  lines.push(document.gate.available
    ? `gate: ${document.gate.command} — ${document.gate.detail}`
    : `gate: unavailable — ${document.gate.detail}`);

  if (document.doctor !== null) {
    lines.push(`doctor: ${document.doctor.proceeds ? 'activation would proceed' : `activation would stop (${document.doctor.stop.reasonCode})`}`);
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
    lines.push(`unavailable: ${document.unavailable.join(', ')} — Gate steps are unavailable because the Gate module is not installed.`);
  }

  lines.push(
    `next: ${document.next === null ? 'nothing' : (document.next.command ?? document.next.instruction)}`,
    `run every command from ${document.project}.`,
    LIMIT,
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

/** The Gate configuration section this clone runs, and what its receipt pinned. */
const showConfiguration = async ({ projectRoot, environment }) => {
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
        `\`${[...gate.display, 'status', '--json'].join(' ')}\` reports no configuration section: the installed Gate (${release}, ${gate.detail}) predates it. Update the Gate module; config show reads the section only through the Gate's own command.`,
      ),
    };
  }

  const { working, pinned } = configuration;

  if (pinned === null && working.reasonCode === 'gate-policy-missing') {
    return unconfiguredSection({ projectRoot, environment, status });
  }

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

/** One value's line: the working value, then how it compares with the pinned one. */
const renderValue = (value) => {
  const shown = value.declared ? JSON.stringify(value.value) : '(not set)';
  const pinned = value.pinned?.declared ? JSON.stringify(value.pinned.value) : '(not set)';
  const changes = [
    ...(value.added?.length ? [`added ${value.added.join(', ')}`] : []),
    ...(value.removed?.length ? [`removed ${value.removed.join(', ')}`] : []),
  ];
  const marking = {
    matches: ' — matches the pinned value',
    differs: ` — differs from the pinned value ${pinned}${changes.map((change) => `; ${change}`).join('')}`,
    unrecoverable: ' — unrecoverable: the pinned value is known only by the section identity',
  }[value.marking] ?? '';

  return `  ${value.key}: ${shown}${marking}`;
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
    lines.push(document.gate.available
      ? `gate: ${document.gate.command} — ${document.gate.detail}`
      : `gate: unavailable — ${document.gate.detail}`);
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
      ...document.runtimeInputs.resolved.map((input) => `  - ${input.name}: from ${input.source}`),
      ...document.runtimeInputs.unresolved.map((input) => `  - ${input.name}: unresolved — no source sets it`),
      ...document.runtimeInputs.environmentFiles.map((file) => `  environment file ${file.path}: ${file.status}`),
    );
  }

  lines.push(
    `next: ${document.next === null ? 'nothing' : (document.next.command ?? document.next.instruction)}`,
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
const revisionCommand = (projectRoot, revision, confirmation = null) => {
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
 * and token reported as it states them (`SG-CFG-001`). Nothing is confirmed.
 */
const repinPreview = async ({ projectRoot, gate, environment, observation, policy }) => {
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
  const previewed = await runGateCommand(gate, { cwd: projectRoot, args: [subcommand], environment });

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
      commands: repin.confirmationToken === null
        ? []
        : [gateCommand('confirm', prefix, subcommand, '--confirm', repin.confirmationToken)],
    },
  };
};

/**
 * Preview or confirm one revision through `framework-setup`'s own operation,
 * then say what follows: on an activated clone the re-pin preview, else
 * nothing. The operation's refusal is reported as it gives it.
 */
const reviseConfiguration = async ({ projectRoot, environment, revision, confirmation }) => {
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
    ...await repinPreview({ projectRoot, gate, environment, observation, policy: revised.policy }),
  };
};

/** What comes after a revision: its confirmation, the re-pin's, or nothing. */
const revisionNext = ({ projectRoot, revised, repin, applied }) => {
  if (!applied) {
    const confirm = revisionCommand(projectRoot, revised.revision, revised.previewHash);

    return { step: 'confirm-revision', command: confirm.run, instruction: 'confirm exactly this preview with its token.' };
  }

  if (repin === null) {
    return null;
  }

  return repin.confirmationToken === null
    ? { step: repin.subcommand, command: null, instruction: repin.refusal?.next ?? repin.refusal?.detail ?? `the Gate offers no token for this ${repin.subcommand}.` }
    : { step: repin.subcommand, command: repin.commands[0].run, instruction: `confirm the Gate's ${repin.subcommand} preview with its own token.` };
};

const runConfigRevision = async ({ projectRoot, environment, revision, confirmation }) => {
  const outcome = (await exists(projectRoot))
    ? await reviseConfiguration({ projectRoot, environment, revision, confirmation })
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
      revision: revised?.revision ?? revision,
      applied,
      subcontract: revised?.subcontract ?? null,
      changes: revised?.changes ?? [],
      previewHash: revised?.previewHash ?? null,
      state: outcome.state ?? null,
      gate: outcome.gate === undefined ? null : describeGate(outcome.gate),
      repin,
      next: revised === null || outcome.failure ? null : revisionNext({ projectRoot, revised, repin, applied }),
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
    lines.push('state: activated — confirming continues into the Gate\'s preview of the re-pin it names for the changed configuration; that preview has its own token.');
  } else if (document.state !== null) {
    lines.push(`state: ${document.state}${document.state === 'activated' ? '' : ' — the clone is not activated, so nothing is re-pinned.'}`);
  }

  if (document.repin !== null) {
    lines.push(...renderRepin(document.repin));
  }

  lines.push(
    `next: ${document.next === null ? 'nothing' : (document.next.command ?? document.next.instruction)}`,
    `run every command from ${document.project}.`,
    REVISION_LIMIT,
    '',
  );

  return lines.join('\n');
};

/**
 * Run one Framework command invocation and return what it printed, without
 * touching the process — the seam tests and later subcommands drive.
 */
export const runFrameworkCommand = async ({ cwd, argv, environment = process.env }) => {
  const options = parseArguments(argv);

  if (options === null) {
    return { exitCode: EXIT_UNRUNNABLE, stdout: '', stderr: `${USAGE}\n`, document: null };
  }

  const projectRoot = path.resolve(cwd, options.project ?? '.');
  const run = {
    setup: runSetup,
    'config show': runConfigShow,
  }[options.subcommand] ?? runConfigRevision;
  const { document, render: rendered } = await run({
    projectRoot,
    environment,
    revision: options.revision,
    confirmation: options.confirmation,
  });

  return {
    exitCode: document.exitStatus,
    stdout: options.json ? `${JSON.stringify(document, null, 2)}\n` : rendered(document),
    stderr: '',
    document,
  };
};

if (isCliEntryPoint(import.meta.url)) {
  const result = await runFrameworkCommand({
    cwd: process.cwd(),
    argv: process.argv.slice(2),
    environment: process.env,
  });

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
