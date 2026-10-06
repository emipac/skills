import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

const destinations = Object.freeze([
  '.agent-framework.yaml', 'docs/agents/issue-tracker.md', 'docs/agents/domain.md', 'docs/agents/triage-labels.md',
]);
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const identity = async (root, file) => {
  try {
    return createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

const destinationIdentities = async (root) => {
  const paths = {};
  for (const file of destinations) {
    const components = file.split('/');
    for (let length = 1; length <= components.length; length += 1) {
      const relative = components.slice(0, length).join('/');
      if (Object.hasOwn(paths, relative)) continue;
      try {
        const entry = await lstat(path.join(root, relative));
        // Managed destinations must use ordinary project paths. Rejecting links
        // also prevents an ancestor swap from redirecting a reviewed write.
        if (entry.isSymbolicLink() || (length < components.length && !entry.isDirectory())
          || (length === components.length && !entry.isFile())) return null;
        paths[relative] = { device: entry.dev, inode: entry.ino, type: entry.isDirectory() ? 'directory' : 'file' };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        paths[relative] = null;
      }
    }
  }
  return paths;
};

const unsafeDestination = () => ({ status: 'refused', reasonCode: 'unsafe-destination', detail: 'Framework destinations must be ordinary paths inside this project. Remove linked or invalid destination paths before setup.' });

export const hasConfiguration = async (root) => {
  try {
    await lstat(path.join(root, '.agent-framework.yaml'));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};

export const publicDiscovery = (discovery) => Object.fromEntries([
  'projectRoot', 'backend', 'frontend', 'sourceScopes', 'recommendedTracker', 'protectedFiles',
  'guidelinePaths', 'srsCandidates', 'glossaryCandidates', 'adrCandidates', 'historyCandidates',
].map((key) => [key, discovery[key]]));

export const baseSetup = async ({ projectRoot, fields, confirmation, discoverProject, configureProject }) => {
  if (await hasConfiguration(projectRoot)) return { status: 'refused', reasonCode: 'configuration-exists', detail: 'This project already has Framework configuration. Use migration or configuration revisions.' };
  const paths = await destinationIdentities(projectRoot);
  if (paths === null) return unsafeDestination();
  const discovery = await discoverProject(projectRoot);
  const selections = { tracker: fields.tracker, backend: fields.backend ?? discovery.backend, frontend: fields.frontend ?? discovery.frontend };
  const files = [...new Set([...destinations, ...discovery.protectedFiles, 'package.json', 'composer.json'])];
  const identities = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await identity(projectRoot, file)])));
  const previewHash = createHash('sha256').update(canonical({ projectRoot, discovery, selections, identities, paths })).digest('hex');
  const preview = { status: 'ready', previewHash, selections, destinations: [...destinations], discovery: publicDiscovery(discovery) };
  if (confirmation === null) return preview;
  if (confirmation !== previewHash) return { status: 'refused', reasonCode: 'confirmation-mismatch', detail: 'The reviewed setup no longer matches this project. Preview it again.' };
  if (await hasConfiguration(projectRoot)) return { status: 'refused', reasonCode: 'configuration-exists', detail: 'Configuration appeared after the preview. Nothing was written.' };
  const currentPaths = await destinationIdentities(projectRoot);
  if (currentPaths === null) return unsafeDestination();
  if (canonical(paths) !== canonical(currentPaths)) return { status: 'refused', reasonCode: 'confirmation-mismatch', detail: 'The destination paths changed. Preview setup again.' };
  return { status: 'configured', previewHash, result: await configureProject({ projectRoot, selections }) };
};
