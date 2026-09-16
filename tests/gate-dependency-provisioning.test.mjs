/**
 * TB-054 — Provide a dependency root the tools can resolve.
 *
 * Every dependency root was provided into the execution root by a symbolic
 * link. A link is a complete success by the only measure the suite ever
 * applied — the autoloader, module tree, or binary can be found — and a
 * complete failure by the measure no fixture ever applied: a tool that resolves
 * a path to its realpath follows the link out of the execution root and
 * concludes that the project it is grading is the original repository.
 *
 * Two real tools were observed doing exactly that, from opposite directions:
 * an ESLint import resolver reclassified the project's own aliased imports as
 * external and reported thirty-three ordering errors that vanished when the
 * same roots were real directories, and Pest derived a test namespace from an
 * absolute path and booted nothing at all until `vendor` was a real copy.
 * Both were reported to the maintainer as faults in their code.
 *
 * The fixture here needs neither of those tools. Node's own module resolver
 * answers the same question — it reports a loaded module's realpath — so a
 * module loaded through a provided dependency root says, in its own words,
 * which tree it believes it is part of. That is the whole property, and it is
 * observable with nothing but this runtime.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { PROTOCOL_VERSION, evaluate } from '../skills/change-evaluation-gate/scripts/lib/evaluate.mjs';
import { validateDecision } from '../skills/change-evaluation-gate/scripts/lib/evaluation-contract.mjs';
import {
  EXECUTION_ROOT_PREFIXES,
  sweepOrphanedExecutionRoots,
} from '../skills/change-evaluation-gate/scripts/lib/hook-runner.mjs';
import { validateGatePolicy } from '../skills/change-evaluation-gate/scripts/lib/policy.mjs';
import {
  DEFAULT_DEPENDENCY_PROVISIONING,
  DEPENDENCY_PROVISIONING_STRATEGIES,
  captureSnapshot,
  verifySnapshot,
} from '../skills/change-evaluation-gate/scripts/lib/snapshot.mjs';

const runFile = promisify(execFile);

const LIBRARY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../skills/change-evaluation-gate/scripts/lib',
);

/** The directory this fixture project installs its dependencies into. */
const INSTALLED = 'installed';

const isolatedGit = () => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

/**
 * The module a tool loads out of the dependency root, which reports where it
 * believes it lives.
 *
 * This is the one thing the whole slice is about. `import.meta.dirname` is the
 * resolved location of the module Node actually loaded, so it answers the
 * question every real tool answers differently under the two strategies: PHP's
 * `__DIR__` inside an autoloader, a TypeScript import resolver's realpath, and
 * Node's own loader all compute the project root from it.
 */
const LOCATOR = 'export const loadedFrom = import.meta.dirname;\n';

/** The graded source, which loads its dependency exactly as a real tool does. */
const GRADER = [
  `import { loadedFrom } from './${INSTALLED}/locate.mjs';`,
  'process.stdout.write(loadedFrom);',
  '',
].join('\n');

/**
 * A clone shaped like a real one: tracked source, and an installed dependency
 * directory Git ignores and therefore never lists.
 */
const clone = async (t, { install = true } = {}) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-provisioning-clone-')));

  t.after(() => rm(root, { recursive: true, force: true }).catch(() => {}));
  await writeFile(path.join(root, '.gitignore'), `${INSTALLED}/\n`, 'utf8');
  await writeFile(path.join(root, 'grade.mjs'), GRADER, 'utf8');
  await writeFile(path.join(root, 'source.txt'), 'baseline\n', 'utf8');

  if (install) {
    await mkdir(path.join(root, INSTALLED), { recursive: true });
    await writeFile(path.join(root, INSTALLED, 'locate.mjs'), LOCATOR, 'utf8');
  }

  await runFile('git', ['init', '--quiet'], { cwd: root, env: isolatedGit() });
  await runFile('git', ['add', '--all'], { cwd: root, env: isolatedGit() });
  await runFile('git', [
    '-c', 'user.email=gate@example.test', '-c', 'user.name=Gate Provisioning',
    'commit', '--quiet', '--message', 'baseline',
  ], { cwd: root, env: isolatedGit() });

  return root;
};

const executionRoot = async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-provisioning-exec-')));

  t.after(() => rm(root, { recursive: true, force: true }).catch(() => {}));

  return root;
};

const capture = async (repositoryRoot, target, dependencyProvisioning) => captureSnapshot({
  repositoryRoot,
  kind: 'git-index',
  executionRoot: target,
  dependencyRoots: [INSTALLED],
  ...(dependencyProvisioning === undefined ? {} : { dependencyProvisioning }),
});

/** Where the tool concludes its dependency lives, asked of the tool itself. */
const askWhereTheDependencyLives = async (target) => {
  const { stdout } = await runFile(process.execPath, ['grade.mjs'], { cwd: target });

  return stdout;
};

const gatePolicy = (execution) => ({
  checks: { required: [], advisory: [] },
  budget: { total_seconds: 600 },
  bypass: { enabled: false, marker: null },
  execution,
  evidence: {},
});

test('TB-054 FR-EVAL-004: under link a tool resolves its dependency to the repository, not the snapshot it is grading', async (t) => {
  const root = await clone(t);
  const target = await executionRoot(t);
  const captured = await capture(root, target, 'link');

  assert.equal(captured.captured, true, captured.detail);
  assert.deepEqual(captured.dependencies.provided, [INSTALLED]);

  const loadedFrom = await askWhereTheDependencyLives(target);

  // This is the defect, stated by the tool rather than inferred: the module the
  // grader loaded reports that it lives in the maintainer's own clone. Every
  // conclusion the tool draws from that — which imports are internal, what the
  // project root is, how to relativize a test file — is drawn about the wrong
  // tree, and reported as a fault in the code being graded.
  assert.equal(
    loadedFrom.startsWith(target),
    false,
    'a linked dependency root already resolved inside the execution root; the defect this slice closes is absent.',
  );
  assert.equal(loadedFrom, path.join(root, INSTALLED));
});

test('TB-054 FR-EVAL-004: under copy the same tool, unchanged, resolves its dependency inside the execution root', async (t) => {
  const root = await clone(t);
  const target = await executionRoot(t);
  const captured = await capture(root, target, 'copy');

  assert.equal(captured.captured, true, captured.detail);
  assert.deepEqual(captured.dependencies.provided, [INSTALLED]);
  assert.equal(captured.dependencies.provisioning, 'copy');

  const loadedFrom = await askWhereTheDependencyLives(target);

  assert.equal(
    loadedFrom,
    path.join(target, INSTALLED),
    'the tool must conclude that the dependency, and therefore the project, lives in the tree it is grading.',
  );

  // And it is a real directory, not a link wearing one's name.
  assert.equal((await lstat(path.join(target, INSTALLED))).isSymbolicLink(), false);
  assert.equal(
    await readFile(path.join(target, INSTALLED, 'locate.mjs'), 'utf8'),
    LOCATOR,
  );
});

test('TB-054 FR-CFG-002, AC-CFG-001: the provisioning strategy is declared, accepted by name, and refused by name', () => {
  for (const strategy of DEPENDENCY_PROVISIONING_STRATEGIES) {
    assert.deepEqual(validateGatePolicy(gatePolicy({ dependency_provisioning: strategy })), []);
  }

  // Absent is the whole of the compatibility promise: a clone that never heard
  // of this declaration is still a valid clone.
  assert.deepEqual(validateGatePolicy(gatePolicy({})), []);
  assert.deepEqual(validateGatePolicy(gatePolicy({ dependency_roots: [INSTALLED] })), []);

  for (const invalid of ['symlink', 'hardlink', 'clone', 'LINK', '', null, true, 1, ['copy']]) {
    const issues = validateGatePolicy(gatePolicy({ dependency_provisioning: invalid }));

    assert.deepEqual(
      issues.map((issue) => issue.code),
      ['gate-policy-execution-invalid'],
      `${JSON.stringify(invalid)} must be refused by the policy contract.`,
    );
    assert.equal(issues[0].path, 'evaluation_gate.execution.dependency_provisioning');
  }
});

test('TB-054 AC-CFG-001: a clone that declares nothing is provisioned exactly as it is today', async (t) => {
  const root = await clone(t);
  const undeclared = await capture(root, await executionRoot(t), undefined);
  const declaredLink = await capture(root, await executionRoot(t), 'link');

  assert.equal(DEFAULT_DEPENDENCY_PROVISIONING, 'link');
  assert.equal(undeclared.dependencies.provisioning, 'link');
  assert.deepEqual(undeclared.dependencies, declaredLink.dependencies);

  // Today's behaviour, byte for byte: a symbolic link to the clone's own
  // installation, and nothing copied.
  const described = await lstat(path.join(undeclared.snapshot.executionRoot, INSTALLED));

  assert.equal(described.isSymbolicLink(), true);
});

test('TB-054 SG-EVAL-001, NFR-REL-001: the strategy moves neither the snapshot identity, its path list, nor its re-check', async (t) => {
  const root = await clone(t);
  const linked = await capture(root, await executionRoot(t), 'link');
  const copied = await capture(root, await executionRoot(t), 'copy');
  const bare = await captureSnapshot({
    repositoryRoot: root,
    kind: 'git-index',
    executionRoot: await executionRoot(t),
  });

  assert.equal(
    linked.snapshot.id,
    copied.snapshot.id,
    'the identity of an unchanged tree must not depend on how its dependencies were provided.',
  );
  assert.equal(linked.snapshot.id, bare.snapshot.id);
  assert.deepEqual(linked.snapshot.paths, copied.snapshot.paths);
  assert.deepEqual(copied.snapshot.paths, bare.snapshot.paths);

  for (const relative of copied.snapshot.paths) {
    assert.equal(
      relative.startsWith(`${INSTALLED}/`) || relative === INSTALLED,
      false,
      `${relative} is a provided dependency root; a provided root is never a graded path.`,
    );
  }

  // A tool writing inside a copied dependency root — every cache does — has
  // still not changed the tree under evaluation.
  await writeFile(path.join(copied.snapshot.executionRoot, INSTALLED, 'cache.txt'), 'tool noise\n', 'utf8');

  assert.equal((await verifySnapshot(copied.snapshot)).verified, true);
  assert.equal((await verifySnapshot(linked.snapshot)).verified, true);
});

test('TB-054 RISK-002, NFR-SEC-001: a linked root is writable through into the maintainer\'s repository; a copied one is not', async (t) => {
  const linkedClone = await clone(t);
  const copiedClone = await clone(t);
  const linked = await capture(linkedClone, await executionRoot(t), 'link');
  const copied = await capture(copiedClone, await executionRoot(t), 'copy');

  for (const [captured] of [[linked], [copied]]) {
    await writeFile(
      path.join(captured.snapshot.executionRoot, INSTALLED, 'written-by-a-check.txt'),
      'a check wrote this\n',
      'utf8',
    );
  }

  const reachedLinkedRepository = await readFile(
    path.join(linkedClone, INSTALLED, 'written-by-a-check.txt'),
    'utf8',
  ).catch(() => null);
  const reachedCopiedRepository = await readFile(
    path.join(copiedClone, INSTALLED, 'written-by-a-check.txt'),
    'utf8',
  ).catch(() => null);

  assert.equal(
    reachedLinkedRepository,
    'a check wrote this\n',
    'a link is writable through by construction; if this ever stops holding, the isolation argument for copy has to be restated.',
  );
  assert.equal(
    reachedCopiedRepository,
    null,
    'a copied root contains the write; the maintainer\'s own installation is never what a check edits.',
  );
});

test('TB-054: a copy that cannot be performed is a stated failure, never a quiet link', async (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('an unreadable directory is readable by root, so this clone cannot make a copy fail.');

    return;
  }

  const root = await clone(t);

  await chmod(path.join(root, INSTALLED), 0o000);
  t.after(() => chmod(path.join(root, INSTALLED), 0o755).catch(() => {}));

  const target = await executionRoot(t);
  const copied = await capture(root, target, 'copy');

  assert.equal(copied.captured, true, 'the snapshot itself is fine; what could not be provided is stated.');
  assert.deepEqual(copied.dependencies.provided, []);
  assert.deepEqual(copied.dependencies.missing, [INSTALLED]);
  assert.equal(
    await lstat(path.join(target, INSTALLED)).then(() => true, () => false),
    false,
    'a copy that failed must leave nothing behind — least of all the link the project declined.',
  );

  // The same clone, the same unreadable directory, provisioned by the strategy
  // that does not need to read it: this is what a silent degradation would have
  // produced, and what the copy strategy must never produce on its own.
  const linkedTarget = await executionRoot(t);
  const linked = await capture(root, linkedTarget, 'link');

  assert.deepEqual(linked.dependencies.provided, [INSTALLED]);
  assert.equal((await lstat(path.join(linkedTarget, INSTALLED))).isSymbolicLink(), true);
});

test('TB-054 FR-CFG-002: a strategy this gate cannot perform ends the capture rather than being repaired into one it can', async (t) => {
  const root = await clone(t);
  const target = await executionRoot(t);
  const captured = await capture(root, target, 'hardlink');

  assert.equal(captured.captured, false);
  assert.equal(captured.reasonCode, 'configuration-invalid');
  assert.match(captured.detail, /"hardlink"/);
  assert.equal(
    await lstat(path.join(target, INSTALLED)).then(() => true, () => false),
    false,
  );
});

test('TB-054 NFR-OPER-001: what was provided, what was not, and by which strategy reach the decision', async (t) => {
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
      sessionId: 'dependency-provisioning',
    },
  }, {
    executionRoot: await executionRoot(t),
    runnerVersion: 'fixture/1.0.0',
    providerVersions: { configuration: '1.0.0' },
    resolvePrerequisite: () => true,
    checks: [],
    policy: gatePolicy({
      dependency_roots: [INSTALLED, '../escape'],
      dependency_provisioning: 'copy',
    }),
    execute: async () => ({ executed: true, exitCode: 0, durationMs: 1 }),
  });

  assert.deepEqual(validateDecision(decision), []);
  assert.deepEqual(decision.environment.dependencies, {
    provisioning: 'copy',
    provided: [],
    missing: [INSTALLED],
    refused: ['../escape'],
  });
  assert.equal(decision.outcome, 'unverified');
  assert.equal(decision.authorization, 'deny');

  // Diagnosable without rerunning anything: the decision names the root and the
  // strategy that was supposed to have provided it.
  assert.equal(
    decision.diagnostics.filter((entry) => entry.reasonCode === 'dependency-root-unavailable').length,
    2,
  );
});

test('TB-054 NFR-OPER-001: a decision on a clone that declares nothing still says how its dependencies were provisioned', async (t) => {
  const root = await clone(t);
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
      sessionId: 'dependency-provisioning-default',
    },
  }, {
    executionRoot: await executionRoot(t),
    runnerVersion: 'fixture/1.0.0',
    providerVersions: { configuration: '1.0.0' },
    resolvePrerequisite: () => true,
    checks: [],
    policy: gatePolicy({}),
    execute: async () => ({ executed: true, exitCode: 0, durationMs: 1 }),
  });

  assert.deepEqual(validateDecision(decision), []);
  assert.deepEqual(decision.environment.dependencies, {
    provisioning: 'link',
    provided: [],
    missing: [],
    refused: [],
  });
});

test('TB-054 SG-LIFE-001: removing an execution root removes a copied tree and never reaches through a link', async (t) => {
  const linkedClone = await clone(t);
  const copiedClone = await clone(t);
  const linkedTarget = await executionRoot(t);
  const copiedTarget = await executionRoot(t);

  await capture(linkedClone, linkedTarget, 'link');
  await capture(copiedClone, copiedTarget, 'copy');

  // What `releaseExecutionRoot` and the orphan sweep both perform.
  await rm(linkedTarget, { recursive: true, force: true });
  await rm(copiedTarget, { recursive: true, force: true });

  assert.equal(
    await readFile(path.join(linkedClone, INSTALLED, 'locate.mjs'), 'utf8'),
    LOCATOR,
    'removing an execution root unlinked the link and must never have followed it into the clone.',
  );
  assert.equal(
    await readFile(path.join(copiedClone, INSTALLED, 'locate.mjs'), 'utf8'),
    LOCATOR,
    'removing an execution root removed the copy and left the clone alone.',
  );
  assert.equal(await stat(copiedTarget).then(() => true, () => false), false);
});

test('TB-054 TB-038: the orphan sweep still reclaims an abandoned execution root that carries a copied dependency tree', async (t) => {
  const root = await clone(t);
  const sweepRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-provisioning-sweep-')));

  t.after(() => rm(sweepRoot, { recursive: true, force: true }).catch(() => {}));

  const abandoned = path.join(sweepRoot, `${EXECUTION_ROOT_PREFIXES[0]}abandoned`);

  await mkdir(abandoned, { recursive: true });

  const captured = await capture(root, abandoned, 'copy');

  assert.equal(captured.captured, true, captured.detail);

  const swept = await sweepOrphanedExecutionRoots({
    temporaryRoot: sweepRoot,
    olderThanMs: 0,
    now: () => Date.now() + 1_000,
  });

  assert.deepEqual(swept.removed, [abandoned]);
  assert.deepEqual(await readdir(sweepRoot), []);
  assert.equal(
    await readFile(path.join(root, INSTALLED, 'locate.mjs'), 'utf8'),
    LOCATOR,
    'the sweep must reclaim the copy and never the installation it was copied from.',
  );
});

test('TB-054 NFR-PORT-002, AC-PORT-001: provisioning names no operating system and links by junction', async () => {
  const source = await readFile(path.join(LIBRARY_ROOT, 'snapshot.mjs'), 'utf8');

  for (const detection of [/process\.platform/, /os\.platform/, /\bwin32\b/, /\bdarwin\b/, /\blinux\b/]) {
    assert.doesNotMatch(
      source,
      detection,
      'the provisioning strategy is declared by the project, never detected from the environment.',
    );
  }

  // The correction TB-054 makes to `link` itself. A Windows directory symbolic
  // link needs elevated privilege or Developer Mode and an ordinary user's
  // attempt fails into the catch, silently; a junction needs neither. Every
  // other platform ignores the argument, which is why this is one constant
  // rather than a branch.
  assert.match(source, /symlink\(source, destination, 'junction'\)/);
  assert.doesNotMatch(source, /symlink\([^)]*'dir'\)/);
});
