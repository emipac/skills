import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  HOOK_BLOCK_BEGIN,
  HOOK_BLOCK_END,
  HOOK_STRATEGIES,
  activate,
  previewActivation,
} from '../skills/change-evaluation-gate/scripts/lib/activation.mjs';
import { openEvidenceStore } from '../skills/change-evaluation-gate/scripts/lib/evidence-store.mjs';

const runFile = promisify(execFile);

/**
 * This suite writes real Git hooks and executes them. Every fixture must
 * therefore be a throwaway repository under the OS temporary directory, and
 * never this repository: an escaped fixture would compose an authoritative hook
 * into the framework clone and block every later commit.
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

/** A throwaway clone with its own isolated Git configuration. */
const throwawayRepository = async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-hook-conformance-')));

  t.after(() => rm(root, { recursive: true, force: true }));
  await assertThrowawayRepository(root);
  await runFile('git', ['init', '--quiet'], { cwd: root, env: isolatedGitEnvironment() });
  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/gate-runner.mjs'), 'process.exitCode = 0;\n', 'utf8');

  return root;
};

const gatePolicy = (overrides = {}) => ({
  checks: { required: ['broad_test'], advisory: [] },
  budget: { total_seconds: 600 },
  bypass: { enabled: false, marker: null },
  execution: { budget_skippable: [] },
  evidence: {},
  ...overrides,
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
  runtimeInputs: [{ name: 'APP_TOKEN', source: 'approved-environment-file' }],
  ...overrides,
});

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

/**
 * A gate runner that leaves an observable trace, so a fixture can tell whether
 * the gate really executed rather than merely being present in a file.
 */
const observableRunner = (root) => [
  "import { writeFileSync } from 'node:fs';",
  '',
  `writeFileSync(${JSON.stringify(path.join(root, 'gate-ran'))}, 'gate\\n');`,
  'process.exitCode = 0;',
  '',
].join('\n');

/**
 * A prior hook that leaves its own trace and then exits explicitly.
 *
 * The trailing `exit 0` is the point: a gate block merely appended to this file
 * would never run, so composition has to place itself where control actually
 * reaches it while keeping every original byte.
 */
const priorHook = (root) => [
  '#!/bin/sh',
  '# a hook this repository already had',
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

const commit = (root, message) => runFile('git', [
  '-c', 'user.email=gate@example.test',
  '-c', 'user.name=Gate Hook Conformance Fixture',
  'commit', '--quiet', '--message', message,
], { cwd: root, env: isolatedGitEnvironment() });

test('resuming a paused activation after the configuration identity changes performs no mutation and leaves every integration inactive', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);
  const hooksDirectory = path.join(store.gitCommonDirectory, 'hooks');
  const request = activationRequest(root);
  const preview = await previewActivation(request, dependencies());
  const touched = [];

  // The client cannot answer the trust prompt yet, so the transaction pauses.
  const paused = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: store,
    establishTrust: async () => ({
      established: false,
      pending: true,
      reason: 'the client is waiting for the operator to trust this clone',
    }),
    registerAdapter: async (adapter) => touched.push(`adapter:${adapter.id}`),
    registerHook: async (registration) => touched.push(registration.path),
  }));

  // A pause is not a refusal and not a success: it is a transaction that may be
  // resumed, and it names exactly the identities it may be resumed against.
  assert.equal(paused.activated, false);
  assert.equal(paused.state, 'paused');
  assert.equal(paused.step, 'trust');
  assert.equal(paused.reasonCode, 'trust-pending');
  assert.equal(paused.receipt, null);
  assert.match(paused.resumption.transactionId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(paused.resumption.previewId, preview.previewId);
  assert.equal(paused.resumption.repositoryIdentity, preview.repository.identity);
  assert.equal(paused.resumption.configurationIdentity, preview.configuration.identity);
  assert.match(paused.resumption.adapterIdentity, /^sha256:[0-9a-f]{64}$/);
  assert.equal(paused.resumption.client, 'claude-code');

  // Nothing is active while it is paused.
  assert.deepEqual(touched, []);
  assert.equal(await store.activationReceipt().read(), null);
  assert.deepEqual(await registeredHooks(hooksDirectory), []);

  // The operator changes the approved policy while the transaction is paused.
  const changed = activationRequest(root, {
    configuration: { schemaVersion: 4, policy: gatePolicy({ budget: { total_seconds: 900 } }) },
  });
  const changedPreview = await previewActivation(changed, dependencies());

  assert.notEqual(changedPreview.configuration.identity, preview.configuration.identity);

  const trusted = [];
  const resumed = await activateFixture(root, {
    ...changed,
    consent: consentFor(changedPreview),
    resume: paused.resumption,
  }, dependencies({
    evidenceStore: store,
    establishTrust: async () => {
      trusted.push('trust');

      return { established: true, grantedBy: 'maintainer', at: '2026-08-11T00:00:00.000Z' };
    },
    registerAdapter: async (adapter) => touched.push(`adapter:${adapter.id}`),
    registerHook: async (registration) => touched.push(registration.path),
  }));

  // The resumed transaction is not the paused one, so it refuses before it
  // touches anything at all.
  assert.equal(resumed.activated, false);
  assert.equal(resumed.state, 'configured');
  assert.equal(resumed.step, 'repository-identity');
  assert.equal(resumed.reasonCode, 'resume-configuration-mismatch');
  assert.equal(resumed.receipt, null);
  assert.deepEqual(resumed.rollback.actions, []);

  // No trust was requested, no adapter registered, no hook written, no receipt.
  assert.deepEqual(trusted, []);
  assert.deepEqual(touched, []);
  assert.equal(await store.activationReceipt().read(), null);
  assert.deepEqual(await registeredHooks(hooksDirectory), []);

  const events = await store.readEvents();

  assert.equal(events.length, 2);
  assert.equal(events.every((event) => event.type === 'activation'), true);
  assert.deepEqual(events.map((event) => event.outcome), ['refused', 'failed']);
  assert.match(events[0].reason, /paused/i);
  assert.match(events[1].reason, /resume-configuration-mismatch/);
});

test('non-interactive activation without exact identities writes nothing, and an exact match may continue', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);
  const hooksDirectory = path.join(store.gitCommonDirectory, 'hooks');
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
    registerAdapter: async (adapter) => touched.push(`adapter:${adapter.id}`),
    registerHook: async (registration) => touched.push(registration.path),
  });

  const expectedRepository = preview.repository.identity;
  const expectedConfiguration = preview.configuration.identity;

  // A flag is not consent and is not an identity. Without both exact identities
  // a non-interactive activation refuses before it touches anything.
  const refusals = [
    [{ ...request, consent, interactive: false }, 'non-interactive-identity-missing'],
    [
      {
        ...request,
        consent,
        interactive: false,
        repository: { ...request.repository, expectedIdentity: expectedRepository },
      },
      'non-interactive-identity-missing',
    ],
    [
      {
        ...request,
        consent,
        interactive: false,
        configuration: { ...request.configuration, expectedIdentity: expectedConfiguration },
      },
      'non-interactive-identity-missing',
    ],
    // A named but wrong identity is rejected before any clone-local mutation.
    [
      {
        ...request,
        consent,
        interactive: false,
        repository: { ...request.repository, expectedIdentity: `sha256:${'b'.repeat(64)}` },
        configuration: { ...request.configuration, expectedIdentity: expectedConfiguration },
      },
      'repository-identity-mismatch',
    ],
    [
      {
        ...request,
        consent,
        interactive: false,
        repository: { ...request.repository, expectedIdentity: expectedRepository },
        configuration: { ...request.configuration, expectedIdentity: `sha256:${'c'.repeat(64)}` },
      },
      'configuration-identity-mismatch',
    ],
  ];

  for (const [candidate, reasonCode] of refusals) {
    const result = await activateFixture(root, candidate, deps());

    assert.equal(result.activated, false, `${reasonCode} activated the clone`);
    assert.equal(result.state, 'configured');
    assert.equal(result.step, 'repository-identity', `${reasonCode} refused at the wrong step`);
    assert.equal(result.reasonCode, reasonCode);
    assert.equal(result.receipt, null);
  }

  // Nothing was trusted, registered, or written by any refused attempt.
  assert.deepEqual(touched, []);
  assert.equal(await store.activationReceipt().read(), null);
  assert.deepEqual(await registeredHooks(hooksDirectory), []);

  // An exact match may continue through the remaining activation checks.
  const exact = await activateFixture(root, {
    ...request,
    consent,
    interactive: false,
    repository: { ...request.repository, expectedIdentity: expectedRepository },
    configuration: { ...request.configuration, expectedIdentity: expectedConfiguration },
  }, dependencies({ evidenceStore: store }));

  assert.equal(exact.activated, true);
  assert.equal(exact.state, 'activated');
  assert.equal(exact.step, 'git-enablement');
  assert.deepEqual(await registeredHooks(hooksDirectory), ['pre-commit']);
});

test('hook registration uses a native hook manager before any other strategy and never touches its generated runner', async (t) => {
  const root = await throwawayRepository(t);

  // A Husky v9 layout: the manager owns `.husky`, and Git is pointed at the
  // generated runner directory `.husky/_`, which is the manager's own business.
  const generated = '#!/bin/sh\n. "${0%/*}/../pre-commit"\n';

  await mkdir(path.join(root, '.husky/_'), { recursive: true });
  await writeFile(path.join(root, '.husky/_/pre-commit'), generated, { mode: 0o755 });
  await runGit(root, ['config', '--local', 'core.hooksPath', '.husky/_']);

  const store = await storeFor(root);
  const request = activationRequest(root);
  const preview = await previewActivation(request, dependencies());

  // The declared order puts the manager's native integration point first, so
  // the registration lands in `.husky`, never in the generated `_` directory
  // and never in `.git/hooks`.
  assert.equal(preview.hooksPath.shared, false);
  assert.equal(preview.hooks[0].ownership, 'native-hook-manager');
  assert.equal(preview.hooks[0].action, 'create-native-registration');
  assert.equal(preview.hooks[0].path, path.join(root, '.husky', 'pre-commit'));
  assert.equal(preview.hooks[0].existing, null);
  assert.equal(preview.hookManager.id, 'husky');
  assert.equal(preview.hookManager.registration, 'managed-directory');

  // No injected registerHook: this exercises the real registration seam.
  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: store,
  }));

  assert.equal(result.activated, true);
  assert.equal(result.receipt.hooks[0].path, path.join(root, '.husky', 'pre-commit'));
  assert.equal(result.receipt.hooks[0].ownership, 'native-hook-manager');
  assert.deepEqual(result.receipt.hookChain, {
    strategy: 'native-hook-manager',
    manager: 'husky',
    path: path.join(root, '.husky', 'pre-commit'),
    priorIdentity: null,
  });

  // The manager's generated runner and the clone's own hook directory are
  // exactly as the manager left them.
  assert.equal(await readFile(path.join(root, '.husky/_/pre-commit'), 'utf8'), generated);
  assert.deepEqual(await registeredHooks(path.join(store.gitCommonDirectory, 'hooks')), []);
  assert.equal((await runGit(root, ['config', '--local', '--get', 'core.hooksPath'])).trim(), '.husky/_');
});

test('a hook manager whose integration point is a configuration file requires manual registration', async (t) => {
  const root = await throwawayRepository(t);
  const declaration = 'pre-commit:\n  commands:\n    tests:\n      run: npm test\n';

  await writeFile(path.join(root, 'lefthook.yml'), declaration, 'utf8');

  const store = await storeFor(root);
  const request = activationRequest(root);
  const preview = await previewActivation(request, dependencies());

  assert.equal(preview.hookManager.id, 'lefthook');
  assert.equal(preview.hookManager.registration, 'declarative');
  assert.equal(preview.hooks[0].action, 'refuse-hook-manager-manual');

  const touched = [];
  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: store,
    registerHook: async (registration) => touched.push(registration.path),
  }));

  assert.equal(result.activated, false);
  assert.equal(result.state, 'configured');
  assert.equal(result.step, 'hook-chain-validation');
  assert.equal(result.reasonCode, 'hook-manager-manual-registration');

  // The gate never edits a hook manager's declaration on the operator's behalf.
  assert.equal(await readFile(path.join(root, 'lefthook.yml'), 'utf8'), declaration);
  assert.deepEqual(touched, []);
  assert.equal(await store.activationReceipt().read(), null);
  assert.deepEqual(await registeredHooks(path.join(store.gitCommonDirectory, 'hooks')), []);
});

test('a confirmed marker-delimited block preserves the prior hook and both the chain and the gate execute', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);
  const hooksDirectory = path.join(store.gitCommonDirectory, 'hooks');
  const hookPath = path.join(hooksDirectory, 'pre-commit');
  const original = priorHook(root);

  await mkdir(hooksDirectory, { recursive: true });
  await writeFile(hookPath, original, { mode: 0o755 });
  await writeFile(path.join(root, 'tools/gate-runner.mjs'), observableRunner(root), 'utf8');

  const request = activationRequest(root);

  // Without confirmation the gate will not touch a hook it did not write.
  const unconfirmed = await previewActivation(request, dependencies());

  assert.equal(unconfirmed.hooks[0].action, 'refuse-existing-hook');
  assert.equal(unconfirmed.hooks[0].existing.path, hookPath);
  assert.match(unconfirmed.hooks[0].existing.identity, /^sha256:[0-9a-f]{64}$/);

  // A confirmation names the exact hook the operator looked at.
  const confirmed = activationRequest(root, {
    hookConfirmation: {
      strategy: 'marker-delimited-block',
      path: hookPath,
      hookIdentity: unconfirmed.hooks[0].existing.identity,
    },
  });
  const preview = await previewActivation(confirmed, dependencies());

  assert.equal(preview.hooks[0].action, 'compose-marker-block');
  assert.equal(preview.hooks[0].ownership, 'marker-delimited-block');
  assert.equal(preview.hooks[0].path, hookPath);

  // No injected registerHook: this composes the real hook on disk.
  const result = await activateFixture(root, { ...confirmed, consent: consentFor(preview) }, dependencies({
    evidenceStore: store,
  }));

  assert.equal(result.activated, true);
  assert.equal(result.receipt.hooks[0].ownership, 'marker-delimited-block');
  assert.deepEqual(result.receipt.hookChain, {
    strategy: 'marker-delimited-block',
    manager: null,
    path: hookPath,
    priorIdentity: unconfirmed.hooks[0].existing.identity,
  });

  // The surrounding hook content is preserved byte for byte: removing the
  // gate-owned block again yields exactly the hook the repository had.
  const composed = await readFile(hookPath, 'utf8');

  assert.equal(composed.includes(HOOK_BLOCK_BEGIN), true);
  assert.equal(composed.includes(HOOK_BLOCK_END), true);
  assert.equal(withoutManagedBlock(composed), original);
  assert.equal(((await stat(hookPath)).mode & 0o111) !== 0, true, 'the composed hook must stay executable');
  assert.deepEqual(await registeredHooks(hooksDirectory), ['pre-commit']);

  // And the composed hook really runs both: a real commit leaves both traces.
  await writeFile(path.join(root, 'source.txt'), 'proposed\n', 'utf8');
  await runGit(root, ['add', '--all']);
  await commit(root, 'a change both the prior chain and the gate see');

  assert.equal(await readFile(path.join(root, 'prior-ran'), 'utf8'), 'prior chain\n');
  assert.equal(await readFile(path.join(root, 'gate-ran'), 'utf8'), 'gate\n');
  assert.equal((await runGit(root, ['rev-list', '--count', 'HEAD'])).trim(), '1');
});

test('a confirmation that does not name the hook actually on disk composes nothing', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);
  const hooksDirectory = path.join(store.gitCommonDirectory, 'hooks');
  const hookPath = path.join(hooksDirectory, 'pre-commit');
  const original = priorHook(root);

  await mkdir(hooksDirectory, { recursive: true });
  await writeFile(hookPath, original, { mode: 0o755 });

  const request = activationRequest(root, {
    hookConfirmation: {
      strategy: 'marker-delimited-block',
      path: hookPath,
      // The operator confirmed a hook that has since been edited.
      hookIdentity: `sha256:${'f'.repeat(64)}`,
    },
  });
  const preview = await previewActivation(request, dependencies());

  assert.equal(preview.hooks[0].action, 'refuse-existing-hook');

  const touched = [];
  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: store,
    registerHook: async (registration) => touched.push(registration.path),
  }));

  assert.equal(result.activated, false);
  assert.equal(result.step, 'hook-chain-validation');
  assert.equal(result.reasonCode, 'hook-confirmation-mismatch');
  assert.equal(await readFile(hookPath, 'utf8'), original);
  assert.deepEqual(touched, []);
  assert.equal(await store.activationReceipt().read(), null);
});

test('marker drift requires manual resolution and no confirmation can authorize it', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);
  const hooksDirectory = path.join(store.gitCommonDirectory, 'hooks');
  const hookPath = path.join(hooksDirectory, 'pre-commit');

  // Half a gate-owned block: the gate cannot tell what this was meant to be.
  const drifted = [
    '#!/bin/sh',
    HOOK_BLOCK_BEGIN,
    'echo "somebody edited the managed block"',
    'exit 0',
    '',
  ].join('\n');

  await mkdir(hooksDirectory, { recursive: true });
  await writeFile(hookPath, drifted, { mode: 0o755 });

  // Even a confirmation naming this exact hook cannot authorize composing into
  // gate-owned content nobody can account for.
  const request = activationRequest(root, {
    hookConfirmation: {
      strategy: 'marker-delimited-block',
      path: hookPath,
      hookIdentity: `sha256:${'0'.repeat(64)}`,
    },
  });
  const preview = await previewActivation(request, dependencies());

  assert.equal(preview.hooks[0].action, 'refuse-marker-drift');

  const touched = [];
  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: store,
    registerHook: async (registration) => touched.push(registration.path),
    composeHook: async (registration) => touched.push(registration.path),
  }));

  assert.equal(result.activated, false);
  assert.equal(result.state, 'configured');
  assert.equal(result.step, 'hook-chain-validation');
  assert.equal(result.reasonCode, 'hook-marker-drift');
  assert.equal(result.errors[0].marker, 'unbalanced');
  assert.equal(result.errors[0].resolution, 'manual');

  // The drifted hook is byte-for-byte untouched.
  assert.equal(await readFile(hookPath, 'utf8'), drifted);
  assert.deepEqual(touched, []);
  assert.equal(await store.activationReceipt().read(), null);
});

test('an intact gate-owned block already in a hook is drift too, and is never reused', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);
  const hooksDirectory = path.join(store.gitCommonDirectory, 'hooks');
  const hookPath = path.join(hooksDirectory, 'pre-commit');
  const original = priorHook(root);

  await mkdir(hooksDirectory, { recursive: true });
  await writeFile(hookPath, original, { mode: 0o755 });

  const confirmation = {
    strategy: 'marker-delimited-block',
    path: hookPath,
    hookIdentity: (await previewActivation(activationRequest(root), dependencies())).hooks[0].existing.identity,
  };
  const request = activationRequest(root, { hookConfirmation: confirmation });
  const preview = await previewActivation(request, dependencies());
  const first = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: store,
  }));

  assert.equal(first.activated, true);

  const composed = await readFile(hookPath, 'utf8');

  // A second activation finds gate-owned content it did not just write.
  const again = activationRequest(root, {
    hookConfirmation: { ...confirmation, hookIdentity: `sha256:${'1'.repeat(64)}` },
  });
  const againPreview = await previewActivation(again, dependencies());

  assert.equal(againPreview.hooks[0].action, 'refuse-marker-drift');

  const result = await activateFixture(root, { ...again, consent: consentFor(againPreview) }, dependencies({
    evidenceStore: store,
  }));

  assert.equal(result.activated, false);
  assert.equal(result.reasonCode, 'hook-marker-drift');
  assert.equal(result.errors[0].marker, 'already-registered');
  assert.equal(await readFile(hookPath, 'utf8'), composed);
});

test('rolling back a composed activation restores the prior hook exactly and never repairs foreign drift', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);
  const hooksDirectory = path.join(store.gitCommonDirectory, 'hooks');
  const hookPath = path.join(hooksDirectory, 'pre-commit');
  const original = priorHook(root);

  await mkdir(hooksDirectory, { recursive: true });
  await writeFile(hookPath, original, { mode: 0o755 });

  const identity = (await previewActivation(activationRequest(root), dependencies()))
    .hooks[0].existing.identity;
  const request = activationRequest(root, {
    hookConfirmation: { strategy: 'marker-delimited-block', path: hookPath, hookIdentity: identity },
  });
  const preview = await previewActivation(request, dependencies());
  const unrecordable = {
    ...store,
    appendLifecycleEvent: async (event) => {
      if (event.outcome === 'succeeded') {
        throw new Error('injected failure while recording the activation');
      }

      return store.appendLifecycleEvent(event);
    },
  };

  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: unrecordable,
  }));

  assert.equal(result.activated, false);
  assert.equal(result.reasonCode, 'activation-record-failed');
  assert.deepEqual(result.rollback.actions, ['git-enablement', 'receipt', 'trust']);
  assert.deepEqual(result.rollback.failures, []);

  // The repository's own hook is back exactly as it was, still executable.
  assert.equal(await readFile(hookPath, 'utf8'), original);
  assert.equal(((await stat(hookPath)).mode & 0o111) !== 0, true);
  assert.equal(await store.activationReceipt().read(), null);

  // A composed hook someone else edited is reported, never rewritten.
  const drifting = {
    ...store,
    appendLifecycleEvent: async (event) => {
      if (event.outcome === 'succeeded') {
        await writeFile(hookPath, `${await readFile(hookPath, 'utf8')}# edited by somebody else\n`, { mode: 0o755 });

        throw new Error('injected failure while recording the activation');
      }

      return store.appendLifecycleEvent(event);
    },
  };
  const drifted = await activateFixture(root, { ...request, consent: consentFor(preview) }, dependencies({
    evidenceStore: drifting,
  }));

  assert.equal(drifted.activated, false);
  assert.deepEqual(
    drifted.rollback.failures.map((failure) => failure.action),
    ['git-enablement'],
  );
  assert.match(drifted.rollback.failures[0].message, /changed/i);
  assert.equal((await readFile(hookPath, 'utf8')).includes('# edited by somebody else'), true);
  assert.equal(await store.activationReceipt().read(), null);
});

test('a paused transaction resumes only with identical identities and never activates partially', async (t) => {
  const root = await throwawayRepository(t);
  const store = await storeFor(root);
  const hooksDirectory = path.join(store.gitCommonDirectory, 'hooks');
  const request = activationRequest(root);
  const preview = await previewActivation(request, dependencies());
  const consent = consentFor(preview);

  const paused = await activateFixture(root, { ...request, consent }, dependencies({
    evidenceStore: store,
    establishTrust: async () => ({ established: false, pending: true, reason: 'awaiting the operator' }),
  }));

  assert.equal(paused.state, 'paused');

  const active = [];
  const touched = [];
  const deps = () => dependencies({
    evidenceStore: store,
    registerAdapter: async (adapter) => active.push(adapter.id),
    unregisterAdapter: async (adapter) => active.splice(active.indexOf(adapter.id), 1),
    registerHook: async (registration) => touched.push(registration.path),
  });

  // Each of the four bound identities is checked, and each refuses before any
  // clone-local mutation.
  const refusals = [
    [
      { ...paused.resumption, repositoryIdentity: `sha256:${'b'.repeat(64)}` },
      'repository-identity',
      'resume-repository-mismatch',
    ],
    [
      { ...paused.resumption, configurationIdentity: `sha256:${'c'.repeat(64)}` },
      'repository-identity',
      'resume-configuration-mismatch',
    ],
    [
      { ...paused.resumption, adapterIdentity: `sha256:${'d'.repeat(64)}` },
      'repository-identity',
      'resume-adapter-mismatch',
    ],
    [
      { ...paused.resumption, previewId: `sha256:${'e'.repeat(64)}` },
      'preview',
      'resume-preview-mismatch',
    ],
    [
      { ...paused.resumption, transactionId: `sha256:${'f'.repeat(64)}` },
      'preview',
      'resume-transaction-mismatch',
    ],
  ];

  for (const [resume, step, reasonCode] of refusals) {
    const result = await activateFixture(root, { ...request, consent, resume }, deps());

    assert.equal(result.activated, false, `${reasonCode} activated the clone`);
    assert.equal(result.state, 'configured');
    assert.equal(result.step, step, `${reasonCode} refused at the wrong step`);
    assert.equal(result.reasonCode, reasonCode);
  }

  // A selected-adapter set that changed while the operator answered the prompt
  // is a different transaction, even when nothing else moved.
  const regrouped = activationRequest(root, {
    adapters: [
      { id: 'git', version: '1.0.0', authoritative: true },
      { id: 'claude-code-desktop', version: '2.0.0', authoritative: false },
    ],
  });
  const regroupedPreview = await previewActivation(regrouped, dependencies());
  const changedAdapters = await activateFixture(root, {
    ...regrouped,
    consent: consentFor(regroupedPreview),
    resume: paused.resumption,
  }, deps());

  assert.equal(changedAdapters.activated, false);
  assert.equal(changedAdapters.reasonCode, 'resume-adapter-mismatch');

  // Nothing was activated by any refused resumption.
  assert.deepEqual(active, []);
  assert.deepEqual(touched, []);
  assert.equal(await store.activationReceipt().read(), null);
  assert.deepEqual(await registeredHooks(hooksDirectory), []);

  // The identical transaction resumes and completes, enabling Git last.
  const resumed = await activateFixture(root, {
    ...request,
    consent,
    resume: paused.resumption,
  }, dependencies({ evidenceStore: store }));

  assert.equal(resumed.activated, true);
  assert.equal(resumed.state, 'activated');
  assert.equal(resumed.step, 'git-enablement');
  assert.equal(resumed.resumption, null);
  assert.equal(resumed.receipt.previewId, paused.resumption.previewId);
  assert.deepEqual(await registeredHooks(hooksDirectory), ['pre-commit']);
});

test('a shared hooks path is refused even when the operator confirms the hook inside it', async (t) => {
  const root = await throwawayRepository(t);
  const shared = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-shared-hooks-')));

  t.after(() => rm(shared, { recursive: true, force: true }));

  const globalConfig = path.join(shared, 'gitconfig');
  const sharedHooks = path.join(shared, 'hooks');
  const sharedHook = path.join(sharedHooks, 'pre-commit');
  const original = priorHook(root);

  await mkdir(sharedHooks, { recursive: true });
  await writeFile(sharedHook, original, { mode: 0o755 });
  await writeFile(globalConfig, `[core]\n\thooksPath = ${sharedHooks}\n`, 'utf8');

  const sharedRunGit = async (repositoryRoot, args) => {
    const { stdout } = await runFile('git', args, {
      cwd: repositoryRoot,
      env: { ...isolatedGitEnvironment(), GIT_CONFIG_GLOBAL: globalConfig },
    });

    return stdout;
  };
  const deps = (overrides = {}) => dependencies({ runGit: sharedRunGit, ...overrides });
  const request = activationRequest(root, {
    hookConfirmation: {
      strategy: 'marker-delimited-block',
      path: sharedHook,
      hookIdentity: `sha256:${'a'.repeat(64)}`,
    },
  });
  const preview = await previewActivation(request, deps());

  assert.equal(preview.hooksPath.shared, true);
  assert.equal(preview.hooks[0].action, 'refuse-shared-hooks-path');

  const touched = [];
  const result = await activateFixture(root, { ...request, consent: consentFor(preview) }, deps({
    registerHook: async (registration) => touched.push(registration.path),
    composeHook: async (registration) => touched.push(registration.path),
  }));

  assert.equal(result.activated, false);
  assert.equal(result.step, 'hook-chain-validation');
  assert.equal(result.reasonCode, 'hooks-path-shared');

  // A confirmation never becomes permission to touch other repositories' hooks,
  // and the shared setting itself is never rewritten to escape it.
  assert.deepEqual(touched, []);
  assert.equal(await readFile(sharedHook, 'utf8'), original);
  assert.equal(await readFile(globalConfig, 'utf8'), `[core]\n\thooksPath = ${sharedHooks}\n`);
});

test('the three hook strategies are selected in the declared order', async (t) => {
  const ownershipFor = async (prepare, { confirming = false } = {}) => {
    const root = await throwawayRepository(t);

    await prepare(root);

    const seen = await previewActivation(activationRequest(root), dependencies());

    if (!confirming) {
      return seen.hooks[0].ownership;
    }

    // The middle strategy is reachable only by confirming the exact hook.
    const confirmed = activationRequest(root, {
      hookConfirmation: {
        strategy: 'marker-delimited-block',
        path: seen.hooks[0].path,
        hookIdentity: seen.hooks[0].existing.identity,
      },
    });

    return (await previewActivation(confirmed, dependencies())).hooks[0].ownership;
  };

  // A clone with a hook manager, a clone with a hook of its own, and a clone
  // with neither: the same resolver, three different answers, in order.
  const managed = await ownershipFor(async (root) => {
    await mkdir(path.join(root, '.husky/_'), { recursive: true });
    await writeFile(path.join(root, '.husky/_/pre-commit'), '#!/bin/sh\n', { mode: 0o755 });
    await runGit(root, ['config', '--local', 'core.hooksPath', '.husky/_']);
  });
  const composed = await ownershipFor(async (root) => {
    const hooksDirectory = path.join(root, '.git', 'hooks');

    await mkdir(hooksDirectory, { recursive: true });
    await writeFile(path.join(hooksDirectory, 'pre-commit'), priorHook(root), { mode: 0o755 });
  }, { confirming: true });
  const bare = await ownershipFor(async () => {});

  assert.deepEqual([managed, composed, bare], [...HOOK_STRATEGIES]);
  assert.deepEqual([...HOOK_STRATEGIES], [
    'native-hook-manager',
    'marker-delimited-block',
    'gate-owned-shim',
  ]);
});
