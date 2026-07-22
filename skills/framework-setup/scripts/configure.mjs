import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const trackerAdapters = new Set([
  'local-markdown',
  'github',
  'jira',
  'linear',
]);
const backendProfiles = new Set(['laravel', 'unknown']);
const frontendProfiles = new Set([
  'livewire',
  'react-typescript',
  'svelte-typescript',
  'none',
  'unknown',
]);
const ignoredDirectories = new Set(['.git', 'node_modules', 'vendor']);

const exists = async (filePath) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const readJson = async (filePath) => {
  if (!(await exists(filePath))) {
    return {};
  }

  return JSON.parse(await readFile(filePath, 'utf8'));
};

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

const sortUnique = (values) => [...new Set(values)].sort();

const detectPackageManager = async (projectRoot) => {
  for (const [lockfile, packageManager] of [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm'],
  ]) {
    if (await exists(path.join(projectRoot, lockfile))) {
      return packageManager;
    }
  }

  return 'npm';
};

const packageScriptCommand = (packageManager, script) => {
  if (packageManager === 'yarn') {
    return `yarn ${script}`;
  }

  return `${packageManager} run ${script}`;
};

export const discoverVerification = async (
  projectRoot,
  packageManifest,
  { backend, frontend },
) => {
  const commands = {
    format: [],
    static_analysis: [],
    test: [],
    smoke: [],
    build: [],
    e2e: [],
  };
  const capabilities = new Set();
  const detectedFiles = [
    [
      'vendor/bin/pint',
      'format',
      'vendor/bin/pint --dirty --format agent',
      'laravel-format',
    ],
    [
      'vendor/bin/phpstan',
      'static_analysis',
      'vendor/bin/phpstan analyse',
      'laravel-static-analysis',
    ],
    ['artisan', 'test', 'php artisan test --compact', 'laravel-tests'],
  ];

  for (const [relativePath, category, command, capability] of detectedFiles) {
    if (await exists(path.join(projectRoot, relativePath))) {
      commands[category].push(command);
      capabilities.add(capability);
    }
  }

  const scriptCategories = {
    format: ['format', 'frontend-format'],
    lint: ['static_analysis', 'frontend-lint'],
    typecheck: ['static_analysis', 'typescript'],
    'type-check': ['static_analysis', 'typescript'],
    test: ['test', 'frontend-tests'],
    smoke: ['smoke', 'smoke-tests'],
    build: ['build', 'frontend-build'],
    e2e: ['e2e', 'frontend-e2e'],
    'test:e2e': ['e2e', 'frontend-e2e'],
  };
  const packageManager = await detectPackageManager(projectRoot);

  for (const [script, [category, capability]] of Object.entries(scriptCategories)) {
    if (packageManifest.scripts?.[script]) {
      commands[category].push(packageScriptCommand(packageManager, script));
      capabilities.add(capability);
    }
  }

  const profile = frontend === 'none' ? backend : `${backend}-${frontend}`;

  return {
    profile,
    capabilities: sortUnique(capabilities),
    commands,
  };
};

const discoverFrontend = (composerPackages, nodePackages) => {
  if (nodePackages.svelte && nodePackages.typescript) {
    return 'svelte-typescript';
  }

  if (nodePackages.react && nodePackages.typescript) {
    return 'react-typescript';
  }

  if (composerPackages['livewire/livewire']) {
    return 'livewire';
  }

  if (Object.keys(nodePackages).length === 0) {
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
  const backend = composerPackages['laravel/framework'] ? 'laravel' : 'unknown';
  const frontend = discoverFrontend(composerPackages, nodePackages);

  return {
    projectRoot: resolvedRoot,
    backend,
    frontend,
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
      { backend, frontend },
    ),
  };
};

const yamlScalar = (value) => {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }

  return /^[a-z0-9_./-]+$/i.test(value) ? value : JSON.stringify(value);
};

const yamlList = (values, indentation = 2) => {
  return values
    .map((value) => `${' '.repeat(indentation)}- ${yamlScalar(value)}`)
    .join('\n');
};

const appendYamlList = (lines, key, values, indentation = 0) => {
  const prefix = ' '.repeat(indentation);

  if (values.length === 0) {
    lines.push(`${prefix}${key}: []`);
    return;
  }

  lines.push(`${prefix}${key}:`);
  lines.push(yamlList(values, indentation + 2));
};

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
  lines.push(
    'verification:',
    `  profile: ${yamlScalar(configuration.verification.profile)}`,
  );
  appendYamlList(lines, 'capabilities', configuration.verification.capabilities, 2);
  lines.push('  commands:');

  for (const [category, commands] of Object.entries(configuration.verification.commands)) {
    appendYamlList(lines, category, commands, 4);
  }

  lines.push(
    'history:',
    `  path: ${yamlScalar(configuration.history.path)}`,
    `  required: ${configuration.history.required}`,
  );
  appendYamlList(lines, 'protected_files', configuration.protected_files);

  return `${lines.join('\n')}\n`;
};

const hashFiles = async (projectRoot, relativePaths) => Object.fromEntries(
  await Promise.all(relativePaths.map(async (relativePath) => [
    relativePath,
    createHash('sha256')
      .update(await readFile(path.join(projectRoot, relativePath)))
      .digest('hex'),
  ])),
);

const writeManagedFile = async (filePath, contents) => {
  await mkdir(path.dirname(filePath), { recursive: true });

  if ((await exists(filePath)) && await readFile(filePath, 'utf8') === contents) {
    return;
  }

  await writeFile(filePath, contents);
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

const adapterReferencePath = (tracker) => fileURLToPath(
  new URL(`../references/tracker-${tracker}.md`, import.meta.url),
);

const selectedValue = (selections, key, fallback) => (
  selections[key] === undefined ? fallback : selections[key]
);

export const configureProject = async ({ projectRoot, selections }) => {
  const discovery = await discoverProject(projectRoot);
  const tracker = selections.tracker;
  const backend = selections.backend ?? discovery.backend;
  const frontend = selections.frontend ?? discovery.frontend;

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
    schema_version: 2,
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
    verification: discovery.verification,
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

const parseArguments = (argumentsList) => {
  const options = {};

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if (argument === '--discover') {
      options.discover = true;
      continue;
    }

    if (argument.startsWith('--')) {
      options[argument.slice(2)] = argumentsList[index + 1];
      index += 1;
    }
  }

  return options;
};

const nullableArgument = (value) => value === 'null' ? null : value;

const runCli = async () => {
  const options = parseArguments(process.argv.slice(2));
  const projectRoot = options.project ?? process.cwd();

  if (options.discover) {
    console.log(JSON.stringify(await discoverProject(projectRoot), null, 2));
    return;
  }

  if (!options.tracker) {
    throw new Error('--tracker is required when configuring a project');
  }

  const result = await configureProject({
    projectRoot,
    selections: {
      tracker: options.tracker,
      srsPath: nullableArgument(options.srs),
      glossaryPath: nullableArgument(options.glossary),
      adrPath: nullableArgument(options.adrs),
      historyPath: nullableArgument(options.history),
      backend: options.backend,
      frontend: options.frontend,
    },
  });

  console.log(JSON.stringify(result, null, 2));
};

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await runCli();
}
