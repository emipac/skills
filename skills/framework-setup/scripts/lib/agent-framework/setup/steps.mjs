import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  draftGatePolicy,
  previewConfigurationMigration,
  previewGateConfiguration,
} from '../../../configure.mjs';
import { command, configureCommand, gateCommand } from '../commands.mjs';
import { PERFORM } from '../contracts.mjs';
import { exists } from '../paths.mjs';

const performedAs = (step, perform) => Object.assign(step, { [PERFORM]: perform });

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

export const baseSetupStep = (projectRoot, discovery) => performedAs({
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
export const migrationStep = async (projectRoot, { current }) => {
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
export const gateConfigurationStep = async (projectRoot, { current }) => {
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

export const doctorStep = (prefix, verdict = null) => performedAs({
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

export const activationStep = (prefix) => performedAs({
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
export const remedyStep = (prefix, remedy) => (remedy.subcommands.length === 1 && remedy.subcommands[0] === 'activate'
  ? { ...activationStep(prefix), id: remedy.remedy }
  : performedAs({
    id: remedy.remedy,
    owner: 'change-evaluation-gate',
    summary: remedy.instruction,
    decisions: [],
    refusal: null,
    commands: remedy.subcommands.flatMap((subcommand) => previewedGateCommands(prefix, subcommand)),
  }, { kind: 'gate', subcommands: [...remedy.subcommands] }));
