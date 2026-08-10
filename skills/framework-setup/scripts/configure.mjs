import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
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
const backendProfiles = new Set(['laravel', 'express-typescript', 'unknown']);
const frontendProfiles = new Set([
  'livewire',
  'react-typescript',
  'svelte-typescript',
  'none',
  'unknown',
]);
const backendProfilesV4 = new Set([...backendProfiles, 'none']);
const commandRunners = new Set([
  'composer-bin',
  'php-script',
  'package-script',
  'repository-script',
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

const readExistingConfiguration = async (projectRoot) => {
  const configurationPath = path.join(projectRoot, '.agent-framework.yaml');

  if (!(await exists(configurationPath))) {
    return {
      schemaVersion: null,
      backend: null,
      frontend: null,
      sourceScopes: null,
    };
  }

  const contents = await readFile(configurationPath, 'utf8');
  const schemaVersion = Number(contents.match(/^schema_version:\s*(\d+)$/m)?.[1] ?? 0);
  const backend = parseYamlScalar(contents.match(/^backend:\s*(.+)$/m)?.[1] ?? 'unknown');
  const frontend = parseYamlScalar(contents.match(/^frontend:\s*(.+)$/m)?.[1] ?? 'unknown');
  const sourceScopes = { backend: [], frontend: [], shared: [] };
  let inSourceScopes = false;
  let currentScope = null;

  for (const line of contents.split(/\r?\n/)) {
    if (line === 'source_scopes:') {
      inSourceScopes = true;
      continue;
    }

    if (inSourceScopes && line && !line.startsWith(' ')) {
      break;
    }

    const scope = line.match(/^  (backend|frontend|shared):(?:\s*\[\])?$/);

    if (inSourceScopes && scope) {
      currentScope = scope[1];
      continue;
    }

    const root = line.match(/^    -\s+(.+)$/);

    if (inSourceScopes && currentScope && root) {
      sourceScopes[currentScope].push(root[1].replace(/^"|"$/g, ''));
    }
  }

  return {
    schemaVersion: schemaVersion || null,
    backend,
    frontend,
    sourceScopes: schemaVersion >= 3 ? sourceScopes : null,
  };
};

const parseYamlScalar = (value) => {
  const trimmed = value.trim();

  return trimmed.startsWith('"') ? JSON.parse(trimmed) : trimmed;
};

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

const inferredCommandDescriptor = (command) => {
  const packageScript = command.match(/^(npm|pnpm|bun) run ([a-zA-Z0-9:_-]+)$/)
    ?? command.match(/^yarn ([a-zA-Z0-9:_-]+)$/);

  if (packageScript) {
    return {
      runner: 'package-script',
      args: [packageScript.at(-1)],
    };
  }

  const safeCommand = /^[a-zA-Z0-9_./:=@-]+(?:\s+[a-zA-Z0-9_./:=@-]+)*$/;

  if (!safeCommand.test(command)) {
    return null;
  }

  const composerBinary = command.match(/^(?:\.\/)?vendor\/bin\/([a-zA-Z0-9_.-]+)(?:\s+(.+))?$/);

  if (composerBinary) {
    return {
      runner: 'composer-bin',
      args: [composerBinary[1], ...(composerBinary[2]?.split(' ') ?? [])],
    };
  }

  const phpScript = command.match(/^php\s+(.+)$/);

  if (phpScript) {
    return {
      runner: 'php-script',
      args: phpScript[1].split(' '),
    };
  }

  return null;
};

const migrationAmbiguities = (configuration, mappings) => {
  const ambiguities = [];

  for (const profile of ['backend', 'frontend']) {
    if (configuration[profile] === 'unknown' && !mappings.profiles?.[profile]) {
      ambiguities.push({
        path: profile,
        value: 'unknown',
        required: ['profile'],
      });
    }
  }

  for (const command of configuration.commands) {
    const commandPath = `verification.commands.${command.category}.${command.scope}[${command.index}]`;
    const mapping = mappings.commands?.[commandPath] ?? {};
    const inferredDescriptor = inferredCommandDescriptor(command.value);
    const required = [];

    if (!inferredDescriptor && !mapping.runner) {
      required.push('runner');
    }

    if (!inferredDescriptor && !Array.isArray(mapping.args)) {
      required.push('args');
    }

    if (!Number.isInteger(mapping.timeout_seconds) || mapping.timeout_seconds <= 0) {
      required.push('timeout_seconds');
    }

    if (required.length > 0) {
      ambiguities.push({
        path: commandPath,
        value: command.value,
        required,
      });
    }
  }

  return ambiguities;
};

const validateCommandWorkingDirectory = (workingDirectory) => {
  const isInvalid = typeof workingDirectory !== 'string'
    || !workingDirectory
    || workingDirectory.includes('\\')
    || path.posix.isAbsolute(workingDirectory)
    || path.win32.isAbsolute(workingDirectory)
    || workingDirectory.split('/').includes('..');

  if (isInvalid) {
    throw new Error(`Invalid command working directory: ${String(workingDirectory)}`);
  }
};

const validateMigrationMappings = (configuration, mappings) => {
  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) {
    throw new Error('Migration mappings must be an object');
  }

  const unsupportedSection = Object.keys(mappings).find(
    (section) => !['profiles', 'commands'].includes(section),
  );

  if (unsupportedSection) {
    throw new Error(`Unsupported migration mapping section: ${unsupportedSection}`);
  }

  for (const section of ['profiles', 'commands']) {
    const value = mappings[section];

    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
      throw new Error(`Migration mapping ${section} must be an object`);
    }
  }

  for (const [profile, value] of Object.entries(mappings.profiles ?? {})) {
    if (!['backend', 'frontend'].includes(profile)) {
      throw new Error(`Unsupported profile mapping: ${profile}`);
    }

    if (configuration[profile] !== 'unknown') {
      throw new Error(
        `Profile mapping for ${profile} is only allowed when its schema v3 value is unknown`,
      );
    }

    const supportedProfiles = profile === 'backend' ? backendProfilesV4 : frontendProfiles;

    if (!supportedProfiles.has(value)) {
      throw new Error(`Unsupported ${profile} profile mapping: ${String(value)}`);
    }
  }

  const commandPaths = new Set(configuration.commands.map(
    (command) => `verification.commands.${command.category}.${command.scope}[${command.index}]`,
  ));

  for (const [commandPath, mapping] of Object.entries(mappings.commands ?? {})) {
    if (!commandPaths.has(commandPath)) {
      throw new Error(`Unknown command mapping: ${commandPath}`);
    }

    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
      throw new Error(`Command mapping must be an object: ${commandPath}`);
    }

    const allowedKeys = new Set([
      'runner',
      'args',
      'working_directory',
      'timeout_seconds',
      'allowed_environment',
    ]);
    const unsupportedKey = Object.keys(mapping).find((key) => !allowedKeys.has(key));

    if (unsupportedKey) {
      throw new Error(`Unsupported command mapping field: ${unsupportedKey}`);
    }

    if (mapping.runner !== undefined && !commandRunners.has(mapping.runner)) {
      throw new Error(`Unsupported command runner: ${String(mapping.runner)}`);
    }

    if (
      mapping.args !== undefined
      && (!Array.isArray(mapping.args)
        || mapping.args.length === 0
        || mapping.args.some((argument) => typeof argument !== 'string'))
    ) {
      throw new Error(`Invalid command arguments: ${commandPath}`);
    }

    if (mapping.working_directory !== undefined) {
      validateCommandWorkingDirectory(mapping.working_directory);
    }

    if (
      mapping.timeout_seconds !== undefined
      && (!Number.isInteger(mapping.timeout_seconds) || mapping.timeout_seconds <= 0)
    ) {
      throw new Error(`Invalid command timeout: ${commandPath}`);
    }

    if (
      mapping.allowed_environment !== undefined
      && (!Array.isArray(mapping.allowed_environment)
        || new Set(mapping.allowed_environment).size !== mapping.allowed_environment.length
        || mapping.allowed_environment.some(
          (name) => typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name),
        ))
    ) {
      throw new Error(`Invalid allowed environment names: ${commandPath}`);
    }
  }
};

const verificationProfile = (backend, frontend) => {
  if (backend === 'none' && frontend === 'none') {
    return 'tooling';
  }

  if (backend === 'none') {
    return frontend;
  }

  return frontend === 'none' ? backend : `${backend}-${frontend}`;
};

const migratedCommandDescriptor = (command, mappings) => {
  const commandPath = `verification.commands.${command.category}.${command.scope}[${command.index}]`;
  const mapping = mappings.commands?.[commandPath] ?? {};
  const inferredDescriptor = inferredCommandDescriptor(command.value) ?? {};

  return {
    runner: mapping.runner ?? inferredDescriptor.runner,
    args: mapping.args ?? inferredDescriptor.args,
    working_directory: mapping.working_directory ?? '.',
    timeout_seconds: mapping.timeout_seconds,
    allowed_environment: mapping.allowed_environment ?? [],
    evidence_category: command.category,
    source_scope: command.scope,
  };
};

const renderMigratedConfiguration = (contents, configuration, mappings) => {
  const backend = mappings.profiles?.backend ?? configuration.backend;
  const frontend = mappings.profiles?.frontend ?? configuration.frontend;
  const commandLines = new Map(configuration.commands.map((command) => [
    command.lineIndex,
    `        - ${JSON.stringify(migratedCommandDescriptor(command, mappings))}`,
  ]));

  return contents.split(/\r?\n/).map((line, lineIndex) => {
    if (commandLines.has(lineIndex)) {
      return commandLines.get(lineIndex);
    }

    if (/^schema_version:/.test(line)) {
      return 'schema_version: 4';
    }

    if (/^backend:/.test(line)) {
      return `backend: ${yamlScalar(backend)}`;
    }

    if (/^frontend:/.test(line)) {
      return `frontend: ${yamlScalar(frontend)}`;
    }

    if (/^  profile:/.test(line)) {
      return `  profile: ${yamlScalar(verificationProfile(backend, frontend))}`;
    }

    return line;
  }).join('\n');
};

const validateMigratedProfilePresence = (configuration, mappings) => {
  const backend = mappings.profiles?.backend ?? configuration.backend;
  const frontend = mappings.profiles?.frontend ?? configuration.frontend;

  for (const [profile, value] of Object.entries({ backend, frontend })) {
    if (value !== 'none') {
      continue;
    }

    const hasProfileScopes = configuration.sourceScopes[profile].length > 0;
    const hasProfileCommands = configuration.commands.some(
      (command) => command.scope === profile,
    );

    if (hasProfileScopes || hasProfileCommands) {
      const title = profile[0].toUpperCase() + profile.slice(1);

      throw new Error(
        `${title} profile none cannot retain ${profile} source scopes or commands`,
      );
    }
  }
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
const verificationCategories = [
  'format',
  'static_analysis',
  'test',
  'smoke',
  'build',
  'e2e',
];
const verificationScopes = ['backend', 'frontend', 'both'];

const emptyScopedCommands = () => Object.fromEntries(
  verificationCategories.map((category) => [
    category,
    { backend: [], frontend: [], both: [] },
  ]),
);

const hasFilesUnder = (files, root) => files.some((file) => (
  (file === root || file.startsWith(`${root}${path.sep}`))
  && /\.(?:(?:c|m)?(?:js|ts)x?|svelte|php|blade\.php)$/i.test(file)
));

const existingRoots = (files, candidates) => candidates.filter(
  (candidate) => hasFilesUnder(files, candidate),
);

const discoverSourceScopes = (files, backend, frontend) => {
  const backendCandidates = existingRoots(
    files,
    backend === 'laravel'
      ? [
          'app',
          'bootstrap',
          'config',
          'database',
          'routes',
          'tests',
          path.join('resources', 'views'),
        ]
      : [
          'server',
          'backend',
          'api',
          'database',
          path.join('src', 'server'),
          path.join('src', 'backend'),
          path.join('src', 'api'),
        ],
  );
  const frontendCandidates = existingRoots(files, [
    'client',
    'frontend',
    path.join('src', 'client'),
    path.join('src', 'frontend'),
    path.join('resources', 'js'),
  ]);
  const shared = existingRoots(files, ['shared', path.join('src', 'shared')]);

  if (backend === 'express-typescript' && backendCandidates.length === 0) {
    const sourceRoot = existingRoots(files, ['src']);

    if (sourceRoot.length > 0 && frontend === 'none') {
      backendCandidates.push(...sourceRoot);
    }
  }

  if (
    ['react-typescript', 'svelte-typescript'].includes(frontend)
    && frontendCandidates.length === 0
  ) {
    frontendCandidates.push(...existingRoots(files, ['src']));
  }

  return {
    backend: sortUnique(backendCandidates),
    frontend: sortUnique(frontendCandidates),
    shared: sortUnique(shared),
  };
};

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
  {
    backend,
    frontend,
    sourceScopes,
    scriptScopes = {},
    excludedScripts = [],
  },
) => {
  const commands = emptyScopedCommands();
  const capabilities = new Set();
  const excludedScriptNames = new Set(excludedScripts);
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
      commands[category].backend.push(command);
      capabilities.add(capability);
    }
  }

  const scriptCategories = {
    format: 'format',
    lint: 'static_analysis',
    typecheck: 'static_analysis',
    'type-check': 'static_analysis',
    test: 'test',
    smoke: 'smoke',
    build: 'build',
    e2e: 'e2e',
  };
  const safeQualifiers = {
    format: new Set(['check', 'server', 'backend', 'client', 'frontend']),
    lint: new Set(['check', 'server', 'backend', 'client', 'frontend']),
    typecheck: new Set(['server', 'backend', 'client', 'frontend']),
    'type-check': new Set(['server', 'backend', 'client', 'frontend']),
    test: new Set([
      'unit',
      'integration',
      'server',
      'backend',
      'client',
      'frontend',
      'e2e',
    ]),
    smoke: null,
    build: new Set(['server', 'backend', 'client', 'frontend']),
    e2e: new Set(['server', 'backend', 'client', 'frontend']),
  };
  const unsafeQualifiers = new Set(['coverage', 'dev', 'fix', 'only', 'watch', 'write']);
  const packageManager = await detectPackageManager(projectRoot);
  const escapeRegularExpression = (value) => (
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  const commandMentionsRoot = (command, root) => {
    const normalizedCommand = command.replaceAll('\\', '/');
    const normalizedRoot = root.replaceAll('\\', '/').replace(/^\.\/|\/$/g, '');

    return new RegExp(
      `(?:^|[\\s"'=:(])${escapeRegularExpression(normalizedRoot)}(?:/|\\b)`,
    ).test(normalizedCommand);
  };
  const commandScope = (command) => {
    if (!sourceScopes) {
      return null;
    }

    const backendMatch = sourceScopes.backend.some(
      (root) => commandMentionsRoot(command, root),
    );
    const frontendMatch = sourceScopes.frontend.some(
      (root) => commandMentionsRoot(command, root),
    );
    const sharedMatch = sourceScopes.shared.some(
      (root) => commandMentionsRoot(command, root),
    );

    if (sharedMatch || (backendMatch && frontendMatch)) {
      return 'both';
    }

    if (backendMatch) {
      return 'backend';
    }

    return frontendMatch ? 'frontend' : null;
  };
  const explicitScope = (script, command) => {
    if (scriptScopes[script]) {
      return scriptScopes[script];
    }

    const parts = script.split(':');

    if (parts.includes('server') || parts.includes('backend')) {
      return 'backend';
    }

    if (parts.includes('client') || parts.includes('frontend')) {
      return 'frontend';
    }

    const inferredCommandScope = commandScope(command);

    if (inferredCommandScope) {
      return inferredCommandScope;
    }

    if (backend === 'express-typescript' && frontend === 'none') {
      return 'backend';
    }

    if (backend === 'express-typescript' && frontend !== 'none') {
      return 'both';
    }

    return frontend === 'none' ? 'backend' : 'frontend';
  };
  const categoryForScript = (script) => {
    const parts = script.split(':');
    const base = parts[0];
    const qualifiers = parts.slice(1);

    if (!Object.hasOwn(scriptCategories, base)) {
      return null;
    }

    if (scriptScopes[script]) {
      return qualifiers.includes('e2e') ? 'e2e' : scriptCategories[base];
    }

    if (qualifiers.some((qualifier) => unsafeQualifiers.has(qualifier))) {
      return null;
    }

    const allowedQualifiers = safeQualifiers[base];

    if (
      allowedQualifiers
      && qualifiers.some((qualifier) => !allowedQualifiers.has(qualifier))
    ) {
      return null;
    }

    if (
      script === 'format'
      && Object.hasOwn(packageManifest.scripts ?? {}, 'format:check')
    ) {
      return null;
    }

    return qualifiers.includes('e2e') ? 'e2e' : scriptCategories[base];
  };
  const addPackageCapability = (category, scope, script) => {
    if (['typecheck', 'type-check'].some((name) => script.split(':').includes(name))) {
      capabilities.add('typescript');
      return;
    }

    const capabilitySuffix = {
      format: 'format',
      static_analysis: 'lint',
      test: 'tests',
      smoke: 'smoke',
      build: 'build',
      e2e: 'e2e',
    }[category];

    if (scope !== 'frontend' && backend === 'express-typescript') {
      capabilities.add(`express-${capabilitySuffix}`);
    }

    if (scope !== 'backend' && frontend !== 'none') {
      capabilities.add(`frontend-${capabilitySuffix}`);
    }
  };

  for (const [script, scriptCommand] of Object.entries(packageManifest.scripts ?? {})) {
    if (excludedScriptNames.has(script)) {
      continue;
    }

    const category = categoryForScript(script);

    if (!category) {
      continue;
    }

    const scope = explicitScope(script, scriptCommand);

    if (!verificationScopes.includes(scope)) {
      throw new Error(`Unsupported scope for package script ${script}: ${scope}`);
    }

    commands[category][scope].push(packageScriptCommand(packageManager, script));
    addPackageCapability(category, scope, script);
  }

  const profile = frontend === 'none' ? backend : `${backend}-${frontend}`;

  return {
    profile,
    capabilities: sortUnique(capabilities),
    commands,
  };
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

const normalizeSourceScopes = (sourceScopes) => Object.fromEntries(
  ['backend', 'frontend', 'shared'].map((scope) => {
    const roots = sourceScopes?.[scope];

    if (!Array.isArray(roots)) {
      throw new Error(`Source scope ${scope} must be an array`);
    }

    return [
      scope,
      sortUnique(roots.map((root) => {
        if (typeof root !== 'string') {
          throw new Error(`Invalid ${scope} source root: ${String(root)}`);
        }

        const normalized = root.replaceAll('\\', '/').replace(/^\.\/|\/$/g, '');

        if (
          !normalized
          || path.posix.isAbsolute(normalized)
          || normalized.split('/').includes('..')
        ) {
          throw new Error(`Invalid ${scope} source root: ${root}`);
        }

        return normalized;
      })),
    ];
  }),
);

export const configureProject = async ({ projectRoot, selections }) => {
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

const parseArguments = (argumentsList) => {
  const options = {};

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if (['--discover', '--migrate-v4'].includes(argument)) {
      options[argument.slice(2)] = true;
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
const listArgument = (value) => (
  value === undefined || value === ''
    ? []
    : value.split(',').map((item) => item.trim()).filter(Boolean)
);
const sourceScopeArguments = (options) => (
  ['backend-scopes', 'frontend-scopes', 'shared-scopes']
    .some((key) => options[key] !== undefined)
    ? {
        backend: listArgument(options['backend-scopes']),
        frontend: listArgument(options['frontend-scopes']),
        shared: listArgument(options['shared-scopes']),
      }
    : undefined
);
const scriptScopeArguments = (options) => Object.fromEntries(
  ['backend', 'frontend', 'both'].flatMap((scope) => (
    listArgument(options[`${scope}-scripts`]).map((script) => [script, scope])
  )),
);

const runCli = async () => {
  const options = parseArguments(process.argv.slice(2));
  const projectRoot = options.project ?? process.cwd();

  if (options.discover) {
    console.log(JSON.stringify(await discoverProject(projectRoot), null, 2));
    return;
  }

  if (options['migrate-v4']) {
    if (!options.mapping) {
      throw new Error('--mapping is required when migrating to schema v4');
    }

    const mappings = JSON.parse(await readFile(path.resolve(options.mapping), 'utf8'));
    const migrationOptions = { projectRoot, mappings };
    const result = options.confirm
      ? await migrateConfiguration({ ...migrationOptions, confirmation: options.confirm })
      : await previewConfigurationMigration(migrationOptions);

    console.log(JSON.stringify(result, null, 2));
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
      sourceScopes: sourceScopeArguments(options),
      scriptScopes: scriptScopeArguments(options),
      excludedScripts: listArgument(options['exclude-scripts']),
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
