import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { validateDecision } from '../skills/change-evaluation-gate/scripts/lib/evaluation-contract.mjs';
import { evaluate } from '../skills/change-evaluation-gate/scripts/lib/evaluate.mjs';

const runFile = promisify(execFile);

const git = (cwd, args) => runFile('git', args, { cwd });

const temporaryRoots = [];

const temporaryDirectory = async (prefix) => {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));

  temporaryRoots.push(directory);

  return directory;
};

/** A throwaway Git repository. This repository's own Git state is never used. */
const createRepository = async (files) => {
  const root = await temporaryDirectory('gate-scope-repo-');

  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(root, relative);

    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, 'utf8');
  }

  await git(root, ['init', '--quiet']);
  await git(root, ['add', '--all']);
  // Committing the baseline is what makes a later edit an observable change;
  // without it every tracked path reads as added.
  await git(root, [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Fixture',
    'commit', '--quiet', '--message', 'baseline',
  ]);

  return root;
};

const servers = [];

/**
 * A throwaway local HTTP runtime serving one directory. It stands in for the
 * project's existing local runtime; the gate never launches an alternate
 * application runtime of its own.
 */
const serveDirectory = async (directory) => {
  const server = createServer((incoming, response) => {
    const relative = decodeURIComponent(
      new URL(incoming.url, 'http://127.0.0.1').pathname,
    ).replace(/^\/+/, '');
    const absolute = path.resolve(directory, relative);

    if (!absolute.startsWith(path.resolve(directory))) {
      response.writeHead(403).end();

      return;
    }

    readFile(absolute).then(
      (body) => response.writeHead(200).end(body),
      () => response.writeHead(404).end(),
    );
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  servers.push(server);

  return `http://127.0.0.1:${server.address().port}`;
};

test.after(async () => {
  for (const server of servers) {
    await new Promise((resolve) => server.close(resolve));
  }

  for (const root of temporaryRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

const command = (args, overrides = {}) => ({
  runner: 'package-script',
  args,
  working_directory: '.',
  timeout_seconds: 60,
  allowed_environment: ['PATH'],
  evidence_category: 'test',
  source_scope: 'both',
  ...overrides,
});

const descriptor = (overrides = {}) => ({
  id: 'node-package.broad-tests.test',
  provider: 'node-package',
  stage: 'broad-tests',
  capability: 'test',
  scope: 'both',
  applicability: { changed_path_globs: ['**'], required_facts: [] },
  prerequisites: [],
  policy: 'required',
  evaluate: command(['run', 'test']),
  fix: null,
  timeout_seconds: 120,
  declared_writes: [],
  evidence: { claims: ['test:broad'], success_exit_codes: [0], report: null },
  order: 10,
  selection: null,
  ...overrides,
});

const request = (overrides = {}) => ({
  protocolVersion: '1.0',
  operation: 'evaluate',
  repository: { root: overrides.root },
  change: { kind: 'worktree', baseRevision: 'HEAD' },
  evaluation: { purpose: 'regression-only', contractRef: null },
  invocation: {
    role: 'authoritative',
    trigger: 'commit-attempt',
    adapter: {
      id: 'git',
      surface: 'git-pre-commit',
      version: '1.0.0',
      capabilities: { nativeBlocking: true },
    },
    sessionId: 'session-scope',
  },
  ...overrides.request,
});

const passingAttempt = () => ({
  executed: true,
  exitCode: 0,
  timedOut: false,
  error: null,
  durationMs: 5,
});

const DELIVERY_CONTRACT = `# TB-900 — Order totals

Status: ready-for-agent

## Acceptance Criteria

- [ ] \`AC-ORD-001\`: an order total sums its line items.
- [ ] \`AC-ORD-002\`: a discounted order total never goes below zero.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | \`AC-ORD-001\` | \`npm run test:unit\` | Yes |
`;

test('AC-EVAL-005 / SG-SCOPE-001: evaluation without a valid delivery contract is regression-only and claims no acceptance coverage', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });

  await writeFile(path.join(root, 'src/order.txt'), 'changed\n', 'utf8');

  const decision = await evaluate(
    request({
      root,
      request: {
        evaluation: {
          purpose: 'change-acceptance-and-regression',
          contractRef: 'docs/tickets/tb-900.md',
        },
      },
    }),
    {
      // The check declares an acceptance-shaped claim, but no valid contract
      // requested it: broad regression evidence is never task acceptance.
      checks: [descriptor({
        evidence: { claims: ['AC-ORD-001', 'test:broad'], success_exit_codes: [0], report: null },
      })],
      executionRoot: await temporaryDirectory('gate-scope-exec-'),
      execute: async () => passingAttempt(),
    },
  );

  assert.deepEqual(validateDecision(decision), []);
  assert.equal(decision.outcome, 'passed');
  assert.equal(decision.task.purpose, 'regression-only');
  assert.equal(decision.task.contractStatus, 'missing');
  assert.equal(decision.task.contractId, null);
  assert.equal(decision.coverage.scope, 'regression-only');
  assert.deepEqual(decision.coverage.acceptanceCriteria, []);
  assert.deepEqual(decision.coverage.provedAcceptanceCriteria, []);
  assert.deepEqual(decision.coverage.acceptanceGaps, []);
  assert.ok(decision.coverage.limitations.length > 0);
  assert.ok(decision.coverage.limitations.some((limitation) => limitation.includes('regression-only')));

  // No assertion is presented as acceptance evidence in regression-only scope.
  const [check] = decision.checks;

  assert.deepEqual([...new Set(check.assertions.map(({ kind }) => kind))], ['regression']);

  // A request that never named a contract is equally regression-only.
  const undeclared = await evaluate(request({ root }), {
    checks: [descriptor()],
    executionRoot: await temporaryDirectory('gate-scope-exec-'),
    execute: async () => passingAttempt(),
  });

  assert.equal(undeclared.task.purpose, 'regression-only');
  assert.equal(undeclared.task.contractStatus, 'not-declared');
  assert.deepEqual(undeclared.coverage.acceptanceCriteria, []);
});

test('AC-EVAL-005 / FR-PROF-005: a valid delivery contract yields stable acceptance-ID assertions and explicit coverage gaps', async () => {
  const root = await createRepository({
    'src/order.txt': 'original\n',
    'docs/tickets/tb-900.md': DELIVERY_CONTRACT,
  });

  await writeFile(path.join(root, 'src/order.txt'), 'changed\n', 'utf8');

  const decision = await evaluate(
    request({
      root,
      request: {
        evaluation: {
          purpose: 'change-acceptance-and-regression',
          contractRef: 'docs/tickets/tb-900.md',
        },
      },
    }),
    {
      checks: [
        descriptor({
          id: 'node-package.focused.test',
          stage: 'focused',
          evaluate: command(['run', 'test:focused']),
          selection: { kind: 'delivery-matrix', value: 'AC-ORD-001' },
          evidence: { claims: ['AC-ORD-001'], success_exit_codes: [0], report: null },
        }),
        descriptor(),
      ],
      executionRoot: await temporaryDirectory('gate-scope-exec-'),
      execute: async () => passingAttempt(),
    },
  );

  assert.deepEqual(validateDecision(decision), []);
  assert.equal(decision.task.purpose, 'change-acceptance-and-regression');
  assert.equal(decision.task.contractStatus, 'valid');
  assert.match(decision.task.contractId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(decision.coverage.scope, 'change-acceptance-and-regression');

  // The contract's stable acceptance IDs are the requested coverage.
  assert.deepEqual(decision.coverage.acceptanceCriteria, ['AC-ORD-001', 'AC-ORD-002']);
  assert.deepEqual(decision.coverage.provedAcceptanceCriteria, ['AC-ORD-001']);

  // The unproved acceptance criterion is an explicit gap, not silence.
  assert.deepEqual(decision.coverage.acceptanceGaps, ['AC-ORD-002']);

  const focused = decision.checks.find(({ id }) => id === 'node-package.focused.test');
  const broad = decision.checks.find(({ id }) => id === 'node-package.broad-tests.test');

  assert.deepEqual(focused.assertions, [{
    id: 'AC-ORD-001',
    kind: 'acceptance',
    outcome: 'passed',
    summary: focused.summary,
  }]);

  // A broad suite stays regression evidence even under a valid contract.
  assert.deepEqual(broad.assertions.map(({ kind }) => kind), ['regression']);
});

test('AC-EVAL-007 / SG-CFG-001: a changed test, verification script, provider, or Gate configuration is reported as a Grader surface with every integrity identity bound', async () => {
  const root = await createRepository({
    'src/order.txt': 'original\n',
    '.agent-framework.yaml': 'schema_version: 4\n',
    'scripts/smoke.mjs': 'process.exit(0);\n',
    'gate/providers/node-package.mjs': 'export const provider = {};\n',
    'tests/order.test.mjs': 'test("order", () => {});\n',
    'tests/untouched.test.mjs': 'test("untouched", () => {});\n',
  });

  // The same change edits its own Grader surfaces.
  await writeFile(path.join(root, '.agent-framework.yaml'), 'schema_version: 4\nrelaxed: true\n', 'utf8');
  await writeFile(path.join(root, 'scripts/smoke.mjs'), 'process.exit(0); // weakened\n', 'utf8');
  await writeFile(path.join(root, 'gate/providers/node-package.mjs'), 'export const provider = { relaxed: true };\n', 'utf8');
  await writeFile(path.join(root, 'tests/order.test.mjs'), 'test("order", () => {}); // weakened\n', 'utf8');

  const decision = await evaluate(request({ root }), {
    checks: [descriptor({
      id: 'node-package.broad-tests.script',
      evaluate: command(['scripts/smoke.mjs', '--json'], { runner: 'repository-script' }),
      evidence: { claims: ['test:script'], success_exit_codes: [0], report: null },
    })],
    executionRoot: await temporaryDirectory('gate-scope-exec-'),
    profile: 'node-package',
    runnerVersion: 'gate-runner/1.0.0',
    providerVersions: { 'node-package': '1.0.0' },
    graderSurfaces: {
      providers: { 'node-package': 'gate/providers/node-package.mjs' },
      tests: ['tests/**'],
    },
    execute: async () => passingAttempt(),
  });

  assert.deepEqual(validateDecision(decision), []);

  const surfaces = decision.integrity.changedGraderSurfaces;

  assert.deepEqual(
    surfaces.map(({ kind, path: surfacePath }) => [kind, surfacePath]),
    [
      ['gate-configuration', '.agent-framework.yaml'],
      ['provider', 'gate/providers/node-package.mjs'],
      ['test', 'tests/order.test.mjs'],
      ['verification-script', 'scripts/smoke.mjs'],
    ],
  );

  // An unchanged declared surface is never reported as changed.
  assert.equal(
    surfaces.some(({ path: surfacePath }) => surfacePath === 'tests/untouched.test.mjs'),
    false,
  );

  // Each reported surface is bound to the content actually evaluated.
  for (const surface of surfaces) {
    assert.match(surface.identity, /^sha256:[0-9a-f]{64}$/);
  }

  // The repository-script surface names the check whose evidence it decides.
  const script = surfaces.find(({ kind }) => kind === 'verification-script');

  assert.equal(script.checkId, 'node-package.broad-tests.script');
  assert.equal(script.role, 'evaluate');

  // SG-CFG-001: a change touching the Gate control surface is visible, and it
  // is never silently classified as malicious.
  assert.equal(decision.integrity.controlSurfaceChanged, true);
  assert.equal(decision.outcome, 'passed');

  // Every integrity identity of this evaluation is bound into the decision.
  assert.equal(decision.integrity.snapshotId, decision.snapshot.id);
  assert.equal(decision.integrity.environmentId, decision.environment.id);
  assert.equal(decision.integrity.configurationId, decision.configurationId);
  assert.equal(decision.integrity.runnerVersion, 'gate-runner/1.0.0');
  assert.deepEqual(decision.integrity.providerVersions, { 'node-package': '1.0.0' });
});

test('AC-EVAL-007: an evaluation that changes no Grader surface reports none', async () => {
  const root = await createRepository({
    'src/order.txt': 'original\n',
    'tests/order.test.mjs': 'test("order", () => {});\n',
  });

  await writeFile(path.join(root, 'src/order.txt'), 'changed\n', 'utf8');

  const decision = await evaluate(request({ root }), {
    checks: [descriptor()],
    executionRoot: await temporaryDirectory('gate-scope-exec-'),
    graderSurfaces: { tests: ['tests/**'] },
    execute: async () => passingAttempt(),
  });

  assert.deepEqual(decision.integrity.changedGraderSurfaces, []);
  assert.equal(decision.integrity.controlSurfaceChanged, false);
  assert.deepEqual(validateDecision(decision), []);
});

test('FR-PROF-005: every applicable check reports at least one Check assertion', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });

  await writeFile(path.join(root, 'src/order.txt'), 'changed\n', 'utf8');

  const decision = await evaluate(request({ root }), {
    checks: [descriptor({
      evidence: { claims: [], success_exit_codes: [0], report: null },
    })],
    executionRoot: await temporaryDirectory('gate-scope-exec-'),
    execute: async () => passingAttempt(),
  });

  assert.deepEqual(validateDecision(decision), []);

  const [check] = decision.checks;

  assert.equal(check.assertions.length, 1);
  assert.equal(check.assertions[0].id, 'node-package.broad-tests.test');
  assert.equal(check.assertions[0].kind, 'regression');
  assert.equal(check.assertions[0].outcome, 'passed');
});

const browserCheck = () => descriptor({
  id: 'node-package.browser.journey',
  stage: 'browser',
  capability: 'journey',
  evaluate: command(['run', 'test:browser'], { evidence_category: 'browser' }),
  evidence: { claims: ['browser:journey'], success_exit_codes: [0], report: null },
});

/** A repository whose staged snapshot differs from its live worktree. */
const divergedRepository = async () => {
  const root = await createRepository({ 'public/app.txt': 'baseline\n' });

  await writeFile(path.join(root, 'public/app.txt'), 'snapshot\n', 'utf8');
  await git(root, ['add', '--all']);
  await writeFile(path.join(root, 'public/app.txt'), 'live-worktree\n', 'utf8');

  return root;
};

const stagedRequest = (root) => request({
  root,
  request: { change: { kind: 'git-index', baseRevision: 'HEAD' } },
});

test('AC-EVAL-008: an HTTP check whose runtime is proved to serve the materialized snapshot can pass', async () => {
  const root = await divergedRepository();
  let servedFrom = null;

  const decision = await evaluate(stagedRequest(root), {
    checks: [browserCheck()],
    executionRoot: await temporaryDirectory('gate-scope-exec-'),
    async resolveRuntime({ executionRoot }) {
      servedFrom = executionRoot;

      return { baseUrl: await serveDirectory(executionRoot), probePaths: ['public/app.txt'] };
    },
    execute: async () => passingAttempt(),
  });

  assert.deepEqual(validateDecision(decision), []);
  assert.equal(decision.outcome, 'passed');
  assert.equal(decision.authorization, 'allow');
  assert.equal(decision.integrity.runtimeBinding.required, true);
  assert.equal(decision.integrity.runtimeBinding.proved, true);
  assert.equal(decision.integrity.runtimeBinding.snapshotId, decision.snapshot.id);
  assert.match(decision.integrity.runtimeBinding.servedSourceId, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(
    decision.integrity.runtimeBinding.probes.map(({ path: probe, matched }) => [probe, matched]),
    [['public/app.txt', true]],
  );
  assert.equal(servedFrom, decision.snapshot.executionRoot);
});

test('AC-EVAL-008 / SG-EVAL-002: a runtime serving the live worktree is unverified and cannot authorize', async () => {
  const root = await divergedRepository();

  const decision = await evaluate(stagedRequest(root), {
    checks: [browserCheck()],
    executionRoot: await temporaryDirectory('gate-scope-exec-'),
    // The existing local runtime still serves the live worktree, not the
    // materialized Evaluation snapshot.
    resolveRuntime: async () => ({
      baseUrl: await serveDirectory(root),
      probePaths: ['public/app.txt'],
    }),
    execute: async () => {
      throw new Error('an unbound runtime must never produce HTTP evidence');
    },
  });

  assert.deepEqual(validateDecision(decision), []);
  assert.equal(decision.outcome, 'unverified');
  assert.equal(decision.authorization, 'deny');

  const [check] = decision.checks;

  assert.equal(check.outcome, 'unverified');
  assert.equal(check.reasonCode, 'snapshot-mismatch');
  assert.equal(decision.integrity.runtimeBinding.proved, false);
  assert.equal(decision.integrity.runtimeBinding.reasonCode, 'snapshot-mismatch');
  assert.deepEqual(
    decision.integrity.runtimeBinding.probes.map(({ matched }) => matched),
    [false],
  );
  assert.deepEqual(decision.coverage.provedClaims, []);
});

test('AC-EVAL-008 / SG-EVAL-002: unprovable routing is unverified rather than assumed bound', async () => {
  const root = await divergedRepository();

  const unprovable = [
    ['no runtime binding is resolvable at all', {}],
    ['the runtime declares no probe', {
      resolveRuntime: async ({ executionRoot }) => ({
        baseUrl: await serveDirectory(executionRoot),
        probePaths: [],
      }),
    }],
    ['the runtime cannot be reached', {
      resolveRuntime: async () => ({
        baseUrl: 'http://127.0.0.1:1/',
        probePaths: ['public/app.txt'],
      }),
    }],
  ];

  for (const [label, dependencies] of unprovable) {
    const decision = await evaluate(stagedRequest(root), {
      checks: [browserCheck()],
      executionRoot: await temporaryDirectory('gate-scope-exec-'),
      execute: async () => {
        throw new Error('an unbound runtime must never produce HTTP evidence');
      },
      ...dependencies,
    });

    assert.deepEqual(validateDecision(decision), [], label);
    assert.equal(decision.outcome, 'unverified', label);
    assert.equal(decision.authorization, 'deny', label);
    assert.equal(decision.checks[0].reasonCode, 'prerequisite-missing', label);
    assert.equal(decision.integrity.runtimeBinding.required, true, label);
    assert.equal(decision.integrity.runtimeBinding.proved, false, label);
  }
});

test('AC-EVAL-008: a change with no HTTP or browser check needs no runtime binding', async () => {
  const root = await divergedRepository();

  const decision = await evaluate(stagedRequest(root), {
    checks: [descriptor()],
    executionRoot: await temporaryDirectory('gate-scope-exec-'),
    execute: async () => passingAttempt(),
  });

  assert.deepEqual(validateDecision(decision), []);
  assert.equal(decision.outcome, 'passed');
  assert.equal(decision.integrity.runtimeBinding.required, false);
  assert.equal(decision.integrity.runtimeBinding.proved, null);
});

test('AC-EVAL-008: the runtime-binding smoke capability is registered and machine readable', async () => {
  const repository = fileURLToPath(new URL('..', import.meta.url));
  const manifest = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8'));
  const configuration = await readFile(path.join(repository, '.agent-framework.yaml'), 'utf8');

  assert.equal(
    manifest.scripts['gate-runtime-binding-smoke'],
    'node skills/change-evaluation-gate/scripts/runtime-binding-smoke.mjs',
  );
  assert.ok(configuration.includes('- gate-runtime-binding-smoke'));

  const { stdout } = await runFile(
    process.execPath,
    ['skills/change-evaluation-gate/scripts/runtime-binding-smoke.mjs', '--json'],
    { cwd: repository },
  );
  const report = JSON.parse(stdout);

  assert.equal(report.capability, 'gate-runtime-binding-smoke');
  assert.equal(report.ok, true);
  assert.deepEqual(
    report.scenarios.map(({ name, ok }) => [name, ok]),
    [
      ['bound-snapshot-runtime', true],
      ['live-worktree-runtime', true],
      ['unprovable-runtime', true],
    ],
  );
});
