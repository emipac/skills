import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  configureProject,
  discoverVerification,
  discoverProject,
} from '../skills/framework-setup/scripts/configure.mjs';

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
