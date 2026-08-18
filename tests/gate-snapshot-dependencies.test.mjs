/**
 * TB-030 — Give the evaluation snapshot the dependencies its checks need.
 *
 * The snapshot is materialized from `git ls-files`, so `vendor/` and
 * `node_modules/` — git-ignored in every project that has them — were absent
 * from every execution root the gate ever built. The one required check in the
 * preserved evidence under `real-project-evidence/` that successfully launched
 * its program died on exactly that:
 *
 *   require(/…/gate-hook-runner-exec-H33i9A/vendor/autoload.php): Failed to
 *   open stream: No such file or directory in …/artisan on line 10
 *
 * A project's installed dependencies are the same category of thing as the tool
 * `TB-024` resolves to an absolute path outside the snapshot: they are not the
 * change being graded, they are what a tool needs in order to grade it.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { PROTOCOL_VERSION, evaluate } from '../skills/change-evaluation-gate/scripts/lib/evaluate.mjs';
import { validateGatePolicy } from '../skills/change-evaluation-gate/scripts/lib/policy.mjs';
import { captureSnapshot, verifySnapshot } from '../skills/change-evaluation-gate/scripts/lib/snapshot.mjs';

const runFile = promisify(execFile);

const isolatedGit = () => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

/**
 * A clone shaped like a real one: tracked source, and an installed dependency
 * directory that Git ignores and therefore never lists.
 */
const clone = async (t, { install = true } = {}) => {
  const root = await mkdtemp(path.join(tmpdir(), 'gate-snapshot-dependencies-'));

  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, '.gitignore'), 'vendor/\n', 'utf8');
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\n', 'utf8');
  await writeFile(path.join(root, 'artisan'), "require 'vendor/autoload.php';\n", 'utf8');

  if (install) {
    await mkdir(path.join(root, 'vendor'), { recursive: true });
    await writeFile(path.join(root, 'vendor/autoload.php'), 'installed\n', 'utf8');
  }

  await runFile('git', ['init', '--quiet'], { cwd: root, env: isolatedGit() });
  await runFile('git', ['add', '--all'], { cwd: root, env: isolatedGit() });
  await runFile('git', [
    '-c', 'user.email=gate@example.test', '-c', 'user.name=Gate Snapshot',
    'commit', '--quiet', '--message', 'baseline',
  ], { cwd: root, env: isolatedGit() });

  return root;
};

const executionRoot = async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'gate-snapshot-exec-'));

  t.after(() => rm(root, { recursive: true, force: true }));

  return root;
};

test('TB-030 FR-EVAL-001: a declared dependency root is materialized into the execution root', async (t) => {
  const root = await clone(t);
  const target = await executionRoot(t);
  const capture = await captureSnapshot({
    repositoryRoot: root,
    kind: 'git-index',
    executionRoot: target,
    dependencyRoots: ['vendor'],
  });

  assert.equal(capture.captured, true, capture.detail);
  assert.deepEqual(capture.dependencies.provided, ['vendor']);
  assert.deepEqual(capture.dependencies.missing, []);

  // The thing a real check actually needs: a file inside the dependency root,
  // reachable from the execution root by the relative path its own source uses.
  assert.equal(
    await readFile(path.join(target, 'vendor/autoload.php'), 'utf8'),
    'installed\n',
  );
});

test('TB-030 SG-EVAL-001, NFR-REL-001: providing a dependency root changes neither the snapshot identity nor its verification', async (t) => {
  const root = await clone(t);
  const withDependencies = await captureSnapshot({
    repositoryRoot: root,
    kind: 'git-index',
    executionRoot: await executionRoot(t),
    dependencyRoots: ['vendor'],
  });
  const without = await captureSnapshot({
    repositoryRoot: root,
    kind: 'git-index',
    executionRoot: await executionRoot(t),
  });

  assert.equal(
    withDependencies.snapshot.id,
    without.snapshot.id,
    'the identity states what was evaluated; an installed dependency is not part of that.',
  );
  assert.deepEqual(withDependencies.snapshot.paths, without.snapshot.paths);
  assert.equal(
    withDependencies.snapshot.paths.some((entry) => entry.startsWith('vendor/')),
    false,
    'a dependency root is never a graded path.',
  );

  // A tool that writes inside its own dependency root — every cache does — has
  // not changed the tree under evaluation.
  await writeFile(
    path.join(withDependencies.snapshot.executionRoot, 'vendor/cache.txt'),
    'written by a tool\n',
    'utf8',
  );

  const verified = await verifySnapshot(withDependencies.snapshot);

  assert.equal(verified.verified, true, JSON.stringify(verified));
});

test('TB-030 NFR-REL-003: a declared dependency root that is absent is reported by name, never silently skipped', async (t) => {
  const root = await clone(t, { install: false });
  const capture = await captureSnapshot({
    repositoryRoot: root,
    kind: 'git-index',
    executionRoot: await executionRoot(t),
    dependencyRoots: ['vendor'],
  });

  assert.equal(capture.captured, true, 'the snapshot itself is fine; what is missing is stated.');
  assert.deepEqual(capture.dependencies.provided, []);
  assert.deepEqual(capture.dependencies.missing, ['vendor']);
});

test('TB-030 SG-EVAL-001: a project declaring no dependency roots materializes exactly what it always did', async (t) => {
  const root = await clone(t);
  const declared = await captureSnapshot({
    repositoryRoot: root,
    kind: 'git-index',
    executionRoot: await executionRoot(t),
    dependencyRoots: [],
  });
  const target = await executionRoot(t);
  const undeclared = await captureSnapshot({
    repositoryRoot: root,
    kind: 'git-index',
    executionRoot: target,
  });

  assert.equal(declared.snapshot.id, undeclared.snapshot.id);
  assert.deepEqual(undeclared.dependencies, { provided: [], missing: [], refused: [] });
  assert.equal(
    await readFile(path.join(target, 'vendor/autoload.php'), 'utf8').catch(() => null),
    null,
    'nothing untracked reaches an execution root that did not ask for it.',
  );
});

test('TB-030 SG-CMD-001: a dependency root that escapes the repository is refused, never materialized', async (t) => {
  const root = await clone(t);
  const target = await executionRoot(t);

  for (const declared of ['../elsewhere', '/etc', 'vendor/../../escape', '']) {
    const capture = await captureSnapshot({
      repositoryRoot: root,
      kind: 'git-index',
      executionRoot: target,
      dependencyRoots: [declared],
    });

    assert.deepEqual(
      capture.dependencies.provided,
      [],
      `${JSON.stringify(declared)} must never be provided to a check.`,
    );
    assert.deepEqual(capture.dependencies.refused, [declared]);
  }
});

test('TB-030 FR-PROF-010: the Gate policy contract validates declared dependency roots', () => {
  const policy = (execution) => ({
    checks: { required: [], advisory: [] },
    budget: { total_seconds: 600 },
    bypass: { enabled: false, marker: null },
    execution,
    evidence: {},
  });

  assert.deepEqual(validateGatePolicy(policy({ dependency_roots: ['vendor', 'node_modules'] })), []);
  assert.deepEqual(validateGatePolicy(policy({})), []);

  for (const invalid of [['/etc'], ['../escape'], [''], 'vendor', [42]]) {
    assert.deepEqual(
      validateGatePolicy(policy({ dependency_roots: invalid })).map((issue) => issue.code),
      ['gate-policy-execution-invalid'],
      `${JSON.stringify(invalid)} must be refused by the policy contract.`,
    );
  }
});

test('TB-030 NFR-REL-003: an evaluation whose declared dependency root is absent is unverified, and denies', async (t) => {
  const root = await clone(t, { install: false });
  const decision = await evaluate({
    protocolVersion: PROTOCOL_VERSION,
    operation: 'evaluate',
    repository: { root },
    change: { kind: 'git-index', baseRevision: 'HEAD' },
    evaluation: { purpose: 'change-acceptance-and-regression', contractRef: null },
    invocation: {
      role: 'authoritative',
      trigger: 'commit-attempt',
      adapter: {
        id: 'git',
        surface: 'git-pre-commit',
        version: '1.0.0',
        capabilities: { nativeBlocking: true },
      },
      sessionId: 'snapshot-dependencies',
    },
  }, {
    executionRoot: await executionRoot(t),
    runnerVersion: 'fixture/1.0.0',
    providerVersions: { configuration: '1.0.0' },
    resolvePrerequisite: () => true,
    checks: [],
    policy: {
      checks: { required: [], advisory: [] },
      budget: { total_seconds: 600 },
      bypass: { enabled: false, marker: null },
      execution: { dependency_roots: ['vendor'] },
      evidence: {},
    },
    execute: async () => ({ executed: true, exitCode: 0, durationMs: 1 }),
  });

  assert.equal(decision.outcome, 'unverified');
  assert.equal(
    decision.authorization,
    'deny',
    'a clone that cannot give its checks what they need has not proved anything.',
  );
  assert.deepEqual(
    decision.diagnostics.map((entry) => entry.reasonCode),
    ['dependency-root-unavailable'],
  );
  assert.match(decision.diagnostics[0].detail, /"vendor"/);
});

test('TB-030 SG-OWNER-001: no stack directory is named in the snapshot module or gate core', async () => {
  const libraryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../skills/change-evaluation-gate/scripts/lib',
  );
  const stackDirectories = /\b(vendor|node_modules)\b/;

  for (const module of ['snapshot.mjs', 'gate-core.mjs', 'evaluation-contract.mjs', 'policy.mjs']) {
    assert.doesNotMatch(
      await readFile(path.join(libraryRoot, module), 'utf8'),
      stackDirectories,
      `${module} names a stack directory; which directories a project installs into is its own declaration.`,
    );
  }
});
