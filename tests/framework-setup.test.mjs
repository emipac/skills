import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  configureProject,
  discoverProject,
} from '../skills/framework-setup/scripts/configure.mjs';

const createLaravelFixture = async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'ai-framework-setup-'));

  await mkdir(path.join(projectRoot, 'docs', 'conventions'), { recursive: true });
  await mkdir(path.join(projectRoot, 'docs', 'specifications'), { recursive: true });
  await mkdir(path.join(projectRoot, '.git'), { recursive: true });
  await mkdir(path.join(projectRoot, 'packages', 'module'), { recursive: true });
  await mkdir(path.join(projectRoot, 'vendor', 'bin'), { recursive: true });
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
      format: ['vendor/bin/pint --dirty --format agent'],
      static_analysis: [
        'vendor/bin/phpstan analyse',
        'npm run lint',
        'npm run typecheck',
      ],
      test: ['php artisan test --compact', 'npm run test'],
      smoke: [],
      build: ['npm run build'],
      e2e: ['npm run e2e'],
    },
  });
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
  assert.match(firstConfiguration, /^    smoke: \[\]$/m);
  assert.match(firstConfiguration, /^schema_version: 2$/m);
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
