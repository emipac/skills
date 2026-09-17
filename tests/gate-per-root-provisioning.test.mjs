/**
 * TB-057 — Provide each dependency root the way it needs.
 *
 * `TB-054` made `dependency_provisioning` one scalar for every declared root.
 * Measured on a real project, 83,199 files were provided by `copy` and 49,120
 * of them — the largest root — were needed as a real directory by nothing.
 * This contract widens the one key: a map from declared root to strategy,
 * beside the scalar, with a root the map does not name provided by `link`.
 *
 * What is proved here, against the real policy, snapshot, evaluation, and
 * re-basing modules: a map is accepted and each root gets its own strategy;
 * a key naming an undeclared root, or a value naming an unknown strategy, is
 * refused by name; an unmapped root links; a scalar and an absent declaration
 * produce the record they produced before; a mixed evaluation records every
 * root's strategy and keeps its identity; and `TB-056`'s re-basing reads the
 * strategy each root actually received rather than a per-evaluation scalar.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { previewActivation } from '../skills/change-evaluation-gate/scripts/lib/activation.mjs';
import { createBoundedExecutor } from '../skills/change-evaluation-gate/scripts/lib/bounded-execution.mjs';
import { readRepositoryConfiguration } from '../skills/change-evaluation-gate/scripts/lib/configuration.mjs';
import { PROTOCOL_VERSION, evaluate } from '../skills/change-evaluation-gate/scripts/lib/evaluate.mjs';
import { validateDecision } from '../skills/change-evaluation-gate/scripts/lib/evaluation-contract.mjs';
import { renderDocument } from '../skills/change-evaluation-gate/scripts/lib/operator-surface.mjs';
import { validateGatePolicy } from '../skills/change-evaluation-gate/scripts/lib/policy.mjs';
import { locateExecutable, providedRoots } from '../skills/change-evaluation-gate/scripts/lib/runner-location.mjs';
import {
  DEFAULT_DEPENDENCY_PROVISIONING,
  captureSnapshot,
  describeProvisioningDefect,
  recordedProvisioning,
  strategyForRoot,
  verifySnapshot,
} from '../skills/change-evaluation-gate/scripts/lib/snapshot.mjs';

const runFile = promisify(execFile);

/** The two roots a real project declares: the one that needs a copy and the one that does not. */
const COPIED = 'vendor';
const LINKED = 'node_modules';
const BINARY = path.join(COPIED, 'bin', 'analyse');
const AUTOLOAD = path.join(COPIED, 'autoload.cjs');
const SOURCE = 'source.txt';
const BREAKAGE = 'BROKEN';
const PROVISIONING_PATH = 'evaluation_gate.execution.dependency_provisioning';

const isolatedGit = () => ({ ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' });

/**
 * The mechanism record a copied root carries since `TB-055`, taken from the
 * capture itself: which mechanism performed the copy is a fact about this
 * environment, and this suite asserts the record's shape and its placement,
 * not which filesystem the suite happens to run on.
 */
const mechanismsOf = (dependencies, roots) => Object.fromEntries(
  roots.map((root) => {
    const record = dependencies.mechanisms?.[root];

    assert.ok(['clone', 'byte-copy'].includes(record?.mechanism), `${root} records no copy mechanism.`);

    return [root, record];
  }),
);

const git = (cwd, args) => runFile('git', args, { cwd, env: isolatedGit() });

const temporary = async (t, prefix) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));

  t.after(() => rm(root, { recursive: true, force: true }).catch(() => {}));

  return root;
};

/** The `TB-056` two-autoloader shim, pinned under the root that is copied. */
const AUTOLOADER = [
  'if (globalThis.ComposerAutoloaderInit) {',
  '  throw new Error(`Cannot redeclare class ComposerAutoloaderInit (previously declared in ${globalThis.ComposerAutoloaderInit}) in ${__filename}`);',
  '}',
  'globalThis.ComposerAutoloaderInit = __filename;',
  '',
].join('\n');

const SHIM = [
  '#!/usr/bin/env node',
  "const path = require('node:path');",
  "const { readFileSync } = require('node:fs');",
  '',
  "require(path.join(__dirname, '..', 'autoload.cjs'));",
  `require(path.resolve(process.cwd(), ${JSON.stringify(COPIED)}, 'autoload.cjs'));`,
  '',
  "const graded = readFileSync(process.argv[2], 'utf8');",
  '',
  'process.stdout.write(`analysed from ${__dirname}\\n`);',
  `process.exitCode = graded.includes(${JSON.stringify(BREAKAGE)}) ? 1 : 0;`,
  '',
].join('\n');

/** A clone with two git-ignored dependency roots, one holding the pinned binary. */
const clone = async (t) => {
  const root = await temporary(t, 'gate-per-root-clone-');

  await writeFile(path.join(root, '.gitignore'), `${COPIED}/\n${LINKED}/\n`, 'utf8');
  await writeFile(path.join(root, SOURCE), 'baseline\n', 'utf8');
  await mkdir(path.join(root, COPIED, 'bin'), { recursive: true });
  await writeFile(path.join(root, BINARY), SHIM, { encoding: 'utf8', mode: 0o755 });
  await writeFile(path.join(root, AUTOLOAD), AUTOLOADER, 'utf8');
  await mkdir(path.join(root, LINKED, 'left-pad'), { recursive: true });
  await writeFile(path.join(root, LINKED, 'left-pad', 'index.js'), 'module.exports = (s) => s;\n', 'utf8');
  await git(root, ['init', '--quiet']);
  await git(root, ['add', '--all']);
  await git(root, ['-c', 'user.email=gate@example.test', '-c', 'user.name=Gate', 'commit', '--quiet', '--message', 'baseline']);

  return root;
};

const capture = (repositoryRoot, executionRoot, dependencyProvisioning, dependencyRoots = [COPIED, LINKED]) => captureSnapshot({
  repositoryRoot,
  kind: 'git-index',
  executionRoot,
  dependencyRoots,
  ...(dependencyProvisioning === undefined ? {} : { dependencyProvisioning }),
});

const gatePolicy = (execution) => ({
  checks: { required: [], advisory: [] },
  budget: { total_seconds: 600 },
  bypass: { enabled: false, marker: null },
  execution,
  evidence: {},
});

const isLink = async (file) => (await lstat(file)).isSymbolicLink();

test('TB-057 FR-CFG-002, AC-CFG-001: a map from declared root to strategy is accepted beside the scalar', () => {
  const roots = { dependency_roots: [COPIED, LINKED] };

  assert.deepEqual(validateGatePolicy(gatePolicy({ ...roots, dependency_provisioning: { [COPIED]: 'copy' } })), []);
  assert.deepEqual(validateGatePolicy(gatePolicy({ ...roots, dependency_provisioning: { [COPIED]: 'copy', [LINKED]: 'link' } })), []);
  assert.deepEqual(validateGatePolicy(gatePolicy({ ...roots, dependency_provisioning: {} })), []);
  // The scalar, unchanged.
  assert.deepEqual(validateGatePolicy(gatePolicy({ ...roots, dependency_provisioning: 'copy' })), []);
  assert.deepEqual(validateGatePolicy(gatePolicy(roots)), []);
});

test('TB-057 FR-CFG-002: a key naming an undeclared root is refused with the root in the diagnostic, never a silent no-op', () => {
  const issues = validateGatePolicy(gatePolicy({
    dependency_roots: [COPIED],
    dependency_provisioning: { [COPIED]: 'copy', 'resources/js/wayfinder': 'copy' },
  }));

  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'gate-policy-execution-invalid');
  assert.equal(issues[0].path, PROVISIONING_PATH);
  assert.match(issues[0].message, /"resources\/js\/wayfinder"/);
  assert.match(issues[0].message, /not a declared dependency root/);

  // A map with no declared roots at all names nothing it may name.
  const undeclared = validateGatePolicy(gatePolicy({ dependency_provisioning: { [COPIED]: 'copy' } }));

  assert.equal(undeclared.length, 1);
  assert.match(undeclared[0].message, new RegExp(`"${COPIED}"`));
});

test('TB-057 FR-CFG-002: a value naming an unknown strategy is refused with the root and the value in the diagnostic', () => {
  for (const invalid of ['clone', 'symlink', 'COPY', '', null, true, 1, ['copy'], { nested: 'copy' }]) {
    const issues = validateGatePolicy(gatePolicy({
      dependency_roots: [COPIED, LINKED],
      dependency_provisioning: { [LINKED]: 'link', [COPIED]: invalid },
    }));

    assert.equal(issues.length, 1, `${JSON.stringify(invalid)} must be refused.`);
    assert.equal(issues[0].code, 'gate-policy-execution-invalid');
    assert.equal(issues[0].path, PROVISIONING_PATH);
    assert.match(issues[0].message, new RegExp(`"${COPIED}"`));
    assert.match(issues[0].message, /link or copy/);
  }

  // Not a scalar and not a map is still refused at the same path.
  for (const invalid of [['copy'], 'hardlink', 1]) {
    const issues = validateGatePolicy(gatePolicy({ dependency_roots: [COPIED], dependency_provisioning: invalid }));

    assert.deepEqual(issues.map((issue) => issue.path), [PROVISIONING_PATH]);
  }
});

test('TB-057: the declaration resolves per root, reads own properties only, and never infers', () => {
  assert.equal(describeProvisioningDefect({ [COPIED]: 'copy' }, [COPIED, LINKED]), null);
  assert.equal(describeProvisioningDefect('copy', []), null);
  assert.match(describeProvisioningDefect({ constructor: 'copy' }, [COPIED]), /"constructor"/);

  assert.equal(strategyForRoot({ [COPIED]: 'copy' }, COPIED), 'copy');
  assert.equal(strategyForRoot({ [COPIED]: 'copy' }, LINKED), DEFAULT_DEPENDENCY_PROVISIONING);
  assert.equal(strategyForRoot({}, 'constructor'), DEFAULT_DEPENDENCY_PROVISIONING);
  assert.equal(strategyForRoot('copy', LINKED), 'copy');

  // How it is recorded: a scalar as the scalar, a map complete and in
  // declaration order, an absent declaration as today's default.
  assert.equal(recordedProvisioning('copy', [COPIED, LINKED]), 'copy');
  assert.equal(recordedProvisioning(undefined, [COPIED, LINKED]), 'link');
  assert.deepEqual(
    Object.entries(recordedProvisioning({ [COPIED]: 'copy' }, [LINKED, COPIED])),
    [[LINKED, 'link'], [COPIED, 'copy']],
  );
});

test('TB-057 FR-EVAL-004: in one evaluation the mapped root is a real directory and the unmapped root is a link, both recorded', async (t) => {
  const root = await clone(t);
  const target = await temporary(t, 'gate-per-root-exec-');
  const captured = await capture(root, target, { [COPIED]: 'copy' });

  assert.equal(captured.captured, true, captured.detail);
  assert.deepEqual(captured.dependencies, {
    provisioning: { [COPIED]: 'copy', [LINKED]: 'link' },
    mechanisms: mechanismsOf(captured.dependencies, [COPIED]),
    provided: [COPIED, LINKED],
    missing: [],
    refused: [],
  });

  assert.equal(await isLink(path.join(target, COPIED)), false, 'the root mapped copy is a link.');
  assert.equal(await isLink(path.join(target, LINKED)), true, 'the root left unmapped is not a link.');
  assert.equal(await readFile(path.join(target, AUTOLOAD), 'utf8'), AUTOLOADER);
  assert.equal(await realpath(path.join(target, LINKED)), path.join(root, LINKED));
});

test('TB-057 SG-EVAL-001, NFR-REL-001: the snapshot identity, its path list, and its re-check are unchanged by any mix of strategies', async (t) => {
  const root = await clone(t);
  const mixed = await capture(root, await temporary(t, 'gate-per-root-exec-'), { [COPIED]: 'copy' });
  const reversed = await capture(root, await temporary(t, 'gate-per-root-exec-'), { [LINKED]: 'copy' });
  const scalar = await capture(root, await temporary(t, 'gate-per-root-exec-'), 'copy');
  const absent = await capture(root, await temporary(t, 'gate-per-root-exec-'), undefined);
  const bare = await captureSnapshot({ repositoryRoot: root, kind: 'git-index', executionRoot: await temporary(t, 'gate-per-root-exec-') });

  for (const captured of [mixed, reversed, scalar, absent]) {
    assert.equal(captured.snapshot.id, bare.snapshot.id);
    assert.deepEqual(captured.snapshot.paths, bare.snapshot.paths);
    assert.equal(captured.snapshot.paths.some((relative) => relative.startsWith(`${COPIED}/`) || relative.startsWith(`${LINKED}/`)), false);
  }

  await writeFile(path.join(mixed.snapshot.executionRoot, COPIED, 'cache.txt'), 'tool noise\n', 'utf8');

  assert.equal((await verifySnapshot(mixed.snapshot)).verified, true);
});

test('TB-057 AC-CFG-001: a scalar declaration and an absent one produce exactly the record TB-054 defined', async (t) => {
  const root = await clone(t);
  const absent = await capture(root, await temporary(t, 'gate-per-root-exec-'), undefined);
  const link = await capture(root, await temporary(t, 'gate-per-root-exec-'), 'link');
  const copy = await capture(root, await temporary(t, 'gate-per-root-exec-'), 'copy');

  assert.deepEqual(absent.dependencies, { provisioning: 'link', provided: [COPIED, LINKED], missing: [], refused: [] });
  assert.deepEqual(link.dependencies, absent.dependencies);
  assert.deepEqual(copy.dependencies, {
    provisioning: 'copy',
    mechanisms: mechanismsOf(copy.dependencies, [COPIED, LINKED]),
    provided: [COPIED, LINKED],
    missing: [],
    refused: [],
  });
  assert.equal(await isLink(path.join(absent.snapshot.executionRoot, COPIED)), true);
  assert.equal(await isLink(path.join(copy.snapshot.executionRoot, LINKED)), false);
});

test('TB-057: a map naming an undeclared root, or an unknown value, ends the capture by name rather than being repaired', async (t) => {
  const root = await clone(t);

  for (const [declaration, named] of [
    [{ [COPIED]: 'copy', 'resources/js/actions': 'copy' }, /"resources\/js\/actions"/],
    [{ [COPIED]: 'hardlink' }, /"hardlink"/],
  ]) {
    const target = await temporary(t, 'gate-per-root-exec-');
    const captured = await capture(root, target, declaration);

    assert.equal(captured.captured, false);
    assert.equal(captured.reasonCode, 'configuration-invalid');
    assert.match(captured.detail, named);
    assert.equal(await lstat(path.join(target, COPIED)).then(() => true, () => false), false);
  }
});

test('TB-057: TB-054\'s safety properties hold per root under its own strategy — a failed copy of one root is cleaned and stated, and the other root is still provided', async (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('an unreadable directory is readable by root, so this clone cannot make a copy fail.');

    return;
  }

  const root = await clone(t);

  await chmod(path.join(root, COPIED), 0o000);
  t.after(() => chmod(path.join(root, COPIED), 0o755).catch(() => {}));

  const target = await temporary(t, 'gate-per-root-exec-');
  const captured = await capture(root, target, { [COPIED]: 'copy' });

  assert.equal(captured.captured, true, captured.detail);
  assert.deepEqual(captured.dependencies, {
    provisioning: { [COPIED]: 'copy', [LINKED]: 'link' },
    provided: [LINKED],
    missing: [COPIED],
    refused: [],
  });
  assert.equal(await lstat(path.join(target, COPIED)).then(() => true, () => false), false, 'a failed copy left something behind.');
  assert.equal(await isLink(path.join(target, LINKED)), true);
});

test('TB-057: an occupied destination is refused per root, and the other root is still provided by its own strategy', async (t) => {
  const root = await clone(t);
  const target = await temporary(t, 'gate-per-root-exec-');

  // The snapshot itself materializes nothing at either root; a path occupied
  // before provisioning is the condition TB-054 refuses to serve by removal.
  await mkdir(path.join(target, LINKED), { recursive: true });

  const captured = await capture(root, target, { [COPIED]: 'copy' });

  assert.equal(captured.captured, true, captured.detail);
  assert.deepEqual(captured.dependencies.provided, [COPIED]);
  assert.deepEqual(captured.dependencies.missing, [LINKED]);
  assert.equal(await isLink(path.join(target, COPIED)), false);
  assert.equal(await isLink(path.join(target, LINKED)), false);
});

test('TB-057 → TB-056: re-basing reads the strategy each root received from the per-root record, not a scalar', async () => {
  const repositoryRoot = path.join(tmpdir(), 'repo');
  const executionRoot = path.join(tmpdir(), 'exec');
  const mixed = {
    provisioning: { [COPIED]: 'copy', [LINKED]: 'link' },
    provided: [COPIED, LINKED],
    missing: [],
    refused: [],
  };

  assert.deepEqual(providedRoots(mixed), [
    { root: COPIED, strategy: 'copy' },
    { root: LINKED, strategy: 'link' },
  ]);
  // The scalar record still projects as it did under TB-056.
  assert.deepEqual(providedRoots({ provisioning: 'copy', provided: [COPIED, LINKED] }), [
    { root: COPIED, strategy: 'copy' },
    { root: LINKED, strategy: 'copy' },
  ]);
  // A provided root the record somehow does not name carries no strategy
  // rather than an invented one.
  assert.deepEqual(providedRoots({ provisioning: { [COPIED]: 'copy' }, provided: [LINKED] }), [
    { root: LINKED, strategy: null },
  ]);

  const underCopied = await locateExecutable({
    executable: path.join(repositoryRoot, BINARY), repositoryRoot, executionRoot, roots: providedRoots(mixed),
  });
  const underLinked = await locateExecutable({
    executable: path.join(repositoryRoot, LINKED, '.bin', 'eslint'), repositoryRoot, executionRoot, roots: providedRoots(mixed),
  });

  assert.deepEqual(underCopied, {
    pinned: path.join(repositoryRoot, BINARY),
    invoked: path.join(executionRoot, BINARY),
    root: COPIED,
    strategy: 'copy',
  });
  // Re-basing does not branch on the strategy: a linked root is where its
  // binaries run from too, by another name for the same file.
  assert.deepEqual(underLinked, {
    pinned: path.join(repositoryRoot, LINKED, '.bin', 'eslint'),
    invoked: path.join(executionRoot, LINKED, '.bin', 'eslint'),
    root: LINKED,
    strategy: 'link',
  });
});

const descriptor = () => ({
  id: 'configuration.static-analysis.static-analysis.1',
  provider: 'configuration',
  stage: 'static-analysis',
  capability: 'static-analysis',
  scope: 'both',
  applicability: { changed_path_globs: ['**'], required_facts: [] },
  prerequisites: [],
  policy: 'required',
  evaluate: {
    runner: 'composer-bin',
    args: ['analyse', SOURCE],
    working_directory: '.',
    timeout_seconds: 60,
    allowed_environment: [],
    evidence_category: 'static-analysis',
    source_scope: 'both',
  },
  fix: null,
  timeout_seconds: 60,
  declared_writes: [],
  evidence: { claims: ['static-analysis'], success_exit_codes: [0], report: null },
  order: 10,
  selection: null,
});

const evaluateClone = async (t, root, execution) => evaluate({
  protocolVersion: PROTOCOL_VERSION,
  operation: 'evaluate',
  repository: { root },
  change: { kind: 'git-index', baseRevision: 'HEAD' },
  evaluation: { purpose: 'change-acceptance-and-regression', contractRef: null },
  invocation: {
    role: 'authoritative',
    trigger: 'commit-attempt',
    adapter: { id: 'git', surface: 'git-pre-commit', version: '1.0.0', capabilities: { nativeBlocking: true } },
    sessionId: 'per-root-provisioning',
  },
}, {
  executionRoot: await temporary(t, 'gate-per-root-exec-'),
  runnerVersion: 'fixture/1.0.0',
  providerVersions: { configuration: '1.0.0' },
  resolvePrerequisite: () => true,
  checks: [descriptor()],
  policy: {
    checks: { required: [descriptor().id], advisory: [] },
    budget: { total_seconds: 600 },
    bypass: { enabled: false, marker: null },
    execution: { budget_skippable: [], dependency_roots: [COPIED, LINKED], ...execution },
    evidence: {},
  },
  execute: createBoundedExecutor({
    resolveExecutable: () => ({ executable: path.join(root, BINARY), interpreter: process.execPath, version: null }),
    captureOutput: true,
    runtimePath: path.dirname(process.execPath),
  }).execute,
});

test('TB-057 AC-EVAL-001, NFR-OPER-001: a mixed evaluation passes good code, blocks a required failure, re-bases the pinned binary under the copied root, and records every root\'s strategy', async (t) => {
  const root = await clone(t);

  await writeFile(path.join(root, SOURCE), 'baseline\nrepaired\n', 'utf8');
  await git(root, ['add', '--all']);

  const passed = await evaluateClone(t, root, { dependency_provisioning: { [COPIED]: 'copy' } });

  assert.deepEqual(validateDecision(passed), []);
  assert.equal(passed.checks[0].outcome, 'passed', passed.checks[0].summary);
  assert.equal(passed.outcome, 'passed');
  assert.deepEqual(passed.environment.dependencies, {
    provisioning: { [COPIED]: 'copy', [LINKED]: 'link' },
    mechanisms: mechanismsOf(passed.environment.dependencies, [COPIED]),
    provided: [COPIED, LINKED],
    missing: [],
    refused: [],
  });
  assert.deepEqual(passed.checks[0].attempts[0].program, {
    pinned: path.join(root, BINARY),
    invoked: path.join(passed.snapshot.executionRoot, BINARY),
    root: COPIED,
  });

  await writeFile(path.join(root, SOURCE), `baseline\n${BREAKAGE}\n`, 'utf8');
  await git(root, ['add', '--all']);

  const blocked = await evaluateClone(t, root, { dependency_provisioning: { [COPIED]: 'copy' } });

  assert.deepEqual(validateDecision(blocked), []);
  assert.equal(blocked.checks[0].outcome, 'failed');
  assert.equal(blocked.authorization, 'deny');
});

test('TB-057 NFR-OPER-001: a decision that materializes nothing still records the per-root map, and the contract validates both shapes', async (t) => {
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
      adapter: { id: 'git', surface: 'git-pre-commit', version: '1.0.0', capabilities: { nativeBlocking: true } },
      sessionId: 'per-root-provisioning-nothing',
    },
  }, {
    executionRoot: await temporary(t, 'gate-per-root-exec-'),
    runnerVersion: 'fixture/1.0.0',
    providerVersions: { configuration: '1.0.0' },
    resolvePrerequisite: () => true,
    checks: [],
    policy: gatePolicy({ dependency_roots: [COPIED, LINKED], dependency_provisioning: { [LINKED]: 'copy' } }),
    execute: async () => ({ executed: true, exitCode: 0, durationMs: 1 }),
  });

  assert.deepEqual(validateDecision(decision), []);
  assert.deepEqual(decision.environment.dependencies.provisioning, { [COPIED]: 'link', [LINKED]: 'copy' });

  const invalid = structuredClone(decision);

  invalid.environment.dependencies.provisioning = { [COPIED]: 1 };
  assert.deepEqual(validateDecision(invalid).map((issue) => issue.path), ['decision.environment.dependencies']);
});

const activationRequest = (root, execution) => ({
  scope: 'repository',
  trigger: 'explicit',
  repository: { root },
  configuration: {
    schemaVersion: 4,
    policy: {
      checks: { required: ['broad_test'], advisory: [] },
      budget: { total_seconds: 600 },
      bypass: { enabled: false, marker: null },
      execution: { budget_skippable: [], dependency_roots: [COPIED, LINKED], ...execution },
      evidence: {},
    },
  },
  client: { id: 'claude-code', surface: 'cli', version: '1.2.3' },
  gate: { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' },
  actor: { name: 'maintainer', source: 'git-config' },
  runtime: {
    runnerVersion: 'change-evaluation-gate/0.9.0',
    hookProgram: { interpreter: process.execPath, script: 'tools/gate-runner.mjs', args: [] },
  },
  checks: [{
    id: 'broad_test',
    evaluate: {
      runner: 'package-script', args: ['test'], working_directory: '.', timeout_seconds: 300, allowed_environment: ['PATH'], evidence_category: 'test', source_scope: 'backend',
    },
  }],
  adapters: [{ id: 'git', version: '1.0.0', authoritative: true }],
  runtimeInputs: [],
});

const activationDependencies = () => ({
  runGit: async (cwd, args) => (await git(cwd, args)).stdout,
  resolveExecutable: (runner) => ({ executable: `/usr/bin/${runner}`, version: '1.0.0' }),
});

test('TB-057 FR-LIFE-004, NFR-OPER-001: the preview names each root\'s strategy, a map is a different consent than a scalar, and a scalar previews as before', async (t) => {
  const root = await clone(t);
  const mixed = await previewActivation(activationRequest(root, { dependency_provisioning: { [COPIED]: 'copy' } }), activationDependencies());
  const scalar = await previewActivation(activationRequest(root, { dependency_provisioning: 'copy' }), activationDependencies());
  const absent = await previewActivation(activationRequest(root, {}), activationDependencies());

  assert.deepEqual(mixed.dependencyProvisioning, { [COPIED]: 'copy', [LINKED]: 'link' });
  assert.equal(scalar.dependencyProvisioning, 'copy');
  assert.equal(absent.dependencyProvisioning, 'link');
  assert.notEqual(mixed.previewId, scalar.previewId, 'consent to a mixed provisioning must not be consent to a scalar one.');
  assert.notEqual(mixed.previewId, absent.previewId);

  // And a differently mixed declaration is a different consent again.
  const reversed = await previewActivation(activationRequest(root, { dependency_provisioning: { [LINKED]: 'copy' } }), activationDependencies());

  assert.notEqual(reversed.previewId, mixed.previewId);

  // A map naming an undeclared root never reaches a preview to consent to.
  await assert.rejects(
    previewActivation(activationRequest(root, { dependency_provisioning: { 'resources/js/routes': 'copy' } }), activationDependencies()),
    /evaluation_gate\.execution\.dependency_provisioning: .*"resources\/js\/routes"/,
  );

  const rendered = (provisioning) => renderDocument({
    command: 'activate',
    repository: { root },
    mutation: null,
    trustBoundary: { statement: 'trust boundary' },
    observation: {
      state: 'configured',
      client: 'claude-code',
      trustModel: null,
      release: { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' },
      repositoryIdentity: mixed.repository.identity,
      configurationIdentity: mixed.configuration.identity,
      hooks: [],
      hookManager: null,
      hookProgram: { interpreter: process.execPath, script: 'tools/gate-runner.mjs' },
      commands: [],
      unresolved: [],
      adapters: [],
      dependencyRoots: [COPIED, LINKED],
      dependencyProvisioning: provisioning,
      runtimeInputs: [],
      shortcut: { kind: 'clone-local-git-alias', name: 'alias.gate' },
      confirmationToken: mixed.previewId,
    },
  }).split('\n');

  assert.ok(rendered(mixed.dependencyProvisioning).includes(`dependency roots: ${COPIED} (copy), ${LINKED} (link)`));
  assert.ok(rendered('copy').includes(`dependency roots: ${COPIED}, ${LINKED} (provided by copy)`));
});

test('TB-057: a map declaration written as a JSON flow value is read by the supported configuration reader', async (t) => {
  const root = await temporary(t, 'gate-per-root-configuration-');

  await writeFile(path.join(root, '.agent-framework.yaml'), [
    'schema_version: 4',
    'evaluation_gate:',
    '  checks: {"required":[],"advisory":[]}',
    '  budget: {"total_seconds":600}',
    '  bypass: {"enabled":false,"marker":null}',
    `  execution: {"budget_skippable":[],"dependency_roots":[${JSON.stringify(COPIED)},${JSON.stringify(LINKED)}],"dependency_provisioning":{${JSON.stringify(COPIED)}:"copy"}}`,
    '  evidence: {}',
    '',
  ].join('\n'), 'utf8');

  const configured = await readRepositoryConfiguration({ repositoryRoot: root });

  assert.equal(configured.ok, true, configured.detail);
  assert.deepEqual(configured.configuration.evaluation_gate.execution.dependency_provisioning, { [COPIED]: 'copy' });
  assert.deepEqual(validateGatePolicy(configured.configuration.evaluation_gate), []);
});
