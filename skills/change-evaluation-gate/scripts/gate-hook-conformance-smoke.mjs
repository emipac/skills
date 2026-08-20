#!/usr/bin/env node
/**
 * `gate-hook-conformance-smoke` — the packaged hook chain and the packaged
 * trust resumption.
 *
 * Proves, against throwaway Git repositories, real composed `pre-commit` hooks,
 * real spawned check processes, and real `git commit` invocations:
 *
 * 1. `composed-hook-chain` — activation composes a confirmed marker-delimited
 *    block into a hook the repository already had, preserves every surrounding
 *    byte, blocks a commit whose required check fails, and on a commit it
 *    allows the *prior* hook still runs and leaves its own observable trace
 *    (AC-LIFE-003, FR-LIFE-007, NFR-COMP-002).
 * 2. `strategy-order` — the declared order is followed: a native hook manager
 *    is used before any gate-owned file, its generated runner is never touched,
 *    and a manager whose integration point is a declaration requires manual
 *    registration rather than being edited (AC-LIFE-009, FR-LIFE-017).
 * 3. `marker-drift` — gate-owned block content nobody can account for requires
 *    manual resolution; nothing is composed, reused, or repaired (AC-LIFE-003).
 * 4. `trust-pause-and-resume` — a transaction paused for client-controlled
 *    trust leaves no integration active, refuses to resume once the
 *    configuration identity changes, and completes only when every transaction
 *    identity is identical (AC-LIFE-009, FR-LIFE-016).
 * 5. `desktop-registration` — two adapters declaring different registration
 *    files and different block schemas both register through their own
 *    declarations into real client configuration files, every unrelated key and
 *    entry in those files survives, drift is reported and never repaired, and
 *    removal returns both files byte for byte to what their owners wrote
 *    (AC-ADAPT-003, FR-ADAPT-008, SG-HOOK-001, SG-LIFE-001).
 * 6. `settled-turn` — a real clean clone driven through the real packaged
 *    preflight program leaves no execution root, and cannot have made one: the
 *    child is given a temporary directory it may read and not write, so a run
 *    that copies the tree fails visibly and a run that never tries is silent.
 *    The same clone still decides a commit exactly as it does today, denying a
 *    breakage and allowing its repair (AC-EVAL-004, FR-ADAPT-005, NFR-PERF-001,
 *    NFR-REL-001).
 *
 * It is non-interactive and offline, requires no external toolchain beyond Git
 * and this Node runtime — in particular no hook manager and no desktop client
 * is ever installed or executed — and is safe to run repeatedly on a clean
 * machine.
 *
 * SAFETY: every fixture is a throwaway repository created under the OS
 * temporary directory and removed afterwards. `assertThrowawayRepository`
 * refuses any root that is not under that directory or that lies inside this
 * repository, because an escaped fixture would compose an authoritative hook
 * into the framework clone and block every later commit.
 *
 * Usage:
 *   node skills/change-evaluation-gate/scripts/gate-hook-conformance-smoke.mjs [--json]
 *
 * Exit status is 0 only when every scenario holds.
 */

import { execFile, spawn } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  HOOK_BLOCK_BEGIN,
  HOOK_BLOCK_END,
  activate,
  configurationIdentity,
  previewActivation,
} from './lib/activation.mjs';
import { createBoundedExecutor } from './lib/bounded-execution.mjs';
import { readRepositoryConfiguration } from './lib/configuration.mjs';
import { evaluate } from './lib/evaluate.mjs';
import { contentIdentity, openEvidenceStore } from './lib/evidence-store.mjs';
import { collectChecks } from './lib/gate-core.mjs';
import { EXECUTION_ROOT_PREFIXES, runHook } from './lib/hook-runner.mjs';
import { deactivateGate, statusGate } from './lib/lifecycle.mjs';
import laravelProvider from './lib/providers/laravel.mjs';

const CAPABILITY = 'gate-hook-conformance-smoke';

const LIBRARY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib');

/** This repository. No fixture may ever touch its Git state or its hooks. */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const SOURCE = 'app/Order.php';

/** The token that makes the graded source fail its required check. */
const BREAKAGE = 'BROKEN';

const runFile = promisify(execFile);

const temporaryRoots = [];

const isInside = (parent, candidate) => candidate === parent
  || candidate.startsWith(`${parent}${path.sep}`);

/** The guard. Nothing in this capability operates outside a throwaway clone. */
const assertThrowawayRepository = async (root) => {
  const resolved = await realpath(root).catch(() => path.resolve(root));
  const temporaryRoot = await realpath(tmpdir());
  const frameworkRoot = await realpath(FRAMEWORK_ROOT).catch(() => FRAMEWORK_ROOT);

  if (!isInside(temporaryRoot, resolved)) {
    throw new Error(`${CAPABILITY} refuses to operate outside the OS temporary directory: ${resolved}.`);
  }

  if (isInside(frameworkRoot, resolved)) {
    throw new Error(`${CAPABILITY} refuses to operate inside this repository: ${resolved}.`);
  }

  return resolved;
};

const temporaryDirectory = async (prefix) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));

  temporaryRoots.push(directory);

  return directory;
};

/** Git with its own configuration, so no developer setting can reach a fixture. */
const gitEnvironment = () => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

const git = async (cwd, args) => runFile('git', args, { cwd, env: gitEnvironment() });

const runGit = async (repositoryRoot, args) => (await git(repositoryRoot, args)).stdout;

const commit = (cwd, message) => git(cwd, [
  '-c', 'user.email=gate@example.test',
  '-c', 'user.name=Gate Hook Conformance Smoke',
  'commit', '--quiet', '--message', message,
]);

/** A required check that grades one source file and really fails on breakage. */
const CHECK_SCRIPT = [
  "import { readFile } from 'node:fs/promises';",
  '',
  "const graded = await readFile(process.argv[2], 'utf8').catch(() => '');",
  '',
  'process.stdout.write(`graded ${graded.length} bytes\\n`);',
  `process.exitCode = graded.includes(${JSON.stringify(BREAKAGE)}) ? 1 : 0;`,
  '',
].join('\n');

/**
 * The program the composed block execs.
 *
 * It runs the real evaluation process against the real snapshot and exits
 * non-zero unless the authoritative decision authorizes the commit.
 */
const runnerScript = () => [
  `import { createBoundedExecutor } from ${JSON.stringify(pathToFileURL(path.join(LIBRARY, 'bounded-execution.mjs')).href)};`,
  `import { evaluate } from ${JSON.stringify(pathToFileURL(path.join(LIBRARY, 'evaluate.mjs')).href)};`,
  `import { collectChecks } from ${JSON.stringify(pathToFileURL(path.join(LIBRARY, 'gate-core.mjs')).href)};`,
  `import laravelProvider from ${JSON.stringify(pathToFileURL(path.join(LIBRARY, 'providers', 'laravel.mjs')).href)};`,
  "import { mkdtemp, readFile, rm } from 'node:fs/promises';",
  "import { tmpdir } from 'node:os';",
  "import path from 'node:path';",
  '',
  // Activation proves this program denies before it registers it. The subject
  // is named explicitly so the proof never runs against somebody's own work.
  "const selfTestSubject = process.env.CHANGE_EVALUATION_GATE_SELF_TEST ?? null;",
  '',
  'if (selfTestSubject !== null) {',
  "  const subject = JSON.parse(await readFile(selfTestSubject, 'utf8'));",
  "  const denied = subject.checks.some((check) => check.required && check.outcome === 'failed');",
  '',
  '  process.stdout.write(`change-evaluation-gate: ${denied ? "denied" : "allowed"} / self-test ${subject.selfTestId}\\n`);',
  '  process.exit(denied ? 1 : 0);',
  '}',
  '',
  `const SOURCE = ${JSON.stringify(SOURCE)};`,
  'const root = process.cwd();',
  "const executionRoot = await mkdtemp(path.join(tmpdir(), 'gate-hook-exec-'));",
  '',
  'try {',
  '  const collected = collectChecks([{',
  '    provider: laravelProvider,',
  '    facts: {',
  "      scopes: { backend: ['app'], frontend: [] },",
  '      proved: {',
  '        broad_test: {',
  '          evaluate: {',
  "            runner: 'repository-script',",
  "            args: ['tools/check.mjs', SOURCE],",
  "            working_directory: '.',",
  '            timeout_seconds: 60,',
  "            allowed_environment: ['PATH'],",
  "            evidence_category: 'test',",
  "            source_scope: 'backend',",
  '          },',
  '        },',
  '      },',
  '    },',
  '  }]);',
  '  const executor = createBoundedExecutor({',
  '    resolveExecutable: (command) => (',
  "      command.runner === 'repository-script' ? { executable: process.execPath } : null",
  '    ),',
  '  });',
  '  const decision = await evaluate({',
  "    protocolVersion: '1.0',",
  "    operation: 'evaluate',",
  '    repository: { root },',
  "    change: { kind: 'worktree', baseRevision: 'HEAD' },",
  "    evaluation: { purpose: 'regression-only', contractRef: null },",
  '    invocation: {',
  "      role: 'authoritative',",
  "      trigger: 'work-complete',",
  "      adapter: { id: 'git', surface: 'git-pre-commit', version: '1.0.0', capabilities: { nativeBlocking: true } },",
  "      sessionId: 'gate-hook-conformance-smoke-hook',",
  '    },',
  '  }, {',
  '    executionRoot,',
  "    runnerVersion: 'gate-hook-conformance-smoke/1.0.0',",
  "    providerVersions: { laravel: '1.0.0' },",
  '    resolvePrerequisite: () => true,',
  '    checks: collected.checks,',
  '    execute: executor.execute,',
  '  });',
  '',
  '  process.stdout.write(`change-evaluation-gate: ${decision.outcome} / ${decision.authorization}\\n`);',
  "  process.exitCode = decision.authorization === 'allow' ? 0 : 1;",
  '} finally {',
  '  await rm(executionRoot, { recursive: true, force: true });',
  '}',
  '',
].join('\n');

/**
 * A hook the repository already had.
 *
 * The trailing `exit 0` is deliberate: a gate block merely appended to this file
 * would never execute, so this fixture proves composition puts the gate where
 * control actually reaches it while keeping the prior chain intact.
 */
const priorHook = (root) => [
  '#!/bin/sh',
  '# a hook this repository already had, and still has',
  `echo "prior chain" > "${path.join(root, 'prior-ran')}"`,
  'exit 0',
  '',
].join('\n');

/** Everything outside the gate-owned block, in order. */
const withoutManagedBlock = (contents) => {
  const begin = contents.indexOf(HOOK_BLOCK_BEGIN);
  const end = contents.indexOf(HOOK_BLOCK_END);

  if (begin === -1 || end === -1) {
    return contents;
  }

  return contents.slice(0, begin) + contents.slice(end + HOOK_BLOCK_END.length + 1);
};

/** A throwaway clone with one baseline commit, a check, and a hook program. */
const fixtureRepository = async () => {
  const root = await temporaryDirectory('gate-hook-conformance-repo-');

  await assertThrowawayRepository(root);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/check.mjs'), CHECK_SCRIPT, 'utf8');
  await writeFile(path.join(root, 'tools/gate-runner.mjs'), runnerScript(), 'utf8');
  await writeFile(path.join(root, SOURCE), 'baseline\n', 'utf8');
  await git(root, ['init', '--quiet']);
  await git(root, ['add', '--all']);
  await commit(root, 'baseline');

  return root;
};

const storeFor = async (root) => openEvidenceStore({
  repositoryRoot: root,
  runGit,
  identity: {
    actor: { name: CAPABILITY, source: 'fixture' },
    client: { id: 'git', surface: 'git-pre-commit', version: '1.0.0' },
    gate: { id: 'change-evaluation-gate', version: '1.0.0', protocolVersion: '1.0' },
    repository: { identity: `sha256:${'0'.repeat(64)}` },
  },
});

const gatePolicy = (overrides = {}) => ({
  checks: { required: ['broad_test'], advisory: [] },
  budget: { total_seconds: 600 },
  bypass: { enabled: false, marker: null },
  execution: { budget_skippable: [] },
  evidence: {},
  ...overrides,
});

const activationRequest = (root, overrides = {}) => ({
  scope: 'repository',
  trigger: 'explicit',
  repository: { root },
  configuration: { schemaVersion: 4, policy: gatePolicy() },
  client: { id: 'git', surface: 'git-pre-commit', version: '1.0.0' },
  gate: { id: 'change-evaluation-gate', version: '1.0.0', protocolVersion: '1.0' },
  actor: { name: CAPABILITY, source: 'fixture' },
  runtime: {
    runnerVersion: `${CAPABILITY}/1.0.0`,
    hookProgram: { interpreter: process.execPath, script: 'tools/gate-runner.mjs', args: [] },
  },
  checks: [{
    id: 'broad_test',
    evaluate: {
      runner: 'repository-script',
      args: ['tools/check.mjs', SOURCE],
      working_directory: '.',
      timeout_seconds: 60,
      allowed_environment: ['PATH'],
      evidence_category: 'test',
      source_scope: 'backend',
    },
  }],
  adapters: [{ id: 'git', version: '1.0.0', authoritative: true }],
  runtimeInputs: [{ name: 'APP_TOKEN', source: 'approved-environment-file' }],
  ...overrides,
});

/**
 * A real self-test of the evaluation process: it materializes the snapshot,
 * spawns the check, and requires a contract decision before Git may be enabled.
 */
const selfTestEvaluation = async ({ repository }) => {
  const collected = collectChecks([{
    provider: laravelProvider,
    facts: {
      scopes: { backend: ['app'], frontend: [] },
      proved: { broad_test: { evaluate: activationRequest(repository.root).checks[0].evaluate } },
    },
  }]);
  const executor = createBoundedExecutor({
    resolveExecutable: (command) => (
      command.runner === 'repository-script' ? { executable: process.execPath } : null
    ),
  });
  const decision = await evaluate({
    protocolVersion: '1.0',
    operation: 'evaluate',
    repository: { root: repository.root },
    change: { kind: 'worktree', baseRevision: 'HEAD' },
    evaluation: { purpose: 'regression-only', contractRef: null },
    invocation: {
      role: 'preflight',
      trigger: 'work-complete',
      adapter: { id: 'git', surface: 'git-pre-commit', version: '1.0.0', capabilities: { nativeBlocking: true } },
      sessionId: `${CAPABILITY}-self-test`,
    },
  }, {
    executionRoot: await temporaryDirectory('gate-hook-conformance-exec-'),
    runnerVersion: `${CAPABILITY}/1.0.0`,
    providerVersions: { laravel: '1.0.0' },
    resolvePrerequisite: () => true,
    checks: collected.checks,
    execute: executor.execute,
  });

  return {
    ok: typeof decision?.outcome === 'string',
    detail: `the evaluation process reached ${decision?.outcome}`,
  };
};

const dependencies = (overrides = {}) => ({
  runGit,
  resolveExecutable: (runner) => (
    runner === 'repository-script'
      ? { executable: process.execPath, version: process.versions.node }
      : null
  ),
  establishTrust: async () => ({
    established: true,
    grantedBy: CAPABILITY,
    at: new Date().toISOString(),
  }),
  selfTestEvaluation,
  selfTestAdapter: async (adapter) => ({ ok: true, detail: `${adapter.id} responded` }),
  ...overrides,
});

const consentFor = (preview) => ({
  previewId: preview.previewId,
  repositoryIdentity: preview.repository.identity,
  configurationIdentity: preview.configuration.identity,
  actor: { name: CAPABILITY, source: 'fixture' },
  grantedAt: new Date().toISOString(),
});

/** Activate one fixture clone for real, through the real registration seam. */
const activateFixture = async (root, request, overrides = {}) => {
  await assertThrowawayRepository(root);

  const preview = await previewActivation(request, dependencies());
  const result = await activate(
    { ...request, consent: consentFor(preview) },
    dependencies(overrides),
  );

  return { preview, result };
};

const check = (findings, condition, detail) => {
  if (!condition) {
    findings.push(detail);
  }
};

/** Every non-sample hook file registered in a clone. */
const registeredHooks = async (hooksDirectory) => {
  const entries = await readdir(hooksDirectory).catch(() => []);

  return entries.filter((entry) => !entry.endsWith('.sample'));
};

/**
 * The prior chain survives composition, and both it and the gate really run.
 *
 * This is the scenario NFR-COMP-002 exists for: not "the old hook is still on
 * disk" but "the old hook still executes".
 */
const composedHookChain = async () => {
  const findings = [];
  const root = await fixtureRepository();
  const store = await storeFor(root);
  const hooksDirectory = path.join(store.gitCommonDirectory, 'hooks');
  const hookPath = path.join(hooksDirectory, 'pre-commit');
  const original = priorHook(root);

  await mkdir(hooksDirectory, { recursive: true });
  await writeFile(hookPath, original, { mode: 0o755 });

  // Without confirmation the gate will not touch a hook it did not write.
  const unconfirmed = await previewActivation(activationRequest(root), dependencies());

  check(
    findings,
    unconfirmed.hooks[0].action === 'refuse-existing-hook',
    `An unconfirmed existing hook was not refused: ${unconfirmed.hooks[0].action}.`,
  );

  const request = activationRequest(root, {
    hookConfirmation: {
      strategy: 'marker-delimited-block',
      path: hookPath,
      hookIdentity: unconfirmed.hooks[0].existing?.identity ?? null,
    },
  });
  const { preview, result } = await activateFixture(root, request, { evidenceStore: store });

  check(
    findings,
    preview.hooks[0].action === 'compose-marker-block'
      && preview.hooks[0].ownership === 'marker-delimited-block',
    `A confirmed existing hook did not select marker composition: ${preview.hooks[0].action}.`,
  );
  check(findings, result.activated === true, `Composition did not activate: ${result.reasonCode}.`);
  check(
    findings,
    result.receipt?.hookChain?.strategy === 'marker-delimited-block'
      && result.receipt?.hookChain?.priorIdentity === unconfirmed.hooks[0].existing?.identity,
    'The receipt does not pin the composition strategy and the preserved chain.',
  );

  const composed = await readFile(hookPath, 'utf8').catch(() => '');

  check(
    findings,
    withoutManagedBlock(composed) === original,
    'Composition did not preserve the surrounding hook content byte for byte.',
  );
  check(
    findings,
    (((await stat(hookPath).catch(() => ({ mode: 0 }))).mode) & 0o111) !== 0,
    'The composed hook is not executable.',
  );
  check(
    findings,
    JSON.stringify(await registeredHooks(hooksDirectory)) === JSON.stringify(['pre-commit']),
    'Composition registered a second hook instead of composing into the existing one.',
  );

  // A change whose required check fails must not become a commit.
  const before = (await runGit(root, ['rev-list', '--count', 'HEAD'])).trim();

  await writeFile(path.join(root, SOURCE), `baseline\n${BREAKAGE}\n`, 'utf8');
  await git(root, ['add', '--all']);

  const blocked = await commit(root, 'a change the gate must refuse').then(
    () => ({ failed: false, stdout: '', stderr: '' }),
    (error) => ({ failed: true, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }),
  );

  check(findings, blocked.failed === true, 'A composed gate allowed a failing change to commit.');
  check(
    findings,
    `${blocked.stdout}${blocked.stderr}`.includes('change-evaluation-gate'),
    'The blocked commit did not report the gate decision.',
  );
  check(
    findings,
    (await runGit(root, ['rev-list', '--count', 'HEAD'])).trim() === before,
    'A blocked commit still moved HEAD.',
  );

  // The prior chain must execute on a commit the gate allows. Clearing its
  // trace first is what makes the next assertion mean something.
  await rm(path.join(root, 'prior-ran'), { force: true });
  await writeFile(path.join(root, SOURCE), 'baseline\nrepaired\n', 'utf8');
  await git(root, ['add', '--all']);

  const allowed = await commit(root, 'a change the gate must allow').then(
    () => ({ failed: false, stderr: '' }),
    (error) => ({ failed: true, stderr: error.stderr ?? '' }),
  );

  check(findings, allowed.failed === false, `A composed gate blocked a passing change: ${allowed.stderr}.`);
  check(
    findings,
    (await readFile(path.join(root, 'prior-ran'), 'utf8').catch(() => null)) === 'prior chain\n',
    'The prior hook chain did not execute: it survived on disk but never ran.',
  );
  check(
    findings,
    Number((await runGit(root, ['rev-list', '--count', 'HEAD'])).trim()) === Number(before) + 1,
    'An allowed commit did not move HEAD.',
  );

  return { name: 'composed-hook-chain', ok: findings.length === 0, findings };
};

/** The declared composition order, and the manager files that are never edited. */
const strategyOrder = async () => {
  const findings = [];

  // A native hook manager comes first, and its generated runner is its own.
  const managed = await fixtureRepository();
  const generated = '#!/bin/sh\n. "${0%/*}/../pre-commit"\n';

  await mkdir(path.join(managed, '.husky/_'), { recursive: true });
  await writeFile(path.join(managed, '.husky/_/pre-commit'), generated, { mode: 0o755 });
  await git(managed, ['config', '--local', 'core.hooksPath', '.husky/_']);

  const managedStore = await storeFor(managed);
  const native = await activateFixture(managed, activationRequest(managed), {
    evidenceStore: managedStore,
  });

  check(
    findings,
    native.preview.hookManager?.id === 'husky'
      && native.preview.hooks[0].ownership === 'native-hook-manager',
    `The native hook manager was not selected first: ${JSON.stringify(native.preview.hookManager)}.`,
  );
  check(
    findings,
    native.preview.hooks[0].path === path.join(managed, '.husky', 'pre-commit'),
    `The registration did not target the manager's own integration point: ${native.preview.hooks[0].path}.`,
  );
  check(findings, native.result.activated === true, `The native registration failed: ${native.result.reasonCode}.`);
  check(
    findings,
    (await readFile(path.join(managed, '.husky/_/pre-commit'), 'utf8').catch(() => null)) === generated,
    "The manager's generated runner was modified.",
  );
  check(
    findings,
    (await registeredHooks(path.join(managedStore.gitCommonDirectory, 'hooks'))).length === 0,
    'A native registration also wrote into the clone\'s own hook directory.',
  );
  check(
    findings,
    (await runGit(managed, ['config', '--local', '--get', 'core.hooksPath'])).trim() === '.husky/_',
    'The configured hooks path was rewritten.',
  );

  // A manager whose integration point is a declaration is never edited.
  const declarative = await fixtureRepository();
  const declaration = 'pre-commit:\n  commands:\n    tests:\n      run: npm test\n';

  await writeFile(path.join(declarative, 'lefthook.yml'), declaration, 'utf8');

  const declarativeStore = await storeFor(declarative);
  const manual = await activateFixture(declarative, activationRequest(declarative), {
    evidenceStore: declarativeStore,
  });

  check(
    findings,
    manual.result.activated === false
      && manual.result.reasonCode === 'hook-manager-manual-registration',
    `A declarative hook manager did not require manual registration: ${manual.result.reasonCode}.`,
  );
  check(
    findings,
    (await readFile(path.join(declarative, 'lefthook.yml'), 'utf8')) === declaration,
    "A hook manager's declaration was edited on the operator's behalf.",
  );
  check(
    findings,
    (await declarativeStore.activationReceipt().read()) === null,
    'A refused activation left a receipt.',
  );

  return { name: 'strategy-order', ok: findings.length === 0, findings };
};

/** Gate-owned block content nobody can account for requires manual resolution. */
const markerDrift = async () => {
  const findings = [];
  const root = await fixtureRepository();
  const store = await storeFor(root);
  const hooksDirectory = path.join(store.gitCommonDirectory, 'hooks');
  const hookPath = path.join(hooksDirectory, 'pre-commit');
  const drifted = [
    '#!/bin/sh',
    HOOK_BLOCK_BEGIN,
    'echo "somebody edited the managed block"',
    'exit 0',
    '',
  ].join('\n');

  await mkdir(hooksDirectory, { recursive: true });
  await writeFile(hookPath, drifted, { mode: 0o755 });

  // Even a confirmation cannot authorize composing into content like this.
  const { preview, result } = await activateFixture(root, activationRequest(root, {
    hookConfirmation: {
      strategy: 'marker-delimited-block',
      path: hookPath,
      hookIdentity: `sha256:${'0'.repeat(64)}`,
    },
  }), { evidenceStore: store });

  check(
    findings,
    preview.hooks[0].action === 'refuse-marker-drift',
    `Marker drift was not previewed as a refusal: ${preview.hooks[0].action}.`,
  );
  check(
    findings,
    result.activated === false && result.reasonCode === 'hook-marker-drift',
    `Marker drift did not require manual resolution: ${result.reasonCode}.`,
  );
  check(
    findings,
    result.errors?.[0]?.resolution === 'manual',
    'Marker drift did not state that resolution is manual.',
  );
  check(
    findings,
    (await readFile(hookPath, 'utf8')) === drifted,
    'A drifted hook was modified rather than left for the operator.',
  );
  check(
    findings,
    (await store.activationReceipt().read()) === null,
    'A refused activation left a receipt.',
  );

  return { name: 'marker-drift', ok: findings.length === 0, findings };
};

/** Trust pauses the transaction, and only the same transaction may resume it. */
const trustPauseAndResume = async () => {
  const findings = [];
  const root = await fixtureRepository();
  const store = await storeFor(root);
  const hooksDirectory = path.join(store.gitCommonDirectory, 'hooks');
  const request = activationRequest(root);
  const registered = [];

  const paused = await activateFixture(root, request, {
    evidenceStore: store,
    establishTrust: async () => ({
      established: false,
      pending: true,
      reason: 'the client is waiting for the operator to trust this clone',
    }),
    registerHook: async (registration) => registered.push(registration.path),
  });

  check(
    findings,
    paused.result.state === 'paused' && paused.result.reasonCode === 'trust-pending',
    `A pending trust prompt did not pause the transaction: ${paused.result.state}/${paused.result.reasonCode}.`,
  );
  check(
    findings,
    /^sha256:[0-9a-f]{64}$/.test(paused.result.resumption?.transactionId ?? ''),
    'A paused transaction did not state the identity it may be resumed against.',
  );
  check(findings, registered.length === 0, 'A paused transaction registered a hook.');
  check(
    findings,
    (await store.activationReceipt().read()) === null
      && (await registeredHooks(hooksDirectory)).length === 0,
    'A paused transaction left an integration active.',
  );

  // The approved policy changes while the operator answers the prompt.
  const changed = activationRequest(root, {
    configuration: { schemaVersion: 4, policy: gatePolicy({ budget: { total_seconds: 900 } }) },
    resume: paused.result.resumption,
  });
  const trusted = [];
  const stale = await activateFixture(root, changed, {
    evidenceStore: store,
    establishTrust: async () => {
      trusted.push('trust');

      return { established: true, grantedBy: CAPABILITY, at: new Date().toISOString() };
    },
    registerHook: async (registration) => registered.push(registration.path),
  });

  check(
    findings,
    stale.result.activated === false
      && stale.result.reasonCode === 'resume-configuration-mismatch',
    `A changed configuration identity still resumed: ${stale.result.reasonCode}.`,
  );
  check(findings, stale.result.step === 'repository-identity', 'A stale resumption was not refused before any mutation.');
  check(findings, trusted.length === 0, 'A stale resumption still asked the client for trust.');
  check(
    findings,
    registered.length === 0 && (await store.activationReceipt().read()) === null
      && (await registeredHooks(hooksDirectory)).length === 0,
    'A stale resumption left an integration active.',
  );

  // The identical transaction resumes and completes.
  const resumed = await activateFixture(
    root,
    activationRequest(root, { resume: paused.result.resumption }),
    { evidenceStore: store },
  );

  check(
    findings,
    resumed.result.activated === true,
    `An identical transaction did not resume: ${resumed.result.reasonCode}.`,
  );
  check(
    findings,
    resumed.result.receipt?.previewId === paused.result.resumption?.previewId,
    'The resumed transaction did not complete the previewed activation.',
  );
  check(
    findings,
    JSON.stringify(await registeredHooks(hooksDirectory)) === JSON.stringify(['pre-commit']),
    'The resumed transaction did not enable authoritative Git.',
  );

  // And the clone it produced is really authoritative.
  await writeFile(path.join(root, SOURCE), `baseline\n${BREAKAGE}\n`, 'utf8');
  await git(root, ['add', '--all']);

  const blocked = await commit(root, 'a change the resumed activation must refuse').then(
    () => false,
    () => true,
  );

  check(findings, blocked === true, 'A resumed activation produced a clone that is not authoritative.');

  return { name: 'trust-pause-and-resume', ok: findings.length === 0, findings };
};

/**
 * Two desktop registration surfaces, in real client configuration files.
 *
 * This is the scenario `AC-ADAPT-003` exists for: not "an entry was written"
 * but "each entry was written in ITS OWN declared file and block schema, every
 * unrelated key and entry in those files survived registration, reconciliation
 * reported the truth without repairing it, and removal gave the files back
 * byte for byte".
 *
 * No desktop client is installed or executed. The files are fixtures in the
 * shapes real captures recorded (FR-ADAPT-008, SG-HOOK-001, SG-LIFE-001).
 */
const desktopRegistration = async () => {
  const findings = [];
  const root = await fixtureRepository();
  const store = await storeFor(root);
  const general = path.join(root, '.claude/settings.local.json');
  const dedicated = path.join(root, '.cursor/hooks.json');
  const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
  const writeJson = async (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

  await mkdir(path.dirname(general), { recursive: true });
  await mkdir(path.dirname(dedicated), { recursive: true });
  // A GENERAL settings file that holds `permissions` beside its hooks, and a
  // DEDICATED, independently versioned file with a flat block shape. Both
  // already carry a hook entry the Gate does not own.
  await writeJson(general, {
    permissions: { allow: ['Bash(ls:*)'], deny: [] },
    hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'somebody-elses-hook' }] }] },
  });
  await writeJson(dedicated, { version: 1, hooks: { stop: [{ command: 'somebody-elses-hook' }] } });

  const pristine = {
    general: await readFile(general, 'utf8'),
    dedicated: await readFile(dedicated, 'utf8'),
  };
  const request = activationRequest(root, {
    adapters: [
      { id: 'git', version: '1.0.0', authoritative: true },
      { id: 'claude-code-desktop', version: '1.0.0', authoritative: false },
      { id: 'cursor', version: '1.0.0', authoritative: false },
    ],
  });
  const { result } = await activateFixture(root, request, { evidenceStore: store });

  check(findings, result.activated === true, `Desktop registration did not activate: ${result.reasonCode}.`);

  // Every desktop registration names the adapter it answers, so an unreadable
  // payload can still be returned through that adapter's own declared feedback
  // channel (TB-025). The command is otherwise the fixture program this
  // activation pinned.
  const commandFor = (adapterId) => [
    process.execPath,
    path.join(root, 'tools/gate-runner.mjs'),
    '--adapter',
    adapterId,
  ].map((value) => `"${value}"`).join(' ');
  const registered = { general: await readJson(general), dedicated: await readJson(dedicated) };

  check(
    findings,
    JSON.stringify(registered.general.hooks.Stop.at(-1))
      === JSON.stringify({
        matcher: '',
        hooks: [{ type: 'command', command: commandFor('claude-code-desktop') }],
      }),
    'The general settings surface was not registered in its own declared block schema.',
  );
  check(
    findings,
    JSON.stringify(registered.dedicated.hooks.stop.at(-1))
      === JSON.stringify({ command: commandFor('cursor') }),
    'The dedicated versioned surface was not registered in its own declared block schema.',
  );

  // Survivors: every unrelated key and every unrelated entry, in both files.
  check(
    findings,
    JSON.stringify(registered.general.permissions) === JSON.stringify({ allow: ['Bash(ls:*)'], deny: [] })
      && registered.dedicated.version === 1,
    'Registration rewrote a part of a client configuration file the adapter does not own.',
  );
  check(
    findings,
    registered.general.hooks.Stop[0].hooks[0].command === 'somebody-elses-hook'
      && registered.dedicated.hooks.stop[0].command === 'somebody-elses-hook',
    'Registration disturbed an unrelated hook entry in the same client file.',
  );

  const healthy = await statusGate({ evidenceStore: store, repositoryRoot: root });

  check(findings, healthy.status === 'healthy', `A registered clone reported ${healthy.status}.`);

  // Somebody edits the Gate's own entry. Health reports it and repairs nothing.
  const drifted = await readJson(general);

  drifted.hooks.Stop.at(-1).matcher = '*';
  await writeJson(general, drifted);

  const beforeStatus = await readFile(general, 'utf8');
  const degraded = await statusGate({ evidenceStore: store, repositoryRoot: root });

  check(
    findings,
    degraded.status === 'degraded'
      && degraded.findings.some((finding) => finding.code === 'adapter-registration-drifted'),
    `A drifted registration was not reported: ${degraded.status}.`,
  );
  check(
    findings,
    degraded.repaired === false && (await readFile(general, 'utf8')) === beforeStatus,
    'Observing a drifted registration changed it.',
  );

  // Removal refuses while that drift stands, and takes nothing at all.
  const refused = await deactivateGate({ evidenceStore: store, repositoryRoot: root });

  check(
    findings,
    refused.deactivated === false && refused.reasonCode === 'registration-drifted',
    `A drifted registration did not refuse the whole deactivation: ${refused.reasonCode}.`,
  );
  check(
    findings,
    refused.removed.length === 0 && (await readFile(dedicated, 'utf8')) === JSON.stringify(registered.dedicated, null, 2) + '\n',
    'A refused deactivation still removed something.',
  );

  // The operator puts their edit back; removal then takes exactly the two Gate
  // entries and gives both files back byte for byte.
  drifted.hooks.Stop.at(-1).matcher = '';
  await writeJson(general, drifted);

  const removal = await deactivateGate({ evidenceStore: store, repositoryRoot: root });

  check(findings, removal.deactivated === true, `Deactivation refused: ${removal.reasonCode}.`);
  check(
    findings,
    JSON.stringify(removal.removed.filter((entry) => entry.kind === 'adapter-registration').map((entry) => entry.adapter))
      === JSON.stringify(['claude-code-desktop', 'cursor']),
    'Deactivation did not withdraw both declared registrations.',
  );
  check(
    findings,
    (await readFile(general, 'utf8')) === pristine.general
      && (await readFile(dedicated, 'utf8')) === pristine.dedicated,
    'Removal did not return both client configuration files to exactly what their owners wrote.',
  );

  return { name: 'desktop-registration', ok: findings.length === 0, findings };
};

/** The packaged program a desktop client's `stop` registration execs. */
const PACKAGED_PREFLIGHT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'gate-preflight.mjs',
);

/** The configuration a clone the preflight can read is activated with. */
const settledConfiguration = () => [
  'schema_version: 4',
  'backend: unknown',
  'frontend: none',
  'verification:',
  '  profile: gate-hook-conformance-smoke',
  '  capabilities: []',
  '  commands:',
  '    test:',
  '      backend: []',
  '      frontend: []',
  '      both:',
  '        - runner: repository-script',
  '          args:',
  '            - tools/check.mjs',
  `            - ${SOURCE}`,
  '          working_directory: "."',
  '          timeout_seconds: 60',
  '          allowed_environment:',
  '            - PATH',
  '          evidence_category: test',
  '          source_scope: both',
  'evaluation_gate:',
  '  checks:',
  '    required:',
  '      - configuration.broad-tests.test',
  '    advisory: []',
  '  budget:',
  '    total_seconds: 600',
  '  bypass:',
  '    enabled: false',
  '  execution: {}',
  '  evidence: {}',
  '',
].join('\n');

/** The activation receipt both packaged runners resolve this clone against. */
const publishReceipt = async (root) => {
  const common = (await runGit(root, ['rev-parse', '--git-common-dir'])).trim();
  const directory = path.resolve(root, common, 'change-evaluation-gate/evidence/activation');
  const read = await readRepositoryConfiguration({ repositoryRoot: root });
  const body = {
    receiptVersion: 'change-evaluation-gate/activation-receipt/v1',
    previewId: 'sha256:preview',
    repository: { root },
    configuration: {
      identity: configurationIdentity({
        schemaVersion: read.configuration?.schema_version ?? null,
        policy: read.configuration?.evaluation_gate ?? null,
      }),
      schemaVersion: read.configuration?.schema_version ?? null,
    },
    runtime: {
      gate: { id: 'change-evaluation-gate', version: '1.0.0', protocolVersion: '1.0' },
      runnerVersion: `${CAPABILITY}/1.0.0`,
      runners: [{
        check_id: 'configuration.broad-tests.test',
        role: 'evaluate',
        runner: 'repository-script',
        executable: process.execPath,
        version: process.versions.node,
      }],
    },
  };

  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'receipt.json'),
    `${JSON.stringify({ ...body, receiptId: contentIdentity(body) }, null, 2)}\n`,
    'utf8',
  );
};

/** Drive the packaged preflight program the way a desktop registration does. */
const runPackagedPreflight = ({ root, temporaryRoot }) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [PACKAGED_PREFLIGHT, '--adapter', 'cursor'], {
    cwd: root,
    env: { ...gitEnvironment(), TMPDIR: temporaryRoot },
  });
  const chunks = { stdout: [], stderr: [] };

  child.stdout.on('data', (chunk) => chunks.stdout.push(chunk));
  child.stderr.on('data', (chunk) => chunks.stderr.push(chunk));
  child.on('error', reject);
  child.on('close', (exitCode) => resolve({
    exitCode,
    stdout: Buffer.concat(chunks.stdout).toString('utf8'),
    stderr: Buffer.concat(chunks.stderr).toString('utf8'),
  }));
  child.stdin.end(`${JSON.stringify({
    hook_event_name: 'stop',
    session_id: `${CAPABILITY}-session`,
    workspace_roots: [root],
    status: 'completed',
    loop_count: 0,
  })}\n`);
});

/**
 * TB-039 — a turn that changed nothing costs nothing.
 *
 * The preflight is registered on the end of every turn, so most of the turns it
 * answers are turns where the maintainer asked a question and nothing in the
 * worktree moved. It used to copy the whole clone, hash it, remove it, and
 * append an Evidence envelope in order to reach the silence that was already
 * determined before any of it began.
 *
 * The copy is observed rather than inferred. Counting execution roots after a
 * run proves nothing — a run removes its own in a `finally` — so the child is
 * given a temporary directory it may read and not write. A run that tries to
 * materialize there fails and says so on the agent's channel; a run that never
 * tries is silent. The same clone then decides two real commits, so the
 * authoritative path is proved unchanged on the very tree the preflight
 * declined to copy (`AC-EVAL-004`, `FR-ADAPT-005`, `NFR-PERF-001`,
 * `NFR-REL-001`).
 */
const settledTurn = async () => {
  const findings = [];
  const root = await temporaryDirectory('gate-hook-conformance-settled-');
  const temporaryRoot = await temporaryDirectory('gate-hook-conformance-settled-tmp-');

  await assertThrowawayRepository(root);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/check.mjs'), CHECK_SCRIPT, 'utf8');
  await writeFile(path.join(root, SOURCE), 'baseline\n', 'utf8');
  await writeFile(path.join(root, '.agent-framework.yaml'), settledConfiguration(), 'utf8');
  await git(root, ['init', '--quiet']);
  await git(root, ['add', '--all']);
  await commit(root, 'settled');
  await publishReceipt(root);

  check(
    findings,
    (await runGit(root, ['status', '--porcelain'])) === '',
    'The fixture clone did not start with a settled worktree.',
  );

  // Readable, and not writable: materializing an execution root here is
  // impossible rather than merely unobserved.
  await chmod(temporaryRoot, 0o500);

  const settled = await runPackagedPreflight({ root, temporaryRoot });

  check(
    findings,
    settled.exitCode === 0 && settled.stdout === '',
    `A turn that changed nothing did not reach silence without materializing anything: ${settled.stdout}${settled.stderr}`,
  );

  // One untracked file: the skip triggers on an empty change set and nothing
  // else, so this turn still captures — and reports that it could not.
  await writeFile(path.join(root, 'app/Invoice.php'), 'new\n', 'utf8');

  const changed = await runPackagedPreflight({ root, temporaryRoot });

  check(
    findings,
    changed.stdout.includes('unverified'),
    `An untracked file is a change, and a change is still captured: ${changed.stdout}`,
  );

  const leftBehind = (await readdir(temporaryRoot).catch(() => []))
    .filter((entry) => EXECUTION_ROOT_PREFIXES.some((prefix) => entry.startsWith(prefix)));

  check(findings, leftBehind.length === 0, `Execution roots were left behind: ${leftBehind.join(', ')}.`);

  await chmod(temporaryRoot, 0o700);
  await rm(path.join(root, 'app/Invoice.php'), { force: true });

  // The same clone, on the authoritative path: a real commit still decides.
  await writeFile(path.join(root, SOURCE), `baseline\n${BREAKAGE}\n`, 'utf8');
  await git(root, ['add', '--all']);

  const denied = await runHook({ cwd: root, environment: process.env });

  await writeFile(path.join(root, SOURCE), 'baseline\nrepaired\n', 'utf8');
  await git(root, ['add', '--all']);

  const allowed = await runHook({ cwd: root, environment: process.env });

  check(
    findings,
    denied.exitCode !== 0 && denied.reasonCode === 'denied',
    `The authoritative runner did not deny a staged breakage: ${denied.reasonCode}.`,
  );
  check(
    findings,
    allowed.exitCode === 0 && allowed.reasonCode === null,
    `The authoritative runner did not allow the repair: ${allowed.reasonCode}.`,
  );

  return { name: 'settled-turn', ok: findings.length === 0, findings };
};

const main = async () => {
  const asJson = process.argv.includes('--json');
  let scenarios = [];

  try {
    scenarios = [
      await composedHookChain(),
      await strategyOrder(),
      await markerDrift(),
      await trustPauseAndResume(),
      await desktopRegistration(),
      await settledTurn(),
    ];
  } finally {
    for (const root of temporaryRoots) {
      await rm(root, { recursive: true, force: true });
    }
  }

  const ok = scenarios.every((scenario) => scenario.ok);
  const report = { capability: CAPABILITY, ok, scenarios };

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const scenario of scenarios) {
      process.stdout.write(`${scenario.ok ? 'ok' : 'FAILED'} ${scenario.name}\n`);

      for (const finding of scenario.findings) {
        process.stdout.write(`  - ${finding}\n`);
      }
    }

    process.stdout.write(`${ok ? 'ok' : 'FAILED'} ${CAPABILITY}\n`);
  }

  process.exitCode = ok ? 0 : 1;
};

await main();
