import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { readExistingConfiguration } from '../configuration-read.mjs';
import { discoverSourceScopes } from './scopes.mjs';
import { discoverVerification } from './verification.mjs';
import { exists, readJson } from '../filesystem.mjs';
import { sortUnique } from '../values.mjs';

const ignoredDirectories = new Set(['.git', 'node_modules', 'vendor']);

const readGitRemotes = async (projectRoot) => {
  const configPath = path.join(projectRoot, '.git', 'config');

  if (!(await exists(configPath))) {
    return [];
  }

  const remotes = [];
  let currentRemote = null;

  for (const line of (await readFile(configPath, 'utf8')).split('\n')) {
    const sectionMatch = line.match(/^\s*\[remote "([^"]+)"\]\s*$/);

    if (sectionMatch) {
      currentRemote = { name: sectionMatch[1], url: null };
      remotes.push(currentRemote);
      continue;
    }

    const urlMatch = line.match(/^\s*url\s*=\s*(.+)\s*$/);

    if (currentRemote && urlMatch) {
      currentRemote.url = urlMatch[1];
    }
  }

  return remotes.filter((remote) => remote.url);
};

const walkFiles = async (directory, projectRoot, files = []) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await walkFiles(entryPath, projectRoot, files);
    } else {
      files.push(path.relative(projectRoot, entryPath));
    }
  }

  return files;
};

const discoverFrontend = (composerPackages, nodePackages, backend) => {
  if (nodePackages.svelte && nodePackages.typescript) {
    return 'svelte-typescript';
  }

  if (nodePackages.react && nodePackages.typescript) {
    return 'react-typescript';
  }

  if (composerPackages['livewire/livewire']) {
    return 'livewire';
  }

  if (backend === 'express-typescript' || Object.keys(nodePackages).length === 0) {
    return 'none';
  }

  return 'unknown';
};

export const discoverProject = async (projectRoot) => {
  const resolvedRoot = path.resolve(projectRoot);
  const allFiles = await walkFiles(resolvedRoot, resolvedRoot);
  const composerManifest = await readJson(path.join(resolvedRoot, 'composer.json'));
  const packageManifest = await readJson(path.join(resolvedRoot, 'package.json'));
  const gitRemotes = await readGitRemotes(resolvedRoot);
  const existingConfiguration = await readExistingConfiguration(resolvedRoot);
  const composerPackages = {
    ...composerManifest.require,
    ...composerManifest['require-dev'],
  };
  const nodePackages = {
    ...packageManifest.dependencies,
    ...packageManifest.devDependencies,
  };
  const protectedFiles = allFiles.filter(
    (filePath) => path.basename(filePath) === 'AGENTS.md',
  );
  const guidelinePaths = allFiles.filter((filePath) => {
    const basename = path.basename(filePath);

    return [
      'AGENTS.md',
      'CLAUDE.md',
      'project-guidelines.md',
    ].includes(basename) || filePath.startsWith(`docs${path.sep}conventions${path.sep}`);
  });
  const markdownFiles = allFiles.filter((filePath) => filePath.endsWith('.md'));
  const hasTypeScriptConfiguration = allFiles.some(
    (filePath) => /^tsconfig(?:\.[^/]+)?\.json$/i.test(filePath),
  );
  const backend = composerPackages['laravel/framework']
    ? 'laravel'
    : nodePackages.express && nodePackages.typescript && hasTypeScriptConfiguration
      ? 'express-typescript'
      : 'unknown';
  const frontend = discoverFrontend(composerPackages, nodePackages, backend);
  const sourceScopes = existingConfiguration.sourceScopes
    ?? discoverSourceScopes(allFiles, backend, frontend);

  return {
    projectRoot: resolvedRoot,
    backend,
    frontend,
    sourceScopes,
    existingConfiguration,
    gitRemotes,
    recommendedTracker: gitRemotes.some((remote) => /github\.com[:/]/i.test(remote.url))
      ? 'github'
      : 'local-markdown',
    protectedFiles: sortUnique(protectedFiles),
    guidelinePaths: sortUnique(guidelinePaths),
    srsCandidates: sortUnique(
      markdownFiles.filter((filePath) => /(?:^|[^a-z])srs(?:[^a-z]|$)/i.test(filePath)),
    ),
    glossaryCandidates: sortUnique(
      markdownFiles.filter((filePath) => /glossar/i.test(filePath)),
    ),
    adrCandidates: sortUnique(
      allFiles
        .filter((filePath) => /(?:^|\/)adr(?:s)?\//i.test(filePath))
        .map((filePath) => path.dirname(filePath)),
    ),
    historyCandidates: sortUnique(
      allFiles
        .filter((filePath) => /(?:^|\/)history\//i.test(filePath))
        .map((filePath) => path.dirname(filePath)),
    ),
    verification: await discoverVerification(
      resolvedRoot,
      packageManifest,
      { backend, frontend, sourceScopes },
    ),
  };
};
