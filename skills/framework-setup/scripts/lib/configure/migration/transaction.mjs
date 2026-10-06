import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { emitDraft, exists } from '../filesystem.mjs';
import {
  migrationAmbiguities,
  validateMigratedProfilePresence,
  validateMigrationMappings,
} from './mappings.mjs';
import { renderMigratedConfiguration } from './rendering.mjs';
import { parseYamlScalar } from '../yaml.mjs';

const parseMigrationConfiguration = (contents) => {
  const schemaVersion = Number(contents.match(/^schema_version:\s*(\d+)$/m)?.[1] ?? 0);
  const backend = parseYamlScalar(contents.match(/^backend:\s*(.+)$/m)?.[1] ?? 'unknown');
  const frontend = parseYamlScalar(contents.match(/^frontend:\s*(.+)$/m)?.[1] ?? 'unknown');
  const commands = [];
  const sourceScopes = { backend: [], frontend: [], shared: [] };
  const commandIndexes = new Map();
  let inVerification = false;
  let inCommands = false;
  let category = null;
  let scope = null;

  const lines = contents.split(/\r?\n/);

  let inSourceScopes = false;
  let sourceScope = null;

  for (const line of lines) {
    if (line === 'source_scopes:') {
      inSourceScopes = true;
      continue;
    }

    if (inSourceScopes && line && !line.startsWith(' ')) {
      break;
    }

    const scopeMatch = line.match(/^  (backend|frontend|shared):(?:\s*\[\])?$/);

    if (inSourceScopes && scopeMatch) {
      sourceScope = scopeMatch[1];
      continue;
    }

    const rootMatch = line.match(/^    -\s+(.+)$/);

    if (inSourceScopes && sourceScope && rootMatch) {
      sourceScopes[sourceScope].push(parseYamlScalar(rootMatch[1]));
    }
  }

  for (const [lineIndex, line] of lines.entries()) {
    if (line === 'verification:') {
      inVerification = true;
      continue;
    }

    if (inVerification && line === '  commands:') {
      inCommands = true;
      continue;
    }

    if (inVerification && line && !line.startsWith(' ')) {
      break;
    }

    if (!inCommands) {
      continue;
    }

    const categoryMatch = line.match(/^    ([a-z_]+):(?:\s*\[\])?$/);

    if (categoryMatch) {
      category = categoryMatch[1];
      scope = null;
      continue;
    }

    const scopeMatch = line.match(/^      (backend|frontend|both):(?:\s*\[\])?$/);

    if (scopeMatch) {
      scope = scopeMatch[1];
      continue;
    }

    const commandMatch = line.match(/^        -\s+(.+)$/);

    if (!commandMatch || !category || !scope) {
      continue;
    }

    const commandIndexKey = `${category}.${scope}`;
    const index = commandIndexes.get(commandIndexKey) ?? 0;
    commandIndexes.set(commandIndexKey, index + 1);
    commands.push({
      category,
      scope,
      index,
      lineIndex,
      value: parseYamlScalar(commandMatch[1]),
    });
  }

  return { schemaVersion, backend, frontend, sourceScopes, commands };
};

export const previewConfigurationMigration = async ({
  projectRoot,
  mappings = {},
}) => {
  const configurationPath = path.join(path.resolve(projectRoot), '.agent-framework.yaml');

  if (!(await exists(configurationPath))) {
    throw new Error('Cannot migrate a missing .agent-framework.yaml configuration');
  }

  const contents = await readFile(configurationPath, 'utf8');
  const configuration = parseMigrationConfiguration(contents);

  if (configuration.schemaVersion !== 3) {
    throw new Error(`Schema v4 migration requires schema version 3, found ${configuration.schemaVersion}`);
  }

  validateMigrationMappings(configuration, mappings);
  const ambiguities = migrationAmbiguities(configuration, mappings);

  if (ambiguities.length > 0) {
    return {
      status: 'requires-mapping',
      fromVersion: 3,
      toVersion: 4,
      previewHash: null,
      ambiguities,
    };
  }

  validateMigratedProfilePresence(configuration, mappings);

  const proposedConfiguration = renderMigratedConfiguration(
    contents,
    configuration,
    mappings,
  );
  const previewHash = createHash('sha256')
    .update(contents)
    .update('\0')
    .update(proposedConfiguration)
    .digest('hex');

  return {
    status: 'ready',
    fromVersion: 3,
    toVersion: 4,
    previewHash,
    ambiguities: [],
    proposedConfiguration,
  };
};

export const migrateConfiguration = async ({
  projectRoot,
  mappings = {},
  confirmation,
}) => {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const configurationPath = path.join(resolvedProjectRoot, '.agent-framework.yaml');
  const preview = await previewConfigurationMigration({
    projectRoot: resolvedProjectRoot,
    mappings,
  });

  if (preview.status !== 'ready') {
    throw new Error('Schema v4 migration still requires explicit mappings');
  }

  if (confirmation !== preview.previewHash) {
    throw new Error('Migration confirmation does not match the current preview');
  }

  const temporaryPath = path.join(
    resolvedProjectRoot,
    `.agent-framework.yaml.${randomUUID()}.tmp`,
  );
  const configurationStats = await stat(configurationPath);

  try {
    await writeFile(temporaryPath, preview.proposedConfiguration, {
      encoding: 'utf8',
      flag: 'wx',
      mode: configurationStats.mode,
    });
    await rename(temporaryPath, configurationPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }

  return {
    status: 'migrated',
    fromVersion: preview.fromVersion,
    toVersion: preview.toVersion,
    previewHash: preview.previewHash,
  };
};

/**
 * Draft the migration mapping this project's own migration report asks for.
 *
 * The migration report names the field that is *missing*; the mapping supplies
 * it. Inverting that by hand is the documented trap, so the draft is keyed by
 * the reported ambiguity paths directly and carries only the field names the
 * report itself named. No value is resolved, executed, or inferred here
 * (SG-CMD-001): every leaf is `null` until the maintainer proves it, and a
 * draft still carrying one is refused by `--mapping` rather than accepted.
 *
 * The report's own envelope — `status`, `fromVersion`, `previewHash`,
 * `ambiguities` — is never a mapping section and never appears in the draft.
 */
export const draftMigrationMapping = async ({ projectRoot, out = null } = {}) => {
  const report = await previewConfigurationMigration({ projectRoot, mappings: {} });
  const profiles = {};
  const commands = {};

  for (const ambiguity of report.ambiguities ?? []) {
    if (['backend', 'frontend'].includes(ambiguity.path)) {
      profiles[ambiguity.path] = null;

      continue;
    }

    commands[ambiguity.path] = Object.fromEntries(
      ambiguity.required.map((field) => [field, null]),
    );
  }

  return emitDraft({ profiles, commands }, out);
};
