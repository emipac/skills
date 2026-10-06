import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { exists, replaceConfiguration } from '../filesystem.mjs';
import { gateSectionLines } from './section.mjs';
import { validateGatePolicy } from './validation.mjs';

const renderGateConfiguration = (contents, policy) => {
  const gateLines = gateSectionLines(policy);
  const lines = contents.trimEnd().split(/\r?\n/);
  const historyIndex = lines.findIndex((line) => line === 'history:');
  const insertionIndex = historyIndex === -1 ? lines.length : historyIndex;

  lines.splice(insertionIndex, 0, ...gateLines);

  return `${lines.join('\n')}\n`;
};

export const previewGateConfiguration = async ({ projectRoot, policy }) => {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const configurationPath = path.join(resolvedProjectRoot, '.agent-framework.yaml');

  if (!(await exists(configurationPath))) {
    throw new Error('Cannot configure the Gate without .agent-framework.yaml');
  }

  const contents = await readFile(configurationPath, 'utf8');
  const schemaVersion = Number(contents.match(/^schema_version:\s*(\d+)$/m)?.[1] ?? 0);

  if (schemaVersion !== 4) {
    throw new Error(`Gate configuration requires schema version 4, found ${schemaVersion}`);
  }

  if (/^evaluation_gate\s*:/m.test(contents)) {
    throw new Error('The Gate is already configured');
  }

  await validateGatePolicy(policy);
  const proposedConfiguration = renderGateConfiguration(contents, policy);
  const previewHash = createHash('sha256')
    .update(contents)
    .update('\0')
    .update(proposedConfiguration)
    .digest('hex');

  return {
    status: 'ready',
    configured: false,
    previewHash,
    proposedConfiguration,
  };
};

export const configureGate = async ({
  projectRoot,
  policy,
  confirmation,
}) => {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const preview = await previewGateConfiguration({ projectRoot: resolvedProjectRoot, policy });

  if (confirmation !== preview.previewHash) {
    throw new Error('Gate configuration confirmation does not match the current preview');
  }

  await replaceConfiguration(resolvedProjectRoot, preview.proposedConfiguration);

  return {
    status: 'configured',
    activated: false,
    previewHash: preview.previewHash,
  };
};
