/**
 * TB-056 — Run a provided binary from where it was provided.
 *
 * A `composer-bin` executable is pinned at activation to its absolute path in
 * the maintainer's repository. Under `copy` (TB-054) the snapshot is given its
 * own dependency tree, and a tool launched from the ORIGINAL tree that also
 * loads the PROJECT's tree from its working directory loads the same code
 * twice: the Composer shim sets `_composer_autoload_path` from `__DIR__`,
 * PHPStan loads the project's autoloader from the tree it grades, and PHP
 * reports a redeclared class. Under `link` both paths resolve to one realpath
 * and `require_once` deduplicates, which is why this never showed before.
 *
 * This repository has no PHP and no Composer shim. The fixture proves the
 * PROPERTY with the runtime it has: a binary whose `__dirname` is where it
 * was launched from, whose own "autoloader" refuses to be loaded twice, and
 * which loads the project's copy from its working directory exactly as
 * PHPStan does. Node's `require` deduplicates by realpath, as PHP's
 * `require_once` does, so the same mechanism produces the same two answers.
 *
 * What it does not cover, by construction: a real Composer proxy, PHP itself,
 * and a real two-autoloader tool. The mechanism is the same; the programs are
 * not.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { promisify } from 'node:util';

import { createBoundedExecutor } from '../skills/change-evaluation-gate/scripts/lib/bounded-execution.mjs';
import { PROTOCOL_VERSION, evaluate } from '../skills/change-evaluation-gate/scripts/lib/evaluate.mjs';
import { REASON_OUTCOMES, validateDecision } from '../skills/change-evaluation-gate/scripts/lib/evaluation-contract.mjs';
import { withoutRunLocalValues } from '../skills/change-evaluation-gate/scripts/lib/evidence-identity.mjs';
import {
  fileIdentity,
  locateExecutable,
  proveSameProgram,
  providedRoots,
  relocateSearchPath,
} from '../skills/change-evaluation-gate/scripts/lib/runner-location.mjs';
import { captureSnapshot } from '../skills/change-evaluation-gate/scripts/lib/snapshot.mjs';

const runFile = promisify(execFile);

const VENDOR = 'vendor';
const BINARY = path.join(VENDOR, 'bin', 'analyse');
const AUTOLOAD = path.join(VENDOR, 'autoload.cjs');
const CACHE = path.join(VENDOR, '.cache', 'result');
const SOURCE = 'source.txt';
const BREAKAGE = 'BROKEN';

/**
 * The tool's own autoloader. A generated Composer `autoload_real.php` declares
 * one class; declaring it twice in one process is a fatal error. This does
 * the same with one global.
 */
const AUTOLOADER = [
  'if (globalThis.ComposerAutoloaderInit) {',
  '  throw new Error(`Cannot redeclare class ComposerAutoloaderInit (previously declared in ${globalThis.ComposerAutoloaderInit}) in ${__filename}`);',
  '}',
  'globalThis.ComposerAutoloaderInit = __filename;',
  '',
].join('\n');

/**
 * The Composer shim analogue. `__dirname` is the directory the file was
 * LAUNCHED from, resolved to its realpath — exactly `__DIR__`. It loads its
 * own autoloader from there, then the project's from the working directory,
 * as PHPStan does; writes its cache beside itself, as PHPStan does; and grades
 * the file it was given.
 */
const SHIM = [
  '#!/usr/bin/env node',
  "const path = require('node:path');",
  "const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');",
  '',
  "require(path.join(__dirname, '..', 'autoload.cjs'));",
  "require(path.resolve(process.cwd(), 'vendor', 'autoload.cjs'));",
  '',
  "mkdirSync(path.join(__dirname, '..', '.cache'), { recursive: true });",
  "writeFileSync(path.join(__dirname, '..', '.cache', 'result'), `${process.cwd()}\\n`);",
  '',
  "const graded = readFileSync(process.argv[2], 'utf8');",
  '',
  'process.stdout.write(`analysed from ${__dirname}\\n`);',
  `process.exitCode = graded.includes(${JSON.stringify(BREAKAGE)}) ? 1 : 0;`,
  '',
].join('\n');

const isolatedGit = () => ({ ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' });

const git = (cwd, args) => runFile('git', args, { cwd, env: isolatedGit() });

const temporary = async (t, prefix) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));

  t.after(() => rm(root, { recursive: true, force: true }).catch(() => {}));

  return root;
};

/** A clone with a git-ignored vendor tree holding the shim and its autoloader. */
const clone = async (t) => {
  const root = await temporary(t, 'gate-runner-location-clone-');

  await writeFile(path.join(root, '.gitignore'), `${VENDOR}/\n`, 'utf8');
  await writeFile(path.join(root, SOURCE), 'baseline\n', 'utf8');
  await mkdir(path.join(root, VENDOR, 'bin'), { recursive: true });
  await writeFile(path.join(root, BINARY), SHIM, { encoding: 'utf8', mode: 0o755 });
  await writeFile(path.join(root, AUTOLOAD), AUTOLOADER, 'utf8');
  await git(root, ['init', '--quiet']);
  await git(root, ['add', '--all']);
  await git(root, ['-c', 'user.email=gate@example.test', '-c', 'user.name=Gate', 'commit', '--quiet', '--message', 'baseline']);

  return root;
};

const stage = async (root, contents) => {
  await writeFile(path.join(root, SOURCE), contents, 'utf8');
  await git(root, ['add', '--all']);
};

const runtimePath = path.dirname(process.execPath);

/** The pin activation would have recorded: the binary in the ORIGINAL tree. */
const pinFor = (root) => ({
  executable: path.join(root, BINARY),
  interpreter: process.execPath,
  version: null,
});

const executorFor = (root) => createBoundedExecutor({
  resolveExecutable: () => pinFor(root),
  captureOutput: true,
  runtimePath,
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

const policyFor = (execution) => ({
  checks: { required: [descriptor().id], advisory: [] },
  budget: { total_seconds: 600 },
  bypass: { enabled: false, marker: null },
  execution: { budget_skippable: [], dependency_roots: [VENDOR], ...execution },
  evidence: {},
});

const evaluateClone = async (t, root, execution, { sessionId = 'runner-location' } = {}) => evaluate({
  protocolVersion: PROTOCOL_VERSION,
  operation: 'evaluate',
  repository: { root },
  change: { kind: 'git-index', baseRevision: 'HEAD' },
  evaluation: { purpose: 'change-acceptance-and-regression', contractRef: null },
  invocation: {
    role: 'authoritative',
    trigger: 'commit-attempt',
    adapter: { id: 'git', surface: 'git-pre-commit', version: '1.0.0', capabilities: { nativeBlocking: true } },
    sessionId,
  },
}, {
  executionRoot: await temporary(t, 'gate-runner-location-exec-'),
  runnerVersion: 'fixture/1.0.0',
  providerVersions: { configuration: '1.0.0' },
  resolvePrerequisite: () => true,
  checks: [descriptor()],
  policy: policyFor(execution),
  execute: executorFor(root).execute,
});

test('TB-056: the fixture reproduces the defect — the original binary, run against a copied tree, redeclares its autoloader', async (t) => {
  const root = await clone(t);
  const target = await temporary(t, 'gate-runner-location-exec-');
  const captured = await captureSnapshot({
    repositoryRoot: root, kind: 'git-index', executionRoot: target, dependencyRoots: [VENDOR], dependencyProvisioning: 'copy',
  });

  assert.deepEqual(captured.dependencies.provided, [VENDOR]);

  // Same working directory, same arguments, only the binary's location differs.
  const original = await runFile(path.join(root, BINARY), [SOURCE], { cwd: target, env: { PATH: runtimePath } })
    .then(() => null, (error) => error);
  const provided = await runFile(path.join(target, BINARY), [SOURCE], { cwd: target, env: { PATH: runtimePath } });

  assert.notEqual(original, null, 'the original binary passed against the copied tree; the fixture no longer reproduces the defect.');
  assert.match(original.stderr, /Cannot redeclare class ComposerAutoloaderInit/);
  assert.match(provided.stdout, /^analysed from /);
});

test('TB-056: under link the same two invocations are one program, and neither redeclares', async (t) => {
  const root = await clone(t);
  const target = await temporary(t, 'gate-runner-location-exec-');

  await captureSnapshot({
    repositoryRoot: root, kind: 'git-index', executionRoot: target, dependencyRoots: [VENDOR], dependencyProvisioning: 'link',
  });

  for (const binary of [path.join(root, BINARY), path.join(target, BINARY)]) {
    const { stdout } = await runFile(binary, [SOURCE], { cwd: target, env: { PATH: runtimePath } });

    assert.equal(stdout, `analysed from ${path.join(root, VENDOR, 'bin')}\n`);
  }
});

test('TB-056 NFR-REL-003: re-base under a provided root only; never the interpreter, never outside a root, never a root that was not provided', async () => {
  const repositoryRoot = path.join(tmpdir(), 'repo');
  const executionRoot = path.join(tmpdir(), 'exec');
  const executable = path.join(repositoryRoot, 'vendor', 'bin', 'phpstan');

  assert.deepEqual(
    await locateExecutable({ executable, repositoryRoot, executionRoot, roots: providedRoots({ provisioning: 'copy', provided: ['vendor'] }) }),
    { pinned: executable, invoked: path.join(executionRoot, 'vendor', 'bin', 'phpstan'), root: 'vendor', strategy: 'copy' },
  );

  // A root beside the one that holds the executable does not claim it.
  assert.deepEqual(
    await locateExecutable({ executable, repositoryRoot, executionRoot, roots: providedRoots({ provisioning: 'copy', provided: ['node_modules'] }) }),
    { pinned: executable, invoked: executable, root: null, strategy: null },
  );

  // A prefix that is not a path boundary is not containment.
  assert.deepEqual(
    (await locateExecutable({ executable, repositoryRoot, executionRoot, roots: providedRoots({ provisioning: 'copy', provided: ['vend'] }) })).root,
    null,
  );

  // A root that was declared but missing or refused is not in `provided`, so
  // it re-bases nothing: the original binary is all there is.
  assert.deepEqual(providedRoots({ provisioning: 'copy', provided: [], missing: ['vendor'], refused: ['../escape'] }), []);
  assert.deepEqual(
    await locateExecutable({ executable, repositoryRoot, executionRoot, roots: providedRoots({ provisioning: 'copy', provided: [], missing: ['vendor'] }) }),
    { pinned: executable, invoked: executable, root: null, strategy: null },
  );

  // Outside every root: an interpreter, a platform executable, a runtime.
  for (const outside of ['/usr/bin/env', process.execPath, path.join(repositoryRoot, 'tools', 'check.mjs')]) {
    assert.deepEqual(
      await locateExecutable({ executable: outside, repositoryRoot, executionRoot, roots: providedRoots({ provisioning: 'copy', provided: ['vendor'] }) }),
      { pinned: outside, invoked: outside, root: null, strategy: null },
    );
  }

  // A root in a subdirectory carries its own remainder.
  assert.equal(
    (await locateExecutable({
      executable: path.join(repositoryRoot, 'app', 'vendor', 'bin', 'pint'), repositoryRoot, executionRoot, roots: providedRoots({ provisioning: 'link', provided: ['app/vendor'] }),
    })).invoked,
    path.join(executionRoot, 'app/vendor', 'bin', 'pint'),
  );
});

test('TB-056: each provided root carries the strategy it received, read from one projection', () => {
  // Today every root shares the declared strategy. A later per-root
  // declaration changes this projection and nothing that consumes it.
  assert.deepEqual(
    providedRoots({ provisioning: 'copy', provided: ['vendor', 'node_modules'], missing: [], refused: [] }),
    [{ root: 'vendor', strategy: 'copy' }, { root: 'node_modules', strategy: 'copy' }],
  );
  assert.deepEqual(providedRoots(null), []);
  assert.deepEqual(providedRoots({ provided: ['vendor'] }), [{ root: 'vendor', strategy: null }]);
});

test('TB-056 FR-EVAL-004, AC-EVAL-001: under copy the pinned binary runs from the provided copy and the check passes; a required failure still blocks', async (t) => {
  const root = await clone(t);

  await stage(root, 'baseline\nrepaired\n');

  const passed = await evaluateClone(t, root, { dependency_provisioning: 'copy' });

  assert.deepEqual(validateDecision(passed), []);
  assert.equal(passed.checks[0].outcome, 'passed', passed.checks[0].summary);
  assert.equal(passed.outcome, 'passed');

  const [attempt] = passed.checks[0].attempts;

  assert.deepEqual(attempt.program, {
    pinned: path.join(root, BINARY),
    invoked: path.join(passed.snapshot.executionRoot, BINARY),
    root: VENDOR,
  });

  await stage(root, `baseline\n${BREAKAGE}\n`);

  const blocked = await evaluateClone(t, root, { dependency_provisioning: 'copy' });

  assert.equal(blocked.checks[0].outcome, 'failed');
  assert.equal(blocked.checks[0].reasonCode, 'grader-negative');
  assert.equal(blocked.authorization, 'deny');
});

test('TB-056 NFR-SEC-001: a tool run from the provided copy writes its cache into the copy, never into the maintainer\'s repository', async (t) => {
  const root = await clone(t);

  await stage(root, 'baseline\nrepaired\n');

  const before = (await git(root, ['status', '--porcelain', '-z', '-uall', '--ignored'])).stdout;
  const decision = await evaluateClone(t, root, { dependency_provisioning: 'copy' });

  assert.equal(decision.checks[0].outcome, 'passed', decision.checks[0].summary);
  assert.equal(
    await readFile(path.join(root, CACHE), 'utf8').catch(() => null),
    null,
    'the tool\'s own cache reached the maintainer\'s repository.',
  );
  assert.equal(
    await readFile(path.join(decision.snapshot.executionRoot, CACHE), 'utf8'),
    `${decision.snapshot.executionRoot}\n`,
  );
  assert.equal((await git(root, ['status', '--porcelain', '-z', '-uall', '--ignored'])).stdout, before);
});

test('TB-056 NFR-REL-001: an undeclared clone and an explicit link clone produce identical evidence, and the check passes under both', async (t) => {
  const undeclared = await clone(t);
  const linked = await clone(t);

  await stage(undeclared, 'baseline\nrepaired\n');
  await stage(linked, 'baseline\nrepaired\n');

  const first = await evaluateClone(t, undeclared, {});
  const second = await evaluateClone(t, linked, { dependency_provisioning: 'link' });

  for (const decision of [first, second]) {
    assert.equal(decision.checks[0].outcome, 'passed', decision.checks[0].summary);
    // Under link the two paths are one file: the executable was re-based and
    // proved equivalent by reading that one file through both names.
    assert.equal(decision.checks[0].attempts[0].program.root, VENDOR);
    assert.equal(decision.environment.dependencies.provisioning, 'link');
  }

  // The two clones differ in where they live, which the evidence identity
  // elides along with the execution root, and in one declared word, which is
  // the configuration identity's to carry (TB-054). With the clone root
  // replaced and the identities the declaration itself derives set aside,
  // the stored projections — every check, attempt, program, and dependency
  // record — are compared byte for byte.
  const normalize = (decision, root) => {
    const {
      evaluationId: _evaluation, configurationId: _configuration, environment, integrity, evidence, ...body
    } = withoutRunLocalValues(decision);
    const { id: _environment, ...environmentBody } = environment;
    const { configurationId: _integrityConfiguration, environmentId: _integrityEnvironment, ...integrityBody } = integrity;
    const { id: _evidence, ...evidenceBody } = evidence;

    return JSON.stringify({
      ...body, environment: environmentBody, integrity: integrityBody, evidence: evidenceBody,
    }).split(root).join('<clone>');
  };

  assert.equal(normalize(first, undeclared), normalize(second, linked));
  assert.ok(normalize(first, undeclared).includes('"program":{"pinned":"<clone>/vendor/bin/analyse","invoked":"<run-local>/vendor/bin/analyse","root":"vendor"}'));
});

test('TB-056 NFR-REL-003, AC-EVAL-006: a provided copy whose bytes differ from the pin is runner-pin-drift, denies, and runs neither', async (t) => {
  const root = await clone(t);
  const target = await temporary(t, 'gate-runner-location-exec-');

  await cp(path.join(root, VENDOR), path.join(target, VENDOR), { recursive: true });
  await writeFile(path.join(target, SOURCE), 'baseline\n', 'utf8');
  // The copy is a different program: one more line.
  await writeFile(path.join(target, BINARY), `${SHIM}process.stdout.write('tampered');\n`, { encoding: 'utf8', mode: 0o755 });

  assert.equal(REASON_OUTCOMES['runner-pin-drift'], 'unverified');

  const attempt = await executorFor(root).execute({
    command: descriptor().evaluate,
    executionRoot: target,
    timeoutSeconds: 60,
    repositoryRoot: root,
    dependencies: { provisioning: 'copy', provided: [VENDOR], missing: [], refused: [] },
  });

  assert.equal(attempt.executed, false);
  assert.equal(attempt.reasonCode, 'runner-pin-drift');
  assert.deepEqual(attempt.program, {
    pinned: path.join(root, BINARY),
    invoked: path.join(target, BINARY),
    root: VENDOR,
  });
  assert.match(attempt.output, /is not the program activation pinned at/);
  assert.match(attempt.output, /never replaced by a different one/);

  // Neither ran: the shim writes its cache beside itself on every run.
  assert.equal(await stat(path.join(root, CACHE)).then(() => true, () => false), false);
  assert.equal(await stat(path.join(target, CACHE)).then(() => true, () => false), false);
});

test('TB-056: a provided copy that never arrived is a launch failure naming the re-based path, not a fault inside the tool', async (t) => {
  const root = await clone(t);
  const target = await temporary(t, 'gate-runner-location-exec-');

  await mkdir(path.join(target, VENDOR), { recursive: true });

  const attempt = await executorFor(root).execute({
    command: descriptor().evaluate,
    executionRoot: target,
    timeoutSeconds: 60,
    repositoryRoot: root,
    dependencies: { provisioning: 'copy', provided: [VENDOR], missing: [], refused: [] },
  });

  assert.equal(attempt.executed, false);
  assert.equal(attempt.reasonCode, 'launch-failed');
  assert.ok(attempt.output.includes(path.join(target, BINARY)), attempt.output);
  assert.ok(attempt.output.includes(path.join(root, BINARY)), attempt.output);
  assert.ok(attempt.output.includes(`"${VENDOR}"`), attempt.output);
  assert.equal(await stat(path.join(root, CACHE)).then(() => true, () => false), false);
});

test('TB-056: an executor given no provided roots invokes the pin exactly as today, and records that it did', async (t) => {
  const root = await clone(t);
  const target = await temporary(t, 'gate-runner-location-exec-');

  await writeFile(path.join(target, SOURCE), 'baseline\n', 'utf8');
  // The original binary, run from the original tree, against a tree with no
  // vendor of its own: what every existing pin fixture does.
  await mkdir(path.join(target, VENDOR), { recursive: true });
  await writeFile(path.join(target, AUTOLOAD), AUTOLOADER, 'utf8');

  const attempt = await executorFor(root).execute({
    command: descriptor().evaluate,
    executionRoot: target,
    timeoutSeconds: 60,
  });

  assert.equal(attempt.executed, true);
  assert.deepEqual(attempt.program, { pinned: path.join(root, BINARY), invoked: path.join(root, BINARY), root: null });
});

test('TB-056: equivalence is a content identity, read once per path, and cheap for a shim-sized binary', async (t) => {
  const root = await clone(t);
  const copy = path.join(await temporary(t, 'gate-runner-location-copy-'), 'analyse');

  await cp(path.join(root, BINARY), copy);

  const same = await proveSameProgram(path.join(root, BINARY), copy);

  assert.equal(same.same, true);
  assert.equal(same.identity, await fileIdentity(copy));
  assert.deepEqual(await proveSameProgram(copy, copy), { same: true, identity: null });

  const unreadable = await proveSameProgram(path.join(root, BINARY), path.join(root, 'absent'));

  assert.equal(unreadable.same, false);
  assert.match(unreadable.detail, /could not be read/);

  // The cost is paid once per check per evaluation. Measured here so the
  // number is a fact rather than a guess; the bound is deliberately loose.
  const started = performance.now();

  for (let index = 0; index < 100; index += 1) {
    await proveSameProgram(path.join(root, BINARY), copy);
  }

  const perProof = (performance.now() - started) / 100;

  assert.ok(perProof < 50, `one equivalence proof took ${perProof.toFixed(2)}ms`);
  t.diagnostic(`one equivalence proof of a ${(await stat(copy)).size}-byte binary: ${perProof.toFixed(3)}ms`);
});

test('TB-056: the search path follows the executable — an entry under a provided root names the provided copy, and the original is not kept beside it', async () => {
  const repositoryRoot = path.join(tmpdir(), 'gate-runner-location-repo');
  const executionRoot = path.join(tmpdir(), 'gate-runner-location-exec');
  const roots = [{ root: VENDOR, strategy: 'copy' }];
  const original = path.join(repositoryRoot, VENDOR, 'bin');
  const platform = path.dirname(process.execPath);
  const runtime = [original, platform, '/usr/bin'].join(path.delimiter);

  const relocated = await relocateSearchPath({
    runtimePath: runtime, repositoryRoot, executionRoot, roots,
  });

  assert.deepEqual(
    relocated.split(path.delimiter),
    [path.join(executionRoot, VENDOR, 'bin'), platform, '/usr/bin'],
  );
  assert.ok(!relocated.split(path.delimiter).includes(original), 'the original vendor/bin must not shadow the copy');

  // Nothing provided: nothing moves. The pins alone decide the path, as today.
  assert.equal(await relocateSearchPath({
    runtimePath: runtime, repositoryRoot, executionRoot, roots: [],
  }), runtime);
  assert.equal(await relocateSearchPath({
    runtimePath: '', repositoryRoot, executionRoot, roots,
  }), '');
});

test('TB-056 FR-EVAL-004: a tool that starts a sibling binary by name finds the provided copy under copy, not the original tree', async (t) => {
  const root = await clone(t);
  const target = await temporary(t, 'gate-runner-location-exec-');
  const sibling = path.join(VENDOR, 'bin', 'whereami');
  const byName = path.join(VENDOR, 'bin', 'analyse-by-name');
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // The sibling reports the directory it was started from; the pinned tool
  // starts it by BARE NAME, so only the search path decides which one runs.
  await writeFile(path.join(root, sibling), [
    '#!/usr/bin/env node',
    "process.stdout.write(require('node:path').dirname(require('node:fs').realpathSync(__filename)));",
    '',
  ].join('\n'), { encoding: 'utf8', mode: 0o755 });
  await writeFile(path.join(root, byName), [
    '#!/usr/bin/env node',
    "const { execFileSync } = require('node:child_process');",
    "const where = execFileSync('whereami', { encoding: 'utf8', env: process.env });",
    'process.stdout.write(`sibling ran from ${where}\\n`);',
    'process.exit(where.startsWith(process.cwd()) ? 0 : 3);',
    '',
  ].join('\n'), { encoding: 'utf8', mode: 0o755 });

  await cp(path.join(root, VENDOR), path.join(target, VENDOR), { recursive: true });
  await writeFile(path.join(target, SOURCE), 'baseline\n', 'utf8');

  const originalBin = path.join(root, VENDOR, 'bin');
  const executor = createBoundedExecutor({
    resolveExecutable: () => ({
      executable: path.join(root, byName), interpreter: process.execPath, version: null,
    }),
    captureOutput: true,
    // Exactly what `runtimeSearchPath` derives from the pin: the ORIGINAL
    // vendor/bin first.
    runtimePath: [originalBin, path.dirname(process.execPath)].join(path.delimiter),
  });

  const attempt = await executor.execute({
    // `composer-bin` names its binary in `args[0]`; composition strips it.
    command: { ...descriptor().evaluate, args: ['analyse-by-name'] },
    executionRoot: target,
    timeoutSeconds: 60,
    repositoryRoot: root,
    dependencies: {
      provisioning: 'copy', provided: [VENDOR], missing: [], refused: [],
    },
  });

  assert.equal(attempt.executed, true, attempt.output);
  assert.equal(attempt.exitCode, 0, attempt.output);
  assert.match(attempt.output, new RegExp(`sibling ran from ${escape(path.join(target, VENDOR, 'bin'))}`));
  assert.doesNotMatch(attempt.output, new RegExp(escape(originalBin)));
});
