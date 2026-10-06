import { execFile } from 'node:child_process';
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
import { fileURLToPath } from 'node:url';
import { isCliEntryPoint } from './lib/cli-entry-point.mjs';

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

/**
 * Emit one draft.
 *
 * Drafting is a read plus a document. It only ever touches the filesystem when
 * an explicit `--out` names a path, and it refuses rather than overwriting a
 * file the maintainer already filled in.
 */
const emitDraft = async (draft, out) => {
  if (!out) {
    return draft;
  }

  const target = path.resolve(out);

  try {
    await writeFile(target, `${JSON.stringify(draft, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Refusing to overwrite a draft: ${target} already exists`);
    }

    throw error;
  }

  return draft;
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

/**
 * Which provider module speaks for which proved stack.
 *
 * This is a module table, not a check catalogue. `framework-setup` learns from
 * it only where to ask; every check identity and every default binding is read
 * back out of the provider's own declared plan, so a provider that changes its
 * checks changes this draft with no edit here (SG-OWNER-001).
 */
const gateProviderModules = Object.freeze({
  laravel: '../../change-evaluation-gate/scripts/lib/providers/laravel.mjs',
  node: '../../change-evaluation-gate/scripts/lib/providers/node-package.mjs',
});

/** The backend profile a Gate draft is derived for: configured, else discovered. */
const resolveDraftBackend = async (projectRoot) => {
  const existing = await readExistingConfiguration(projectRoot);

  return existing.backend && existing.backend !== 'unknown'
    ? existing.backend
    : (await discoverProject(projectRoot)).backend;
};

const resolveDraftProvider = async (projectRoot) => {
  const backend = await resolveDraftBackend(projectRoot);
  const specifier = backend === 'laravel'
    ? gateProviderModules.laravel
    : (await exists(path.join(path.resolve(projectRoot), 'package.json'))
      ? gateProviderModules.node
      : null);

  if (!specifier) {
    throw new Error('No verification provider matches this project; a Gate policy cannot be drafted');
  }

  return (await import(specifier)).default;
};

/**
 * The total evaluation budget, summed from the timeouts this project proved.
 *
 * A schema v4 configuration states an exact timeout for every command it owns,
 * so their total is a derived project fact rather than a default. A project
 * that has proved none leaves the budget `null`, and a `null` budget is refused
 * by `--policy` rather than silently replaced with a plausible number.
 */
const derivedBudgetSeconds = async (projectRoot) => {
  const { readRepositoryConfiguration } = await import(
    '../../change-evaluation-gate/scripts/lib/configuration.mjs',
  );
  const read = await readRepositoryConfiguration({ repositoryRoot: path.resolve(projectRoot) });

  if (!read.ok) {
    return null;
  }

  let total = 0;

  for (const scopes of Object.values(read.configuration?.verification?.commands ?? {})) {
    for (const scoped of Object.values(scopes ?? {})) {
      if (!Array.isArray(scoped)) {
        continue;
      }

      for (const command of scoped) {
        if (!Number.isInteger(command?.timeout_seconds) || command.timeout_seconds <= 0) {
          return null;
        }

        total += command.timeout_seconds;
      }
    }
  }

  return total > 0 ? total : null;
};

/**
 * The check identities the activated Git hook actually binds through, read
 * from this project's own schema v4 configuration.
 *
 * `gateChecksFromConfiguration` is the same function `hook-runner.mjs` calls
 * at evaluation time, so the identities this returns are exactly the ones a
 * configured, activated hook will bind (SG-OWNER-001, NFR-REL-003) — never a
 * restated copy of its `configuration.<stage>.<capability>` naming rule.
 *
 * A project that has not migrated, or that has migrated but proved no
 * verification command yet, has nothing this function can derive an identity
 * from: the drafter refuses rather than guess or fall back to provider-plan
 * names, because a draft that cannot bind is worse than no draft at all.
 */
const configuredChecksToDraft = async (projectRoot) => {
  const { readRepositoryConfiguration, gateChecksFromConfiguration } = await import(
    '../../change-evaluation-gate/scripts/lib/configuration.mjs',
  );
  const read = await readRepositoryConfiguration({ repositoryRoot: path.resolve(projectRoot) });
  const { checks } = read.ok ? gateChecksFromConfiguration(read.configuration) : { checks: [] };

  if (checks.length === 0) {
    throw new Error(
      'A Gate policy cannot be drafted before this project migrates to schema version 4 and '
      + 'proves at least one verification command; run the schema v4 migration (--mapping) first.',
    );
  }

  return checks;
};

/**
 * Draft the Gate policy this project's own configuration and matching
 * provider already describe.
 *
 * Check identities are read out of `gateChecksFromConfiguration`, the exact
 * function the activated hook binds through, so the draft cannot name a check
 * the hook will not enforce. The required/advisory binding for each identity
 * is still read out of the provider's declared plan, matched by the stage and
 * capability the configuration proves — a configured check with no matching
 * plan entry binds advisory rather than guessing required. Nothing here
 * restates either catalogue (SG-OWNER-001), and nothing unproved is invented:
 * bypass stays disabled with no marker, and an unprovable budget stays `null`.
 */
/**
 * Which installed dependency directory each logical runner reaches into.
 *
 * A `composer-bin` binary lives under the vendor directory and a PHP entry
 * point autoloads from it; a package script runs through a package manager that
 * resolves from the module tree. A `repository-script` is run by this Node
 * runtime against a file the repository tracks and needs neither.
 */
const RUNNER_DEPENDENCY_ROOTS = Object.freeze({
  'composer-bin': 'vendor',
  'php-script': 'vendor',
  'package-script': 'node_modules',
});

/**
 * The Node lock files, each with the package manager that writes it, in the
 * order a project's package manager is detected by.
 */
const PACKAGE_LOCK_FILES = Object.freeze([
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
]);

/**
 * Which manifest and lock files govern each installed dependency directory.
 *
 * This is the one place `framework-setup` records which directory a
 * dependency manager installs into: the Gate drafter reads a runner's root's
 * manifest from it, and `config suggest` reads which repository facts imply a
 * root (`SG-OWNER-001`). Gate core learns no manifest, lock file, or directory
 * name from it.
 */
const DEPENDENCY_INSTALLS = Object.freeze({
  vendor: Object.freeze({ manifest: 'composer.json', lockFiles: Object.freeze(['composer.lock']) }),
  node_modules: Object.freeze({
    manifest: 'package.json',
    lockFiles: Object.freeze(PACKAGE_LOCK_FILES.map(([lockFile]) => lockFile)),
  }),
});

/**
 * Where this project installs the dependencies its own checks need to run.
 *
 * A materialized Evaluation snapshot holds tracked content, and an installed
 * dependency tree is never tracked — so a tool starts inside the snapshot and
 * cannot find the autoloader or module tree it needs to read the code at all.
 *
 * Two proved facts are required before a root is declared, and a manifest alone
 * is not enough: some configured check must run through a runner that reaches
 * into that directory, *and* the manifest that governs it must exist. A project
 * carrying a `package.json` whose only check is a repository script needs no
 * module tree, and declaring one would deny its commits for a directory nothing
 * was going to read.
 *
 * A root the project has not installed yet is the Gate's to report, not this
 * drafter's to hide.
 */
const derivedDependencyRoots = async (projectRoot, checks) => {
  const resolvedRoot = path.resolve(projectRoot);
  const roots = [];

  for (const check of checks) {
    for (const command of [check.evaluate, check.fix]) {
      const root = RUNNER_DEPENDENCY_ROOTS[command?.runner] ?? null;

      if (root === null || roots.includes(root)) {
        continue;
      }

      if (await exists(path.join(resolvedRoot, DEPENDENCY_INSTALLS[root].manifest))) {
        roots.push(root);
      }
    }
  }

  return roots.sort();
};

/**
 * The Sensitive runtime inputs a stock project of each profile needs its test
 * suite to receive, and where that profile keeps them.
 *
 * A Laravel application reads its encryption key from `.env`, which is
 * git-ignored and therefore absent from the Evaluation snapshot; its stock
 * `phpunit.xml` deliberately sets no `APP_KEY`, so a suite that runs locally
 * fails inside the snapshot with a missing key on first activation. Declaring
 * the name and the file here lets the Gate resolve that one approved name from
 * the file, hand it to the check, and scrub it from Evidence — the declaration
 * is names and paths only, never a value (`FR-CFG-006`, `FR-LIFE-013`,
 * `TB-059`). A maintainer who does not want it removes one line. Every other
 * profile declares nothing, exactly as before.
 *
 * This is the profile's knowledge, kept in `framework-setup`'s profile table:
 * Gate core learns no variable name, file name, or framework (`SG-OWNER-001`).
 */
const PROFILE_EVIDENCE_DEFAULTS = Object.freeze({
  laravel: Object.freeze({
    sensitive_inputs: Object.freeze(['APP_KEY']),
    environment_files: Object.freeze(['.env']),
  }),
});

const derivedEvidencePolicy = (backend) => {
  const defaults = PROFILE_EVIDENCE_DEFAULTS[backend] ?? null;

  return defaults === null
    ? {}
    : Object.fromEntries(Object.entries(defaults).map(([key, values]) => [key, [...values]]));
};

export const draftGatePolicy = async ({ projectRoot, out = null } = {}) => {
  const provider = await resolveDraftProvider(projectRoot);
  const checks = await configuredChecksToDraft(projectRoot);
  const required = [];
  const advisory = [];

  for (const check of checks) {
    const planEntry = provider.plan.find(
      (entry) => entry.stage === check.stage && entry.capability === check.capability,
    );

    (planEntry?.policy === 'required' ? required : advisory).push(check.id);
  }

  return emitDraft({
    checks: { required, advisory },
    budget: { total_seconds: await derivedBudgetSeconds(projectRoot) },
    bypass: { enabled: false, marker: null },
    execution: {
      budget_skippable: [],
      dependency_roots: await derivedDependencyRoots(projectRoot, checks),
    },
    evidence: derivedEvidencePolicy(await resolveDraftBackend(projectRoot)),
  }, out);
};

/** The Gate configuration section's five subcontracts, in the order `configure-gate` writes them. */
export const gatePolicyKeys = Object.freeze(['checks', 'budget', 'bypass', 'execution', 'evidence']);
const gateForbiddenOwnershipFields = new Set([
  'activation',
  'activated',
  'allowed_environment',
  'args',
  'capabilities',
  'client',
  'command',
  'commands',
  'evidence_category',
  'executable',
  'hook',
  'profile',
  'profiles',
  'receipt',
  'runner',
  'source_scope',
  'trust',
  'version',
  'working_directory',
]);

const gateForbiddenOwnershipField = (value) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (gateForbiddenOwnershipFields.has(key)) {
      return key;
    }

    const nestedField = gateForbiddenOwnershipField(nestedValue);

    if (nestedField) {
      return nestedField;
    }
  }

  return null;
};

const validateGatePolicy = async (policy) => {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error('Gate policy must be an object');
  }

  const policyKeys = Object.keys(policy);
  const unsupportedKey = policyKeys.find((key) => !gatePolicyKeys.includes(key));
  const missingKey = gatePolicyKeys.find((key) => !policyKeys.includes(key));

  if (unsupportedKey) {
    throw new Error(`Unsupported Gate policy subcontract: ${unsupportedKey}`);
  }

  if (missingKey) {
    throw new Error(`Missing Gate policy subcontract: ${missingKey}`);
  }

  if (policyKeys.length !== gatePolicyKeys.length) {
    throw new Error('Gate policy must contain exactly five subcontracts');
  }

  const forbiddenOwnershipField = gateForbiddenOwnershipField(policy);

  if (forbiddenOwnershipField) {
    throw new Error(
      `Gate policy cannot own verification or activation field: ${forbiddenOwnershipField}`,
    );
  }

  const checks = policy.checks;

  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) {
    throw new Error('Gate checks policy must be an object');
  }

  const checkKeys = Object.keys(checks);

  if (
    checkKeys.length !== 2
    || !checkKeys.includes('required')
    || !checkKeys.includes('advisory')
  ) {
    throw new Error('Gate checks policy must contain only required and advisory identities');
  }

  for (const category of ['required', 'advisory']) {
    const identities = checks[category];

    if (
      !Array.isArray(identities)
      || new Set(identities).size !== identities.length
      || identities.some((identity) => typeof identity !== 'string' || !identity.trim())
    ) {
      throw new Error(`Gate ${category} check identities must be unique non-empty strings`);
    }
  }

  const overlappingIdentity = checks.required.find((identity) => checks.advisory.includes(identity));

  if (overlappingIdentity) {
    throw new Error(
      `Gate check identity cannot be both required and advisory: ${overlappingIdentity}`,
    );
  }

  const budget = policy.budget;

  if (
    !budget
    || typeof budget !== 'object'
    || Array.isArray(budget)
    || Object.keys(budget).length !== 1
    || !Number.isInteger(budget.total_seconds)
    || budget.total_seconds <= 0
  ) {
    throw new Error('Gate budget policy must contain a positive total_seconds integer');
  }

  for (const subcontract of ['bypass', 'execution', 'evidence']) {
    const value = policy[subcontract];

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Gate ${subcontract} policy must be an object`);
    }
  }

  const { validateGatePolicy: validateRuntimeGatePolicy } = await import(
    '../../change-evaluation-gate/scripts/lib/policy.mjs',
  );
  const runtimeIssues = validateRuntimeGatePolicy(policy);

  if (runtimeIssues.length > 0) {
    throw new Error(runtimeIssues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join(' '));
  }
};

/**
 * The Gate configuration section as `configure-gate` writes it: the
 * `evaluation_gate:` line, then one flow-JSON line per subcontract in
 * `gatePolicyKeys` order. A revision renders through this same function, so a
 * revised file is the file configuring that candidate would have written
 * (`NFR-REL-004`).
 */
const gateSectionLines = (policy) => [
  'evaluation_gate:',
  ...gatePolicyKeys.map((key) => `  ${key}: ${JSON.stringify(policy[key])}`),
];

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

/** Replace `.agent-framework.yaml` in one rename, keeping its mode. */
const replaceConfiguration = async (resolvedProjectRoot, contents) => {
  const configurationPath = path.join(resolvedProjectRoot, '.agent-framework.yaml');
  const temporaryPath = path.join(
    resolvedProjectRoot,
    `.agent-framework.yaml.${randomUUID()}.tmp`,
  );
  const configurationStats = await stat(configurationPath);

  try {
    await writeFile(temporaryPath, contents, {
      encoding: 'utf8',
      flag: 'wx',
      mode: configurationStats.mode,
    });
    await rename(temporaryPath, configurationPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
};

/**
 * A revision that is refused, carrying the reason code a caller reports it by.
 * Every refusal is decided before anything is written.
 */
const revisionRefusal = (reasonCode, message) => Object.assign(new Error(message), { reasonCode });

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const listOrEmpty = (value) => (Array.isArray(value) ? value : []);

const nothingToRevise = (detail) => revisionRefusal(
  'nothing-to-revise',
  `${detail}, so this revision changes nothing; nothing was written.`,
);

/** `subcontract` with `value` appended to its `key` list. */
const withListed = (subcontract, key, value) => ({ ...subcontract, [key]: [...listOrEmpty(subcontract[key]), value] });

/** `subcontract` with `value` gone from its `key` list, which stays declared. */
const withoutListed = (subcontract, key, value) => (
  Array.isArray(subcontract[key])
    ? { ...subcontract, [key]: subcontract[key].filter((declared) => declared !== value) }
    : subcontract
);

/**
 * `checks` with one bound check moved from one severity to the other.
 *
 * Only a check the policy already binds moves: an identity bound as neither is
 * refused rather than bound, because binding a check is not a severity change
 * and which identities a profile resolves is Verification's (`SG-OWNER-001`).
 */
const movedCheck = (checks, check, from, to) => {
  if (listOrEmpty(checks[to]).includes(check)) {
    throw nothingToRevise(`check ${check} is already ${to}`);
  }

  if (!listOrEmpty(checks[from]).includes(check)) {
    throw revisionRefusal(
      'check-unbound',
      `check ${check} is not bound by the Gate policy, so there is no severity to change: a revision moves only a check the policy already binds between required and advisory, and never binds a new one or edits a Verification profile command. Nothing was written.`,
    );
  }

  return { ...checks, [from]: checks[from].filter((declared) => declared !== check), [to]: [...listOrEmpty(checks[to]), check] };
};

/**
 * `true` and `false` as the booleans they spell; any other value as given, so
 * the Gate policy validator refuses it with its own reason.
 */
const spelledBoolean = (value) => {
  if (value === 'true') {
    return true;
  }

  return value === 'false' ? false : value;
};

/**
 * `execution` with one root given `provisioning`, changing as little of the
 * declaration as that takes, and returned as is when the root already has it.
 *
 * A single strategy that differs becomes the per-root map the Gate validator
 * accepts, every other declared root keeping the strategy it already had, so
 * no root's provisioning moves except the one named. Which strategy a root
 * gets when nothing names it is the Gate's default and is not restated here.
 */
const withRootProvisioning = (execution, root, provisioning) => {
  const declared = execution.dependency_provisioning;

  if (typeof declared === 'string') {
    return declared === provisioning ? execution : {
      ...execution,
      dependency_provisioning: {
        ...Object.fromEntries(listOrEmpty(execution.dependency_roots).map((declaredRoot) => [declaredRoot, declared])),
        [root]: provisioning,
      },
    };
  }

  if (isPlainObject(declared) && Object.hasOwn(declared, root) && declared[root] === provisioning) {
    return execution;
  }

  return {
    ...execution,
    dependency_provisioning: { ...(isPlainObject(declared) ? declared : {}), [root]: provisioning },
  };
};

/**
 * The named revisions of the Gate configuration section (`FR-GUIDE-006`).
 *
 * Each changes one subcontract and nothing else: `argument` is the value it
 * names, `options` the optional values it accepts, and `revise` derives the
 * revised subcontract from the current one, or refuses when the revision would
 * change nothing. None of them judges the candidate — the Gate policy
 * validator `configure-gate` loads does, after (`SG-OWNER-001`): a value it
 * would refuse, such as an enabled bypass with no marker, reaches it as given
 * and is refused with its own reason. `TB-069` added the `execution` rows;
 * `TB-070` the `evidence`, `checks`, `budget`, and `bypass` rows.
 *
 * A Sensitive runtime input is declared by name, and the source it may be
 * resolved from besides the environment by naming its environment file; no
 * value is read, asked for, or written (`SG-SECRET-001`). A check is moved or
 * removed only when the policy already binds it, so no revision binds a new
 * check, and none adds or edits a Verification profile command or an
 * `allowed_environment`, which is never a Gate policy property.
 */
export const gateRevisions = Object.freeze({
  'add-dependency-root': Object.freeze({
    subcontract: 'execution',
    argument: 'root',
    options: Object.freeze(['provisioning']),
    revise: (execution, { root, provisioning }) => {
      const roots = listOrEmpty(execution.dependency_roots);

      if (roots.includes(root)) {
        throw nothingToRevise(`dependency root ${root} is already declared`);
      }

      const added = { ...execution, dependency_roots: [...roots, root] };

      return provisioning === undefined ? added : withRootProvisioning(added, root, provisioning);
    },
  }),
  'remove-dependency-root': Object.freeze({
    subcontract: 'execution',
    argument: 'root',
    options: Object.freeze([]),
    revise: (execution, { root }) => {
      const roots = listOrEmpty(execution.dependency_roots);

      if (!roots.includes(root)) {
        throw nothingToRevise(`dependency root ${root} is not declared`);
      }

      const removed = { ...execution, dependency_roots: roots.filter((declared) => declared !== root) };
      const declared = execution.dependency_provisioning;

      // A map may name only declared roots, so the removed root leaves it too;
      // a map that named nothing else says what no map says.
      if (isPlainObject(declared) && Object.hasOwn(declared, root)) {
        const { [root]: _removed, ...others } = declared;

        if (Object.keys(others).length === 0) {
          delete removed.dependency_provisioning;
        } else {
          removed.dependency_provisioning = others;
        }
      }

      return removed;
    },
  }),
  'set-dependency-provisioning': Object.freeze({
    subcontract: 'execution',
    argument: 'provisioning',
    options: Object.freeze(['root']),
    revise: (execution, { provisioning, root }) => {
      if (root === undefined) {
        if (execution.dependency_provisioning === provisioning) {
          throw nothingToRevise(`every dependency root is already provided by ${provisioning}`);
        }

        return { ...execution, dependency_provisioning: provisioning };
      }

      const revised = withRootProvisioning(execution, root, provisioning);

      if (revised === execution) {
        throw nothingToRevise(`dependency root ${root} is already provided by ${provisioning}`);
      }

      return revised;
    },
  }),
  'add-budget-skippable': Object.freeze({
    subcontract: 'execution',
    argument: 'check',
    options: Object.freeze([]),
    revise: (execution, { check }) => {
      const skippable = listOrEmpty(execution.budget_skippable);

      if (skippable.includes(check)) {
        throw nothingToRevise(`check ${check} is already budget-skippable`);
      }

      return { ...execution, budget_skippable: [...skippable, check] };
    },
  }),
  'remove-budget-skippable': Object.freeze({
    subcontract: 'execution',
    argument: 'check',
    options: Object.freeze([]),
    revise: (execution, { check }) => {
      const skippable = listOrEmpty(execution.budget_skippable);

      if (!skippable.includes(check)) {
        throw nothingToRevise(`check ${check} is not budget-skippable`);
      }

      return { ...execution, budget_skippable: skippable.filter((declared) => declared !== check) };
    },
  }),
  'add-sensitive-input': Object.freeze({
    subcontract: 'evidence',
    argument: 'name',
    options: Object.freeze(['environment-file']),
    revise: (evidence, { name, 'environment-file': file }) => {
      const addsName = !listOrEmpty(evidence.sensitive_inputs).includes(name);
      const addsFile = file !== undefined && !listOrEmpty(evidence.environment_files).includes(file);

      if (!addsName && !addsFile) {
        throw nothingToRevise(file === undefined
          ? `Sensitive runtime input ${name} is already declared`
          : `Sensitive runtime input ${name} and environment file ${file} are already declared`);
      }

      const named = addsName ? withListed(evidence, 'sensitive_inputs', name) : evidence;

      return addsFile ? withListed(named, 'environment_files', file) : named;
    },
  }),
  'remove-sensitive-input': Object.freeze({
    subcontract: 'evidence',
    argument: 'name',
    options: Object.freeze([]),
    revise: (evidence, { name }) => {
      if (!listOrEmpty(evidence.sensitive_inputs).includes(name)) {
        throw nothingToRevise(`Sensitive runtime input ${name} is not declared`);
      }

      return withoutListed(evidence, 'sensitive_inputs', name);
    },
  }),
  'add-environment-file': Object.freeze({
    subcontract: 'evidence',
    argument: 'file',
    options: Object.freeze([]),
    revise: (evidence, { file }) => {
      if (listOrEmpty(evidence.environment_files).includes(file)) {
        throw nothingToRevise(`environment file ${file} is already declared`);
      }

      return withListed(evidence, 'environment_files', file);
    },
  }),
  'remove-environment-file': Object.freeze({
    subcontract: 'evidence',
    argument: 'file',
    options: Object.freeze([]),
    revise: (evidence, { file }) => {
      if (!listOrEmpty(evidence.environment_files).includes(file)) {
        throw nothingToRevise(`environment file ${file} is not declared`);
      }

      return withoutListed(evidence, 'environment_files', file);
    },
  }),
  'promote-check': Object.freeze({
    subcontract: 'checks',
    argument: 'check',
    options: Object.freeze([]),
    revise: (checks, { check }) => movedCheck(checks, check, 'advisory', 'required'),
  }),
  'demote-check': Object.freeze({
    subcontract: 'checks',
    argument: 'check',
    options: Object.freeze([]),
    revise: (checks, { check }) => movedCheck(checks, check, 'required', 'advisory'),
  }),
  'remove-check': Object.freeze({
    subcontract: 'checks',
    argument: 'check',
    options: Object.freeze([]),
    revise: (checks, { check }) => {
      if (![...listOrEmpty(checks.required), ...listOrEmpty(checks.advisory)].includes(check)) {
        throw nothingToRevise(`check ${check} is not bound by the Gate policy`);
      }

      return withoutListed(withoutListed(checks, 'required', check), 'advisory', check);
    },
  }),
  'set-budget': Object.freeze({
    subcontract: 'budget',
    argument: 'seconds',
    options: Object.freeze([]),
    revise: (budget, { seconds }) => {
      // Digits are the number they spell; anything else reaches the validator as given.
      const total = /^\d+$/.test(seconds) ? Number(seconds) : seconds;

      if (budget.total_seconds === total) {
        throw nothingToRevise(`the total budget is already ${total} seconds`);
      }

      return { ...budget, total_seconds: total };
    },
  }),
  'set-bypass': Object.freeze({
    subcontract: 'bypass',
    argument: 'enabled',
    options: Object.freeze(['marker', 'require-reference']),
    revise: (bypass, { enabled, marker, 'require-reference': requireReference }) => {
      const revised = {
        ...bypass,
        enabled: spelledBoolean(enabled),
        ...(marker === undefined ? {} : { marker }),
        ...(requireReference === undefined ? {} : { require_reference: spelledBoolean(requireReference) }),
      };

      if (JSON.stringify(revised) === JSON.stringify(bypass)) {
        throw nothingToRevise(`bypass is already ${JSON.stringify(bypass)}`);
      }

      return revised;
    },
  }),
});

/**
 * A typed value in `NAME=value` form: a name, file, or check given with a
 * value after `=`. No revision takes a value, and the part after `=` may be a
 * secret, so it is never repeated (`SG-GUIDE-002`, `SG-SECRET-001`).
 */
const suppliesValue = (value) => typeof value === 'string' && value.includes('=');

/** `revision` as it may be echoed: each value after `=` replaced by a marker that repeats nothing. */
export const withheldRevision = (revision) => Object.fromEntries(Object.entries(revision ?? {})
  .map(([key, value]) => [key, suppliesValue(value) ? `${value.slice(0, value.indexOf('='))}=<withheld>` : value]));

/**
 * Refuse a revision any of whose typed values supplies a value, before the
 * file, the operation, or the validator sees it, naming only what precedes
 * `=`.
 */
const refuseSuppliedValues = (revision) => {
  const supplied = Object.entries(revision ?? {}).filter(([, value]) => suppliesValue(value));

  if (supplied.length > 0) {
    throw Object.assign(revisionRefusal(
      'value-supplied',
      `A value was supplied for ${supplied.map(([key, value]) => `${key} ${value.slice(0, value.indexOf('='))}`).join(', ')}: a Gate revision takes a name, file, or check alone and never a value, so the part after \`=\` was not read into the configuration and is not repeated here. Nothing was written; pass the name alone.`,
    ), { revision: withheldRevision(revision) });
  }
};

/** The one revision asked for, with only the values its operation takes. */
const requestedRevision = (revision) => {
  const operation = gateRevisions[revision?.operation] ?? null;

  if (operation === null) {
    throw revisionRefusal(
      'revision-unknown',
      `Unknown Gate revision ${JSON.stringify(revision?.operation ?? null)}; one of ${Object.keys(gateRevisions).join(', ')}.`,
    );
  }

  const accepted = [operation.argument, ...operation.options];
  const unaccepted = Object.keys(revision)
    .filter((key) => key !== 'operation' && revision[key] !== undefined && !accepted.includes(key));

  if (unaccepted.length > 0) {
    throw revisionRefusal(
      'revision-unknown',
      `${revision.operation} does not take ${unaccepted.join(', ')}; it takes ${accepted.join(', ')}.`,
    );
  }

  const given = accepted.filter((key) => revision[key] !== undefined);
  const malformed = given.find((key) => typeof revision[key] !== 'string' || revision[key] === '');

  if (!given.includes(operation.argument) || malformed !== undefined) {
    throw revisionRefusal(
      'revision-incomplete',
      `${revision.operation} needs a non-empty ${malformed ?? operation.argument}.`,
    );
  }

  return {
    operation,
    revision: Object.fromEntries([['operation', revision.operation], ...given.map((key) => [key, revision[key]])]),
  };
};

/** A top-level key that names the Gate section, quoted or not. */
const GATE_SECTION_HEAD = /^(?:evaluation_gate|"evaluation_gate"|'evaluation_gate')[ \t]*:/gm;

const lineNumberAt = (contents, offset) => contents.slice(0, offset).split('\n').length;

/**
 * Locate the Gate configuration section and read it back, or refuse.
 *
 * The section is its head line and every following line up to the next
 * top-level entry; blank and comment lines at its end belong to what follows.
 * It is revisable only when it round-trips: it reads as exactly the five
 * subcontract lines `configure-gate` writes, and rendering what it reads
 * reproduces it byte for byte. A hand-written block section, a comment or a
 * blank line inside it, or flow JSON spelled any other way is refused rather
 * than rewritten — a revision never changes how a section is written
 * (`RISK-012`).
 *
 * @returns {{ start: number, end: number, line: number, lines: string[], policy: object }}
 */
const readGateSection = (contents) => {
  const heads = [...contents.matchAll(GATE_SECTION_HEAD)];

  if (heads.length === 0) {
    throw revisionRefusal(
      'gate-unconfigured',
      '.agent-framework.yaml has no Gate configuration section to revise; configure the Gate first (--configure-gate). Nothing was written.',
    );
  }

  if (heads.length > 1) {
    throw revisionRefusal(
      'section-ambiguous',
      `.agent-framework.yaml declares the Gate configuration section ${heads.length} times (lines ${heads.map((head) => lineNumberAt(contents, head.index)).join(', ')}), so a revision cannot tell which one the Gate reads. Nothing was written.`,
    );
  }

  const start = heads[0].index;
  const line = lineNumberAt(contents, start);
  const lines = [];
  let cursor = start;

  while (cursor < contents.length) {
    const newline = contents.indexOf('\n', cursor);
    const end = newline === -1 ? contents.length : newline;
    const text = contents.slice(cursor, end);

    if (lines.length > 0 && text.trim() !== '' && !/^[ \t#]/.test(text)) {
      break;
    }

    lines.push({ text, end });
    cursor = end + 1;
  }

  while (lines.length > 1 && /^\s*(#.*)?$/.test(lines.at(-1).text)) {
    lines.pop();
  }

  const written = lines.map((entry) => entry.text);
  const unrevisable = (index, reason) => revisionRefusal(
    'section-unrevisable',
    `.agent-framework.yaml line ${line + index} ${reason}. A revision rewrites the Gate configuration section only when it is exactly what configure-gate writes — \`evaluation_gate:\` and then one flow-JSON line per subcontract, ${gatePolicyKeys.join(', ')}, with nothing between them — and never changes how a section is written. Nothing was written; edit the section by hand.`,
  );
  const policy = {};

  for (const [index, text] of written.entries()) {
    if (index === 0) {
      if (text !== 'evaluation_gate:') {
        throw unrevisable(index, 'does not open the section as `evaluation_gate:` alone');
      }

      continue;
    }

    const entry = text.match(/^ {2}([a-z_]+): (.+)$/);
    const key = gatePolicyKeys[index - 1];

    if (entry === null || entry[1] !== key) {
      throw unrevisable(index, key === undefined
        ? 'is more than the five subcontract lines'
        : `is not the \`  ${key}: <JSON>\` line`);
    }

    try {
      policy[key] = JSON.parse(entry[2]);
    } catch {
      throw unrevisable(index, `holds ${key} in a form that is not flow JSON`);
    }
  }

  if (written.length !== gatePolicyKeys.length + 1) {
    throw unrevisable(written.length, `ends the section before its ${gatePolicyKeys[written.length - 1]} line`);
  }

  const rendered = gateSectionLines(policy);
  const differing = written.findIndex((text, index) => text !== rendered[index]);

  if (differing !== -1) {
    throw unrevisable(differing, 'spells its flow JSON differently from how configure-gate writes the same value');
  }

  return { start, end: lines.at(-1).end, line, lines: written, policy };
};

/** Validate one policy with the Gate policy validator, refusing by its own reason. */
const validatedPolicy = async (policy, reasonCode, prefix) => {
  try {
    await validateGatePolicy(policy);
  } catch (error) {
    throw error.code === 'ERR_MODULE_NOT_FOUND'
      ? revisionRefusal('gate-validator-unavailable', `The Gate policy validator could not be loaded (${error.message}). Nothing was written.`)
      : revisionRefusal(reasonCode, `${prefix}: ${error.message} Nothing was written.`);
  }
};

/**
 * Preview one named revision of the Gate configuration section.
 *
 * It reads the section back (refusing one it cannot locate unambiguously or
 * round-trip), refuses a section the Gate policy validator already rejects,
 * applies the revision to its one subcontract, validates the candidate with
 * that same validator, and renders the candidate as `configure-gate` renders a
 * section, in place. Every byte outside the section is the file's own, and the
 * rendered section reads back as exactly the candidate. The preview names each
 * changed line before and after; `previewHash` binds the file as it is now to
 * the file the revision would write, so it confirms exactly this change to
 * exactly this file. Nothing is written.
 */
export const previewGateRevision = async ({ projectRoot, revision }) => {
  refuseSuppliedValues(revision);

  const configurationPath = path.join(path.resolve(projectRoot), '.agent-framework.yaml');

  if (!(await exists(configurationPath))) {
    throw revisionRefusal('configuration-missing', 'Cannot revise the Gate configuration without .agent-framework.yaml');
  }

  const contents = await readFile(configurationPath, 'utf8');
  const schemaVersion = Number(contents.match(/^schema_version:\s*(\d+)$/m)?.[1] ?? 0);

  if (schemaVersion !== 4) {
    throw revisionRefusal('schema-unsupported', `Gate configuration requires schema version 4, found ${schemaVersion}`);
  }

  const requested = requestedRevision(revision);
  const { operation } = requested;
  const section = readGateSection(contents);

  await validatedPolicy(section.policy, 'section-invalid', 'The Gate configuration section does not validate as it stands, and a revision starts from a valid section');

  const policy = {
    ...section.policy,
    [operation.subcontract]: operation.revise(section.policy[operation.subcontract], requested.revision),
  };

  await validatedPolicy(policy, 'candidate-invalid', `The Gate policy validator refuses this ${requested.revision.operation} revision`);

  const rendered = gateSectionLines(policy);
  const proposedConfiguration = `${contents.slice(0, section.start)}${rendered.join('\n')}${contents.slice(section.end)}`;
  const reread = readGateSection(proposedConfiguration).policy;

  // `RISK-012`: the section reads back as the candidate, and nothing outside it moved.
  if (
    JSON.stringify(reread) !== JSON.stringify(policy)
    || !proposedConfiguration.startsWith(contents.slice(0, section.start))
    || !proposedConfiguration.endsWith(contents.slice(section.end))
  ) {
    throw revisionRefusal('section-unrevisable', 'The revised Gate configuration section does not read back as the candidate. Nothing was written.');
  }

  const previewHash = createHash('sha256')
    .update(contents)
    .update('\0')
    .update(proposedConfiguration)
    .digest('hex');

  return {
    status: 'ready',
    revision: requested.revision,
    subcontract: operation.subcontract,
    changes: rendered
      .map((after, index) => ({
        subcontract: gatePolicyKeys[index - 1] ?? null,
        line: section.line + index,
        before: section.lines[index],
        after,
      }))
      .filter((change) => change.before !== change.after),
    policy,
    previewHash,
    proposedConfiguration,
  };
};

/**
 * Write exactly the previewed revision, or nothing.
 *
 * The preview is taken again from the file as it is now, so a token from a
 * preview of another revision, or of the file before anything in it changed,
 * matches nothing and writes nothing.
 */
export const reviseGate = async ({ projectRoot, revision, confirmation }) => {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const preview = await previewGateRevision({ projectRoot: resolvedProjectRoot, revision });

  if (confirmation !== preview.previewHash) {
    throw revisionRefusal(
      'preview-mismatch',
      'Gate revision confirmation does not match the current preview: the file or the revision changed since that preview. Nothing was written; preview again.',
    );
  }

  await replaceConfiguration(resolvedProjectRoot, preview.proposedConfiguration);

  return {
    status: 'revised',
    revision: preview.revision,
    subcontract: preview.subcontract,
    changes: preview.changes,
    policy: preview.policy,
    previewHash: preview.previewHash,
  };
};

/**
 * The dotenv convention: the environment file a project keeps out of Git, and
 * the example file committed beside it that names the keys it holds. Like
 * `DEPENDENCY_INSTALLS`, this is `framework-setup`'s knowledge; Gate core
 * learns no file name from it (`SG-OWNER-001`).
 */
const ENVIRONMENT_FILE_CONVENTIONS = Object.freeze([
  Object.freeze({ file: '.env', example: '.env.example' }),
]);

const isFile = (candidate) => stat(candidate).then((entry) => entry.isFile(), () => false);

const isDirectory = (candidate) => stat(candidate).then((entry) => entry.isDirectory(), () => false);

/**
 * Whether Git ignores `file`, as `git check-ignore` answers: a tracked file is
 * never ignored, and anything but Git's own yes — no repository, no Git — is
 * not a yes. Nothing is read from the file and nothing under `.git` is written.
 */
const isGitIgnored = (projectRoot, file, environment) => new Promise((resolve) => {
  execFile('git', ['check-ignore', '--quiet', '--', file], { cwd: projectRoot, env: environment }, (error) => {
    resolve(error === null);
  });
});

/**
 * The key each line of an environment file assigns, never its value: only the
 * text before a line's first `=`, without a leading `export`, is kept. A line
 * that assigns nothing yields `name: null`; blank and comment lines yield
 * nothing.
 *
 * @returns {Array<{ line: number, name: string | null }>}
 */
const environmentFileKeys = (contents) => contents.split(/\r?\n/).flatMap((text, index) => {
  const line = text.trim();

  if (line === '' || line.startsWith('#')) {
    return [];
  }

  const assignment = line.indexOf('=');

  return [{ line: index + 1, name: assignment > 0 ? line.slice(0, assignment).trim().replace(/^export\s+/, '') : null }];
});

/** One dependency root, when a manifest or lock file that governs it is present together with the directory. */
const dependencyRootFact = async (resolvedRoot, root, { manifest, lockFiles }) => {
  const governing = [];

  for (const [fact, file] of [['manifest', manifest], ...lockFiles.map((lockFile) => ['lock-file', lockFile])]) {
    if (await isFile(path.join(resolvedRoot, file))) {
      governing.push({ fact, path: file });
    }
  }

  return governing.length > 0 && await isDirectory(path.join(resolvedRoot, root))
    ? [{ root, evidence: [...governing, { fact: 'install-directory', path: root }] }]
    : [];
};

/**
 * The repository facts that imply what a Gate configuration section should
 * declare (`FR-GUIDE-007`, `TB-071`), read from this repository only and from
 * `framework-setup`'s own tables (`SG-OWNER-001`):
 *
 * - `dependencyRoots`: each directory in `DEPENDENCY_INSTALLS` that exists
 *   together with its manifest or a lock file, naming which;
 * - `sensitiveInputs`: each key an example environment file assigns, first
 *   occurrence only, with its line — never a value (`SG-GUIDE-002`);
 *   `unassigned` counts the example lines that assign no key;
 * - `environmentFiles`: each conventional environment file present that Git
 *   ignores. Its contents are never read.
 *
 * Whether a key is a name the Gate accepts, and whether any of this is already
 * declared, is not judged here. Nothing is written.
 */
export const discoverGateConfigurationFacts = async ({ projectRoot, environment = process.env }) => {
  const resolvedRoot = path.resolve(projectRoot);
  const dependencyRoots = [];
  const sensitiveInputs = [];
  const unassigned = [];
  const environmentFiles = [];

  for (const [root, install] of Object.entries(DEPENDENCY_INSTALLS)) {
    dependencyRoots.push(...await dependencyRootFact(resolvedRoot, root, install));
  }

  for (const { file, example } of ENVIRONMENT_FILE_CONVENTIONS) {
    const keys = await isFile(path.join(resolvedRoot, example))
      ? environmentFileKeys(await readFile(path.join(resolvedRoot, example), 'utf8'))
      : [];
    const assigned = keys.filter(({ name }) => name !== null);

    for (const { line, name } of assigned.filter((key, index) => assigned.findIndex(({ name: first }) => first === key.name) === index)) {
      sensitiveInputs.push({ name, evidence: [{ fact: 'example-name', path: example, line }] });
    }

    if (keys.length > assigned.length) {
      unassigned.push({ path: example, count: keys.length - assigned.length });
    }

    if (await isFile(path.join(resolvedRoot, file)) && await isGitIgnored(resolvedRoot, file, environment)) {
      environmentFiles.push({ file, evidence: [{ fact: 'git-ignored', path: file }] });
    }
  }

  return { dependencyRoots, sensitiveInputs, unassigned, environmentFiles };
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
  for (const [lockfile, packageManager] of PACKAGE_LOCK_FILES) {
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
  // Every discovered command is a GRADER: it reports, it never rewrites, and it
  // must reach the same verdict outside a Git worktree as inside one. Pint's
  // `--dirty` breaks both rules — it fixes files in place, and it selects them
  // from uncommitted Git state, so it aborts outright in the materialized
  // snapshot a Change Evaluation Gate check runs against. `--test` reports the
  // same style errors and changes nothing. Rewriting belongs to the explicit
  // fix operation, which invokes Pint without `--test`.
  const detectedFiles = [
    [
      'vendor/bin/pint',
      'format',
      'vendor/bin/pint --test --format agent',
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

  // One concept, three spellings: every table below reads this list, so a
  // spelling cannot be accepted in one place and declined in another.
  const typeCheckBases = ['typecheck', 'type-check', 'types'];
  const scriptCategories = {
    format: 'format',
    lint: 'static_analysis',
    ...Object.fromEntries(
      typeCheckBases.map((base) => [base, 'static_analysis']),
    ),
    test: 'test',
    smoke: 'smoke',
    build: 'build',
    e2e: 'e2e',
  };
  const safeQualifiers = {
    format: new Set(['check', 'server', 'backend', 'client', 'frontend']),
    lint: new Set(['check', 'server', 'backend', 'client', 'frontend']),
    ...Object.fromEntries(typeCheckBases.map((base) => [
      base,
      new Set(['check', 'server', 'backend', 'client', 'frontend']),
    ])),
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
  const classifyScript = (script) => {
    const parts = script.split(':');
    const base = parts[0];
    const qualifiers = parts.slice(1);
    const accepted = {
      category: qualifiers.includes('e2e') ? 'e2e' : scriptCategories[base],
      reason: null,
    };

    if (!Object.hasOwn(scriptCategories, base)) {
      return { category: null, reason: 'unrecognised-name' };
    }

    if (scriptScopes[script]) {
      return accepted;
    }

    const unsafeQualifier = qualifiers.find(
      (qualifier) => unsafeQualifiers.has(qualifier),
    );

    if (unsafeQualifier) {
      return { category: null, reason: `unsafe-qualifier: ${unsafeQualifier}` };
    }

    const allowedQualifiers = safeQualifiers[base];
    const unsupportedQualifier = allowedQualifiers
      ? qualifiers.find((qualifier) => !allowedQualifiers.has(qualifier))
      : undefined;

    if (unsupportedQualifier) {
      return {
        category: null,
        reason: `unsupported-qualifier: ${unsupportedQualifier}`,
      };
    }

    if (
      script === 'format'
      && Object.hasOwn(packageManifest.scripts ?? {}, 'format:check')
    ) {
      return { category: null, reason: 'superseded-by-format-check' };
    }

    return accepted;
  };
  const addPackageCapability = (category, scope, script) => {
    if (
      typeCheckBases.some(
        (name) => script.split(':').includes(name),
      )
    ) {
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

  const unclassifiedScripts = [];

  for (const [script, scriptCommand] of Object.entries(packageManifest.scripts ?? {})) {
    if (excludedScriptNames.has(script)) {
      continue;
    }

    const { category, reason } = classifyScript(script);

    if (!category) {
      unclassifiedScripts.push({ script, command: scriptCommand, reason });
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
    // Reported, never acted on: naming what was declined keeps a maintainer
    // informed without inferring that any of it is a verification command.
    unclassifiedScripts: unclassifiedScripts.sort(
      (first, second) => (first.script < second.script ? -1 : 1),
    ),
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

const parseArguments = (argumentsList) => {
  const options = {};

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if ([
      '--discover',
      '--migrate-v4',
      '--configure-gate',
      '--draft-mapping',
      '--draft-policy',
    ].includes(argument)) {
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

  // Drafting is a distinct request with a distinct output. It is deliberately
  // not folded into --discover and never chains into migration or the Gate.
  if (options['draft-mapping']) {
    console.log(JSON.stringify(
      await draftMigrationMapping({ projectRoot, out: options.out ?? null }),
      null,
      2,
    ));
    return;
  }

  if (options['draft-policy']) {
    console.log(JSON.stringify(
      await draftGatePolicy({ projectRoot, out: options.out ?? null }),
      null,
      2,
    ));
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

  // A named revision of a configured Gate section, previewed, then confirmed
  // with that preview's token: the direct path the Framework command's
  // `config` revisions drive (`FR-GUIDE-006`, `NFR-REL-004`).
  if (options['revise-gate']) {
    // Every value any named revision takes, read by its own name; the
    // operation refuses a value it does not take.
    const revisionValues = new Set(Object.values(gateRevisions)
      .flatMap(({ argument, options: optional }) => [argument, ...optional]));
    const revisionOptions = {
      projectRoot,
      revision: {
        operation: options['revise-gate'],
        ...Object.fromEntries([...revisionValues].map((name) => [name, options[name]])),
      },
    };
    let result;

    try {
      result = options.confirm
        ? await reviseGate({ ...revisionOptions, confirmation: options.confirm })
        : await previewGateRevision(revisionOptions);
    } catch (error) {
      if (error.reasonCode === undefined) {
        throw error;
      }

      // A refusal is the revision's own answer, stated as one, and never the
      // thrown error's inspection, which would print what it carries.
      console.log(JSON.stringify({ status: 'refused', reasonCode: error.reasonCode, detail: error.message }, null, 2));
      process.exitCode = 2;
      return;
    }

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (options['configure-gate']) {
    if (!options.policy) {
      throw new Error('--policy is required when configuring the Gate');
    }

    const policy = JSON.parse(await readFile(path.resolve(options.policy), 'utf8'));
    const gateOptions = { projectRoot, policy };
    const result = options.confirm
      ? await configureGate({ ...gateOptions, confirmation: options.confirm })
      : await previewGateConfiguration(gateOptions);

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!options.tracker) {
    throw new Error('--tracker is required when configuring a project');
  }

  let result;

  try {
    result = await configureProject({
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
  } catch (error) {
    if (error.reasonCode === undefined) {
      throw error;
    }

    // Stated as `--revise-gate` states its refusals: a document, exit 2.
    console.log(JSON.stringify({ status: 'refused', reasonCode: error.reasonCode, detail: error.message }, null, 2));
    process.exitCode = 2;
    return;
  }

  console.log(JSON.stringify(result, null, 2));
};

if (isCliEntryPoint(import.meta.url)) {
  await runCli();
}
