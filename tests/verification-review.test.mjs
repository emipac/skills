import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  auditVerificationEvidence,
  parseVerificationConfiguration,
  planVerification,
} from '../skills/verify-change/scripts/verification-plan.mjs';
import { discoverVerification } from '../skills/framework-setup/scripts/configure.mjs';

const root = process.cwd();
const execFileAsync = promisify(execFile);

const verification = {
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
    smoke: ['php artisan test --compact --filter=smoke'],
    build: ['npm run build'],
    e2e: ['npm run e2e'],
  },
};

test('plans required verification from focused evidence to broad suites', () => {
  const result = planVerification({
    verification,
    changedFiles: [
      'app/Actions/CreateOrder.php',
      'resources/js/pages/orders/Create.tsx',
    ],
    userFacing: true,
    ticketRows: [
      {
        layer: 'targeted',
        evidence: 'AC-ORDER-001 creates an order',
        command: 'php artisan test --compact tests/Feature/CreateOrderTest.php',
        required: true,
      },
      {
        layer: 'affected',
        evidence: 'Order domain remains green',
        command: 'php artisan test --compact tests/Feature/Orders',
        required: true,
      },
    ],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(
    [...new Set(result.steps.map((step) => step.stage))],
    [
      'focused',
      'format',
      'static-analysis',
      'affected-tests',
      'smoke',
      'build',
      'browser',
      'broad-tests',
    ],
  );
  assert.equal(result.steps[0].acceptanceIds[0], 'AC-ORDER-001');
  assert.equal(result.steps.every((step) => step.command.length > 0), true);
});

test('requires smoke or browser capability for a user-facing change', () => {
  const result = planVerification({
    verification: {
      ...verification,
      capabilities: verification.capabilities.filter(
        (capability) => capability !== 'frontend-e2e',
      ),
      commands: { ...verification.commands, smoke: [], e2e: [] },
    },
    changedFiles: ['routes/web.php'],
    userFacing: true,
    ticketRows: [],
  });

  assert.equal(result.valid, false);
  assert.equal(
    result.errors.some((error) => error.code === 'missing-user-facing-evidence'),
    true,
  );
});

test('requires a production build for frontend changes', () => {
  const result = planVerification({
    verification: {
      ...verification,
      capabilities: verification.capabilities.filter(
        (capability) => capability !== 'frontend-build',
      ),
      commands: { ...verification.commands, build: [] },
    },
    changedFiles: ['resources/js/pages/orders/Create.tsx'],
    userFacing: false,
    ticketRows: [],
  });

  assert.equal(result.valid, false);
  assert.equal(
    result.errors.some((error) => error.code === 'missing-frontend-build'),
    true,
  );
});

test('rejects legacy configuration without a verification profile', () => {
  const result = planVerification({
    verification: { capabilities: [], commands: {} },
    changedFiles: ['app/Models/Order.php'],
    userFacing: false,
    ticketRows: [],
  });

  assert.equal(result.valid, false);
  assert.equal(
    result.errors.some((error) => error.code === 'missing-verification-profile'),
    true,
  );
  assert.equal(auditVerificationEvidence(result, []).valid, false);
});

test('does not run frontend-only layers for a backend-only change', () => {
  const result = planVerification({
    verification,
    changedFiles: ['app/Models/Order.php'],
    userFacing: false,
    ticketRows: [],
  });

  assert.equal(result.valid, true);
  assert.equal(result.steps.some((step) => step.command === 'npm run build'), false);
  assert.equal(result.steps.some((step) => step.command === 'npm run e2e'), false);
  assert.equal(
    result.skipped.some((skip) => skip.stage === 'build' && skip.reason.includes('frontend')),
    true,
  );
});

test('preserves Laravel backend-only behavior with schema version 3 scopes', () => {
  const result = planVerification({
    verification: {
      profile: 'laravel-react-typescript',
      sourceScopes: {
        backend: ['app', 'routes', 'tests'],
        frontend: ['resources/js'],
        shared: [],
      },
      capabilities: verification.capabilities,
      commands: {
        format: {
          backend: ['vendor/bin/pint --dirty --format agent'],
          frontend: [],
          both: [],
        },
        static_analysis: {
          backend: ['vendor/bin/phpstan analyse'],
          frontend: ['npm run lint'],
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
    },
    changedFiles: ['app/Models/Order.php'],
    userFacing: false,
    ticketRows: [],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.scopes, { backend: true, frontend: false });
  assert.equal(result.steps.some((step) => step.command === 'npm run build'), false);
});

test('uses configured source scopes for Express and frontend TypeScript', () => {
  const expressVerification = {
    profile: 'express-typescript-react-typescript',
    sourceScopes: {
      backend: ['server'],
      frontend: ['src'],
      shared: ['shared'],
    },
    capabilities: ['express-tests', 'frontend-build', 'typescript'],
    commands: {
      format: { backend: [], frontend: [], both: [] },
      static_analysis: {
        backend: ['npm run typecheck:server'],
        frontend: ['npm run lint:client'],
        both: [],
      },
      test: {
        backend: ['npm run test:server'],
        frontend: ['npm run test:client'],
        both: [],
      },
      smoke: {
        backend: ['npm run smoke:server'],
        frontend: [],
        both: [],
      },
      build: {
        backend: ['npm run build:server'],
        frontend: ['npm run build:client'],
        both: [],
      },
      e2e: { backend: [], frontend: ['npm run e2e:client'], both: [] },
    },
  };

  const backendResult = planVerification({
    verification: expressVerification,
    changedFiles: ['server/routes/users.ts'],
    userFacing: true,
    ticketRows: [],
  });

  assert.equal(backendResult.valid, true);
  assert.deepEqual(backendResult.scopes, { backend: true, frontend: false });
  assert.equal(
    backendResult.steps.some((step) => step.command === 'npm run build:server'),
    true,
  );
  assert.equal(
    backendResult.steps.some((step) => step.command === 'npm run build:client'),
    false,
  );

  const frontendResult = planVerification({
    verification: expressVerification,
    changedFiles: ['src/pages/Users.tsx'],
    userFacing: false,
    ticketRows: [],
  });

  assert.deepEqual(frontendResult.scopes, { backend: false, frontend: true });
  assert.equal(
    frontendResult.steps.some((step) => step.command === 'npm run build:client'),
    true,
  );
  assert.equal(
    frontendResult.steps.some((step) => step.command === 'npm run build:server'),
    false,
  );

  const sharedResult = planVerification({
    verification: expressVerification,
    changedFiles: ['shared/user.ts'],
    userFacing: false,
    ticketRows: [],
  });

  assert.deepEqual(sharedResult.scopes, { backend: true, frontend: true });

  const unmatchedResult = planVerification({
    verification: expressVerification,
    changedFiles: ['config/runtime.ts'],
    userFacing: false,
    ticketRows: [],
  });

  assert.deepEqual(unmatchedResult.scopes, { backend: true, frontend: true });
  assert.deepEqual(unmatchedResult.scopeNotes, [
    { file: 'config/runtime.ts', reason: 'unmatched' },
  ]);

  const ambiguousResult = planVerification({
    verification: {
      ...expressVerification,
      sourceScopes: { backend: ['src'], frontend: ['src'], shared: [] },
    },
    changedFiles: ['src/index.tsx'],
    userFacing: false,
    ticketRows: [],
  });

  assert.deepEqual(ambiguousResult.scopes, { backend: true, frontend: true });
  assert.deepEqual(ambiguousResult.scopeNotes, [
    { file: 'src/index.tsx', reason: 'ambiguous' },
  ]);
});

test('reports missing Express TypeScript and test capabilities', () => {
  const result = planVerification({
    verification: {
      profile: 'express-typescript',
      sourceScopes: { backend: ['server'], frontend: [], shared: [] },
      capabilities: [],
      commands: {},
    },
    changedFiles: ['server/index.ts'],
    userFacing: false,
    ticketRows: [],
  });

  assert.equal(result.valid, false);
  assert.equal(
    result.errors.some((error) => error.code === 'missing-typescript-check'),
    true,
  );
  assert.equal(
    result.errors.some((error) => error.code === 'missing-express-tests'),
    true,
  );
});

test('audits exact command outcomes and justified optional skips', () => {
  const plan = planVerification({
    verification,
    changedFiles: ['app/Models/Order.php'],
    userFacing: false,
    ticketRows: [],
  });
  const incomplete = auditVerificationEvidence(plan, []);

  assert.equal(incomplete.valid, false);
  assert.equal(incomplete.errors.some((error) => error.code === 'missing-evidence'), true);

  const complete = auditVerificationEvidence(plan, plan.steps.map((step) => ({
    stage: step.stage,
    command: step.command,
    outcome: 'passed',
    summary: 'Command completed successfully.',
  })));

  assert.equal(complete.valid, true);
});

test('parses the generated verification configuration contract', () => {
  const parsed = parseVerificationConfiguration(`schema_version: 2
verification:
  profile: laravel-livewire
  capabilities:
    - laravel-tests
  commands:
    format: []
    test:
      - php artisan test --compact
history:
  path: null
`);

  assert.deepEqual(parsed, {
    profile: 'laravel-livewire',
    capabilities: ['laravel-tests'],
    commands: {
      format: [],
      test: ['php artisan test --compact'],
    },
  });
});

test('parses schema version 3 source scopes and scoped commands', () => {
  const parsed = parseVerificationConfiguration(`schema_version: 3
backend: express-typescript
frontend: react-typescript
source_scopes:
  backend:
    - server
  frontend:
    - src
  shared:
    - shared
verification:
  profile: express-typescript-react-typescript
  capabilities:
    - express-tests
  commands:
    test:
      backend:
        - npm run test:server
      frontend:
        - npm run test:client
      both: []
history:
  path: null
`);

  assert.deepEqual(parsed, {
    profile: 'express-typescript-react-typescript',
    sourceScopes: {
      backend: ['server'],
      frontend: ['src'],
      shared: ['shared'],
    },
    capabilities: ['express-tests'],
    commands: {
      test: {
        backend: ['npm run test:server'],
        frontend: ['npm run test:client'],
        both: [],
      },
    },
  });
});

test('discovers package-manager-correct frontend commands', async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'verification-profile-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  await writeFile(path.join(projectRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

  const result = await discoverVerification(
    projectRoot,
    {
      scripts: {
        lint: 'eslint .',
        typecheck: 'tsc --noEmit',
        test: 'vitest run',
      },
    },
    { backend: 'laravel', frontend: 'svelte-typescript' },
  );

  assert.equal(result.profile, 'laravel-svelte-typescript');
  assert.deepEqual(result.commands.static_analysis, {
    backend: [],
    frontend: ['pnpm run lint', 'pnpm run typecheck'],
    both: [],
  });
  assert.deepEqual(result.commands.test, {
    backend: [],
    frontend: ['pnpm run test'],
    both: [],
  });
});

test('honors confirmed package-script scopes for mixed Express projects', async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'verification-express-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));

  const result = await discoverVerification(
    projectRoot,
    {
      scripts: {
        test: 'vitest run',
        'test:unit': 'vitest run unit',
        'test:watch': 'vitest',
        build: 'tsc',
      },
    },
    {
      backend: 'express-typescript',
      frontend: 'react-typescript',
      scriptScopes: {
        test: 'both',
        'test:unit': 'backend',
        build: 'backend',
      },
    },
  );

  assert.deepEqual(result.commands.test, {
    backend: ['npm run test:unit'],
    frontend: [],
    both: ['npm run test'],
  });
  assert.equal(
    Object.values(result.commands.test).flat().includes('npm run test:watch'),
    false,
  );
  assert.deepEqual(result.commands.build, {
    backend: ['npm run build'],
    frontend: [],
    both: [],
  });
});

test('verification planner CLI is read-only and returns valid JSON', async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'verification-cli-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const configurationPath = path.join(projectRoot, '.agent-framework.yaml');
  const matrixPath = path.join(projectRoot, 'matrix.json');
  const configuration = `schema_version: 2
verification:
  profile: laravel
  capabilities:
    - laravel-tests
  commands:
    format: []
    static_analysis: []
    test:
      - php artisan test --compact
    smoke: []
    build: []
    e2e: []
history:
  path: null
`;
  await writeFile(configurationPath, configuration);
  await writeFile(matrixPath, '[]\n');

  const { stdout } = await execFileAsync(process.execPath, [
    path.join(root, 'skills', 'verify-change', 'scripts', 'verification-plan.mjs'),
    '--config',
    configurationPath,
    '--ticket-matrix',
    matrixPath,
    '--changed-file',
    'app/Models/Order.php',
    '--json',
  ]);

  assert.equal(JSON.parse(stdout).valid, true);
  assert.equal(await readFile(configurationPath, 'utf8'), configuration);
});

test('declares verification and three-axis review evaluation cases', async () => {
  const verifyCases = JSON.parse(await readFile(
    path.join(root, 'skills', 'verify-change', 'evals', 'cases.json'),
    'utf8',
  ));
  const reviewCases = JSON.parse(await readFile(
    path.join(root, 'skills', 'code-review', 'evals', 'cases.json'),
    'utf8',
  ));

  assert.equal(verifyCases.cases.length >= 3, true);
  assert.equal(reviewCases.cases.length >= 3, true);

  for (const evaluation of [...verifyCases.cases, ...reviewCases.cases]) {
    assert.equal(evaluation.assertions.length >= 4, true);
  }
});

test('code review separates Standards, Contract, and Evidence', async () => {
  const skill = await readFile(
    path.join(root, 'skills', 'code-review', 'SKILL.md'),
    'utf8',
  );

  for (const axis of ['Standards', 'Contract', 'Evidence']) {
    assert.match(skill, new RegExp(`\\*\\*${axis}\\*\\*`));
  }

  assert.match(skill, /safeguard/i);
  assert.match(skill, /intent drift/i);
  assert.match(skill, /independent (?:pass|review)/i);
});

test('selective synchronization keeps incidental implementation out of durable artifacts', async () => {
  const reference = await readFile(
    path.join(root, 'skills', 'implement', 'references', 'durable-synchronization.md'),
    'utf8',
  );

  assert.match(reference, /Observable behavior.*SRS/is);
  assert.match(reference, /Domain terminology.*glossary/is);
  assert.match(reference, /Durable architecture.*ADR/is);
  assert.match(reference, /Private implementation.*None/is);
  assert.match(reference, /accepted contract amendment/i);
});
