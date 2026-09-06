import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import * as frameworkSetup from '../skills/framework-setup/scripts/configure.mjs';
import {
  configureProject,
  discoverVerification,
  discoverProject,
} from '../skills/framework-setup/scripts/configure.mjs';

const execFileAsync = promisify(execFile);
const configureScript = fileURLToPath(
  new URL('../skills/framework-setup/scripts/configure.mjs', import.meta.url),
);
const configurationSchemaPath = fileURLToPath(
  new URL(
    '../skills/framework-setup/references/agent-framework.schema.json',
    import.meta.url,
  ),
);

const createLaravelFixture = async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'ai-framework-setup-'));

  await mkdir(path.join(projectRoot, 'docs', 'conventions'), { recursive: true });
  await mkdir(path.join(projectRoot, 'docs', 'specifications'), { recursive: true });
  await mkdir(path.join(projectRoot, '.git'), { recursive: true });
  await mkdir(path.join(projectRoot, 'packages', 'module'), { recursive: true });
  await mkdir(path.join(projectRoot, 'vendor', 'bin'), { recursive: true });
  await mkdir(path.join(projectRoot, 'app'), { recursive: true });
  await mkdir(path.join(projectRoot, 'resources', 'js'), { recursive: true });
  await writeFile(path.join(projectRoot, 'AGENTS.md'), 'boost-generated\n');
  await writeFile(
    path.join(projectRoot, 'packages', 'module', 'AGENTS.md'),
    'module-generated\n',
  );
  await writeFile(path.join(projectRoot, 'project-guidelines.md'), '# Guidelines\n');
  await writeFile(
    path.join(projectRoot, 'docs', 'conventions', 'testing.md'),
    '# Testing\n',
  );
  await writeFile(
    path.join(projectRoot, 'docs', 'specifications', 'srs.md'),
    '# SRS\n',
  );
  await writeFile(
    path.join(projectRoot, 'composer.json'),
    `${JSON.stringify({ require: { 'laravel/framework': '^13.0' } }, null, 2)}\n`,
  );
  await writeFile(
    path.join(projectRoot, 'package.json'),
    `${JSON.stringify({
      dependencies: { react: '^19.0.0' },
      devDependencies: { typescript: '^6.0.0' },
      scripts: {
        lint: 'eslint .',
        typecheck: 'tsc --noEmit',
        test: 'vitest run',
        build: 'vite build',
        e2e: 'playwright test',
      },
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(projectRoot, '.git', 'config'),
    '[remote "origin"]\n\turl = git@github.com:acme/example.git\n',
  );
  await writeFile(path.join(projectRoot, 'artisan'), '');
  await writeFile(path.join(projectRoot, 'vendor', 'bin', 'pint'), '');
  await writeFile(path.join(projectRoot, 'vendor', 'bin', 'phpstan'), '');
  await writeFile(path.join(projectRoot, 'app', 'Order.php'), '<?php\n');
  await writeFile(path.join(projectRoot, 'resources', 'js', 'app.tsx'), 'export {};\n');

  return projectRoot;
};

const createExpressFixture = async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'ai-framework-express-'));

  await mkdir(path.join(projectRoot, 'server', 'routes'), { recursive: true });
  await mkdir(path.join(projectRoot, 'src', 'pages'), { recursive: true });
  await mkdir(path.join(projectRoot, 'shared'), { recursive: true });
  await writeFile(path.join(projectRoot, 'server', 'index.ts'), 'export {};\n');
  await writeFile(path.join(projectRoot, 'server', 'routes', 'users.ts'), 'export {};\n');
  await writeFile(path.join(projectRoot, 'src', 'pages', 'Users.tsx'), 'export {};\n');
  await writeFile(path.join(projectRoot, 'shared', 'user.ts'), 'export {};\n');
  await writeFile(path.join(projectRoot, 'tsconfig.json'), '{}\n');
  await writeFile(
    path.join(projectRoot, 'package.json'),
    `${JSON.stringify({
      dependencies: { express: '^5.0.0', react: '^19.0.0' },
      devDependencies: { typescript: '^6.0.0' },
      scripts: {
        'lint:server': 'eslint server',
        'typecheck:server': 'tsc --noEmit',
        'test:server': 'vitest run server',
        'smoke:server': 'vitest run server/smoke',
        'build:server': 'tsc',
        'lint:client': 'eslint src',
        'test:client': 'vitest run src',
        'build:client': 'vite build',
        'e2e:client': 'playwright test',
      },
    }, null, 2)}\n`,
  );

  return projectRoot;
};

test('discovers Laravel, frontend, and existing project guidance', async (context) => {
  const projectRoot = await createLaravelFixture();
  context.after(() => rm(projectRoot, { recursive: true, force: true }));

  const discovery = await discoverProject(projectRoot);

  assert.equal(discovery.backend, 'laravel');
  assert.equal(discovery.frontend, 'react-typescript');
  assert.deepEqual(discovery.gitRemotes, [
    { name: 'origin', url: 'git@github.com:acme/example.git' },
  ]);
  assert.equal(discovery.recommendedTracker, 'github');
  assert.deepEqual(discovery.sourceScopes, {
    backend: ['app'],
    frontend: ['resources/js'],
    shared: [],
  });
  assert.deepEqual(discovery.protectedFiles, [
    'AGENTS.md',
    'packages/module/AGENTS.md',
  ]);
  assert.deepEqual(discovery.guidelinePaths, [
    'AGENTS.md',
    'docs/conventions/testing.md',
    'packages/module/AGENTS.md',
    'project-guidelines.md',
  ]);
  assert.deepEqual(discovery.srsCandidates, ['docs/specifications/srs.md']);
  assert.deepEqual(discovery.verification, {
    profile: 'laravel-react-typescript',
    capabilities: [
      'frontend-build',
      'frontend-e2e',
      'frontend-lint',
      'frontend-tests',
      'laravel-format',
      'laravel-static-analysis',
      'laravel-tests',
      'typescript',
    ],
    commands: {
      format: {
        backend: ['vendor/bin/pint --dirty --format agent'],
        frontend: [],
        both: [],
      },
      static_analysis: {
        backend: ['vendor/bin/phpstan analyse'],
        frontend: ['npm run lint', 'npm run typecheck'],
        both: [],
      },
      test: {
        backend: ['php artisan test --compact'],
        frontend: ['npm run test'],
        both: [],
      },
      smoke: { backend: [], frontend: [], both: [] },
      build: { backend: [], frontend: ['npm run build'], both: [] },
      e2e: { backend: [], frontend: ['npm run e2e'], both: [] },
    },
    unclassifiedScripts: [],
  });
});

test('discovers Express TypeScript with distinct backend and frontend scopes', async (context) => {
  const projectRoot = await createExpressFixture();
  context.after(() => rm(projectRoot, { recursive: true, force: true }));

  const discovery = await discoverProject(projectRoot);

  assert.equal(discovery.backend, 'express-typescript');
  assert.equal(discovery.frontend, 'react-typescript');
  assert.deepEqual(discovery.sourceScopes, {
    backend: ['server'],
    frontend: ['src'],
    shared: ['shared'],
  });
  assert.equal(discovery.verification.profile, 'express-typescript-react-typescript');
  assert.deepEqual(discovery.verification.commands.static_analysis, {
    backend: ['npm run lint:server', 'npm run typecheck:server'],
    frontend: ['npm run lint:client'],
    both: [],
  });
  assert.deepEqual(discovery.verification.commands.build, {
    backend: ['npm run build:server'],
    frontend: ['npm run build:client'],
    both: [],
  });
});

test('writes confirmed Express source scopes idempotently', async (context) => {
  const projectRoot = await createExpressFixture();
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const options = {
    projectRoot,
    selections: {
      tracker: 'github',
      sourceScopes: {
        backend: ['server'],
        frontend: ['src'],
        shared: ['shared'],
      },
    },
  };

  const first = await configureProject(options);
  const firstConfiguration = await readFile(
    path.join(projectRoot, '.agent-framework.yaml'),
    'utf8',
  );
  const second = await configureProject(options);

  assert.deepEqual(second, first);
  assert.equal(
    await readFile(path.join(projectRoot, '.agent-framework.yaml'), 'utf8'),
    firstConfiguration,
  );
  assert.match(firstConfiguration, /^schema_version: 3$/m);
  assert.match(firstConfiguration, /^backend: express-typescript$/m);
  assert.match(firstConfiguration, /^  backend:\n    - server$/m);
  assert.match(firstConfiguration, /^  frontend:\n    - src$/m);
  assert.match(firstConfiguration, /^  shared:\n    - shared$/m);
  assert.doesNotMatch(firstConfiguration, /^evaluation_gate:/m);
  await assert.rejects(access(path.join(projectRoot, '.git', 'hooks', 'pre-commit')));
  await assert.rejects(access(path.join(projectRoot, '.git', 'ai-skills-framework', 'gate.json')));
});

test('migrates schema version 2 with confirmed source scopes', async (context) => {
  const projectRoot = await createExpressFixture();
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  await writeFile(
    path.join(projectRoot, '.agent-framework.yaml'),
    'schema_version: 2\nbackend: unknown\nfrontend: unknown\n',
  );

  const discovery = await discoverProject(projectRoot);

  assert.deepEqual(discovery.existingConfiguration, {
    schemaVersion: 2,
    backend: 'unknown',
    frontend: 'unknown',
    sourceScopes: null,
  });
  assert.deepEqual(discovery.sourceScopes, {
    backend: ['server'],
    frontend: ['src'],
    shared: ['shared'],
  });

  await configureProject({
    projectRoot,
    selections: {
      tracker: 'local-markdown',
      sourceScopes: discovery.sourceScopes,
    },
  });

  assert.match(
    await readFile(path.join(projectRoot, '.agent-framework.yaml'), 'utf8'),
    /^schema_version: 3$/m,
  );
});

test('previews schema v4 ambiguity without modifying schema v3', async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'ai-framework-migration-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const configurationPath = path.join(projectRoot, '.agent-framework.yaml');
  const originalConfiguration = `schema_version: 3
backend: unknown
frontend: none
tracker: local-markdown
artifacts:
  srs: null
  glossary: null
  adrs: null
guidelines: []
source_scopes:
  backend: []
  frontend: []
  shared:
    - skills
verification:
  profile: unknown
  capabilities: []
  commands:
    test:
      backend: []
      frontend: []
      both:
        - "node scripts/check.mjs | tee output.log"
history:
  path: null
  required: false
protected_files: []
`;
  await writeFile(configurationPath, originalConfiguration);

  assert.equal(typeof frameworkSetup.previewConfigurationMigration, 'function');

  const preview = await frameworkSetup.previewConfigurationMigration({
    projectRoot,
    mappings: { profiles: { backend: 'none' }, commands: {} },
  });

  assert.equal(preview.status, 'requires-mapping');
  assert.equal(preview.fromVersion, 3);
  assert.equal(preview.toVersion, 4);
  assert.equal(preview.previewHash, null);
  assert.deepEqual(preview.ambiguities, [
    {
      path: 'verification.commands.test.both[0]',
      value: 'node scripts/check.mjs | tee output.log',
      required: ['runner', 'args', 'timeout_seconds'],
    },
  ]);
  assert.equal(await readFile(configurationPath, 'utf8'), originalConfiguration);
});

test('previews backend-only, frontend-only, full-stack, and tooling schema v4 profiles', async (context) => {
  const roots = [];
  context.after(() => Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  ));

  for (const scenario of [
    {
      name: 'backend-only',
      backend: 'laravel',
      frontend: 'none',
      profile: 'laravel',
      scope: 'backend',
      sourceScopes: { backend: ['app'], frontend: [], shared: [] },
      profileMappings: {},
    },
    {
      name: 'frontend-only',
      backend: 'unknown',
      frontend: 'react-typescript',
      profile: 'react-typescript',
      scope: 'frontend',
      sourceScopes: { backend: [], frontend: ['src'], shared: [] },
      profileMappings: { backend: 'none' },
    },
    {
      name: 'full-stack',
      backend: 'laravel',
      frontend: 'react-typescript',
      profile: 'laravel-react-typescript',
      scope: 'both',
      sourceScopes: { backend: ['app'], frontend: ['resources/js'], shared: [] },
      profileMappings: {},
    },
    {
      name: 'tooling-only',
      backend: 'unknown',
      frontend: 'none',
      profile: 'tooling',
      scope: 'both',
      sourceScopes: { backend: [], frontend: [], shared: ['skills'] },
      profileMappings: { backend: 'none' },
    },
  ]) {
    const projectRoot = await mkdtemp(path.join(tmpdir(), `ai-framework-${scenario.name}-`));
    roots.push(projectRoot);
    const configurationPath = path.join(projectRoot, '.agent-framework.yaml');
    const sourceScopeLines = (scope, values) => values.length === 0
      ? `  ${scope}: []`
      : `  ${scope}:\n${values.map((value) => `    - ${value}`).join('\n')}`;
    const commands = ['backend', 'frontend', 'both'].map((scope) => (
      scope === scenario.scope
        ? `      ${scope}:\n        - "npm run test:unit"`
        : `      ${scope}: []`
    )).join('\n');
    const originalConfiguration = `schema_version: 3
backend: ${scenario.backend}
frontend: ${scenario.frontend}
tracker: local-markdown
artifacts:
  srs: null
  glossary: null
  adrs: null
guidelines: []
source_scopes:
${sourceScopeLines('backend', scenario.sourceScopes.backend)}
${sourceScopeLines('frontend', scenario.sourceScopes.frontend)}
${sourceScopeLines('shared', scenario.sourceScopes.shared)}
verification:
  profile: legacy
  capabilities: []
  commands:
    test:
${commands}
history:
  path: null
  required: false
protected_files: []
`;
    await writeFile(configurationPath, originalConfiguration);
    const commandPath = `verification.commands.test.${scenario.scope}[0]`;

    const preview = await frameworkSetup.previewConfigurationMigration({
      projectRoot,
      mappings: {
        profiles: scenario.profileMappings,
        commands: { [commandPath]: { timeout_seconds: 300 } },
      },
    });

    assert.equal(preview.status, 'ready');
    assert.match(preview.previewHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(preview.ambiguities, []);
    assert.match(preview.proposedConfiguration, /^schema_version: 4$/m);
    assert.match(
      preview.proposedConfiguration,
      new RegExp(`^backend: ${scenario.backend === 'unknown' ? 'none' : scenario.backend}$`, 'm'),
    );
    assert.match(preview.proposedConfiguration, new RegExp(`^frontend: ${scenario.frontend}$`, 'm'));
    assert.match(
      preview.proposedConfiguration,
      new RegExp(`^  profile: ${scenario.profile}$`, 'm'),
    );
    assert.match(
      preview.proposedConfiguration,
      new RegExp(`^        - \\{"runner":"package-script","args":\\["test:unit"\\],"working_directory":"\\.","timeout_seconds":300,"allowed_environment":\\[\\],"evidence_category":"test","source_scope":"${scenario.scope}"\\}$`, 'm'),
    );
    assert.equal(await readFile(configurationPath, 'utf8'), originalConfiguration);
  }
});

test('rejects schema v4 migration data assigned to an inactive profile', async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'ai-framework-inactive-profile-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const configurationPath = path.join(projectRoot, '.agent-framework.yaml');
  const configuration = `schema_version: 3
backend: unknown
frontend: none
tracker: local-markdown
artifacts:
  srs: null
  glossary: null
  adrs: null
guidelines: []
source_scopes:
  backend:
    - server
  frontend: []
  shared: []
verification:
  profile: unknown
  capabilities: []
  commands:
    test:
      backend:
        - "npm run test:server"
      frontend: []
      both: []
history:
  path: null
  required: false
protected_files: []
`;
  await writeFile(configurationPath, configuration);

  await assert.rejects(
    frameworkSetup.previewConfigurationMigration({
      projectRoot,
      mappings: {
        profiles: { backend: 'none' },
        commands: {
          'verification.commands.test.backend[0]': { timeout_seconds: 300 },
        },
      },
    }),
    /Backend profile none cannot retain backend source scopes or commands/,
  );
  assert.equal(await readFile(configurationPath, 'utf8'), configuration);
});

test('rejects invalid or behavior-changing schema v4 mappings', async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'ai-framework-invalid-mapping-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const configurationPath = path.join(projectRoot, '.agent-framework.yaml');
  const configuration = `schema_version: 3
backend: laravel
frontend: none
tracker: local-markdown
artifacts:
  srs: null
  glossary: null
  adrs: null
guidelines: []
source_scopes:
  backend:
    - app
  frontend: []
  shared: []
verification:
  profile: laravel
  capabilities: []
  commands:
    test:
      backend:
        - "php artisan test --compact"
      frontend: []
      both: []
history:
  path: null
  required: false
protected_files: []
`;
  const commandPath = 'verification.commands.test.backend[0]';
  await writeFile(configurationPath, configuration);

  await assert.rejects(
    frameworkSetup.previewConfigurationMigration({
      projectRoot,
      mappings: {
        profiles: { backend: 'none' },
        commands: { [commandPath]: { timeout_seconds: 300 } },
      },
    }),
    /Profile mapping for backend is only allowed when its schema v3 value is unknown/,
  );
  await assert.rejects(
    frameworkSetup.previewConfigurationMigration({
      projectRoot,
      mappings: {
        commands: {
          [commandPath]: {
            runner: 'shell',
            args: ['artisan', 'test', '--compact'],
            timeout_seconds: 300,
          },
        },
      },
    }),
    /Unsupported command runner: shell/,
  );
  await assert.rejects(
    frameworkSetup.previewConfigurationMigration({
      projectRoot,
      mappings: {
        commands: {
          [commandPath]: {
            working_directory: '../outside',
            timeout_seconds: 300,
          },
        },
      },
    }),
    /Invalid command working directory: \.\.\/outside/,
  );
  assert.equal(await readFile(configurationPath, 'utf8'), configuration);
});

test('atomically installs only the confirmed schema v4 preview', async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'ai-framework-confirmed-migration-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const configurationPath = path.join(projectRoot, '.agent-framework.yaml');
  const originalConfiguration = `schema_version: 3
backend: unknown
frontend: none
tracker: local-markdown
artifacts:
  srs: null
  glossary: null
  adrs: null
guidelines: []
source_scopes:
  backend: []
  frontend: []
  shared:
    - skills
verification:
  profile: unknown
  capabilities: []
  commands:
    test:
      backend: []
      frontend: []
      both:
        - "npm run test:unit"
history:
  path: null
  required: false
protected_files: []
`;
  const mappings = {
    profiles: { backend: 'none' },
    commands: {
      'verification.commands.test.both[0]': { timeout_seconds: 300 },
    },
  };
  await writeFile(configurationPath, originalConfiguration);
  const preview = await frameworkSetup.previewConfigurationMigration({
    projectRoot,
    mappings,
  });

  assert.equal(typeof frameworkSetup.migrateConfiguration, 'function');
  await assert.rejects(
    frameworkSetup.migrateConfiguration({
      projectRoot,
      mappings,
      confirmation: 'stale-preview',
    }),
    /Migration confirmation does not match the current preview/,
  );
  assert.equal(await readFile(configurationPath, 'utf8'), originalConfiguration);

  const result = await frameworkSetup.migrateConfiguration({
    projectRoot,
    mappings,
    confirmation: preview.previewHash,
  });

  assert.equal(result.status, 'migrated');
  assert.equal(result.previewHash, preview.previewHash);
  assert.equal(await readFile(configurationPath, 'utf8'), preview.proposedConfiguration);
  assert.doesNotMatch(preview.proposedConfiguration, /^evaluation_gate:/m);
  assert.deepEqual(
    (await readdir(projectRoot)).filter((entry) => entry.startsWith('.agent-framework.yaml.')),
    [],
  );
});

test('exposes preview and confirmation through the schema v4 migration command', async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'ai-framework-migration-cli-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const configurationPath = path.join(projectRoot, '.agent-framework.yaml');
  const mappingPath = path.join(projectRoot, 'migration-mapping.json');
  const originalConfiguration = `schema_version: 3
backend: unknown
frontend: none
tracker: local-markdown
artifacts:
  srs: null
  glossary: null
  adrs: null
guidelines: []
source_scopes:
  backend: []
  frontend: []
  shared: []
verification:
  profile: unknown
  capabilities: []
  commands: {}
history:
  path: null
  required: false
protected_files: []
`;
  await writeFile(configurationPath, originalConfiguration);
  await writeFile(mappingPath, '{"profiles":{"backend":"none"}}\n');

  const previewOutput = await execFileAsync(process.execPath, [
    configureScript,
    '--migrate-v4',
    '--project',
    projectRoot,
    '--mapping',
    mappingPath,
  ]);
  const preview = JSON.parse(previewOutput.stdout);

  assert.equal(preview.status, 'ready');
  assert.equal(await readFile(configurationPath, 'utf8'), originalConfiguration);

  const migrationOutput = await execFileAsync(process.execPath, [
    configureScript,
    '--migrate-v4',
    '--project',
    projectRoot,
    '--mapping',
    mappingPath,
    '--confirm',
    preview.previewHash,
  ]);
  const migration = JSON.parse(migrationOutput.stdout);

  assert.equal(migration.status, 'migrated');
  assert.match(await readFile(configurationPath, 'utf8'), /^schema_version: 4$/m);
});

test('reads schema v4 profile presence and source scopes', async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'ai-framework-read-v4-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  await writeFile(
    path.join(projectRoot, '.agent-framework.yaml'),
    `schema_version: 4
backend: none
frontend: react-typescript
source_scopes:
  backend: []
  frontend:
    - src
  shared:
    - shared
`,
  );

  const discovery = await discoverProject(projectRoot);

  assert.deepEqual(discovery.existingConfiguration, {
    schemaVersion: 4,
    backend: 'none',
    frontend: 'react-typescript',
    sourceScopes: {
      backend: [],
      frontend: ['src'],
      shared: ['shared'],
    },
  });
});

test('defines distinct schema v3 and v4 verification contracts', async () => {
  const schema = JSON.parse(await readFile(configurationSchemaPath, 'utf8'));
  const schemaV3 = schema.$defs.schemaV3;
  const schemaV4 = schema.$defs.schemaV4;
  const descriptor = schema.$defs.commandDescriptor;

  assert.deepEqual(schema.oneOf, [
    { $ref: '#/$defs/schemaV3' },
    { $ref: '#/$defs/schemaV4' },
  ]);
  assert.equal(schemaV3.properties.schema_version.const, 3);
  assert.equal(schemaV4.properties.schema_version.const, 4);
  assert.doesNotMatch(
    JSON.stringify(schemaV3.properties.backend),
    /none/,
  );
  assert.match(
    JSON.stringify(schema.$defs.backendProfileV4),
    /none/,
  );
  assert.equal(
    schema.$defs.rawCommandScopes.properties.backend.$ref,
    '#/$defs/uniqueStrings',
  );
  assert.equal(schema.$defs.uniqueStrings.items.type, 'string');
  assert.equal(
    schema.$defs.descriptorCommandScopes.properties.backend.items.$ref,
    '#/$defs/backendCommandDescriptor',
  );
  assert.deepEqual(descriptor.required, [
    'runner',
    'args',
    'working_directory',
    'timeout_seconds',
    'allowed_environment',
    'evidence_category',
    'source_scope',
  ]);
  assert.deepEqual(descriptor.properties.runner.enum, [
    'composer-bin',
    'php-script',
    'package-script',
    'repository-script',
  ]);
  assert.equal(schemaV3.properties.evaluation_gate, undefined);
  assert.equal(schemaV4.properties.evaluation_gate.$ref, '#/$defs/evaluationGate');
  assert.deepEqual(schema.$defs.evaluationGate.required, [
    'checks',
    'budget',
    'bypass',
    'execution',
    'evidence',
  ]);
  assert.equal(schema.$defs.evaluationGate.additionalProperties, false);
  assert.deepEqual(schema.$defs.gateChecks.required, ['required', 'advisory']);
  assert.equal(schema.$defs.gateChecks.additionalProperties, false);
  assert.equal(schema.$defs.gateBudget.properties.total_seconds.minimum, 1);
  assert.equal(
    schema.$defs.evaluationGate.properties.execution.$ref,
    '#/$defs/gatePolicySubcontract',
  );
  assert.match(JSON.stringify(schema.$defs.gatePolicySubcontract), /commands/);
});

test('previews explicit Gate configuration without activating or modifying the repository', async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'ai-framework-gate-preview-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const configurationPath = path.join(projectRoot, '.agent-framework.yaml');
  const originalConfiguration = `schema_version: 4
backend: none
frontend: none
tracker: local-markdown
artifacts:
  srs: null
  glossary: null
  adrs: null
guidelines: []
source_scopes:
  backend: []
  frontend: []
  shared: []
verification:
  profile: tooling
  capabilities: []
  commands: {}
history:
  path: null
  required: false
protected_files: []
`;
  const policy = {
    checks: {
      required: ['unit'],
      advisory: ['review'],
    },
    budget: { total_seconds: 600 },
    bypass: { enabled: false },
    execution: {},
    evidence: {},
  };
  await writeFile(configurationPath, originalConfiguration);

  assert.equal(typeof frameworkSetup.previewGateConfiguration, 'function');
  const preview = await frameworkSetup.previewGateConfiguration({ projectRoot, policy });

  assert.equal(preview.status, 'ready');
  assert.equal(preview.configured, false);
  assert.match(preview.previewHash, /^[a-f0-9]{64}$/);
  assert.match(preview.proposedConfiguration, /^evaluation_gate:$/m);
  assert.match(preview.proposedConfiguration, /^  checks: /m);
  assert.match(preview.proposedConfiguration, /^  budget: /m);
  assert.match(preview.proposedConfiguration, /^  bypass: /m);
  assert.match(preview.proposedConfiguration, /^  execution: /m);
  assert.match(preview.proposedConfiguration, /^  evidence: /m);
  assert.equal(await readFile(configurationPath, 'utf8'), originalConfiguration);
  await assert.rejects(access(path.join(projectRoot, '.git', 'hooks', 'pre-commit')));
  await assert.rejects(access(path.join(projectRoot, '.git', 'ai-skills-framework', 'gate.json')));
});

test('configures the dormant Gate only after exact preview confirmation', async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'ai-framework-gate-configure-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const configurationPath = path.join(projectRoot, '.agent-framework.yaml');
  const originalConfiguration = `schema_version: 4
backend: none
frontend: none
tracker: local-markdown
artifacts: {"srs":null,"glossary":null,"adrs":null}
guidelines: []
source_scopes: {"backend":[],"frontend":[],"shared":[]}
verification: {"profile":"tooling","capabilities":[],"commands":{}}
history: {"path":null,"required":false}
protected_files: []
`;
  const policy = {
    checks: { required: ['unit'], advisory: [] },
    budget: { total_seconds: 300 },
    bypass: { enabled: false },
    execution: {},
    evidence: {},
  };
  await writeFile(configurationPath, originalConfiguration);
  const preview = await frameworkSetup.previewGateConfiguration({ projectRoot, policy });

  assert.equal(typeof frameworkSetup.configureGate, 'function');
  await assert.rejects(
    frameworkSetup.configureGate({ projectRoot, policy, confirmation: 'stale-preview' }),
    /Gate configuration confirmation does not match the current preview/,
  );
  assert.equal(await readFile(configurationPath, 'utf8'), originalConfiguration);

  const result = await frameworkSetup.configureGate({
    projectRoot,
    policy,
    confirmation: preview.previewHash,
  });

  assert.equal(result.status, 'configured');
  assert.equal(result.activated, false);
  assert.equal(result.previewHash, preview.previewHash);
  assert.equal(await readFile(configurationPath, 'utf8'), preview.proposedConfiguration);
  assert.deepEqual(
    (await readdir(projectRoot)).filter((entry) => entry.startsWith('.agent-framework.yaml.')),
    [],
  );
  await assert.rejects(access(path.join(projectRoot, '.git', 'hooks', 'pre-commit')));
  await assert.rejects(access(path.join(projectRoot, '.git', 'ai-skills-framework', 'gate.json')));
});

test('rejects Gate configuration outside the strict schema v4 policy boundary', async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'ai-framework-gate-invalid-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const configurationPath = path.join(projectRoot, '.agent-framework.yaml');
  const policy = {
    checks: { required: ['unit'], advisory: [] },
    budget: { total_seconds: 300 },
    bypass: { enabled: false },
    execution: {},
    evidence: {},
  };
  await writeFile(configurationPath, 'schema_version: 3\n');

  await assert.rejects(
    frameworkSetup.previewGateConfiguration({ projectRoot, policy }),
    /Gate configuration requires schema version 4, found 3/,
  );

  await writeFile(configurationPath, 'schema_version: 4\n');
  const { evidence: _evidence, ...missingSubcontract } = policy;

  await assert.rejects(
    frameworkSetup.previewGateConfiguration({ projectRoot, policy: missingSubcontract }),
    /Missing Gate policy subcontract: evidence/,
  );
  await assert.rejects(
    frameworkSetup.previewGateConfiguration({
      projectRoot,
      policy: { ...policy, commands: ['npm test'] },
    }),
    /Unsupported Gate policy subcontract: commands/,
  );
  await assert.rejects(
    frameworkSetup.previewGateConfiguration({
      projectRoot,
      policy: { ...policy, activated: true },
    }),
    /Unsupported Gate policy subcontract: activated/,
  );
  await assert.rejects(
    frameworkSetup.previewGateConfiguration({
      projectRoot,
      policy: { ...policy, execution: { commands: ['npm test'] } },
    }),
    /Gate policy cannot own verification or activation field: commands/,
  );
  await assert.rejects(
    frameworkSetup.previewGateConfiguration({
      projectRoot,
      policy: {
        ...policy,
        checks: { required: [{ id: 'unit' }], advisory: [] },
      },
    }),
    /Gate required check identities must be unique non-empty strings/,
  );
  await assert.rejects(
    frameworkSetup.previewGateConfiguration({
      projectRoot,
      policy: {
        ...policy,
        checks: { required: ['unit'], advisory: ['unit'] },
      },
    }),
    /Gate check identity cannot be both required and advisory: unit/,
  );
  await writeFile(configurationPath, 'schema_version: 4\nevaluation_gate: {}\n');
  await assert.rejects(
    frameworkSetup.previewGateConfiguration({ projectRoot, policy }),
    /The Gate is already configured/,
  );
  assert.equal(
    await readFile(configurationPath, 'utf8'),
    'schema_version: 4\nevaluation_gate: {}\n',
  );
});

test('exposes dormant Gate configuration through an explicit previewed command', async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'ai-framework-gate-cli-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const configurationPath = path.join(projectRoot, '.agent-framework.yaml');
  const policyPath = path.join(projectRoot, 'gate-policy.json');
  const originalConfiguration = 'schema_version: 4\nhistory: {}\n';
  const policy = {
    checks: { required: ['unit'], advisory: [] },
    budget: { total_seconds: 300 },
    bypass: { enabled: false },
    execution: {},
    evidence: {},
  };
  await writeFile(configurationPath, originalConfiguration);
  await writeFile(policyPath, `${JSON.stringify(policy)}\n`);

  const previewOutput = await execFileAsync(process.execPath, [
    configureScript,
    '--configure-gate',
    '--project',
    projectRoot,
    '--policy',
    policyPath,
  ]);
  const preview = JSON.parse(previewOutput.stdout);

  assert.equal(preview.status, 'ready');
  assert.equal(await readFile(configurationPath, 'utf8'), originalConfiguration);

  const configureOutput = await execFileAsync(process.execPath, [
    configureScript,
    '--configure-gate',
    '--project',
    projectRoot,
    '--policy',
    policyPath,
    '--confirm',
    preview.previewHash,
  ]);
  const result = JSON.parse(configureOutput.stdout);

  assert.equal(result.status, 'configured');
  assert.equal(result.activated, false);
  assert.match(await readFile(configurationPath, 'utf8'), /^evaluation_gate:$/m);
});

test('rejects unsafe source roots', async (context) => {
  const projectRoot = await createExpressFixture();
  context.after(() => rm(projectRoot, { recursive: true, force: true }));

  await assert.rejects(
    configureProject({
      projectRoot,
      selections: {
        tracker: 'local-markdown',
        sourceScopes: {
          backend: ['../server'],
          frontend: ['src'],
          shared: [],
        },
      },
    }),
    /Invalid backend source root/,
  );
});

test('configuration is idempotent and preserves AGENTS.md byte-for-byte', async (context) => {
  const projectRoot = await createLaravelFixture();
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const agentsBefore = await readFile(path.join(projectRoot, 'AGENTS.md'));
  const moduleAgentsBefore = await readFile(
    path.join(projectRoot, 'packages', 'module', 'AGENTS.md'),
  );
  const options = {
    projectRoot,
    selections: {
      tracker: 'linear',
      srsPath: 'docs/specifications/srs.md',
      historyPath: 'docs/history',
    },
  };

  const firstResult = await configureProject(options);
  const firstConfiguration = await readFile(
    path.join(projectRoot, '.agent-framework.yaml'),
    'utf8',
  );
  const firstTrackerAdapter = await readFile(
    path.join(projectRoot, 'docs', 'agents', 'issue-tracker.md'),
    'utf8',
  );
  const secondResult = await configureProject(options);

  assert.deepEqual(secondResult, firstResult);
  assert.equal(
    await readFile(path.join(projectRoot, '.agent-framework.yaml'), 'utf8'),
    firstConfiguration,
  );
  assert.equal(
    await readFile(path.join(projectRoot, 'docs', 'agents', 'issue-tracker.md'), 'utf8'),
    firstTrackerAdapter,
  );
  assert.deepEqual(await readFile(path.join(projectRoot, 'AGENTS.md')), agentsBefore);
  assert.deepEqual(
    await readFile(path.join(projectRoot, 'packages', 'module', 'AGENTS.md')),
    moduleAgentsBefore,
  );
  assert.match(firstConfiguration, /^    smoke:$/m);
  assert.match(firstConfiguration, /^schema_version: 3$/m);
  assert.match(firstConfiguration, /^source_scopes:$/m);
  assert.match(firstConfiguration, /^  profile: laravel-react-typescript$/m);
  assert.match(firstConfiguration, /^    - laravel-tests$/m);
  assert.match(firstConfiguration, /^tracker: linear$/m);
  assert.match(firstConfiguration, /^backend: laravel$/m);
  assert.match(firstConfiguration, /^frontend: react-typescript$/m);
});

test('explicit null selections do not fall back to discovered artifacts', async (context) => {
  const projectRoot = await createLaravelFixture();
  context.after(() => rm(projectRoot, { recursive: true, force: true }));

  await configureProject({
    projectRoot,
    selections: {
      tracker: 'local-markdown',
      srsPath: null,
      glossaryPath: null,
      adrPath: null,
      historyPath: null,
    },
  });

  const configuration = await readFile(
    path.join(projectRoot, '.agent-framework.yaml'),
    'utf8',
  );

  assert.match(configuration, /^  srs: null$/m);
  assert.match(configuration, /^  glossary: null$/m);
  assert.match(configuration, /^  adrs: null$/m);
  assert.match(configuration, /^  path: null$/m);
  assert.match(configuration, /^  required: false$/m);
});

test('new projects reserve the default SRS path without creating the document', async (context) => {
  const projectRoot = await createLaravelFixture();
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  await unlink(path.join(projectRoot, 'docs', 'specifications', 'srs.md'));

  const result = await configureProject({
    projectRoot,
    selections: {
      tracker: 'local-markdown',
    },
  });

  assert.equal(result.configuration.artifacts.srs, 'docs/specifications/srs.md');
  await assert.rejects(access(path.join(projectRoot, 'docs', 'specifications', 'srs.md')));
});

for (const tracker of ['local-markdown', 'github', 'jira', 'linear']) {
  test(`writes the ${tracker} tracker adapter`, async (context) => {
    const projectRoot = await createLaravelFixture();
    context.after(() => rm(projectRoot, { recursive: true, force: true }));

    await configureProject({
      projectRoot,
      selections: {
        tracker,
        srsPath: 'docs/specifications/srs.md',
        historyPath: 'docs/history',
      },
    });

    const trackerDocument = await readFile(
      path.join(projectRoot, 'docs', 'agents', 'issue-tracker.md'),
      'utf8',
    );

    assert.match(trackerDocument, new RegExp(`^adapter: ${tracker}$`, 'm'));
  });
}

for (const [fixture, frontend, sourceScopes] of [
  [
    'express-typescript',
    'none',
    { backend: ['server'], frontend: [], shared: [] },
  ],
  [
    'express-react-typescript',
    'react-typescript',
    { backend: ['server'], frontend: ['src'], shared: [] },
  ],
  [
    'express-svelte-typescript',
    'svelte-typescript',
    { backend: ['backend'], frontend: ['frontend'], shared: [] },
  ],
]) {
  test(`discovers the ${fixture} compatibility fixture`, async () => {
    const discovery = await discoverProject(
      path.join(process.cwd(), 'fixtures', fixture),
    );

    assert.equal(discovery.backend, 'express-typescript');
    assert.equal(discovery.frontend, frontend);
    assert.deepEqual(discovery.sourceScopes, sourceScopes);
  });
}

for (const [fixture, frontend, sourceScopes] of [
  ['laravel-only', 'none', { backend: ['app'], frontend: [], shared: [] }],
  [
    'laravel-livewire',
    'livewire',
    { backend: ['app', 'resources/views'], frontend: [], shared: [] },
  ],
  [
    'laravel-react-typescript',
    'react-typescript',
    { backend: ['app'], frontend: ['resources/js'], shared: [] },
  ],
  [
    'laravel-svelte-typescript',
    'svelte-typescript',
    { backend: ['app'], frontend: ['resources/js'], shared: [] },
  ],
]) {
  test(`preserves the ${fixture} compatibility fixture`, async () => {
    const discovery = await discoverProject(
      path.join(process.cwd(), 'fixtures', fixture),
    );

    assert.equal(discovery.backend, 'laravel');
    assert.equal(discovery.frontend, frontend);
    assert.deepEqual(discovery.sourceScopes, sourceScopes);
  });
}

test('keeps plain JavaScript Express on the conservative unknown profile', async () => {
  const discovery = await discoverProject(
    path.join(process.cwd(), 'fixtures', 'express-javascript'),
  );

  assert.equal(discovery.backend, 'unknown');
  assert.equal(discovery.frontend, 'unknown');
});

test('preserves confirmed ambiguous source roots for conservative planning', async () => {
  const discovery = await discoverProject(
    path.join(process.cwd(), 'fixtures', 'express-ambiguous-source'),
  );

  assert.equal(discovery.backend, 'express-typescript');
  assert.equal(discovery.frontend, 'react-typescript');
  assert.deepEqual(discovery.sourceScopes, {
    backend: ['src'],
    frontend: ['src'],
    shared: [],
  });
});

test('exposes missing Express verification capabilities', async () => {
  const discovery = await discoverProject(
    path.join(process.cwd(), 'fixtures', 'express-missing-checks'),
  );

  assert.equal(discovery.backend, 'express-typescript');
  assert.deepEqual(discovery.verification.capabilities, ['express-build']);
});

test('does not infer unsupported workspace package profiles', async () => {
  const discovery = await discoverProject(
    path.join(process.cwd(), 'fixtures', 'express-workspace-unsupported'),
  );

  assert.equal(discovery.backend, 'unknown');
  assert.equal(discovery.frontend, 'none');
});

test('discovers safe qualified verification scripts and source-root scopes', async () => {
  const discovery = await discoverProject(
    path.join(process.cwd(), 'fixtures', 'express-realistic-scripts'),
  );

  assert.deepEqual(discovery.sourceScopes, {
    backend: ['database', 'server'],
    frontend: ['src'],
    shared: [],
  });
  assert.deepEqual(discovery.verification.commands, {
    format: {
      backend: [],
      frontend: [],
      both: ['npm run format:check'],
    },
    static_analysis: {
      backend: [],
      frontend: [],
      both: ['npm run lint', 'npm run type-check'],
    },
    test: {
      backend: ['npm run test:unit', 'npm run test:integration'],
      frontend: ['npm run test:frontend'],
      both: ['npm run test'],
    },
    smoke: {
      backend: [],
      frontend: [],
      both: ['npm run smoke:search'],
    },
    build: {
      backend: [],
      frontend: ['npm run build:frontend'],
      both: ['npm run build'],
    },
    e2e: {
      backend: [],
      frontend: [],
      both: [],
    },
  });
});

test('removes explicitly excluded package scripts from verification discovery', async () => {
  const fixtureRoot = path.join(
    process.cwd(),
    'fixtures',
    'express-realistic-scripts',
  );
  const packageManifest = JSON.parse(
    await readFile(path.join(fixtureRoot, 'package.json'), 'utf8'),
  );
  const verification = await discoverVerification(
    fixtureRoot,
    packageManifest,
    {
      backend: 'express-typescript',
      frontend: 'react-typescript',
      sourceScopes: {
        backend: ['database', 'server'],
        frontend: ['src'],
        shared: [],
      },
      excludedScripts: ['build', 'test'],
    },
  );

  assert.deepEqual(verification.commands.test.both, []);
  assert.deepEqual(verification.commands.build.both, []);
  assert.deepEqual(verification.commands.test.backend, [
    'npm run test:unit',
    'npm run test:integration',
  ]);
});

const unrecognisedScriptNames = {
  'lint:check': 'eslint .',
  'types:check': 'svelte-check --tsconfig ./tsconfig.json',
  'types:watch': 'svelte-check --watch',
  'types:fix': 'svelte-check --fix',
  'build:ssr': 'vite build --ssr',
  dev: 'vite',
  setup: 'composer install',
  'post-autoload-dump': 'php artisan package:discover',
};

const createScriptClassificationFixture = async (scripts) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'ai-framework-scripts-'));

  await mkdir(path.join(projectRoot, 'app'), { recursive: true });
  await mkdir(path.join(projectRoot, 'resources', 'js'), { recursive: true });
  await writeFile(
    path.join(projectRoot, 'composer.json'),
    `${JSON.stringify({
      require: { 'laravel/framework': '^13.0' },
      scripts: {
        'types:check': ['phpstan analyse'],
        setup: ['composer install'],
        'post-autoload-dump': ['php artisan package:discover'],
      },
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(projectRoot, 'package.json'),
    `${JSON.stringify({
      dependencies: { svelte: '^5.0.0' },
      devDependencies: { typescript: '^6.0.0' },
      scripts,
    }, null, 2)}\n`,
  );
  await writeFile(path.join(projectRoot, 'app', 'Order.php'), '<?php\n');
  await writeFile(
    path.join(projectRoot, 'resources', 'js', 'app.svelte'),
    '<script></script>\n',
  );

  return projectRoot;
};

test('classifies a types-prefixed script as a type check', async (context) => {
  const projectRoot = await createScriptClassificationFixture(unrecognisedScriptNames);
  context.after(() => rm(projectRoot, { recursive: true, force: true }));

  const discovery = await discoverProject(projectRoot);

  assert.deepEqual(discovery.verification.commands.static_analysis, {
    backend: [],
    frontend: ['npm run lint:check', 'npm run types:check'],
    both: [],
  });
  assert.ok(discovery.verification.capabilities.includes('typescript'));
});

test('still refuses an unsafe qualifier on a types-prefixed script', async (context) => {
  const projectRoot = await createScriptClassificationFixture(unrecognisedScriptNames);
  context.after(() => rm(projectRoot, { recursive: true, force: true }));

  const discovery = await discoverProject(projectRoot);
  const everyCommand = Object.values(discovery.verification.commands).flatMap(
    (scopes) => Object.values(scopes).flat(),
  );

  assert.ok(!everyCommand.includes('npm run types:watch'));
  assert.ok(!everyCommand.includes('npm run types:fix'));
  assert.deepEqual(
    discovery.verification.unclassifiedScripts
      .filter((entry) => entry.script.startsWith('types:'))
      .map((entry) => [entry.script, entry.reason]),
    [
      ['types:fix', 'unsafe-qualifier: fix'],
      ['types:watch', 'unsafe-qualifier: watch'],
    ],
  );
});

test('names every package script the resolver declined, in a stable order', async (context) => {
  const projectRoot = await createScriptClassificationFixture(unrecognisedScriptNames);
  context.after(() => rm(projectRoot, { recursive: true, force: true }));

  const discovery = await discoverProject(projectRoot);

  assert.deepEqual(discovery.verification.unclassifiedScripts, [
    {
      script: 'build:ssr',
      command: 'vite build --ssr',
      reason: 'unsupported-qualifier: ssr',
    },
    { script: 'dev', command: 'vite', reason: 'unrecognised-name' },
    {
      script: 'post-autoload-dump',
      command: 'php artisan package:discover',
      reason: 'unrecognised-name',
    },
    { script: 'setup', command: 'composer install', reason: 'unrecognised-name' },
    {
      script: 'types:fix',
      command: 'svelte-check --fix',
      reason: 'unsafe-qualifier: fix',
    },
    {
      script: 'types:watch',
      command: 'svelte-check --watch',
      reason: 'unsafe-qualifier: watch',
    },
  ]);
  assert.equal(
    JSON.stringify(await discoverProject(projectRoot)),
    JSON.stringify(discovery),
  );
});

test('reports a superseded format script rather than dropping it silently', async (context) => {
  const projectRoot = await createScriptClassificationFixture({
    format: 'prettier --write resources/',
    'format:check': 'prettier --check resources/',
  });
  context.after(() => rm(projectRoot, { recursive: true, force: true }));

  const discovery = await discoverProject(projectRoot);

  assert.deepEqual(discovery.verification.commands.format.frontend, [
    'npm run format:check',
  ]);
  assert.deepEqual(discovery.verification.unclassifiedScripts, [
    {
      script: 'format',
      command: 'prettier --write resources/',
      reason: 'superseded-by-format-check',
    },
  ]);
});

test('reports an empty not-classified list when every script is recognised', async (context) => {
  const projectRoot = await createScriptClassificationFixture({
    'lint:check': 'eslint .',
    'types:check': 'svelte-check --tsconfig ./tsconfig.json',
  });
  context.after(() => rm(projectRoot, { recursive: true, force: true }));

  const discovery = await discoverProject(projectRoot);

  assert.deepEqual(discovery.verification.unclassifiedScripts, []);
});

test('unrecognised scripts neither block configuration nor change what is written', async (context) => {
  const noisyRoot = await createScriptClassificationFixture(unrecognisedScriptNames);
  const quietRoot = await createScriptClassificationFixture({
    'lint:check': 'eslint .',
    'types:check': 'svelte-check --tsconfig ./tsconfig.json',
  });
  context.after(() => rm(noisyRoot, { recursive: true, force: true }));
  context.after(() => rm(quietRoot, { recursive: true, force: true }));
  const selections = { tracker: 'local-markdown' };

  const noisyResult = await configureProject({ projectRoot: noisyRoot, selections });
  const noisyConfiguration = await readFile(
    path.join(noisyRoot, '.agent-framework.yaml'),
    'utf8',
  );

  await configureProject({ projectRoot: quietRoot, selections });

  assert.equal(
    noisyConfiguration,
    await readFile(path.join(quietRoot, '.agent-framework.yaml'), 'utf8'),
  );
  assert.ok(!noisyConfiguration.includes('post-autoload-dump'));
  assert.ok(!noisyConfiguration.includes('unclassified'));

  const repeated = await configureProject({ projectRoot: noisyRoot, selections });

  assert.deepEqual(repeated, noisyResult);
  assert.equal(
    await readFile(path.join(noisyRoot, '.agent-framework.yaml'), 'utf8'),
    noisyConfiguration,
  );

  const discoverRun = await execFileAsync(
    process.execPath,
    [configureScript, '--discover', '--project-root', noisyRoot],
  );

  assert.equal(discoverRun.stderr, '');
  assert.ok(!JSON.parse(discoverRun.stdout).ambiguities);
});

test('composer scripts are outside the package-script resolver', async (context) => {
  const projectRoot = await createScriptClassificationFixture({
    'lint:check': 'eslint .',
  });
  context.after(() => rm(projectRoot, { recursive: true, force: true }));

  const discovery = await discoverProject(projectRoot);

  assert.deepEqual(discovery.verification.unclassifiedScripts, []);
});
