import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
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
    preview: '/usr/bin/package-script test',
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
  await writeFile(path.join(root, 'tools/gate-runner.mjs'), 'process.exitCode = 0;\n', 'utf8');

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
  await writeFile(path.join(root, 'tools/gate-runner.mjs'), 'process.exitCode = 0;\n', 'utf8');

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
  await writeFile(path.join(root, 'tools/gate-runner.mjs'), 'process.exitCode = 0;\n', 'utf8');

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
