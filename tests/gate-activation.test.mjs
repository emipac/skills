import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  ACTIVATION_RECEIPT_VERSION,
  ACTIVATION_STEPS,
  activate,
  configurationIdentity,
  previewActivation,
  repositoryIdentity,
} from '../skills/change-evaluation-gate/scripts/lib/activation.mjs';
import { openEvidenceStore } from '../skills/change-evaluation-gate/scripts/lib/evidence-store.mjs';
import { statusGate } from '../skills/change-evaluation-gate/scripts/lib/lifecycle.mjs';

const runFile = promisify(execFile);

/**
 * This suite writes real Git hooks. Every fixture must therefore be a throwaway
 * repository under the OS temporary directory, and never this repository: an
 * escaped fixture would activate authoritative enforcement on the framework
 * clone and block every later commit.
 */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const isInside = (parent, candidate) => candidate === parent
  || candidate.startsWith(`${parent}${path.sep}`);

const assertThrowawayRepository = async (root) => {
  const resolved = await realpath(root).catch(() => path.resolve(root));
  const temporaryRoot = await realpath(tmpdir());
  const frameworkRoot = await realpath(FRAMEWORK_ROOT).catch(() => FRAMEWORK_ROOT);

  assert.equal(
    isInside(temporaryRoot, resolved),
    true,
    `Refusing to activate outside the OS temporary directory: ${resolved}.`,
  );
  assert.equal(
    isInside(frameworkRoot, resolved),
    false,
    `Refusing to activate inside this repository: ${resolved}.`,
  );

  return resolved;
};

/**
 * A throwaway clone with its own isolated Git configuration, so a developer's
 * global `core.hooksPath` can never leak into a fixture expectation.
 */
const throwawayRepository = async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-activation-')));

  t.after(() => rm(root, { recursive: true, force: true }));
  await assertThrowawayRepository(root);
  await runFile('git', ['init', '--quiet'], { cwd: root, env: isolatedGitEnvironment() });

  return root;
};

const isolatedGitEnvironment = () => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

const runGit = async (repositoryRoot, args) => {
  const { stdout } = await runFile('git', args, {
    cwd: repositoryRoot,
    env: isolatedGitEnvironment(),
  });

  return stdout;
};

/**
 * A hook program that honors the self-test protocol.
 *
 * Started with a self-test subject named in the environment, it evaluates that
 * subject and denies it; started as a real hook it evaluates the change in
 * front of it. Proving the first says nothing about the second, which is the
 * whole reason the subject is explicit.
 */
const DENYING_RUNNER = [
  "import { readFile } from 'node:fs/promises';",
  '',
  'const subjectPath = process.env.CHANGE_EVALUATION_GATE_SELF_TEST ?? null;',
  '',
  'if (subjectPath === null) {',
  '  process.exitCode = 0;',
  '} else {',
  "  const subject = JSON.parse(await readFile(subjectPath, 'utf8'));",
  "  const denied = subject.checks.some((check) => check.required && check.outcome === 'failed');",
  '',
  '  process.stdout.write(`change-evaluation-gate: ${denied ? "denied" : "allowed"}\\n`);',
  '  process.exitCode = denied ? 1 : 0;',
  '}',
  '',
].join('\n');

const gatePolicy = () => ({
  checks: { required: ['broad_test'], advisory: [] },
  budget: { total_seconds: 600 },
  bypass: { enabled: false, marker: null },
  execution: { budget_skippable: [] },
  evidence: {},
});

const testCommand = () => ({
  runner: 'package-script',
  args: ['test'],
  working_directory: '.',
  timeout_seconds: 300,
  allowed_environment: ['PATH'],
  evidence_category: 'test',
  source_scope: 'backend',
});

const activationRequest = (root, overrides = {}) => ({
  scope: 'repository',
  trigger: 'explicit',
  repository: { root },
  configuration: { schemaVersion: 4, policy: gatePolicy() },
  client: { id: 'claude-code', surface: 'cli', version: '1.2.3' },
  gate: { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' },
  actor: { name: 'maintainer', source: 'git-config' },
  runtime: {
    runnerVersion: 'change-evaluation-gate/0.9.0',
    hookProgram: { interpreter: process.execPath, script: 'tools/gate-runner.mjs', args: [] },
  },
  checks: [{ id: 'broad_test', evaluate: testCommand() }],
  adapters: [{ id: 'git', version: '1.0.0', authoritative: true }],
  runtimeInputs: [
    { name: 'APP_TOKEN', source: 'approved-environment-file', value: RUNTIME_INPUT_CANARY },
  ],
  ...overrides,
});

/** A runtime input value that must never reach an Activation receipt. */
const RUNTIME_INPUT_CANARY = 'runtime-input-canary-9c1d47ab';

/** Consent is bound to the exact preview it was granted against. */
const consentFor = (preview) => ({
  previewId: preview.previewId,
  repositoryIdentity: preview.repository.identity,
  configurationIdentity: preview.configuration.identity,
  actor: { name: 'maintainer', source: 'git-config' },
  grantedAt: '2026-08-11T00:00:00.000Z',
});

const storeFor = async (root) => openEvidenceStore({
  repositoryRoot: root,
  runGit,
  identity: {
    actor: { name: 'maintainer', source: 'git-config' },
    client: { id: 'claude-code', surface: 'cli', version: '1.2.3' },
    gate: { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' },
    repository: { identity: `sha256:${'a'.repeat(64)}` },
  },
});

const dependencies = (overrides = {}) => ({
  runGit,
  resolveExecutable: (runner) => ({ executable: `/usr/bin/${runner}`, version: '1.0.0' }),
  establishTrust: async () => ({ established: true, grantedBy: 'maintainer', at: '2026-08-11T00:00:00.000Z' }),
  selfTestEvaluation: async () => ({ ok: true, detail: 'evaluation process reached a decision' }),
  selfTestAdapter: async (adapter) => ({ ok: true, detail: `${adapter.id} responded` }),
  ...overrides,
});

/** Every non-sample hook file registered in a clone. */
const registeredHooks = async (hooksDirectory) => {
  const entries = await readdir(hooksDirectory).catch(() => []);

  return entries.filter((entry) => !entry.endsWith('.sample'));
};

/** A guarded call: no fixture may activate anything outside a throwaway clone. */
const activateFixture = async (root, request, deps) => {
  await assertThrowawayRepository(root);

  return activate(request, deps);
};

test('TB-028 FR-LIFE-004: activation refuses a real executable that could not start, through the shipped resolver', async (t) => {
  const root = await throwawayRepository(t);

  // A tool binary exactly like `vendor/bin/pint`: a script whose interpreter
  // the kernel must find before a byte of it runs. This one names an
  // interpreter that does not exist on this machine.
  await mkdir(path.join(root, 'vendor/bin'), { recursive: true });
  await writeFile(
    path.join(root, 'vendor/bin/grade'),
    '#!/usr/bin/env interpreter-that-does-not-exist\nexit 0\n',
    'utf8',
  );
  await chmod(path.join(root, 'vendor/bin/grade'), 0o755);

  const request = activationRequest(root, {
    checks: [{
      id: 'broad_test',
      evaluate: {
        ...testCommand(),
        runner: 'composer-bin',
        args: ['grade'],
        allowed_environment: [],
      },
    }],
  });
  const store = await storeFor(root);
  // No injected resolver: this drives the rule an activated clone really uses,
  // which is the participant that has to notice the executable cannot launch.
  const deps = dependencies({
    evidenceStore: store,
    resolveExecutable: undefined,
    environment: { PATH: '' },
  });
  const preview = await previewActivation(request, deps);

  assert.deepEqual(
    preview.unresolved.map((entry) => entry.reason),
    ['runner-unresolved'],
    'a preview must show the maintainer that this command cannot run before consent is asked for.',
  );

  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, deps);

  assert.equal(result.activated, false);
  assert.equal(result.step, 'runner-resolution');
  assert.equal(result.reasonCode, 'runner-unresolved');
  assert.equal(
    await store.activationReceipt().read(),
    null,
    'a clone that cannot run its checks is left configured, with nothing pinned.',
  );
  assert.deepEqual(
    await registeredHooks(path.join(root, '.git/hooks')),
    [],
    'and with no registered hook: enforcement it could never carry out is not enforcement.',
  );
});

test('activation preview refuses invalid Gate policy before consent is possible', async (t) => {
  const root = await throwawayRepository(t);
  const request = activationRequest(root, {
    configuration: {
      schemaVersion: 4,
      policy: { ...gatePolicy(), bypass: {} },
    },
  });

  await assert.rejects(
    previewActivation(request, dependencies()),
    /The bypass subcontract must state explicitly whether bypass is enabled/,
  );
});

test('failure immediately before Git enablement leaves the clone configured with no receipt and no registration', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);
  const revoked = [];
  const attempted = [];
  const request = activationRequest(root);
  const preview = await previewActivation(request, dependencies());

  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: store,
    revokeTrust: async (record) => revoked.push(record.client?.id ?? null),
    // Failure injected at the one moment that matters: the receipt is written
    // and every self-test has passed, but Git has not been made authoritative.
    registerHook: async (registration) => {
      attempted.push(registration.path);

      throw new Error('injected failure immediately before Git enablement');
    },
  }));

  assert.equal(result.activated, false);
  assert.equal(result.state, 'configured');
  assert.equal(result.step, 'git-enablement');
  assert.equal(result.reasonCode, 'hook-registration-failed');
  assert.equal(result.receipt, null);

  // The transaction really did reach the last step.
  assert.equal(attempted.length, 1);

  // No receipt survives a failed transaction.
  assert.equal(typeof store.paths.activationReceipt, 'string');
  assert.equal(
    await readFile(store.paths.activationReceipt, 'utf8').catch(() => null),
    null,
  );
  assert.equal(await store.activationReceipt().read(), null);

  // No registration survives it either: the clone's hook chain is untouched.
  const hooksDirectory = path.join(store.gitCommonDirectory, 'hooks');

  assert.deepEqual(await registeredHooks(hooksDirectory), []);

  // Every gate-owned change was compensated, in reverse.
  assert.equal(result.rollback.performed, true);
  assert.deepEqual(result.rollback.failures, []);
  assert.deepEqual(result.rollback.actions, ['receipt', 'trust']);
  assert.deepEqual(revoked, ['claude-code']);

  // The failed transition is recorded exactly once, as a failure.
  const events = await store.readEvents();

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'activation');
  assert.equal(events[0].outcome, 'failed');
  assert.match(events[0].reason, /git-enablement/);

  // The clone is still merely configured: Git enforcement never ran.
  await writeFile(path.join(root, 'source.txt'), 'proposed\n', 'utf8');
  await runGit(root, ['add', '--all']);
  await runFile('git', [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Activation Fixture',
    'commit', '--quiet', '--message', 'configured clones still commit',
  ], { cwd: root, env: isolatedGitEnvironment() });

  assert.equal((await runGit(root, ['rev-list', '--count', 'HEAD'])).trim(), '1');
  assert.deepEqual([...ACTIVATION_STEPS].slice(-1), ['git-enablement']);
});

test('successful activation records the previewed identities and enables Git last', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);
  const request = activationRequest(root);
  const timeline = [];

  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/gate-runner.mjs'), DENYING_RUNNER, 'utf8');

  const preview = await previewActivation(request, dependencies());

  // A preview is a statement of intent, not a change: it names the exact hook
  // location and the exact resolved commands and writes nothing.
  assert.match(preview.previewId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(preview.repository.identity, repositoryIdentity(store.gitCommonDirectory));
  assert.equal(preview.configuration.identity, configurationIdentity(request.configuration));
  assert.deepEqual(preview.commands, [{
    check_id: 'broad_test',
    role: 'evaluate',
    runner: 'package-script',
    executable: '/usr/bin/package-script',
    version: '1.0.0',
    // The descriptor stores the script name; `package-script` reaches it
    // through `run`, so that is what the maintainer is shown and what runs.
    preview: '/usr/bin/package-script run test',
    working_directory: '.',
  }]);
  assert.deepEqual(preview.hooks, [{
    hook: 'pre-commit',
    path: path.join(store.gitCommonDirectory, 'hooks', 'pre-commit'),
    action: 'create-owned-shim',
    ownership: 'gate-owned-shim',
    existing: null,
  }]);
  assert.deepEqual(preview.adapters, [{ id: 'git', version: '1.0.0', authoritative: true }]);
  assert.deepEqual(preview.runtimeInputs, ['APP_TOKEN']);
  assert.equal(await store.activationReceipt().read(), null);
  assert.deepEqual(await registeredHooks(path.join(store.gitCommonDirectory, 'hooks')), []);

  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: store,
    selfTestEvaluation: async () => {
      timeline.push('self-test-evaluation');

      return { ok: true, detail: 'evaluation process reached a decision' };
    },
    selfTestAdapter: async (adapter) => {
      timeline.push(`self-test-adapter:${adapter.id}`);

      return { ok: true, detail: `${adapter.id} responded` };
    },
    registerHook: async (registration) => {
      // Git is enabled last: by the time anything authoritative exists, every
      // self-test has passed and the pinned receipt is already on disk.
      timeline.push('register-hook');
      assert.notEqual(await store.activationReceipt().read(), null);

      return { path: registration.path, ownership: 'gate-owned-shim', digest: `sha256:${'1'.repeat(64)}` };
    },
  }));

  assert.equal(result.activated, true);
  assert.equal(result.state, 'activated');
  assert.equal(result.reasonCode, null);
  assert.equal(result.rollback.performed, false);

  // The pipeline ran in its declared order and Git enablement was last.
  assert.deepEqual(result.order, [...ACTIVATION_STEPS]);
  assert.deepEqual(timeline, ['self-test-evaluation', 'self-test-adapter:git', 'register-hook']);

  const receipt = result.receipt;

  assert.equal(receipt.receiptVersion, ACTIVATION_RECEIPT_VERSION);
  assert.match(receipt.receiptId, /^sha256:[0-9a-f]{64}$/);

  // The receipt pins the previewed identities.
  assert.equal(receipt.previewId, preview.previewId);
  assert.equal(receipt.repository.identity, preview.repository.identity);
  assert.equal(receipt.configuration.identity, preview.configuration.identity);
  assert.equal(receipt.configuration.schemaVersion, 4);

  // ... the active runtime and adapter versions ...
  assert.deepEqual(receipt.runtime.gate, {
    id: 'change-evaluation-gate',
    version: '0.9.0',
    protocolVersion: '1.0',
  });
  assert.equal(receipt.runtime.runnerVersion, 'change-evaluation-gate/0.9.0');
  assert.deepEqual(receipt.runtime.runners, [{
    check_id: 'broad_test',
    role: 'evaluate',
    runner: 'package-script',
    executable: '/usr/bin/package-script',
    // What the executable needs in order to start is part of what was proved,
    // so the receipt pins it. This fixture's resolver names none (TB-028).
    interpreter: null,
    version: '1.0.0',
  }]);
  assert.deepEqual(receipt.adapters, [{
    id: 'git',
    version: '1.0.0',
    authoritative: true,
    selfTest: { ok: true, detail: 'git responded' },
  }]);

  // ... the hook locations ...
  assert.deepEqual(receipt.hooks, [{
    hook: 'pre-commit',
    path: path.join(store.gitCommonDirectory, 'hooks', 'pre-commit'),
    ownership: 'gate-owned-shim',
  }]);

  // ... the trust state ...
  assert.deepEqual(receipt.trust, {
    client: 'claude-code',
    established: true,
    grantedBy: 'maintainer',
    at: '2026-08-11T00:00:00.000Z',
  });

  // ... the runtime input NAMES, never their values ...
  assert.deepEqual(receipt.runtimeInputs, ['APP_TOKEN']);
  assert.equal(JSON.stringify(receipt).includes(RUNTIME_INPUT_CANARY), false);

  // ... and the self-test results.
  assert.deepEqual(receipt.selfTests, [
    { name: 'evaluation-process', ok: true, detail: 'evaluation process reached a decision' },
    {
      name: 'hook-program',
      ok: true,
      detail: 'The registered hook program denied the self-test subject with exit 1.',
    },
    { name: 'adapter:git', ok: true, detail: 'git responded' },
  ]);

  // The published receipt is exactly what the transaction returned.
  assert.deepEqual(await store.activationReceipt().read(), receipt);
  assert.equal(
    (await readFile(store.paths.activationReceipt, 'utf8')).includes(RUNTIME_INPUT_CANARY),
    false,
  );

  const events = await store.readEvents();

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'activation');
  assert.equal(events[0].outcome, 'succeeded');
  assert.equal(events[0].after, receipt.receiptId);
});

test('activation refuses an existing hook and never overwrites it', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);
  const hooksDirectory = path.join(store.gitCommonDirectory, 'hooks');
  const hookPath = path.join(hooksDirectory, 'pre-commit');
  const existing = '#!/bin/sh\necho "somebody else owns this hook"\nexit 0\n';

  await mkdir(hooksDirectory, { recursive: true });
  await writeFile(hookPath, existing, { mode: 0o755 });

  const request = activationRequest(root);
  const preview = await previewActivation(request, dependencies());

  // The preview says plainly that it will not take this hook over.
  assert.equal(preview.hooks[0].action, 'refuse-existing-hook');
  assert.equal(preview.hooks[0].existing.path, hookPath);
  assert.equal(preview.hooks[0].existing.bytes, Buffer.byteLength(existing, 'utf8'));

  const registered = [];
  const revoked = [];
  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: store,
    revokeTrust: async () => revoked.push('trust'),
    registerHook: async (registration) => registered.push(registration.path),
  }));

  assert.equal(result.activated, false);
  assert.equal(result.state, 'configured');
  assert.equal(result.step, 'hook-chain-validation');
  assert.equal(result.reasonCode, 'hook-exists');

  // Nothing was registered, and the foreign hook is byte-for-byte unchanged.
  assert.deepEqual(registered, []);
  assert.equal(await readFile(hookPath, 'utf8'), existing);
  assert.deepEqual(await registeredHooks(hooksDirectory), ['pre-commit']);
  assert.equal(await store.activationReceipt().read(), null);
  assert.deepEqual(result.rollback.actions, ['trust']);
  assert.deepEqual(revoked, ['trust']);

  const events = await store.readEvents();

  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, 'failed');
  assert.match(events[0].reason, /hook-chain-validation/);
});

test('activation refuses a shared or global hooks path and never changes it', async (t) => {
  const root = await throwawayRepository(t);
  const shared = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-shared-hooks-')));

  t.after(() => rm(shared, { recursive: true, force: true }));

  const globalConfig = path.join(shared, 'gitconfig');
  const sharedHooks = path.join(shared, 'hooks');

  await mkdir(sharedHooks, { recursive: true });
  await writeFile(globalConfig, `[core]\n\thooksPath = ${sharedHooks}\n`, 'utf8');

  const sharedRunGit = async (repositoryRoot, args) => {
    const { stdout } = await runFile('git', args, {
      cwd: repositoryRoot,
      env: { ...isolatedGitEnvironment(), GIT_CONFIG_GLOBAL: globalConfig },
    });

    return stdout;
  };

  const store = await openEvidenceStore({
    repositoryRoot: root,
    runGit: sharedRunGit,
    identity: {
      actor: { name: 'maintainer', source: 'git-config' },
      client: { id: 'claude-code', surface: 'cli', version: '1.2.3' },
      gate: { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' },
      repository: { identity: `sha256:${'a'.repeat(64)}` },
    },
  });
  const request = activationRequest(root);
  const deps = dependencies({ runGit: sharedRunGit });
  const preview = await previewActivation(request, deps);

  assert.equal(preview.hooks[0].action, 'refuse-shared-hooks-path');
  assert.equal(preview.hooksPath.configured, true);
  assert.equal(preview.hooksPath.shared, true);

  const registered = [];
  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, {
    ...deps,
    evidenceStore: store,
    registerHook: async (registration) => registered.push(registration.path),
  });

  assert.equal(result.activated, false);
  assert.equal(result.state, 'configured');
  assert.equal(result.step, 'hook-chain-validation');
  assert.equal(result.reasonCode, 'hooks-path-shared');

  // The shared hook directory and the global configuration are untouched.
  assert.deepEqual(registered, []);
  assert.deepEqual(await readdir(sharedHooks), []);
  assert.equal(await readFile(globalConfig, 'utf8'), `[core]\n\thooksPath = ${sharedHooks}\n`);
  assert.equal(await store.activationReceipt().read(), null);
  assert.deepEqual(await registeredHooks(path.join(store.gitCommonDirectory, 'hooks')), []);
});

test('activation registers a gate-owned shim at the previewed location without changing the hooks path', async (t) => {
  const root = await throwawayRepository(t);

  // A repository-local hooks path is this clone's own business: activation
  // honors it exactly as configured and never rewrites it.
  await runGit(root, ['config', '--local', 'core.hooksPath', '.githooks']);
  await mkdir(path.join(root, '.githooks'), { recursive: true });
  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/gate-runner.mjs'), DENYING_RUNNER, 'utf8');

  const store = await storeFor(root);
  const request = activationRequest(root);
  const preview = await previewActivation(request, dependencies());

  assert.equal(preview.hooksPath.configured, true);
  assert.equal(preview.hooksPath.shared, false);
  assert.equal(preview.hooks[0].path, path.join(root, '.githooks', 'pre-commit'));
  assert.equal(preview.hooks[0].action, 'create-owned-shim');

  // No injected registerHook: this exercises the real registration seam.
  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: store,
  }));

  assert.equal(result.activated, true);
  assert.equal(result.receipt.hooks[0].path, preview.hooks[0].path);

  const shim = await readFile(preview.hooks[0].path, 'utf8');

  assert.match(shim, /^#!\/bin\/sh\n/);
  assert.match(shim, /change-evaluation-gate/);
  assert.equal(shim.includes(process.execPath), true);
  assert.equal(shim.includes(path.join(root, 'tools/gate-runner.mjs')), true);

  const mode = (await stat(preview.hooks[0].path)).mode;

  assert.equal((mode & 0o111) !== 0, true, 'the registered hook must be executable');

  // The configured hooks path is byte-for-byte what the operator set.
  assert.equal((await runGit(root, ['config', '--local', '--get', 'core.hooksPath'])).trim(), '.githooks');
  assert.deepEqual(await registeredHooks(path.join(store.gitCommonDirectory, 'hooks')), []);
});

test('an activation that cannot be recorded is rolled back and removes the hook it wrote', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);

  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/gate-runner.mjs'), DENYING_RUNNER, 'utf8');

  const request = activationRequest(root);
  const preview = await previewActivation(request, dependencies());
  const revoked = [];
  const recorded = [];
  const failingStore = {
    ...store,
    appendLifecycleEvent: async (event) => {
      recorded.push(event.outcome);

      if (event.outcome === 'succeeded') {
        throw new Error('injected failure while recording the activation');
      }

      return store.appendLifecycleEvent(event);
    },
  };

  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: failingStore,
    revokeTrust: async () => revoked.push('trust'),
  }));

  assert.equal(result.activated, false);
  assert.equal(result.state, 'configured');
  assert.equal(result.reasonCode, 'activation-record-failed');
  assert.equal(result.receipt, null);

  // Authoritative Git is gone again: the shim it wrote was removed.
  assert.deepEqual(await registeredHooks(path.join(store.gitCommonDirectory, 'hooks')), []);
  assert.equal(await store.activationReceipt().read(), null);
  assert.deepEqual(result.rollback.actions, ['git-enablement', 'receipt', 'trust']);
  assert.deepEqual(result.rollback.failures, []);
  assert.deepEqual(revoked, ['trust']);
  assert.deepEqual(recorded, ['succeeded', 'failed']);
});

test('rollback removes only unchanged gate-owned content and never repairs foreign drift', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);

  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/gate-runner.mjs'), DENYING_RUNNER, 'utf8');

  const request = activationRequest(root);
  const preview = await previewActivation(request, dependencies());
  const drifted = '#!/bin/sh\n# edited by somebody else while activation ran\nexit 0\n';
  const failingStore = {
    ...store,
    appendLifecycleEvent: async (event) => {
      if (event.outcome === 'succeeded') {
        // A concurrent editor replaces the gate's shim before rollback runs.
        await writeFile(preview.hooks[0].path, drifted, { mode: 0o755 });

        throw new Error('injected failure while recording the activation');
      }

      return store.appendLifecycleEvent(event);
    },
  };

  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: failingStore,
  }));

  assert.equal(result.activated, false);
  assert.equal(result.reasonCode, 'activation-record-failed');

  // The drifted file is not gate-owned content any more, so rollback leaves it
  // alone and says so rather than silently deleting somebody else's work.
  assert.equal(await readFile(preview.hooks[0].path, 'utf8'), drifted);
  assert.deepEqual(
    result.rollback.failures.map((failure) => failure.action),
    ['git-enablement'],
  );
  assert.match(result.rollback.failures[0].message, /changed/i);

  // The receipt is still withdrawn: no partial successful state survives.
  assert.equal(await store.activationReceipt().read(), null);
});

test('a failing adapter self-test leaves no partial adapter set active and never enables Git', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);
  const active = [];
  const registered = [];
  const request = activationRequest(root, {
    adapters: [
      { id: 'git', version: '1.0.0', authoritative: true },
      { id: 'claude-code-desktop', version: '2.0.0', authoritative: false },
    ],
  });
  const preview = await previewActivation(request, dependencies());

  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: store,
    registerAdapter: async (adapter) => {
      active.push(adapter.id);

      return { id: adapter.id, registered: true };
    },
    unregisterAdapter: async (adapter) => {
      active.splice(active.indexOf(adapter.id), 1);
    },
    selfTestAdapter: async (adapter) => (adapter.id === 'git'
      ? { ok: true, detail: 'git responded' }
      : { ok: false, detail: 'the desktop client is not installed' }),
    registerHook: async (registration) => registered.push(registration.path),
  }));

  assert.equal(result.activated, false);
  assert.equal(result.state, 'configured');
  assert.equal(result.step, 'self-test');
  assert.equal(result.reasonCode, 'adapter-self-test-failed');

  // The adapter that passed was registered and then unregistered: the clone is
  // left with no adapter active at all, never a partial set.
  assert.deepEqual(active, []);
  assert.deepEqual(result.rollback.actions, ['adapter:git', 'trust']);
  assert.deepEqual(result.rollback.failures, []);

  // Git was never made authoritative.
  assert.deepEqual(registered, []);
  assert.equal(await store.activationReceipt().read(), null);
  assert.deepEqual(await registeredHooks(path.join(store.gitCommonDirectory, 'hooks')), []);
});

test('Git is never enabled when the evaluation process self-test fails', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);
  const active = [];
  const registered = [];
  const request = activationRequest(root);
  const preview = await previewActivation(request, dependencies());

  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: store,
    registerAdapter: async (adapter) => active.push(adapter.id),
    unregisterAdapter: async (adapter) => active.splice(active.indexOf(adapter.id), 1),
    selfTestEvaluation: async () => ({ ok: false, detail: 'the evaluation process could not reach a decision' }),
    registerHook: async (registration) => registered.push(registration.path),
  }));

  assert.equal(result.activated, false);
  assert.equal(result.step, 'self-test');
  assert.equal(result.reasonCode, 'self-test-failed');

  // No adapter was even reached, and nothing authoritative exists.
  assert.deepEqual(active, []);
  assert.deepEqual(registered, []);
  assert.equal(await store.activationReceipt().read(), null);
  assert.deepEqual(await registeredHooks(path.join(store.gitCommonDirectory, 'hooks')), []);
  assert.deepEqual(result.rollback.actions, ['trust']);
});

test('activation refuses every prohibited entry point and writes nothing', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);
  const request = activationRequest(root);
  const preview = await previewActivation(request, dependencies());
  const consent = consentFor(preview);
  const touched = [];
  const deps = () => dependencies({
    evidenceStore: store,
    establishTrust: async () => {
      touched.push('trust');

      return { established: true, grantedBy: 'maintainer', at: '2026-08-11T00:00:00.000Z' };
    },
    registerHook: async (registration) => touched.push(registration.path),
  });

  const refusals = [
    // Package and plugin lifecycles never activate anything.
    [{ ...request, consent, trigger: 'install' }, 'repository-identity', 'activation-trigger-prohibited'],
    [{ ...request, consent, trigger: 'setup' }, 'repository-identity', 'activation-trigger-prohibited'],
    // v1 has no global activation.
    [{ ...request, consent, scope: 'global' }, 'repository-identity', 'activation-scope-global'],
    // A non-interactive activation must name the clone and the policy it expects.
    [
      { ...request, consent, repository: { ...request.repository, expectedIdentity: `sha256:${'b'.repeat(64)}` } },
      'repository-identity',
      'repository-identity-mismatch',
    ],
    [
      { ...request, consent, configuration: { ...request.configuration, expectedIdentity: `sha256:${'c'.repeat(64)}` } },
      'repository-identity',
      'configuration-identity-mismatch',
    ],
    // Consent is never implied, never reusable, and never for another clone.
    [{ ...request }, 'consent', 'consent-missing'],
    [
      { ...request, consent: { ...consent, previewId: `sha256:${'d'.repeat(64)}` } },
      'consent',
      'consent-preview-mismatch',
    ],
    [
      { ...request, consent: { ...consent, repositoryIdentity: `sha256:${'e'.repeat(64)}` } },
      'consent',
      'consent-identity-mismatch',
    ],
  ];

  for (const [candidate, step, reasonCode] of refusals) {
    const result = await activateFixture(root, candidate, deps());

    assert.equal(result.activated, false, `${reasonCode} activated the clone`);
    assert.equal(result.state, 'configured');
    assert.equal(result.step, step, `${reasonCode} refused at the wrong step`);
    assert.equal(result.reasonCode, reasonCode);
    assert.equal(result.receipt, null);
  }

  // Nothing was trusted, registered, or written by any refused attempt.
  assert.deepEqual(touched, []);
  assert.equal(await store.activationReceipt().read(), null);
  assert.deepEqual(await registeredHooks(path.join(store.gitCommonDirectory, 'hooks')), []);

  const events = await store.readEvents();

  assert.equal(events.length, refusals.length);
  assert.equal(events.every((event) => event.type === 'activation' && event.outcome === 'failed'), true);
});

test('failure at an early step rolls back and leaves the clone configured', async (t) => {
  const root = await throwawayRepository(t);
  const request = activationRequest(root);
  const preview = await previewActivation(request, dependencies());
  const consent = consentFor(preview);

  // A logical runner that resolves to nothing never falls back to a shell.
  // Consent is taken against that same preview, so the refusal is the missing
  // executable and not a stale preview.
  const unresolvedStore = await storeFor(root);
  const unresolvedDeps = dependencies({
    evidenceStore: unresolvedStore,
    resolveExecutable: () => null,
  });
  const unresolvedPreview = await previewActivation(request, unresolvedDeps);
  const unresolved = await activateFixture(
    root,
    { ...request, consent: consentFor(unresolvedPreview) },
    unresolvedDeps,
  );

  assert.equal(unresolved.activated, false);
  assert.equal(unresolved.step, 'runner-resolution');
  assert.equal(unresolved.reasonCode, 'runner-unresolved');
  assert.deepEqual(unresolved.rollback.actions, []);
  assert.equal(await unresolvedStore.activationReceipt().read(), null);

  // Trust is the client's to grant; the gate never grants it on the operator's
  // behalf and stops when it is withheld.
  const untrustedStore = await storeFor(root);
  const untrusted = await activateFixture(root, { ...request, consent }, dependencies({
    evidenceStore: untrustedStore,
    establishTrust: async () => ({ established: false, reason: 'the client declined to trust this clone' }),
  }));

  assert.equal(untrusted.activated, false);
  assert.equal(untrusted.step, 'trust');
  assert.equal(untrusted.reasonCode, 'trust-not-established');
  assert.deepEqual(untrusted.rollback.actions, []);
  assert.equal(await untrustedStore.activationReceipt().read(), null);

  // A receipt that cannot be published atomically is no receipt at all.
  const receiptStore = await storeFor(root);
  const active = [];
  const revoked = [];
  const registered = [];
  const receiptFailed = await activateFixture(root, { ...request, consent }, dependencies({
    evidenceStore: {
      ...receiptStore,
      activationReceipt: () => ({
        ...receiptStore.activationReceipt(),
        write: async () => {
          throw new Error('injected receipt write failure');
        },
      }),
    },
    registerAdapter: async (adapter) => active.push(adapter.id),
    unregisterAdapter: async (adapter) => active.splice(active.indexOf(adapter.id), 1),
    revokeTrust: async () => revoked.push('trust'),
    registerHook: async (registration) => registered.push(registration.path),
  }));

  assert.equal(receiptFailed.activated, false);
  assert.deepEqual(active, []);
  assert.equal(receiptFailed.step, 'receipt');
  assert.equal(receiptFailed.reasonCode, 'receipt-write-failed');
  assert.deepEqual(receiptFailed.rollback.actions, ['adapter:git', 'trust']);
  assert.deepEqual(registered, []);
  assert.deepEqual(revoked, ['trust']);
  assert.equal(await receiptStore.activationReceipt().read(), null);

  // Through every one of those failures the clone stayed merely configured.
  const store = await storeFor(root);

  assert.deepEqual(await registeredHooks(path.join(store.gitCommonDirectory, 'hooks')), []);
});

/**
 * TB-016 — `AC-ADAPT-003`, `FR-ADAPT-008`, `SG-HOOK-001`, `SG-OWNER-001`.
 *
 * Two desktop surfaces that register in different files, with different block
 * schemas, under different event-key casing, and with only one of them carrying
 * its own format version. Activation writes both through their declarations and
 * knows nothing about either client.
 */
const seedClientConfigurations = async (root) => {
  await mkdir(path.join(root, '.claude'), { recursive: true });
  await mkdir(path.join(root, '.cursor'), { recursive: true });
  await writeFile(
    path.join(root, '.claude/settings.local.json'),
    `${JSON.stringify({
      permissions: { allow: ['Bash(ls:*)'], deny: [] },
      hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'somebody-elses-hook' }] }] },
    }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(root, '.cursor/hooks.json'),
    `${JSON.stringify({ version: 1, hooks: { stop: [{ command: 'somebody-elses-hook' }] } }, null, 2)}\n`,
    'utf8',
  );
};

test('AC-ADAPT-003: activation registers two differently declared desktop surfaces without branching on a client name', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);

  await seedClientConfigurations(root);

  const request = activationRequest(root, {
    adapters: [
      { id: 'git', version: '1.0.0', authoritative: true },
      { id: 'claude-code-desktop', version: '2.0.0', authoritative: false },
      { id: 'cursor', version: '3.0.0', authoritative: false },
    ],
  });
  const preview = await previewActivation(request, dependencies());
  const result = await activateFixture(
    root,
    { ...request, consent: consentFor(preview) },
    dependencies({ evidenceStore: store }),
  );

  assert.equal(result.activated, true, `Activation refused: ${result.reasonCode}.`);

  const commandFor = (adapterId) => `"${process.execPath}" "${path.join(root, 'tools/gate-runner.mjs')}" "--adapter" "${adapterId}"`;
  const general = JSON.parse(await readFile(path.join(root, '.claude/settings.local.json'), 'utf8'));
  const dedicated = JSON.parse(await readFile(path.join(root, '.cursor/hooks.json'), 'utf8'));

  // Each surface received the Gate entry in its own declared block schema,
  // pointing at the preflight program named with that adapter's id.
  assert.deepEqual(general.hooks.Stop.at(-1), {
    matcher: '',
    hooks: [{ type: 'command', command: commandFor('claude-code-desktop') }],
  });
  assert.deepEqual(dedicated.hooks.stop.at(-1), { command: commandFor('cursor') });

  // Every unrelated key and every unrelated entry survived activation.
  assert.deepEqual(general.permissions, { allow: ['Bash(ls:*)'], deny: [] });
  assert.equal(dedicated.version, 1);
  assert.deepEqual(
    general.hooks.Stop[0],
    { matcher: '', hooks: [{ type: 'command', command: 'somebody-elses-hook' }] },
  );
  assert.deepEqual(dedicated.hooks.stop[0], { command: 'somebody-elses-hook' });

  // The receipt pins what was registered, per adapter, so a later status or
  // removal reconciles this exact entry rather than searching for one.
  const registrations = result.receipt.adapters.map((adapter) => [
    adapter.id,
    adapter.registration?.kind ?? null,
    adapter.registration?.path ?? null,
    adapter.registration?.registered ?? false,
  ]);

  // Authoritative Git declares a repository hook chain rather than a client
  // configuration file, so it carries no client registration here at all; the
  // receipt's own `hookChain` already pins that surface.
  assert.deepEqual(registrations, [
    ['git', null, null, false],
    ['claude-code-desktop', 'client-configuration-file', path.join(root, '.claude/settings.local.json'), true],
    ['cursor', 'client-configuration-file', path.join(root, '.cursor/hooks.json'), true],
  ]);

  for (const adapter of result.receipt.adapters.slice(1)) {
    assert.match(adapter.registration.entryIdentity, /^sha256:[0-9a-f]{64}$/);
  }

  // SG-OWNER-001: the registration mechanics and activation itself name no
  // client. Every client name in this module set lives in the adapter
  // declarations, which is the only place that knows a client at all.
  const libraryRoot = path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts/lib');
  const clientNames = /\b(cursor|codex|claude|copilot|vscode|jetbrains|intellij|windsurf|zed)\b/i;

  for (const module of ['activation.mjs', 'lifecycle.mjs', 'adapter-registration.mjs']) {
    assert.doesNotMatch(
      await readFile(path.join(libraryRoot, module), 'utf8'),
      clientNames,
      `${module} branches on a client name.`,
    );
  }
});

test('SG-HOOK-001: an activation that fails after registering desktop surfaces leaves every client configuration file exactly as it was', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);

  await seedClientConfigurations(root);

  const before = {
    general: await readFile(path.join(root, '.claude/settings.local.json'), 'utf8'),
    dedicated: await readFile(path.join(root, '.cursor/hooks.json'), 'utf8'),
  };
  const request = activationRequest(root, {
    adapters: [
      { id: 'git', version: '1.0.0', authoritative: true },
      { id: 'claude-code-desktop', version: '2.0.0', authoritative: false },
      { id: 'cursor', version: '3.0.0', authoritative: false },
    ],
  });
  const preview = await previewActivation(request, dependencies());
  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: {
      ...store,
      activationReceipt: () => ({
        ...store.activationReceipt(),
        write: async () => {
          throw new Error('the receipt could not be published atomically');
        },
      }),
    },
  }));

  assert.equal(result.activated, false);
  assert.equal(result.step, 'receipt');
  assert.equal(result.reasonCode, 'receipt-write-failed');

  // Both registered surfaces were withdrawn, newest first, and neither client
  // file kept a single Gate byte.
  assert.deepEqual(result.rollback.actions, ['adapter:cursor', 'adapter:claude-code-desktop', 'trust']);
  assert.deepEqual(result.rollback.failures, []);
  assert.equal(await readFile(path.join(root, '.claude/settings.local.json'), 'utf8'), before.general);
  assert.equal(await readFile(path.join(root, '.cursor/hooks.json'), 'utf8'), before.dedicated);
  assert.equal(await store.activationReceipt().read(), null);
  assert.deepEqual(await registeredHooks(path.join(store.gitCommonDirectory, 'hooks')), []);
});

test('AC-ADAPT-003: a declared registration surface that cannot be confirmed is unverified and never counted as registered', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);

  await seedClientConfigurations(root);

  // That client is simply not on this machine. Its declared file is gone, and
  // the Gate has no way to confirm the surface it would register in.
  await rm(path.join(root, '.cursor'), { recursive: true, force: true });

  const request = activationRequest(root, {
    adapters: [
      { id: 'git', version: '1.0.0', authoritative: true },
      { id: 'claude-code-desktop', version: '2.0.0', authoritative: false },
      { id: 'cursor', version: '3.0.0', authoritative: false },
    ],
  });
  const preview = await previewActivation(request, dependencies());
  const result = await activateFixture(
    root,
    { ...request, consent: consentFor(preview) },
    dependencies({ evidenceStore: store }),
  );

  assert.equal(result.activated, true, `Activation refused: ${result.reasonCode}.`);

  const confirmed = result.receipt.adapters.find((adapter) => adapter.id === 'claude-code-desktop');
  const unconfirmed = result.receipt.adapters.find((adapter) => adapter.id === 'cursor');

  assert.equal(confirmed.registration.registered, true);
  assert.equal(confirmed.registration.state, 'registered');

  // The unconfirmed surface is reported, never claimed.
  assert.equal(unconfirmed.registration.state, 'unverified');
  assert.equal(unconfirmed.registration.registered, false);
  assert.equal(unconfirmed.registration.confirmed, false);
  assert.equal(unconfirmed.registration.entryIdentity, null);

  // And the Gate did not invent that client's configuration file: it cannot
  // know a format it has never confirmed, including its own version key.
  assert.equal(await readFile(path.join(root, '.cursor/hooks.json'), 'utf8').catch(() => null), null);

  // Health says so out loud, and repairs nothing.
  const status = await statusGate({ evidenceStore: store, repositoryRoot: root });

  assert.equal(status.status, 'degraded');
  assert.deepEqual(
    status.findings.map((finding) => [finding.code, finding.adapter]),
    [['adapter-registration-unverified', 'cursor']],
  );
  assert.equal(status.repaired, false);
  assert.deepEqual(status.mutations, []);
});

/**
 * A hook program that ignores the self-test subject entirely and exits `0`.
 *
 * This is the shape of the real defect: a program pointed at a pure library
 * prints nothing, exits `0`, and would therefore allow every commit.
 */
const ALLOWING_RUNNER = 'process.exitCode = 0;\n';

test('activation refuses a registered hook program that allows a change it must deny', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);

  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/gate-runner.mjs'), ALLOWING_RUNNER, 'utf8');

  const request = activationRequest(root);
  const preview = await previewActivation(request, dependencies());

  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: store,
  }));

  assert.equal(result.activated, false);
  assert.equal(result.state, 'configured');
  assert.equal(result.step, 'self-test');
  assert.equal(result.reasonCode, 'hook-program-self-test-failed');
  assert.equal(result.receipt, null);

  // The clone is left configured: no receipt, and no registered hook.
  assert.equal(await store.activationReceipt().read(), null);
  assert.deepEqual(await registeredHooks(path.join(store.gitCommonDirectory, 'hooks')), []);
});

test('activation whose hook program denies the change completes, records the self-test, and still enables Git last', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);

  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/gate-runner.mjs'), DENYING_RUNNER, 'utf8');

  const request = activationRequest(root);
  const preview = await previewActivation(request, dependencies());

  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: store,
  }));

  assert.equal(result.activated, true, `Activation refused: ${result.reasonCode}.`);

  // The receipt records that the program was proved, and what it proved.
  const persisted = await store.activationReceipt().read();
  const selfTest = persisted.selfTests.find((entry) => entry.name === 'hook-program');

  assert.notEqual(selfTest, undefined, 'the receipt must record the hook-program self-test');
  assert.equal(selfTest.ok, true);
  assert.match(selfTest.detail, /denied/);

  // The frozen pipeline is unchanged and Git is still enabled last.
  assert.deepEqual(result.order, [...ACTIVATION_STEPS]);
  assert.equal(result.order.at(-1), 'git-enablement');
  assert.deepEqual(await registeredHooks(path.join(store.gitCommonDirectory, 'hooks')), ['pre-commit']);
});

test('activation refuses a hook program that cannot start, and never mistakes a failure to run for a denial', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);

  const request = activationRequest(root, {
    runtime: {
      runnerVersion: 'change-evaluation-gate/0.9.0',
      // An interpreter that is not there at all: the program never runs, so
      // nothing about it has been proved (NFR-REL-003).
      hookProgram: {
        interpreter: path.join(root, 'tools/no-such-interpreter'),
        script: 'tools/gate-runner.mjs',
        args: [],
      },
    },
  });
  const preview = await previewActivation(request, dependencies());

  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: store,
  }));

  assert.equal(result.activated, false);
  assert.equal(result.state, 'configured');
  assert.equal(result.step, 'self-test');
  assert.equal(result.reasonCode, 'hook-program-self-test-failed');
  assert.equal(result.errors[0].reason, 'hook-program-cannot-start');
  assert.equal(result.receipt, null);
  assert.equal(await store.activationReceipt().read(), null);
  assert.deepEqual(await registeredHooks(path.join(store.gitCommonDirectory, 'hooks')), []);
});
