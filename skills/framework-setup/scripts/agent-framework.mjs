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
 *   are `gate status --json`'s `observation.state` and `observation.next`;
 * - whether activation would stop is `gate doctor --json`'s `verdict`.
 *
 * It confirms, writes, registers, and trusts nothing (`SG-GUIDE-001`), and
 * without the Gate module it names only `framework-setup` steps and says the
 * Gate steps are unavailable (`FR-GUIDE-009`).
 *
 * Usage:
 *   agent-framework setup [--json] [--project <directory>]
 *
 * Exit status follows the Gate's: `0` nothing further to do, `1` steps remain,
 * `2` the command could not run.
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
  previewConfigurationMigration,
  previewGateConfiguration,
} from './configure.mjs';
import { isCliEntryPoint } from './lib/cli-entry-point.mjs';
import { locateGateCommand, runGateCommand } from './lib/gate-command.mjs';

/** The document an agent parses. Versioned, so a later field is an addition rather than a surprise. */
export const DOCUMENT_VERSION = 'agent-framework/setup/1';

export const EXIT_DONE = 0;

export const EXIT_STEPS_REMAIN = 1;

export const EXIT_UNRUNNABLE = 2;

const USAGE = 'usage: agent-framework setup [--json] [--project <directory>]';

const CONFIGURE_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'configure.mjs');

/** The steps the Gate module performs, named when it is absent (`FR-GUIDE-009`). */
const GATE_STEPS = Object.freeze(['configure-gate', 'doctor', 'activate']);

const LIMIT = 'setup wrote nothing, confirmed nothing, and registered nothing; each step is performed only by the command it names, which previews first where it writes.';

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
 * The Gate subcommands a remedy `gate status` names is performed by. The
 * remedy — which one, and in what order — is the Gate's; this only spells the
 * subcommand of the same name. A remedy with no subcommand is the
 * maintainer's own act, stated in the Gate's words.
 */
const REMEDY_SUBCOMMANDS = Object.freeze({
  activate: ['activate'],
  repair: ['repair'],
  sync: ['sync'],
  'activation-transaction': ['deactivate', 'activate'],
});

const remedyStep = (prefix, remedy) => (remedy.remedy === 'activate'
  ? activationStep(prefix)
  : {
    id: remedy.remedy,
    owner: 'change-evaluation-gate',
    summary: remedy.instruction,
    decisions: [],
    refusal: null,
    commands: (REMEDY_SUBCOMMANDS[remedy.remedy] ?? [])
      .flatMap((subcommand) => previewedGateCommands(prefix, subcommand)),
  });

const failure = (reasonCode, detail) => ({ failure: { reasonCode, detail } });

/**
 * Ask the Gate where a schema v4 clone stands, and name what its own
 * observations say comes next.
 */
const gatePlan = async ({ projectRoot, gate, environment }) => {
  const status = await runGateCommand(gate, { cwd: projectRoot, args: ['status'], environment });

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

/** Where this clone stands, and every remaining step in order. */
const planSetup = async ({ projectRoot, environment }) => {
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

  const planned = await gatePlan({ projectRoot, gate, environment });

  return planned.failure ? { ...planned, gate } : { ...base, ...planned };
};

const parseArguments = (argv) => {
  const [subcommand, ...rest] = argv;
  const options = { json: false, project: null };

  if (subcommand !== 'setup') {
    return null;
  }

  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--json') {
      options.json = true;
    } else if (rest[index] === '--project' && rest[index + 1] !== undefined) {
      options.project = rest[index + 1];
      index += 1;
    } else {
      return null;
    }
  }

  return options;
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
  const planned = (await exists(projectRoot))
    ? await planSetup({ projectRoot, environment })
    : failure('project-missing', `${projectRoot} does not exist.`);
  const steps = planned.steps ?? [];
  const first = steps[0] ?? null;
  const exitStatus = planned.failure ? EXIT_UNRUNNABLE : (steps.length === 0 ? EXIT_DONE : EXIT_STEPS_REMAIN);
  const document = {
    document: DOCUMENT_VERSION,
    command: 'setup',
    ok: !planned.failure,
    exitStatus,
    project: projectRoot,
    state: planned.state ?? null,
    health: planned.observed?.health ?? null,
    gate: planned.gate === undefined ? null : {
      available: planned.gate.available,
      located: planned.gate.located,
      command: planned.gate.display === null ? null : planned.gate.display.map(quoteForShell).join(' '),
      detail: planned.gate.detail,
      observed: planned.observed ?? null,
    },
    doctor: planned.doctor ?? null,
    steps,
    unavailable: planned.gate?.available === false ? [...GATE_STEPS] : [],
    next: first === null ? null : {
      step: first.id,
      command: first.commands[0]?.run ?? null,
      instruction: first.summary,
    },
    failure: planned.failure ?? null,
    limit: LIMIT,
  };

  return {
    exitCode: exitStatus,
    stdout: options.json ? `${JSON.stringify(document, null, 2)}\n` : render(document),
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
