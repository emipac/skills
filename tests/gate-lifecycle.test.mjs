import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  activate,
  hookBlockIdentity,
  hookRegistrationReceiptId,
  previewActivation,
} from '../skills/change-evaluation-gate/scripts/lib/activation.mjs';
import { openCoordinationLock } from '../skills/change-evaluation-gate/scripts/lib/coordination.mjs';
import { contentIdentity, openEvidenceStore } from '../skills/change-evaluation-gate/scripts/lib/evidence-store.mjs';
import {
  UPDATE_STEPS,
  activeRelease,
  confirmConfigurationCleanup,
  confirmEvidencePrune,
  confirmRepair,
  deactivateGate,
  inspectCoordination,
  previewEvidencePrune,
  previewConfigurationCleanup,
  previewRepair,
  inspectRelease,
  statusGate,
  uninstallGate,
  updateGate,
} from '../skills/change-evaluation-gate/scripts/lib/lifecycle.mjs';

const runFile = promisify(execFile);

/**
 * This suite activates real clones, registers real hooks, and then removes
 * them again. Every fixture must therefore be a throwaway repository under the
 * OS temporary directory and never this repository: an escaped fixture would
 * both activate authoritative enforcement on the framework clone and let a
 * removal fixture delete framework state.
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
    `Refusing to run a lifecycle fixture outside the OS temporary directory: ${resolved}.`,
  );
  assert.equal(
    isInside(frameworkRoot, resolved),
    false,
    `Refusing to run a lifecycle fixture inside this repository: ${resolved}.`,
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

const throwawayRepository = async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-lifecycle-')));

  t.after(() => rm(root, { recursive: true, force: true }));
  await assertThrowawayRepository(root);
  await runFile('git', ['init', '--quiet'], { cwd: root, env: isolatedGitEnvironment() });

  return root;
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

const ACTIVE_RELEASE = { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' };

const CANDIDATE_RELEASE = { id: 'change-evaluation-gate', version: '0.9.1', protocolVersion: '1.0' };

const activationRequest = (root, overrides = {}) => ({
  scope: 'repository',
  trigger: 'explicit',
  repository: { root },
  configuration: { schemaVersion: 4, policy: gatePolicy() },
  client: { id: 'claude-code', surface: 'cli', version: '1.2.3' },
  gate: { ...ACTIVE_RELEASE },
  actor: { name: 'maintainer', source: 'git-config' },
  runtime: {
    runnerVersion: 'change-evaluation-gate/0.9.0',
    hookProgram: { interpreter: process.execPath, script: 'tools/gate-runner.mjs', args: [] },
  },
  checks: [{ id: 'broad_test', evaluate: testCommand() }],
  adapters: [
    { id: 'git', version: '1.0.0', authoritative: true },
    { id: 'claude-code', version: '1.2.3', authoritative: false },
  ],
  runtimeInputs: [{ name: 'APP_TOKEN', source: 'approved-environment-file' }],
  ...overrides,
});

const storeFor = async (root) => openEvidenceStore({
  repositoryRoot: root,
  runGit,
  identity: {
    actor: { name: 'maintainer', source: 'git-config' },
    client: { id: 'claude-code', surface: 'cli', version: '1.2.3' },
    gate: { ...ACTIVE_RELEASE },
    repository: { identity: `sha256:${'a'.repeat(64)}` },
  },
});

const activationDependencies = (overrides = {}) => ({
  runGit,
  resolveExecutable: (runner) => ({ executable: `/usr/bin/${runner}`, version: '1.0.0' }),
  establishTrust: async () => ({ established: true, grantedBy: 'maintainer', at: '2026-08-11T00:00:00.000Z' }),
  selfTestEvaluation: async () => ({ ok: true, detail: 'evaluation process reached a decision' }),
  selfTestAdapter: async (adapter) => ({ ok: true, detail: `${adapter.id} responded` }),
  ...overrides,
});

/** A guarded activation: no fixture may activate anything outside a throwaway clone. */
const activatedClone = async (t, overrides = {}) => {
  const root = await throwawayRepository(t);

  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/gate-runner.mjs'), 'process.exitCode = 0;\n', 'utf8');

  const store = await storeFor(root);
  const request = activationRequest(root, overrides);
  const preview = await previewActivation(request, activationDependencies());
  const consent = {
    previewId: preview.previewId,
    repositoryIdentity: preview.repository.identity,
    configurationIdentity: preview.configuration.identity,
    actor: { name: 'maintainer', source: 'git-config' },
    grantedAt: '2026-08-11T00:00:00.000Z',
  };

  await assertThrowawayRepository(root);

  const result = await activate(
    { ...request, consent },
    activationDependencies({ evidenceStore: store }),
  );

  assert.equal(result.activated, true, `The fixture failed to activate: ${result.reasonCode}.`);

  return { root, store, request, preview, receipt: result.receipt };
};

/**
 * A complete observable snapshot of one clone: every file under the Evidence
 * store and every registered hook, by path and bytes. Any status-time mutation
 * anywhere in gate-owned state changes this value.
 */
const snapshotOf = async (root, store) => {
  const entries = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await walk(absolute);
      } else {
        entries.push([
          path.relative(root, absolute),
          (await readFile(absolute, 'utf8').catch(() => null)),
        ]);
      }
    }
  };

  await walk(store.root);
  await walk(path.join(store.gitCommonDirectory, 'hooks'));

  return JSON.stringify(entries.sort(([left], [right]) => left.localeCompare(right)));
};

const lifecycleDependencies = (overrides = {}) => ({
  selfTestEvaluation: async () => ({ ok: true, detail: 'evaluation process reached a decision' }),
  selfTestAdapter: async (adapter) => ({ ok: true, detail: `${adapter.id} responded` }),
  probeAdapter: async (adapter) => ({ ok: true, detail: `${adapter.id} responded` }),
  clock: () => new Date('2026-08-11T01:00:00.000Z'),
  ...overrides,
});

test('an injected update failure keeps the prior active release and status reports health without repairing anything', async (t) => {
  const { root, store, receipt } = await activatedClone(t);
  const pinned = await readFile(store.paths.activationReceipt, 'utf8');
  const before = await snapshotOf(root, store);

  // The update reaches its self-test — every earlier step passed — and fails
  // there, which is the one moment where a careless implementation would have
  // already replaced the Active gate release.
  const result = await updateGate({
    evidenceStore: store,
    repositoryRoot: root,
    candidate: { ...CANDIDATE_RELEASE },
    migrations: [],
  }, lifecycleDependencies({
    selfTestEvaluation: async () => ({ ok: false, detail: 'injected update self-test failure' }),
  }));

  assert.equal(result.updated, false);
  assert.equal(result.state, 'preserved');
  assert.equal(result.step, 'self-test');
  assert.equal(result.reasonCode, 'update-self-test-failed');
  assert.deepEqual(activeRelease(result.receipt), { ...ACTIVE_RELEASE });
  assert.deepEqual([...UPDATE_STEPS].slice(-1), ['release-switch']);

  // The prior release survives byte for byte: nothing partial was published.
  assert.equal(await readFile(store.paths.activationReceipt, 'utf8'), pinned);
  assert.deepEqual(activeRelease(await store.activationReceipt().read()), { ...ACTIVE_RELEASE });

  // Health is observable, and observing it repairs and writes nothing.
  const afterUpdate = await snapshotOf(root, store);
  const status = await statusGate({
    evidenceStore: store,
    repositoryRoot: root,
    adapters: [
      { id: 'git', version: '1.0.0', authoritative: true },
      { id: 'claude-code', version: '1.2.3', authoritative: false },
    ],
  }, lifecycleDependencies());

  assert.equal(status.status, 'healthy');
  assert.equal(status.repaired, false);
  assert.deepEqual(status.mutations, []);
  assert.deepEqual(activeRelease(status.receipt), { ...ACTIVE_RELEASE });
  assert.equal(await snapshotOf(root, store), afterUpdate);

  // The failed update is recorded, and it did not disturb the clone either.
  const events = await store.readEvents();

  assert.equal(events.at(-1).type, 'update');
  assert.equal(events.at(-1).outcome, 'failed');
  assert.equal(receipt.runtime.gate.version, '0.9.0');
  assert.notEqual(before, null);
});

test('adapter loss is degraded, authoritative loss is broken, and neither repairs anything', async (t) => {
  const { root, store } = await activatedClone(t);
  const hookPath = (await store.activationReceipt().read()).hooks[0].path;
  const registered = await readFile(hookPath, 'utf8');

  // Losing a supporting surface costs the clone a surface, not its authority.
  const before = await snapshotOf(root, store);
  const degraded = await statusGate({
    evidenceStore: store,
    repositoryRoot: root,
    adapters: [{ id: 'git', version: '1.0.0', authoritative: true }],
  }, lifecycleDependencies());

  assert.equal(degraded.status, 'degraded');
  assert.deepEqual(
    degraded.findings.map((finding) => [finding.code, finding.adapter ?? null]),
    [['adapter-lost', 'claude-code']],
  );
  assert.equal(degraded.repaired, false);
  assert.equal(await snapshotOf(root, store), before);

  // Losing the authoritative surface means the gate no longer enforces what it
  // claims to enforce.
  const broken = await statusGate({
    evidenceStore: store,
    repositoryRoot: root,
    adapters: [{ id: 'claude-code', version: '1.2.3', authoritative: false }],
  }, lifecycleDependencies());

  assert.equal(broken.status, 'broken');
  assert.equal(broken.findings[0].code, 'authoritative-adapter-lost');
  assert.equal(broken.repaired, false);
  assert.equal(await snapshotOf(root, store), before);

  // An adapter that is installed but no longer answers is the same loss.
  const unresponsive = await statusGate({
    evidenceStore: store,
    repositoryRoot: root,
    adapters: null,
  }, lifecycleDependencies({
    probeAdapter: async (adapter) => ({ ok: adapter.id !== 'git', detail: 'no response' }),
  }));

  assert.equal(unresponsive.status, 'broken');
  assert.equal(await snapshotOf(root, store), before);
});

test('a tampered gate-owned block is broken through a durable identity, and status leaves the tampering in place', async (t) => {
  const { root, store } = await activatedClone(t);
  const receipt = await store.activationReceipt().read();
  const hookPath = receipt.hooks[0].path;
  const registered = await readFile(hookPath, 'utf8');

  // The receipt carries a durable identity of the registration it authorized,
  // hashed with its own receipt-id line elided so the cycle can be closed.
  assert.match(receipt.hookChain.blockIdentity, /^sha256:[0-9a-f]{64}$/);
  assert.equal(receipt.hookChain.blockIdentity, hookBlockIdentity(registered));
  assert.equal(hookRegistrationReceiptId(registered), receipt.receiptId);

  // An intact registration reconciles clean.
  assert.equal(
    (await statusGate({ evidenceStore: store, repositoryRoot: root }, lifecycleDependencies())).status,
    'healthy',
  );

  // Somebody neuters the hook while leaving every marker and the receipt line
  // exactly where they were. Only a content identity can see this.
  const tampered = registered.replace(/^exec .*$/m, 'exit 0');

  assert.notEqual(tampered, registered);
  await writeFile(hookPath, tampered, 'utf8');

  const status = await statusGate({
    evidenceStore: store,
    repositoryRoot: root,
  }, lifecycleDependencies());

  assert.equal(status.status, 'broken');
  assert.equal(status.findings[0].code, 'hook-block-tampered');
  assert.equal(status.repaired, false);
  assert.deepEqual(status.mutations, []);

  // Status observed the tampering and left it exactly as it found it.
  assert.equal(await readFile(hookPath, 'utf8'), tampered);

  // A registration that names a different activation is drift too.
  await writeFile(
    hookPath,
    registered.replace(hookRegistrationReceiptId(registered), `sha256:${'b'.repeat(64)}`),
    'utf8',
  );

  const renamed = await statusGate({
    evidenceStore: store,
    repositoryRoot: root,
  }, lifecycleDependencies());

  assert.equal(renamed.status, 'broken');
  assert.equal(renamed.findings[0].code, 'hook-receipt-mismatch');

  // And an absent registration is the plainest authoritative loss of all.
  await rm(hookPath, { force: true });

  const absent = await statusGate({
    evidenceStore: store,
    repositoryRoot: root,
  }, lifecycleDependencies());

  assert.equal(absent.status, 'broken');
  assert.equal(absent.findings[0].code, 'hook-absent');
  assert.equal(absent.repaired, false);
});

test('an ordinary distribution exposes a candidate only, and only an explicit successful update advances the active release', async (t) => {
  const { root, store } = await activatedClone(t);
  const pinned = await readFile(store.paths.activationReceipt, 'utf8');
  const hookPath = (await store.activationReceipt().read()).hooks[0].path;
  const registered = await readFile(hookPath, 'utf8');

  // Installing a newer skill, plugin, or package makes a candidate visible.
  const available = inspectRelease({
    receipt: await store.activationReceipt().read(),
    distribution: { ...CANDIDATE_RELEASE },
  });

  assert.deepEqual(available.active, { ...ACTIVE_RELEASE });
  assert.deepEqual(available.candidate, { ...CANDIDATE_RELEASE });
  assert.equal(available.candidateAvailable, true);
  assert.equal(available.advancesActiveRelease, false);
  assert.equal(available.action, 'gate update');

  // And changes nothing at all: the Active gate release is still the old one.
  assert.equal(await readFile(store.paths.activationReceipt, 'utf8'), pinned);
  assert.deepEqual(activeRelease(await store.activationReceipt().read()), { ...ACTIVE_RELEASE });

  const applied = [];
  const result = await updateGate({
    evidenceStore: store,
    repositoryRoot: root,
    candidate: { ...CANDIDATE_RELEASE },
    migrations: [{ id: 'evidence-index-v2', reversible: true, description: 'reindex evidence' }],
    runtime: { runnerVersion: 'change-evaluation-gate/0.9.1' },
  }, lifecycleDependencies({
    applyMigration: async (migration) => {
      applied.push(migration.id);

      return { ok: true };
    },
  }));

  assert.equal(result.updated, true);
  assert.equal(result.state, 'updated');
  assert.deepEqual(result.order, [...UPDATE_STEPS]);
  assert.deepEqual(applied, ['evidence-index-v2']);
  assert.deepEqual(result.release, { from: { ...ACTIVE_RELEASE }, to: { ...CANDIDATE_RELEASE } });

  // The switch is one atomic receipt write, and it records what it superseded.
  const switched = await store.activationReceipt().read();

  assert.deepEqual(activeRelease(switched), { ...CANDIDATE_RELEASE });
  assert.equal(switched.supersedes.release.version, '0.9.0');
  assert.equal(switched.runtime.runnerVersion, 'change-evaluation-gate/0.9.1');
  assert.equal(switched.receiptId, result.receipt.receiptId);
  assert.notEqual(switched.receiptId, switched.supersedes.receiptId);

  const events = await store.readEvents();

  assert.equal(events.at(-1).type, 'update');
  assert.equal(events.at(-1).outcome, 'succeeded');

  // The registration itself was never touched by the release switch.
  assert.equal(await readFile(hookPath, 'utf8'), registered);
});

test('an incompatible candidate and an irreversible migration are refused before anything runs', async (t) => {
  const { root, store } = await activatedClone(t);
  const pinned = await readFile(store.paths.activationReceipt, 'utf8');
  const applied = [];
  const deps = lifecycleDependencies({
    applyMigration: async (migration) => {
      applied.push(migration.id);

      return { ok: true };
    },
  });

  const protocol = await updateGate({
    evidenceStore: store,
    repositoryRoot: root,
    candidate: { id: 'change-evaluation-gate', version: '1.0.0', protocolVersion: '2.0' },
  }, deps);

  assert.equal(protocol.updated, false);
  assert.equal(protocol.step, 'compatibility');
  assert.equal(protocol.reasonCode, 'update-incompatible');

  const irreversible = await updateGate({
    evidenceStore: store,
    repositoryRoot: root,
    candidate: { ...CANDIDATE_RELEASE },
    migrations: [{ id: 'drop-legacy-index', reversible: false }],
  }, deps);

  assert.equal(irreversible.updated, false);
  assert.equal(irreversible.step, 'compatibility');
  assert.deepEqual(applied, []);

  // A failing migration unwinds exactly what it applied and nothing else.
  const reverted = [];
  const failed = await updateGate({
    evidenceStore: store,
    repositoryRoot: root,
    candidate: { ...CANDIDATE_RELEASE },
    migrations: [
      { id: 'first', reversible: true },
      { id: 'second', reversible: true },
    ],
  }, lifecycleDependencies({
    applyMigration: async (migration) => {
      applied.push(migration.id);

      return { ok: migration.id === 'first', detail: 'injected migration failure' };
    },
    revertMigration: async (migration) => reverted.push(migration.id),
  }));

  assert.equal(failed.updated, false);
  assert.equal(failed.state, 'preserved');
  assert.equal(failed.reasonCode, 'update-migration-failed');
  assert.deepEqual(applied, ['first', 'second']);
  assert.deepEqual(reverted, ['first']);

  // Through every refusal the previous Active gate release is untouched.
  assert.equal(await readFile(store.paths.activationReceipt, 'utf8'), pinned);
});

/** The hook a repository already had, which activation must preserve and restore. */
const PRIOR_HOOK = [
  '#!/bin/sh',
  '# the repository had its own pre-commit long before the gate existed',
  'echo "prior chain" > prior-ran',
  'exit 0',
  '',
].join('\n');

/** An unrelated hook the gate never registered, never previewed, and never owns. */
const UNRELATED_HOOK = '#!/bin/sh\necho "unrelated" > unrelated-ran\n';

/** A shared configuration file that carries far more than the Gate section. */
const SHARED_CONFIGURATION = [
  'schema_version: 4',
  'backend: laravel',
  'frontend: none',
  'tracker: local-markdown',
  'evaluation_gate:',
  '  enabled: true',
  '  checks:',
  '    required:',
  '      - broad_test',
  'history:',
  '  path: docs/history',
  '  required: true',
  '',
].join('\n');

/**
 * An activated clone that already had a hook chain, an unrelated hook, a shared
 * configuration file, historical Evidence, and a global asset outside the
 * project. Every one of those must survive removal.
 */
const populatedClone = async (t) => {
  const root = await throwawayRepository(t);
  const globalAssets = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-global-')));

  t.after(() => rm(globalAssets, { recursive: true, force: true }));
  await assertThrowawayRepository(globalAssets);

  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/gate-runner.mjs'), 'process.exitCode = 0;\n', 'utf8');
  await writeFile(path.join(root, '.agent-framework.yaml'), SHARED_CONFIGURATION, 'utf8');
  await mkdir(path.join(root, '.claude', 'skills'), { recursive: true });
  await writeFile(path.join(root, '.claude/skills/gate.md'), '# project asset\n', 'utf8');
  await writeFile(path.join(globalAssets, 'gate.md'), '# global asset\n', 'utf8');

  const store = await storeFor(root);
  const hooksDirectory = path.join(store.gitCommonDirectory, 'hooks');

  await mkdir(hooksDirectory, { recursive: true });
  await writeFile(path.join(hooksDirectory, 'pre-commit'), PRIOR_HOOK, { mode: 0o755 });
  await writeFile(path.join(hooksDirectory, 'pre-push'), UNRELATED_HOOK, { mode: 0o755 });

  // Historical Evidence that predates the activation and must outlive it.
  await store.appendEvidence({
    decision: { evaluationId: `sha256:${'c'.repeat(64)}`, outcome: 'pass' },
    outputs: [{ checkId: 'broad_test', attempt: 1, text: 'historical output\n' }],
  });

  const request = activationRequest(root);
  const unconfirmed = await previewActivation(request, activationDependencies());
  const confirmed = {
    ...request,
    hookConfirmation: {
      strategy: 'marker-delimited-block',
      path: unconfirmed.hooks[0].path,
      hookIdentity: unconfirmed.hooks[0].existing.identity,
    },
  };
  const preview = await previewActivation(confirmed, activationDependencies());

  await assertThrowawayRepository(root);

  const result = await activate({
    ...confirmed,
    consent: {
      previewId: preview.previewId,
      repositoryIdentity: preview.repository.identity,
      configurationIdentity: preview.configuration.identity,
      actor: { name: 'maintainer', source: 'git-config' },
      grantedAt: '2026-08-11T00:00:00.000Z',
    },
  }, activationDependencies({ evidenceStore: store }));

  assert.equal(result.activated, true, `The fixture failed to activate: ${result.reasonCode}.`);
  assert.equal(result.receipt.hookChain.strategy, 'marker-delimited-block');

  return { root, store, globalAssets, hooksDirectory, receipt: result.receipt };
};

test('deactivation removes only unchanged gate-owned state and preserves configuration, unrelated hooks, global assets, and evidence', async (t) => {
  const { root, store, globalAssets, hooksDirectory, receipt } = await populatedClone(t);
  const historicalEvents = (await store.readEvents()).length;
  const historicalBlobs = (await store.listBlobs()).length;
  const historicalLog = (await store.readLog()).length;

  assert.ok(historicalBlobs > 0, 'The fixture recorded no historical Evidence to preserve.');

  const result = await deactivateGate({
    evidenceStore: store,
    repositoryRoot: root,
  }, lifecycleDependencies());

  assert.equal(result.deactivated, true);
  assert.equal(result.state, 'configured');
  assert.equal(result.reasonCode, null);
  assert.deepEqual(
    result.removed.map((entry) => entry.kind).sort(),
    ['activation-receipt', 'hook-registration'],
  );

  // The prior hook chain is restored byte for byte: the gate removed its block
  // and nothing else.
  assert.equal(await readFile(path.join(hooksDirectory, 'pre-commit'), 'utf8'), PRIOR_HOOK);

  // An unrelated hook the gate never owned is exactly as it was.
  assert.equal(await readFile(path.join(hooksDirectory, 'pre-push'), 'utf8'), UNRELATED_HOOK);

  // The shared configuration file is untouched — every key, including the ones
  // that have nothing to do with the Gate.
  assert.equal(await readFile(path.join(root, '.agent-framework.yaml'), 'utf8'), SHARED_CONFIGURATION);

  // Global assets outside the project are not deactivation's business.
  assert.equal(await readFile(path.join(globalAssets, 'gate.md'), 'utf8'), '# global asset\n');

  // Project-installed assets survive deactivation; only `gate uninstall` may
  // remove those, and only after this step.
  assert.equal(await readFile(path.join(root, '.claude/skills/gate.md'), 'utf8'), '# project asset\n');

  // Every byte of historical Evidence outlives the activation that produced it.
  assert.equal((await store.listBlobs()).length, historicalBlobs);
  assert.equal((await store.readLog()).length, historicalLog);

  const events = await store.readEvents();

  assert.equal(events.length, historicalEvents + 1);
  assert.equal(events.at(-1).type, 'removal');
  assert.equal(events.at(-1).outcome, 'succeeded');
  assert.equal(events.at(-1).before, receipt.receiptId);

  // The receipt — and only the receipt — is gone.
  assert.equal(await store.activationReceipt().read(), null);

  // A clone with nothing to deactivate says so rather than doing anything.
  const again = await deactivateGate({
    evidenceStore: store,
    repositoryRoot: root,
  }, lifecycleDependencies());

  assert.equal(again.deactivated, false);
  assert.equal(again.reasonCode, 'activation-absent');
  assert.deepEqual(again.removed, []);
});

test('deactivation refuses as a whole when a gate-owned registration drifted, and removes nothing', async (t) => {
  const { root, store, hooksDirectory } = await populatedClone(t);
  const hookPath = path.join(hooksDirectory, 'pre-commit');
  const composed = await readFile(hookPath, 'utf8');

  // Somebody edited inside the markers. The gate can no longer prove that
  // removing the block restores what it promised to preserve.
  const drifted = composed.replace(/\|\| exit \$\?/, '|| true');

  assert.notEqual(drifted, composed);
  await writeFile(hookPath, drifted, 'utf8');

  const result = await deactivateGate({
    evidenceStore: store,
    repositoryRoot: root,
  }, lifecycleDependencies());

  assert.equal(result.deactivated, false);
  assert.equal(result.state, 'activated');
  assert.equal(result.reasonCode, 'registration-drifted');
  assert.deepEqual(result.removed, []);

  // Nothing was removed and nothing was repaired: not the drifted hook, and
  // not the receipt that still names it.
  assert.equal(await readFile(hookPath, 'utf8'), drifted);
  assert.notEqual(await store.activationReceipt().read(), null);

  const events = await store.readEvents();

  assert.equal(events.at(-1).type, 'removal');
  assert.equal(events.at(-1).outcome, 'refused');
});

test('uninstall requires prior deactivation and removes only unchanged project-installed assets', async (t) => {
  const { root, store, globalAssets, hooksDirectory } = await populatedClone(t);
  const projectAsset = path.join(root, '.claude/skills/gate.md');
  const globalAsset = path.join(globalAssets, 'gate.md');
  const configuration = path.join(root, '.agent-framework.yaml');
  const manifest = async (paths) => Promise.all(paths.map(async (asset) => ({
    path: asset,
    identity: contentIdentity(await readFile(asset, 'utf8')),
  })));

  // An activated clone is never uninstalled out from under its own hook.
  const early = await uninstallGate({
    evidenceStore: store,
    repositoryRoot: root,
    assets: await manifest([projectAsset]),
  }, lifecycleDependencies());

  assert.equal(early.uninstalled, false);
  assert.equal(early.reasonCode, 'deactivation-required');
  assert.deepEqual(early.removed, []);
  assert.equal(await readFile(projectAsset, 'utf8'), '# project asset\n');

  assert.equal(
    (await deactivateGate({ evidenceStore: store, repositoryRoot: root }, lifecycleDependencies())).deactivated,
    true,
  );

  // A manifest that reaches outside the project is refused as a whole. Global
  // assets are shared with every other clone on the machine.
  const global = await uninstallGate({
    evidenceStore: store,
    repositoryRoot: root,
    assets: await manifest([projectAsset, globalAsset]),
  }, lifecycleDependencies());

  assert.equal(global.uninstalled, false);
  assert.equal(global.reasonCode, 'asset-refused');
  assert.deepEqual(global.refused.map((entry) => entry.reason), ['asset-outside-project']);
  assert.deepEqual(global.removed, []);
  assert.equal(await readFile(globalAsset, 'utf8'), '# global asset\n');
  assert.equal(await readFile(projectAsset, 'utf8'), '# project asset\n');

  // The shared configuration file is never a Gate asset, wherever it is listed.
  const shared = await uninstallGate({
    evidenceStore: store,
    repositoryRoot: root,
    configurationPath: configuration,
    assets: await manifest([configuration]),
  }, lifecycleDependencies());

  assert.equal(shared.uninstalled, false);
  assert.deepEqual(shared.refused.map((entry) => entry.reason), ['shared-configuration']);
  assert.equal(await readFile(configuration, 'utf8'), SHARED_CONFIGURATION);

  // Neither is anything inside the Evidence store.
  const evidence = await uninstallGate({
    evidenceStore: store,
    repositoryRoot: root,
    assets: [{ path: store.paths.log, identity: contentIdentity('') }],
  }, lifecycleDependencies());

  assert.equal(evidence.uninstalled, false);
  assert.deepEqual(evidence.refused.map((entry) => entry.reason), ['historical-evidence']);

  // A project asset the maintainer edited is theirs now, not the Gate's.
  const pinned = await manifest([projectAsset]);

  await writeFile(projectAsset, '# project asset, since edited\n', 'utf8');

  const modified = await uninstallGate({
    evidenceStore: store,
    repositoryRoot: root,
    assets: pinned,
  }, lifecycleDependencies());

  assert.equal(modified.uninstalled, false);
  assert.deepEqual(modified.refused.map((entry) => entry.reason), ['asset-modified']);
  assert.equal(await readFile(projectAsset, 'utf8'), '# project asset, since edited\n');

  // Finally: the clean case removes exactly the unchanged project asset.
  const historicalBlobs = (await store.listBlobs()).length;
  const result = await uninstallGate({
    evidenceStore: store,
    repositoryRoot: root,
    assets: await manifest([projectAsset]),
  }, lifecycleDependencies());

  assert.equal(result.uninstalled, true);
  assert.deepEqual(result.removed.map((entry) => entry.path), [projectAsset]);
  assert.deepEqual(result.refused, []);
  assert.equal(await readFile(projectAsset, 'utf8').catch(() => null), null);

  // And nothing else at all. Assert the survivors, not merely the Gate's absence.
  assert.equal(await readFile(configuration, 'utf8'), SHARED_CONFIGURATION);
  assert.equal(await readFile(globalAsset, 'utf8'), '# global asset\n');
  assert.equal(await readFile(path.join(hooksDirectory, 'pre-commit'), 'utf8'), PRIOR_HOOK);
  assert.equal(await readFile(path.join(hooksDirectory, 'pre-push'), 'utf8'), UNRELATED_HOOK);
  assert.equal((await store.listBlobs()).length, historicalBlobs);

  const events = await store.readEvents();

  assert.ok(events.length > 0);
  assert.equal(events.at(-1).type, 'removal');
  assert.equal(events.at(-1).outcome, 'succeeded');
});

test('cleanup removes only previewed Gate keys and never deletes the shared configuration file', async (t) => {
  const { root, store } = await populatedClone(t);
  const configuration = path.join(root, '.agent-framework.yaml');

  const preview = await previewConfigurationCleanup({ configurationPath: configuration });

  assert.deepEqual(preview.keys.map((key) => key.key), ['evaluation_gate']);
  assert.match(preview.confirmationToken, /^sha256:[0-9a-f]{64}$/);
  assert.match(preview.removedText, /^evaluation_gate:\n/);
  assert.equal(preview.path, configuration);

  // Previewing writes nothing.
  assert.equal(await readFile(configuration, 'utf8'), SHARED_CONFIGURATION);

  // A confirmation that cannot reproduce the preview removes nothing at all.
  const mismatched = await confirmConfigurationCleanup({
    configurationPath: configuration,
    preview,
    confirmation: `sha256:${'f'.repeat(64)}`,
  }, lifecycleDependencies());

  assert.equal(mismatched.cleaned, false);
  assert.equal(mismatched.reasonCode, 'preview-mismatch');
  assert.deepEqual(mismatched.removedKeys, []);
  assert.equal(await readFile(configuration, 'utf8'), SHARED_CONFIGURATION);

  const result = await confirmConfigurationCleanup({
    evidenceStore: store,
    configurationPath: configuration,
    preview,
    confirmation: preview.confirmationToken,
  }, lifecycleDependencies());

  assert.equal(result.cleaned, true);
  assert.deepEqual(result.removedKeys, ['evaluation_gate']);

  // The shared file still exists, and every non-Gate line is byte-identical.
  const cleaned = await readFile(configuration, 'utf8');

  assert.equal(cleaned, [
    'schema_version: 4',
    'backend: laravel',
    'frontend: none',
    'tracker: local-markdown',
    'history:',
    '  path: docs/history',
    '  required: true',
    '',
  ].join('\n'));

  // A second cleanup has nothing left to preview, and still never touches
  // anything that is not the Gate's.
  const empty = await previewConfigurationCleanup({ configurationPath: configuration });

  assert.deepEqual(empty.keys, []);

  const nothing = await confirmConfigurationCleanup({
    evidenceStore: store,
    configurationPath: configuration,
    preview: empty,
    confirmation: empty.confirmationToken,
  }, lifecycleDependencies());

  assert.equal(nothing.cleaned, false);
  assert.equal(nothing.reasonCode, 'nothing-previewed');
  assert.equal(await readFile(configuration, 'utf8'), cleaned);
});

test('drift survives status and an ordinary update, and changes only through a confirmed repair', async (t) => {
  const { root, store, hooksDirectory } = await populatedClone(t);
  const hookPath = path.join(hooksDirectory, 'pre-commit');
  const registered = await readFile(hookPath, 'utf8');
  const runtime = {
    hookProgram: { interpreter: process.execPath, script: 'tools/gate-runner.mjs', args: [] },
  };

  // Somebody neuters the gate-owned block without disturbing its markers.
  const drifted = registered.replace(/\|\| exit \$\?/, '|| true');

  assert.notEqual(drifted, registered);
  await writeFile(hookPath, drifted, 'utf8');

  const broken = await statusGate({ evidenceStore: store, repositoryRoot: root }, lifecycleDependencies());

  assert.equal(broken.status, 'broken');
  assert.equal(broken.findings[0].code, 'hook-block-tampered');

  // An ordinary — and entirely successful — update does not repair it.
  const updated = await updateGate({
    evidenceStore: store,
    repositoryRoot: root,
    candidate: { ...CANDIDATE_RELEASE },
  }, lifecycleDependencies());

  assert.equal(updated.updated, true);
  assert.equal(await readFile(hookPath, 'utf8'), drifted);

  // The drift is still there afterwards, still unrepaired.
  const receipt = await store.activationReceipt().read();
  const stillBroken = await statusGate({ evidenceStore: store, repositoryRoot: root }, lifecycleDependencies());

  assert.equal(stillBroken.status, 'broken');
  assert.equal(await readFile(hookPath, 'utf8'), drifted);

  const preview = await previewRepair({
    evidenceStore: store,
    repositoryRoot: root,
    runtime,
  }, lifecycleDependencies());

  assert.deepEqual(preview.actions.map((action) => action.code), ['hook-block-tampered']);
  assert.match(preview.confirmationToken, /^sha256:[0-9a-f]{64}$/);

  // Previewing a repair repairs nothing.
  assert.equal(await readFile(hookPath, 'utf8'), drifted);

  const refused = await confirmRepair({
    evidenceStore: store,
    repositoryRoot: root,
    runtime,
    preview,
    confirmation: `sha256:${'e'.repeat(64)}`,
  }, lifecycleDependencies());

  assert.equal(refused.repaired, false);
  assert.equal(refused.reasonCode, 'preview-mismatch');
  assert.equal(await readFile(hookPath, 'utf8'), drifted);

  const result = await confirmRepair({
    evidenceStore: store,
    repositoryRoot: root,
    runtime,
    preview,
    confirmation: preview.confirmationToken,
  }, lifecycleDependencies());

  assert.equal(result.repaired, true);
  assert.deepEqual(result.actions.map((action) => action.kind), ['hook-registration']);

  // The registration is exactly the block the current receipt authorizes, and
  // the surrounding chain the activation preserved is still byte for byte
  // itself.
  const repaired = await readFile(hookPath, 'utf8');

  assert.equal(
    hookBlockIdentity(repaired.match(/# >>> [\s\S]*?# <<< change-evaluation-gate managed block <<</)[0]),
    receipt.hookChain.blockIdentity,
  );
  assert.equal(hookRegistrationReceiptId(repaired), receipt.receiptId);
  assert.ok(repaired.includes('echo "prior chain" > prior-ran'));

  assert.equal(
    (await statusGate({ evidenceStore: store, repositoryRoot: root }, lifecycleDependencies())).status,
    'healthy',
  );

  const events = await store.readEvents();

  assert.equal(events.at(-1).type, 'repair');
  assert.equal(events.at(-1).outcome, 'succeeded');
  assert.ok(events.some((event) => event.type === 'repair' && event.outcome === 'refused'));
});

test('the operator prune command previews, never deletes without confirmation, and removes only blobs', async (t) => {
  const { root, store } = await activatedClone(t);

  for (const index of [1, 2]) {
    await store.appendEvidence({
      decision: { evaluationId: `sha256:${String(index).repeat(64)}`, outcome: 'pass' },
      outputs: [{ checkId: 'broad_test', attempt: index, text: `output ${index}\n`.repeat(8) }],
    });
  }

  const blobsBefore = (await store.listBlobs()).length;
  const logBefore = (await store.readLog()).length;

  assert.equal(blobsBefore, 2);

  const preview = await previewEvidencePrune({
    evidenceStore: store,
    selector: { appendedBefore: '2999-01-01T00:00:00.000Z' },
  });

  assert.equal(preview.blobs.length, 2);
  assert.ok(preview.totalBytes > 0);
  assert.match(preview.confirmationToken, /^sha256:[0-9a-f]{64}$/);
  assert.equal(preview.removed, false);

  // Previewing removes nothing at all.
  assert.equal((await store.listBlobs()).length, blobsBefore);

  // A prune without a confirmation is never an implicit deletion.
  const unconfirmed = await confirmEvidencePrune({ evidenceStore: store, preview, confirmation: null });

  assert.equal(unconfirmed.pruned, false);
  assert.equal(unconfirmed.reasonCode, 'preview-mismatch');
  assert.equal((await store.listBlobs()).length, blobsBefore);

  const result = await confirmEvidencePrune({
    evidenceStore: store,
    preview,
    confirmation: preview.confirmationToken,
  });

  assert.equal(result.pruned, true);
  assert.equal(result.removed.length, 2);
  assert.ok(result.reclaimedBytes > 0);

  // Only blobs went. Envelopes, the append-only log, the events, and the
  // tombstones that record the removal are all still there.
  assert.equal((await store.listBlobs()).length, 0);
  assert.equal((await store.readLog()).length, logBefore);
  assert.equal((await store.readTombstones()).length, 2);
  assert.ok((await store.readEvents()).some((event) => event.type === 'pruning'));
  assert.notEqual(await store.readEnvelope(`sha256:${'1'.repeat(64)}`), undefined);
});

test('the operator lock command inspects the coordination lock without acquiring or recovering it', async (t) => {
  const { root, store } = await activatedClone(t);

  const idle = await inspectCoordination({ repositoryRoot: root, runGit });

  assert.equal(idle.held, false);
  assert.equal(idle.stale, false);
  assert.equal(idle.recovered, false);
  assert.equal(idle.acquired, false);
  assert.equal(idle.recoveryToken, null);
  assert.equal(idle.action, null);

  const lock = await openCoordinationLock({ repositoryRoot: root, runGit, store });
  const held = await lock.acquire({ bindingKey: 'fixture', executionId: 'fixture', role: 'authoritative' });

  assert.equal(held.acquired, true);

  const observed = await inspectCoordination({ repositoryRoot: root, runGit });

  assert.equal(observed.held, true);
  assert.equal(observed.holder.pid, process.pid);
  assert.equal(observed.recovered, false);
  assert.equal(observed.acquired, false);
  assert.equal(observed.stale, false);
  // A live holder is never recoverable, so the command offers no recovery.
  assert.equal(observed.action, null);

  // The lock is still exactly where it was; inspection took nothing.
  assert.equal((await lock.readRecord()).lockId, held.record.lockId);
  assert.equal((await lock.inspect()).held, true);

  assert.equal((await held.release()).released, true);
});

/** Every file in the entire clone, by relative path and bytes. */
const wholeCloneSnapshot = async (root) => {
  const entries = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        entries.push([
          path.relative(root, absolute),
          (await readFile(absolute, 'base64').catch(() => null)),
        ]);
      }
    }
  };

  await walk(root);

  return JSON.stringify(entries.sort(([left], [right]) => left.localeCompare(right)));
};

test('gate status mutates nothing anywhere in the clone, healthy or broken (SG-LIFE-001)', async (t) => {
  const { root, store, hooksDirectory } = await populatedClone(t);

  await store.appendEvidence({
    decision: { evaluationId: `sha256:${'d'.repeat(64)}`, outcome: 'pass' },
    outputs: [{ checkId: 'broad_test', attempt: 1, text: 'evidence that must survive observation\n' }],
  });

  // Healthy: observing an intact clone changes not one byte of it.
  const healthyBefore = await wholeCloneSnapshot(root);
  const healthy = await statusGate({
    evidenceStore: store,
    repositoryRoot: root,
    adapters: [
      { id: 'git', version: '1.0.0', authoritative: true },
      { id: 'claude-code', version: '1.2.3', authoritative: false },
    ],
  }, lifecycleDependencies());

  assert.equal(healthy.status, 'healthy');
  assert.equal(await wholeCloneSnapshot(root), healthyBefore);

  // Degraded: neither does observing a clone that lost a supporting surface.
  const degraded = await statusGate({
    evidenceStore: store,
    repositoryRoot: root,
    adapters: [{ id: 'git', version: '1.0.0', authoritative: true }],
  }, lifecycleDependencies());

  assert.equal(degraded.status, 'degraded');
  assert.equal(await wholeCloneSnapshot(root), healthyBefore);

  // Broken: and least of all a clone whose authoritative registration is gone.
  await rm(path.join(hooksDirectory, 'pre-commit'), { force: true });

  const brokenBefore = await wholeCloneSnapshot(root);
  const broken = await statusGate({
    evidenceStore: store,
    repositoryRoot: root,
    adapters: null,
  }, lifecycleDependencies());

  assert.equal(broken.status, 'broken');
  assert.equal(broken.repaired, false);
  assert.deepEqual(broken.mutations, []);

  // No repair, no receipt withdrawal, no drift event, no lock, nothing.
  assert.equal(await wholeCloneSnapshot(root), brokenBefore);

  // Repeated observation is still observation.
  await statusGate({ evidenceStore: store, repositoryRoot: root }, lifecycleDependencies());
  await statusGate({ evidenceStore: store, repositoryRoot: root }, lifecycleDependencies());

  assert.equal(await wholeCloneSnapshot(root), brokenBefore);
});
