import path from 'node:path';

import { PACKAGE_LOCK_FILES, verificationCategories, verificationScopes } from '../contracts.mjs';
import { exists } from '../filesystem.mjs';
import { sortUnique } from '../values.mjs';

const emptyScopedCommands = () => Object.fromEntries(
  verificationCategories.map((category) => [
    category,
    { backend: [], frontend: [], both: [] },
  ]),
);

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
