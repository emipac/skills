import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { readExistingConfiguration } from './configuration-read.mjs';
import {
  backendProfiles,
  frontendProfiles,
  trackerAdapters,
  verificationScopes,
} from './contracts.mjs';
import { discoverProject } from './discovery/project.mjs';
import { normalizeSourceScopes } from './discovery/scopes.mjs';
import { discoverVerification } from './discovery/verification.mjs';
import { hashFiles, readJson, writeManagedFile } from './filesystem.mjs';
import { adapterReferencePath } from './paths.mjs';
import { revisionRefusal } from './refusals.mjs';
import { appendYamlList, yamlScalar } from './yaml.mjs';

const renderConfiguration = (configuration) => {
  const lines = [
    `schema_version: ${configuration.schema_version}`,
    `backend: ${yamlScalar(configuration.backend)}`,
    `frontend: ${yamlScalar(configuration.frontend)}`,
    `tracker: ${yamlScalar(configuration.tracker)}`,
    'artifacts:',
    `  srs: ${yamlScalar(configuration.artifacts.srs)}`,
    `  glossary: ${yamlScalar(configuration.artifacts.glossary)}`,
    `  adrs: ${yamlScalar(configuration.artifacts.adrs)}`,
  ];

  appendYamlList(lines, 'guidelines', configuration.guidelines);
  lines.push('source_scopes:');

  for (const scope of verificationScopes.slice(0, 2).concat('shared')) {
    appendYamlList(lines, scope, configuration.source_scopes[scope], 2);
  }

  lines.push(
    'verification:',
    `  profile: ${yamlScalar(configuration.verification.profile)}`,
  );
  appendYamlList(lines, 'capabilities', configuration.verification.capabilities, 2);
  lines.push('  commands:');

  for (const [category, commands] of Object.entries(configuration.verification.commands)) {
    lines.push(`    ${category}:`);

    for (const scope of verificationScopes) {
      appendYamlList(lines, scope, commands[scope], 6);
    }
  }

  lines.push(
    'history:',
    `  path: ${yamlScalar(configuration.history.path)}`,
    `  required: ${configuration.history.required}`,
  );
  appendYamlList(lines, 'protected_files', configuration.protected_files);

  return `${lines.join('\n')}\n`;
};

const renderDomainDocument = (configuration) => `# Domain artifacts

- SRS: ${configuration.artifacts.srs ?? 'not configured'}
- Glossary: ${configuration.artifacts.glossary ?? 'not configured'}
- ADR directory: ${configuration.artifacts.adrs ?? 'not configured'}

These paths are pointers. Read the referenced documents before changing domain
language, requirements, or durable architecture decisions.
`;

const triageDocument = `# Triage labels

| Role | Tracker label |
| --- | --- |
| needs-triage | needs-triage |
| needs-info | needs-info |
| ready-for-agent | ready-for-agent |
| ready-for-human | ready-for-human |
| wontfix | wontfix |
`;

const selectedValue = (selections, key, fallback) => (
  selections[key] === undefined ? fallback : selections[key]
);

/**
 * Base setup writes a schema v3 file from discovery. A schema v4 file holds
 * decisions discovery cannot reproduce — Command descriptors, mapped profiles,
 * the Gate section — so it is refused before discovery and before any write,
 * rather than rewritten as v3 (`FS-005`). A version above 4 is one this
 * release cannot read at all, so it is refused as unsupported rather than
 * replaced by an older one.
 */
const refuseSchemaV4 = async (projectRoot) => {
  const { schemaVersion } = await readExistingConfiguration(path.resolve(projectRoot));

  if (schemaVersion > 4) {
    throw revisionRefusal(
      'schema-unsupported',
      `.agent-framework.yaml declares schema version ${schemaVersion}, which this release of framework-setup does not support, `
        + 'and base setup writes schema version 3 from discovery: rewriting it would replace a newer contract with an older one. '
        + 'Nothing was written. Update the framework-setup skill before configuring this repository.',
    );
  }

  if (schemaVersion === 4) {
    throw revisionRefusal(
      'schema-v4-configured',
      '.agent-framework.yaml declares schema version 4, and base setup writes schema version 3 from discovery: '
        + 'rewriting it would lose its Command descriptors, its mapped profiles, and any evaluation_gate section. Nothing was written. '
        + 'Revise the Gate section by name with `agent-framework config <revision>`; any other change to a schema v4 file is the maintainer\'s own edit.',
    );
  }
};

export const configureProject = async ({ projectRoot, selections }) => {
  await refuseSchemaV4(projectRoot);

  const discovery = await discoverProject(projectRoot);
  const tracker = selections.tracker;
  const backend = selections.backend ?? discovery.backend;
  const frontend = selections.frontend ?? discovery.frontend;
  const sourceScopes = normalizeSourceScopes(
    selections.sourceScopes ?? discovery.sourceScopes,
  );

  if (!trackerAdapters.has(tracker)) {
    throw new Error(`Unsupported tracker adapter: ${tracker}`);
  }

  if (!backendProfiles.has(backend)) {
    throw new Error(`Unsupported backend profile: ${backend}`);
  }

  if (!frontendProfiles.has(frontend)) {
    throw new Error(`Unsupported frontend profile: ${frontend}`);
  }

  const protectedHashes = await hashFiles(
    discovery.projectRoot,
    discovery.protectedFiles,
  );
  const configuration = {
    schema_version: 3,
    backend,
    frontend,
    tracker,
    artifacts: {
      srs: selectedValue(
        selections,
        'srsPath',
        discovery.srsCandidates[0] ?? 'docs/specifications/srs.md',
      ),
      glossary: selectedValue(
        selections,
        'glossaryPath',
        discovery.glossaryCandidates[0] ?? null,
      ),
      adrs: selectedValue(
        selections,
        'adrPath',
        discovery.adrCandidates[0] ?? 'docs/adr',
      ),
    },
    guidelines: discovery.guidelinePaths,
    source_scopes: sourceScopes,
    verification: await discoverVerification(
      discovery.projectRoot,
      await readJson(path.join(discovery.projectRoot, 'package.json')),
      {
        backend,
        frontend,
        sourceScopes,
        scriptScopes: selections.scriptScopes,
        excludedScripts: selections.excludedScripts,
      },
    ),
    history: {
      path: selectedValue(
        selections,
        'historyPath',
        discovery.historyCandidates[0] ?? null,
      ),
      required: Boolean(selectedValue(
        selections,
        'historyPath',
        discovery.historyCandidates[0] ?? null,
      )),
    },
    protected_files: discovery.protectedFiles,
  };
  const managedFiles = [
    '.agent-framework.yaml',
    'docs/agents/issue-tracker.md',
    'docs/agents/domain.md',
    'docs/agents/triage-labels.md',
  ];

  await writeManagedFile(
    path.join(discovery.projectRoot, managedFiles[0]),
    renderConfiguration(configuration),
  );
  await writeManagedFile(
    path.join(discovery.projectRoot, managedFiles[1]),
    await readFile(adapterReferencePath(tracker), 'utf8'),
  );
  await writeManagedFile(
    path.join(discovery.projectRoot, managedFiles[2]),
    renderDomainDocument(configuration),
  );
  await writeManagedFile(
    path.join(discovery.projectRoot, managedFiles[3]),
    triageDocument,
  );

  const protectedHashesAfter = await hashFiles(
    discovery.projectRoot,
    discovery.protectedFiles,
  );

  if (JSON.stringify(protectedHashesAfter) !== JSON.stringify(protectedHashes)) {
    throw new Error('A protected AGENTS.md file changed during setup');
  }

  return {
    configuration,
    managedFiles,
    protectedFilesVerified: discovery.protectedFiles,
  };
};
