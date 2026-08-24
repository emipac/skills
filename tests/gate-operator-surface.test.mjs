import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { activate, previewActivation } from '../skills/change-evaluation-gate/scripts/lib/activation.mjs';
import { openCoordinationLock } from '../skills/change-evaluation-gate/scripts/lib/coordination.mjs';
import { openEvidenceStore } from '../skills/change-evaluation-gate/scripts/lib/evidence-store.mjs';
import { validateLifecycleEvent } from '../skills/change-evaluation-gate/scripts/lib/lifecycle-event.mjs';
import { inspectCoordination, statusGate } from '../skills/change-evaluation-gate/scripts/lib/lifecycle.mjs';
import {
  COMMANDS,
  CONFIRMABLE_COMMANDS,
  CONFIRMED_COMMANDS,
  CONFIRMED_SELECTORS,
  EXIT_OBSERVED,
  EXIT_UNHEALTHY,
  EXIT_UNRUNNABLE,
  runOperatorCommand,
} from '../skills/change-evaluation-gate/scripts/lib/operator-surface.mjs';

const runFile = promisify(execFile);

/**
 * This suite activates real clones and registers real hooks. Every fixture is
 * therefore a throwaway repository under the OS temporary directory and never
 * this repository, guarded the same way `tests/gate-lifecycle.test.mjs` guards
 * its own: an escaped fixture would activate authoritative enforcement on the
 * framework clone.
 */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGED_COMMAND = path.join(
  FRAMEWORK_ROOT,
  'skills/change-evaluation-gate/scripts/gate.mjs',
);

const isInside = (parent, candidate) => candidate === parent
  || candidate.startsWith(`${parent}${path.sep}`);

const assertThrowawayRepository = async (root) => {
  const resolved = await realpath(root).catch(() => path.resolve(root));
  const temporaryRoot = await realpath(tmpdir());
  const frameworkRoot = await realpath(FRAMEWORK_ROOT).catch(() => FRAMEWORK_ROOT);

  assert.equal(
    isInside(temporaryRoot, resolved),
    true,
    `Refusing to run an operator-surface fixture outside the OS temporary directory: ${resolved}.`,
  );
  assert.equal(
    isInside(frameworkRoot, resolved),
    false,
    `Refusing to run an operator-surface fixture inside this repository: ${resolved}.`,
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
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-operator-')));

  t.after(() => rm(root, { recursive: true, force: true }));
  await assertThrowawayRepository(root);
  await runFile('git', ['init', '--quiet'], { cwd: root, env: isolatedGitEnvironment() });

  return root;
};

const ACTIVE_RELEASE = { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' };

const SHARED_CONFIGURATION = [
  'schema_version: 4',
  'backend: laravel',
  'frontend: none',
  'evaluation_gate:',
  '  checks:',
  '    required:',
  '      - broad_test',
  '    advisory: []',
  '  budget:',
  '    total_seconds: 600',
  '  bypass:',
  '    enabled: false',
  '    marker: null',
  '  execution:',
  '    budget_skippable: []',
  '  evidence: {}',
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

/**
 * The declared adapter set an ordinary activation pins.
 *
 * Authoritative Git alone: a desktop surface would also have to have written a
 * real client registration for this clone to be healthy, and a fixture that
 * pins one without registering it is a *drifted* clone, not a healthy one.
 */
const DECLARED_ADAPTERS = [
  { id: 'git', version: '1.0.0', authoritative: true },
];

/** A supporting surface a later gate release stopped declaring. */
const RETIRED_ADAPTERS = [
  { id: 'git', version: '1.0.0', authoritative: true },
  { id: 'retired-surface', version: '0.1.0', authoritative: false },
];

const activationRequest = (root, overrides = {}) => ({
  scope: 'repository',
  trigger: 'explicit',
  repository: { root },
  configuration: { schemaVersion: 4, policy: gatePolicy() },
  client: { id: 'git', surface: 'git-pre-commit', version: '1.0.0' },
  gate: { ...ACTIVE_RELEASE },
  actor: { name: 'maintainer', source: 'git-config' },
  runtime: {
    runnerVersion: 'change-evaluation-gate/0.9.0',
    hookProgram: { interpreter: process.execPath, script: 'tools/gate-runner.mjs', args: [] },
  },
  checks: [{ id: 'broad_test', evaluate: testCommand() }],
  adapters: DECLARED_ADAPTERS,
  runtimeInputs: [{ name: 'APP_TOKEN', source: 'approved-environment-file' }],
  ...overrides,
});

const storeFor = async (root) => openEvidenceStore({
  repositoryRoot: root,
  runGit,
  identity: {
    actor: { name: 'maintainer', source: 'git-config' },
    client: { id: 'git', surface: 'git-pre-commit', version: '1.0.0' },
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

const SELF_TEST_GUARD = [
  "import { readFileSync } from 'node:fs';",
  '',
  'if (process.env.CHANGE_EVALUATION_GATE_SELF_TEST) {',
  "  const subject = JSON.parse(readFileSync(process.env.CHANGE_EVALUATION_GATE_SELF_TEST, 'utf8'));",
  '  process.stdout.write(`change-evaluation-gate: denied / self-test ${subject.selfTestId}\\n`);',
  '  process.exit(1);',
  '}',
  '',
].join('\n');

/** A clone that is configured and deliberately not activated. */
const configuredClone = async (t) => {
  const root = await throwawayRepository(t);

  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/gate-runner.mjs'), `${SELF_TEST_GUARD}process.exitCode = 0;\n`, 'utf8');
  await writeFile(path.join(root, '.agent-framework.yaml'), SHARED_CONFIGURATION, 'utf8');

  return root;
};

/** A guarded activation: no fixture may activate anything outside a throwaway clone. */
const activatedClone = async (t, overrides = {}) => {
  const root = await configuredClone(t);
  const store = await storeFor(root);
  const request = activationRequest(root, overrides);
  const preview = await previewActivation(request, activationDependencies());

  await assertThrowawayRepository(root);

  const result = await activate({
    ...request,
    consent: {
      previewId: preview.previewId,
      repositoryIdentity: preview.repository.identity,
      configurationIdentity: preview.configuration.identity,
      actor: { name: 'maintainer', source: 'git-config' },
      grantedAt: '2026-08-11T00:00:00.000Z',
    },
  }, activationDependencies({ evidenceStore: store }));

  assert.equal(result.activated, true, `The fixture failed to activate: ${result.reasonCode}.`);

  return { root, store, receipt: result.receipt };
};

/**
 * Every file AND every directory in the whole clone, by relative path and
 * bytes. Directories are included deliberately: a command that creates an
 * empty directory has still written to the clone, and a file-only snapshot
 * would not see it.
 */
const wholeCloneSnapshot = async (root, { directories = true } = {}) => {
  const entries = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (directories) {
          entries.push([path.relative(root, absolute), '<directory>']);
        }

        await walk(absolute);
      } else if (entry.isFile()) {
        entries.push([
          path.relative(root, absolute),
          await readFile(absolute, 'base64').catch(() => null),
        ]);
      }
    }
  };

  await walk(root);

  return JSON.stringify(entries.sort(([left], [right]) => left.localeCompare(right)));
};

/** Every file in the whole clone. Nothing this slice adds may change one byte. */
const everyFile = (root) => wholeCloneSnapshot(root, { directories: false });

const observe = (root, argv) => runOperatorCommand({
  cwd: root,
  argv,
  environment: isolatedGitEnvironment(),
});

/**
 * Every file and directory in the clone EXCEPT the append-only Evidence store.
 *
 * A refusal is required to leave a record (`NFR-AUD-001`), so "wrote nothing"
 * cannot mean "no byte anywhere changed" without also meaning "the refusal was
 * never recorded". This snapshot is the honest form of the claim: nothing the
 * operation would have acted on changed, and the store's own contents are
 * asserted separately and precisely.
 */
const cloneOutsideEvidence = async (root, storeRoot) => {
  const entries = JSON.parse(await wholeCloneSnapshot(root));
  const relativeStore = path.relative(root, storeRoot);

  return JSON.stringify(entries.filter(([entryPath]) => entryPath !== relativeStore
    && !entryPath.startsWith(`${relativeStore}${path.sep}`)));
};

/** Everything about a store that a refusal must leave exactly as it found it. */
const storeContents = async (store) => JSON.stringify({
  blobs: (await store.listBlobs()).map((blob) => blob.blobId ?? blob.identity).sort(),
  log: (await store.readLog()).length,
  tombstones: (await store.readTombstones()).length,
  receipt: await store.activationReceipt().read(),
});

/** The token the preview just printed, which a later invocation must reproduce. */
const tokenOf = (result) => {
  assert.match(
    result.document.observation.confirmationToken,
    /^sha256:[0-9a-f]{64}$/,
    `\`gate ${result.document.command}\` previewed without a confirmation token.`,
  );

  return result.document.observation.confirmationToken;
};

/**
 * THE FIRST RED TEST.
 *
 * Running the observation command against an activated clone reports its
 * health and writes nothing, where before this slice no such command existed
 * and an agent had to import `lifecycle.mjs` and reconstruct its argument
 * shapes from this suite (`FR-LIFE-009`, `AC-LIFE-004`, `SG-LIFE-001`).
 */
test('the observation command reports an activated clone\'s health and writes nothing', async (t) => {
  const { root } = await activatedClone(t);
  const before = await wholeCloneSnapshot(root);

  const result = await observe(root, ['status']);

  assert.equal(result.exitCode, EXIT_OBSERVED);
  assert.equal(result.document.command, 'status');
  assert.equal(result.document.observation.state, 'activated');
  assert.equal(result.document.observation.health, 'healthy');
  assert.equal(result.document.observation.repaired, false);
  assert.deepEqual(result.document.observation.mutations, []);
  assert.match(result.stdout, /healthy/);
  assert.equal(result.stderr, '');

  // Not one byte, and not one directory.
  assert.equal(await wholeCloneSnapshot(root), before);

  // Repeated observation is still observation.
  await observe(root, ['status']);
  await observe(root, ['status', '--json']);

  assert.equal(await wholeCloneSnapshot(root), before);
});

test('the health command grades degraded and broken, and every grade leaves the clone unchanged', async (t) => {
  const { root, store } = await activatedClone(t, { adapters: RETIRED_ADAPTERS });
  const before = await wholeCloneSnapshot(root);

  // A supporting surface this gate no longer declares costs the clone a
  // surface, not its authority.
  const degraded = await observe(root, ['status']);

  assert.equal(degraded.document.observation.health, 'degraded');
  assert.equal(degraded.exitCode, EXIT_UNHEALTHY);
  assert.deepEqual(
    degraded.document.observation.findings.map((finding) => finding.code),
    ['adapter-lost'],
  );
  assert.equal(await wholeCloneSnapshot(root), before);

  // Losing the authoritative registration means the gate enforces nothing it
  // claims to enforce.
  const hookPath = (await store.activationReceipt().read()).hooks[0].path;
  const registered = await readFile(hookPath, 'utf8');

  await rm(hookPath, { force: true });

  const brokenBefore = await wholeCloneSnapshot(root);
  const broken = await observe(root, ['status']);

  assert.equal(broken.document.observation.health, 'broken');
  assert.equal(broken.exitCode, EXIT_UNHEALTHY);
  assert.equal(broken.document.observation.findings[0].code, 'hook-absent');
  assert.equal(broken.document.observation.repaired, false);

  // The drift is reported, never repaired: the hook is still gone.
  assert.equal(await wholeCloneSnapshot(root), brokenBefore);
  assert.equal(await readFile(hookPath, 'utf8').catch(() => null), null);
  assert.notEqual(registered, null);
});

test('a configured clone that was never activated observes as configured, and no Evidence store is created', async (t) => {
  const root = await configuredClone(t);
  const before = await wholeCloneSnapshot(root);

  const result = await observe(root, ['status']);

  assert.equal(result.exitCode, EXIT_OBSERVED);
  assert.equal(result.document.observation.state, 'configured');
  assert.equal(result.document.observation.health, 'healthy');
  assert.equal(result.document.observation.findings[0].code, 'activation-absent');

  // Observing a clone that has no Evidence store does not give it one.
  assert.equal(await wholeCloneSnapshot(root), before);
});

test('both renderings of one invocation agree (NFR-OPER-001)', async (t) => {
  const { root, store } = await activatedClone(t, { adapters: RETIRED_ADAPTERS });

  await store.appendEvidence({
    decision: { evaluationId: `sha256:${'1'.repeat(64)}`, outcome: 'pass' },
    outputs: [{ checkId: 'broad_test', attempt: 1, text: 'output\n'.repeat(8) }],
  });

  for (const argv of [['status'], ['locks'], ['prune']]) {
    const human = await observe(root, argv);
    const machine = await observe(root, [...argv, '--json']);

    // One code path, two renderings: the machine document IS the document the
    // human rendering was made from.
    assert.deepEqual(JSON.parse(machine.stdout), machine.document);
    assert.equal(human.exitCode, machine.exitCode);
    assert.equal(human.document.command, machine.document.command);
    assert.equal(human.document.ok, machine.document.ok);

    // Every named finding the document carries is named in the human text too;
    // no finding is machine-only, and none is prose-only.
    for (const finding of human.document.observation.findings ?? []) {
      assert.ok(
        human.stdout.includes(finding.code),
        `The human rendering of ${argv[0]} does not name ${finding.code}.`,
      );
      assert.ok(
        human.stdout.includes(finding.detail),
        `The human rendering of ${argv[0]} does not state ${finding.code}'s detail.`,
      );
    }

    // The trust boundary travels with both renderings (SG-TRUST-001).
    assert.equal(human.document.trustBoundary.model, 'cooperative-local-process');
    assert.ok(human.stdout.includes(human.document.trustBoundary.statement));
  }
});

test('the lock command reports a free lock, a live holder, and a stale holder, and recovers nothing (AC-COORD-001)', async (t) => {
  const { root, store } = await activatedClone(t);
  const virginFiles = await everyFile(root);
  const virginTree = await wholeCloneSnapshot(root);

  // FREE.
  const first = await observe(root, ['locks']);

  // Inspection writes no file — not the lock, not a record, not an event.
  assert.equal(await everyFile(root), virginFiles);

  // FIXED IN TB-041: `inspectCoordination` opens the lock through
  // `openCoordinationLock`, which used to ensure the coordination directory
  // existed before it read anything — so the first `gate locks` on a clone that
  // had never taken a lock created one empty directory. Directory creation
  // moved to the two paths that actually write (acquisition and stale
  // recovery), and inspection now creates nothing at all.
  assert.equal(
    await wholeCloneSnapshot(root),
    virginTree,
    'Inspecting the lock created something in the clone.',
  );

  assert.equal(first.exitCode, EXIT_OBSERVED);
  assert.equal(first.document.observation.held, false);
  assert.equal(first.document.observation.acquired, false);
  assert.equal(first.document.observation.recovered, false);
  assert.equal(first.document.observation.action, null);

  const free = await wholeCloneSnapshot(root);

  assert.equal((await observe(root, ['locks'])).document.observation.held, false);
  assert.equal(await wholeCloneSnapshot(root), free);

  // LIVE. A holder this machine can see running is nobody's to take.
  const lock = await openCoordinationLock({ repositoryRoot: root, runGit, store });
  const held = await lock.acquire({ bindingKey: 'fixture', executionId: 'fixture', role: 'authoritative' });

  assert.equal(held.acquired, true);

  const liveBefore = await wholeCloneSnapshot(root);
  const live = await observe(root, ['locks']);

  assert.equal(live.exitCode, EXIT_OBSERVED);
  assert.equal(live.document.observation.held, true);
  assert.equal(live.document.observation.stale, false);
  assert.equal(live.document.observation.acquired, false);
  assert.equal(live.document.observation.recovered, false);
  assert.equal(live.document.observation.action, null);
  assert.equal(live.document.observation.holder.pid, process.pid);
  assert.equal(await wholeCloneSnapshot(root), liveBefore);
  assert.equal((await lock.readRecord()).lockId, held.record.lockId);

  // STALE. The same holder, with a heartbeat far enough in the past that no
  // reader can still believe in it.
  const lockPath = live.document.observation.lockPath;
  const record = JSON.parse(await readFile(lockPath, 'utf8'));

  await writeFile(
    lockPath,
    JSON.stringify({ ...record, heartbeatAt: '2000-01-01T00:00:00.000Z' }),
    'utf8',
  );

  const staleBefore = await wholeCloneSnapshot(root);
  const stale = await observe(root, ['locks']);

  assert.equal(stale.document.observation.held, true);
  assert.equal(stale.document.observation.stale, true);
  assert.ok(stale.document.observation.staleReasons.includes('heartbeat-expired'));
  assert.match(stale.document.observation.recoveryToken, /^sha256:[0-9a-f]{64}$/);
  assert.equal(stale.document.observation.recovered, false);
  assert.equal(stale.document.observation.action, 'gate locks --recover');

  // A stale lock is a clone that needs attention, not a failed invocation.
  assert.equal(stale.exitCode, EXIT_UNHEALTHY);

  // And inspection took nothing: the stale record is still exactly there.
  assert.equal(await wholeCloneSnapshot(root), staleBefore);

  await rm(lockPath, { force: true });
  await held.release().catch(() => null);
});

test('the prune preview names the exact blobs and bytes, returns its token, and removes nothing (AC-EVID-002)', async (t) => {
  const { root, store } = await activatedClone(t);

  for (const index of [1, 2]) {
    await store.appendEvidence({
      decision: { evaluationId: `sha256:${String(index).repeat(64)}`, outcome: 'pass' },
      outputs: [{ checkId: 'broad_test', attempt: index, text: `output ${index}\n`.repeat(8) }],
    });
  }

  const blobsBefore = await store.listBlobs();
  const logBefore = (await store.readLog()).length;
  const eventsBefore = (await store.readEvents()).length;
  const before = await wholeCloneSnapshot(root);

  assert.equal(blobsBefore.length, 2);

  const preview = await observe(root, ['prune', '--before', '2999-01-01T00:00:00.000Z']);

  assert.equal(preview.exitCode, EXIT_OBSERVED);
  assert.equal(preview.document.observation.blobs.length, 2);
  assert.ok(preview.document.observation.totalBytes > 0);
  assert.match(preview.document.observation.confirmationToken, /^sha256:[0-9a-f]{64}$/);
  assert.equal(preview.document.observation.removed, false);
  assert.equal(preview.document.observation.action, 'gate prune --confirm');

  // The exact blobs, by identity and bytes.
  assert.deepEqual(
    preview.document.observation.blobs.map((blob) => blob.blobId).sort(),
    blobsBefore.map((blob) => blob.blobId ?? blob.identity).sort(),
  );

  // A preview removes nothing and appends nothing.
  assert.equal((await store.listBlobs()).length, 2);
  assert.equal((await store.readLog()).length, logBefore);
  assert.equal((await store.readEvents()).length, eventsBefore);
  assert.equal((await store.readTombstones()).length, 0);
  assert.equal(await wholeCloneSnapshot(root), before);

  // A narrower selector previews less, and still removes nothing.
  const narrowed = await observe(root, ['prune', '--evaluation', `sha256:${'1'.repeat(64)}`]);

  assert.equal(narrowed.document.observation.blobs.length, 1);
  assert.equal(await wholeCloneSnapshot(root), before);
});

test('the surface refuses every mutating selector, flag, and confirmation token, and says which operation owns it', async (t) => {
  const { root } = await activatedClone(t);
  const before = await wholeCloneSnapshot(root);
  const token = `sha256:${'f'.repeat(64)}`;

  const refusals = [
    // Two operations this surface still does not perform, refused by name.
    [['activate'], 'gate activate'],
    [['fix'], 'gate fix'],
    // A selector that names another command's work. `gate status` never
    // repairs as a side effect, whatever it is asked with.
    [['status', '--repair'], 'gate repair'],
    [['status', '--fix'], 'gate fix'],
    // A bare token is not a confirmation: it has to name the selector it
    // confirms, so a stray argument can never be spent as one.
    [['prune', token], 'gate prune --confirm <token>'],
    [['repair', token], 'gate repair --confirm <token>'],
    [['locks', token], 'gate locks --recover <token>'],
  ];

  for (const [argv, owner] of refusals) {
    const refused = await observe(root, argv);

    assert.equal(refused.exitCode, EXIT_UNRUNNABLE, `${argv.join(' ')} was not refused.`);
    assert.equal(refused.document.ok, false);
    assert.equal(
      refused.document.failure.ownedBy,
      owner,
      `${argv.join(' ')} did not name ${owner} as the operation that owns it.`,
    );
    assert.ok(
      refused.stderr.includes(owner),
      `${argv.join(' ')} did not say which operation owns it.`,
    );
    assert.equal(refused.stdout, '');
  }

  // Nothing can be forced, because nothing here changes anything.
  for (const flag of ['--force', '--yes']) {
    const forced = await observe(root, ['status', flag]);

    assert.equal(forced.exitCode, EXIT_UNRUNNABLE);
    assert.equal(forced.document.failure.reasonCode, 'mutation-refused');
    assert.equal(forced.document.failure.ownedBy, null);
  }

  // The refusals stayed data, and TB-041 moved entries OUT of these tables and
  // into the command registry rather than adding a second parser beside them.
  assert.deepEqual(CONFIRMED_COMMANDS, { activate: 'gate activate', fix: 'gate fix' });
  assert.deepEqual(CONFIRMED_SELECTORS, { '--repair': 'gate repair', '--fix': 'gate fix' });
  assert.equal(CONFIRMED_SELECTORS['--recover'], undefined);
  assert.equal(CONFIRMED_COMMANDS.repair, undefined);
  assert.deepEqual(
    [...COMMANDS],
    ['status', 'locks', 'prune', 'repair', 'update', 'deactivate', 'uninstall', 'cleanup'],
  );

  // Exactly one command has no confirmed form, and it is the one that must go
  // on recording nothing at all.
  assert.deepEqual(
    COMMANDS.filter((command) => !(command in CONFIRMABLE_COMMANDS)),
    ['status'],
  );

  // Every refusal above ran against a real activated clone and left it alone.
  assert.equal(await wholeCloneSnapshot(root), before);
});

test('an unhealthy clone and a failed invocation are distinguishable by exit status alone', async (t) => {
  const { root, store } = await activatedClone(t);

  await rm((await store.activationReceipt().read()).hooks[0].path, { force: true });

  const unhealthy = await observe(root, ['status']);

  // A clone outside any Git repository: the command could not run at all.
  const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-operator-outside-')));

  t.after(() => rm(outside, { recursive: true, force: true }));

  const failed = await observe(outside, ['status']);
  const unknown = await observe(root, ['nonsense']);

  assert.equal(unhealthy.exitCode, EXIT_UNHEALTHY);
  assert.equal(failed.exitCode, EXIT_UNRUNNABLE);
  assert.equal(unknown.exitCode, EXIT_UNRUNNABLE);
  assert.notEqual(EXIT_UNHEALTHY, EXIT_UNRUNNABLE);
  assert.notEqual(EXIT_OBSERVED, EXIT_UNHEALTHY);

  // An unhealthy clone still produced an observation; a failed invocation did
  // not, and says so in a named field rather than in prose.
  assert.equal(unhealthy.document.observation.health, 'broken');
  assert.equal(failed.document.observation, null);
  assert.equal(failed.document.failure.reasonCode, 'repository-unresolved');
  assert.equal(unknown.document.failure.reasonCode, 'unknown-command');
});

test('the command reports the same health the lifecycle library does, from the same clone', async (t) => {
  const { root, store } = await activatedClone(t);

  const command = await observe(root, ['status']);
  const library = await statusGate({ evidenceStore: store, repositoryRoot: root });
  const locksCommand = await observe(root, ['locks']);
  const locksLibrary = await inspectCoordination({ repositoryRoot: root, runGit });

  assert.equal(command.document.observation.health, library.status);
  assert.equal(command.document.observation.state, library.state);
  assert.equal(locksCommand.document.observation.held, locksLibrary.held);
  assert.equal(locksCommand.document.observation.lockPath, locksLibrary.lockPath);
});

test('the packaged entry point is the command a maintainer and an agent both run', async (t) => {
  const { root } = await activatedClone(t);
  const before = await wholeCloneSnapshot(root);

  await access(PACKAGED_COMMAND, constants.X_OK);

  const manifest = JSON.parse(await readFile(path.join(FRAMEWORK_ROOT, 'package.json'), 'utf8'));

  assert.equal(
    manifest.bin['change-evaluation-gate'],
    'skills/change-evaluation-gate/scripts/gate.mjs',
  );
  assert.equal(
    manifest.scripts.gate,
    'node skills/change-evaluation-gate/scripts/gate.mjs',
  );

  const { stdout } = await runFile(process.execPath, [PACKAGED_COMMAND, 'status', '--json'], {
    cwd: root,
    env: isolatedGitEnvironment(),
  });
  const document = JSON.parse(stdout);

  assert.equal(document.command, 'status');
  assert.equal(document.observation.health, 'healthy');
  assert.equal(document.exitStatus, EXIT_OBSERVED);

  // A broken clone exits non-zero through the packaged program too, and the
  // exit status is the branch an agent takes without parsing anything.
  await rm(path.join(root, '.git', 'hooks', 'pre-commit'), { force: true });

  const failure = await runFile(process.execPath, [PACKAGED_COMMAND, 'status'], {
    cwd: root,
    env: isolatedGitEnvironment(),
  }).catch((error) => error);

  assert.equal(failure.code, EXIT_UNHEALTHY);
  assert.match(failure.stdout, /broken/);

  // `--help` is the only thing this surface offers that is not an observation,
  // and it never touches the clone.
  const help = await runFile(process.execPath, [PACKAGED_COMMAND, '--help'], {
    cwd: root,
    env: isolatedGitEnvironment(),
  });

  assert.match(help.stdout, /gate status/);
  assert.match(help.stdout, /gate locks/);
  assert.match(help.stdout, /gate prune/);
  assert.notEqual(before, null);
});

/* ------------------------------------------------------------------------- *
 * TB-041 — the half of the lifecycle that writes.
 * ------------------------------------------------------------------------- */

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

/** The shared configuration file, with keys on both sides of the Gate's own. */
const POPULATED_CONFIGURATION = `${SHARED_CONFIGURATION}history:\n  path: docs/history\n  required: true\n`;

/** The hook program this suite's fixtures really register, named for a repair. */
const FIXTURE_HOOK_SCRIPT = 'tools/gate-runner.mjs';

/**
 * An activated clone that already had a hook chain, an unrelated hook, a shared
 * configuration file with keys the Gate does not own, historical Evidence, a
 * project-installed asset, and a global asset outside the project.
 *
 * The gate-owned registration here is a MARKER-DELIMITED BLOCK composed into
 * somebody else's hook, which is the shape `AC-LIFE-010` is about: the clobbered
 * managed block, restored to exactly what the receipt authorizes and to nothing
 * else.
 */
const populatedClone = async (t, overrides = {}) => {
  const root = await throwawayRepository(t);
  const globalAssets = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-operator-global-')));

  t.after(() => rm(globalAssets, { recursive: true, force: true }));
  await assertThrowawayRepository(globalAssets);

  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, FIXTURE_HOOK_SCRIPT), `${SELF_TEST_GUARD}process.exitCode = 0;\n`, 'utf8');
  await writeFile(path.join(root, '.agent-framework.yaml'), POPULATED_CONFIGURATION, 'utf8');
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

  const request = activationRequest(root, overrides);
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

  return {
    root,
    store,
    globalAssets,
    hooksDirectory,
    hookPath: path.join(hooksDirectory, 'pre-commit'),
    projectAsset: path.join(root, '.claude/skills/gate.md'),
    configuration: path.join(root, '.agent-framework.yaml'),
    receipt: result.receipt,
  };
};

/** Make a clone stop matching a preview it has already produced. */
const STALE_SCENARIOS = [
  {
    command: 'repair',
    argv: ['repair', '--hook-script', FIXTURE_HOOK_SCRIPT],
    prepare: async ({ hookPath }) => {
      // Somebody neuters the gate-owned block without disturbing its markers.
      const composed = await readFile(hookPath, 'utf8');

      await writeFile(hookPath, composed.replace(/\|\| exit \$\?/, '|| true'), 'utf8');
    },
    invalidate: async ({ hookPath }) => {
      // And then the whole registration goes, so the drift the operator read
      // (`hook-block-tampered`) is not the drift this clone now has
      // (`hook-absent`) and the repair they were shown is a different repair.
      await writeFile(hookPath, PRIOR_HOOK, 'utf8');
    },
    reasonCode: 'preview-mismatch',
    eventType: 'repair',
  },
  {
    command: 'update',
    argv: ['update'],
    invalidate: async ({ store }) => {
      // The Active gate release moved underneath the operator, so the release
      // the preview proposed to move FROM is not the one this clone is on.
      const receipt = await store.activationReceipt().read();

      await writeFile(
        store.paths.activationReceipt,
        `${JSON.stringify({
          ...receipt,
          runtime: { ...receipt.runtime, gate: { ...receipt.runtime.gate, version: '0.7.0' } },
        })}\n`,
        'utf8',
      );
    },
    reasonCode: 'update-preview-mismatch',
    eventType: 'update',
    // `updateGate` records a refused update as `failed`, which is its own
    // vocabulary and not this surface's to restate.
    eventOutcome: 'failed',
  },
  {
    command: 'deactivate',
    argv: ['deactivate'],
    invalidate: async ({ hookPath }) => {
      const composed = await readFile(hookPath, 'utf8');

      await writeFile(hookPath, composed.replace(/\|\| exit \$\?/, '|| true'), 'utf8');
    },
    reasonCode: 'preview-mismatch',
    eventType: 'removal',
  },
  {
    command: 'uninstall',
    argv: (fixture) => ['uninstall', '--asset', fixture.projectAsset],
    invalidate: async ({ projectAsset }) => {
      await writeFile(projectAsset, '# the maintainer has since made this theirs\n', 'utf8');
    },
    reasonCode: 'preview-mismatch',
    eventType: 'removal',
  },
  {
    command: 'cleanup',
    argv: ['cleanup'],
    invalidate: async ({ configuration }) => {
      const contents = await readFile(configuration, 'utf8');

      await writeFile(configuration, `${contents}# somebody else edited this file\n`, 'utf8');
    },
    reasonCode: 'preview-mismatch',
    eventType: 'removal',
  },
  {
    command: 'prune',
    argv: ['prune', '--before', '2999-01-01T00:00:00.000Z'],
    invalidate: async ({ store }) => {
      await store.appendEvidence({
        decision: { evaluationId: `sha256:${'9'.repeat(64)}`, outcome: 'pass' },
        outputs: [{ checkId: 'broad_test', attempt: 2, text: 'appended after the preview\n' }],
      });
    },
    reasonCode: 'preview-mismatch',
    eventType: 'pruning',
  },
  {
    command: 'locks',
    argv: ['locks'],
    prepare: async ({ root, store }) => {
      // A holder that stopped heartbeating long enough ago that no reader can
      // still believe in it.
      const lock = await openCoordinationLock({ repositoryRoot: root, runGit, store });
      const held = await lock.acquire({ bindingKey: 'fixture', executionId: 'fixture', role: 'authoritative' });

      assert.equal(held.acquired, true);

      const record = JSON.parse(await readFile(lock.lockPath, 'utf8'));

      await writeFile(
        lock.lockPath,
        JSON.stringify({ ...record, heartbeatAt: '2000-01-01T00:00:00.000Z' }),
        'utf8',
      );
    },
    invalidate: async ({ root, store }) => {
      const lock = await openCoordinationLock({ repositoryRoot: root, runGit, store });
      const record = JSON.parse(await readFile(lock.lockPath, 'utf8'));

      // A different abandoned holder. The token the operator was shown was the
      // identity of the one they read, and this is not it.
      await writeFile(lock.lockPath, JSON.stringify({ ...record, pid: record.pid + 1 }), 'utf8');
    },
    reasonCode: 'recovery-mismatch',
    eventType: 'stale-lock-recovery',
    // A stale lock IS a clone that needs an operator, so even its preview says
    // so in the exit status.
    previewExit: EXIT_UNHEALTHY,
  },
];

/**
 * THE FIRST RED TEST OF TB-041.
 *
 * A confirmation that names a preview this clone no longer matches performs no
 * write and returns a stated refusal — for EVERY operation that writes, driven
 * through the command surface rather than through the library, because the
 * question this asks is whether an operator could assemble the arguments at
 * all and whether a preview survives a round trip through a shell. Both are
 * invisible to a test that constructs the preview object and hands it straight
 * back in the same function scope (`NFR-REL-002`, `AC-LIFE-010`, `AC-EVID-002`,
 * `FR-COORD-005`).
 */
for (const scenario of STALE_SCENARIOS) {
  test(`a confirmation naming a preview this clone no longer matches performs no write: gate ${scenario.command}`, async (t) => {
    const fixture = await populatedClone(t);
    const { root, store } = fixture;
    const argv = typeof scenario.argv === 'function' ? scenario.argv(fixture) : scenario.argv;

    await scenario.prepare?.(fixture);

    // 1. The operator reads a preview, and it writes nothing.
    const beforePreview = await wholeCloneSnapshot(root);
    const preview = await observe(root, argv);

    assert.equal(
      preview.exitCode,
      scenario.previewExit ?? EXIT_OBSERVED,
      `\`gate ${scenario.command}\` could not preview.`,
    );
    assert.equal(preview.document.mutation, null, 'A preview reported a mutation.');
    assert.equal(await wholeCloneSnapshot(root), beforePreview);

    const token = tokenOf(preview);

    // 2. The clone stops matching what they read.
    await scenario.invalidate(fixture);

    const cloneBefore = await cloneOutsideEvidence(root, store.paths.root);
    const contentsBefore = await storeContents(store);
    const eventsBefore = (await store.readEvents()).length;

    // 3. The confirmation they were holding is refused.
    const confirmed = await observe(root, [...argv, CONFIRMABLE_COMMANDS[scenario.command], token]);

    assert.equal(
      confirmed.exitCode,
      EXIT_UNHEALTHY,
      `\`gate ${scenario.command}\` did not report a refusal as a clone needing attention.`,
    );
    assert.equal(confirmed.document.ok, false);
    assert.equal(confirmed.document.failure, null, 'A refusal was reported as a failed invocation.');
    assert.equal(confirmed.document.mutation.performed, false);
    assert.equal(confirmed.document.mutation.reasonCode, scenario.reasonCode);
    assert.equal(confirmed.document.mutation.confirmation, token);

    // The refusal is stated, not implied: a person reads why in the rendering.
    assert.match(confirmed.stdout, /performed: false/);
    assert.ok(confirmed.stdout.includes(scenario.reasonCode));

    // 4. Nothing was written. Not the hook, not the configuration, not the
    //    asset, not the receipt, not one blob.
    assert.equal(
      await cloneOutsideEvidence(root, store.paths.root),
      cloneBefore,
      `\`gate ${scenario.command}\` changed the clone while refusing.`,
    );
    assert.equal(
      await storeContents(store),
      contentsBefore,
      `\`gate ${scenario.command}\` changed the Evidence store while refusing.`,
    );

    // 5. And the refusal was recorded as a refusal, rather than silently
    //    (`NFR-AUD-001`).
    const events = await store.readEvents();

    assert.ok(
      events.length > eventsBefore,
      `\`gate ${scenario.command}\` refused without recording anything.`,
    );
    assert.equal(events.at(-1).type, scenario.eventType);
    assert.equal(events.at(-1).outcome, scenario.eventOutcome ?? 'refused');
    assert.deepEqual(validateLifecycleEvent(events.at(-1)), []);
  });
}

test('the surface refuses any single invocation that would both preview and confirm, and says why', async (t) => {
  const { root, store } = await populatedClone(t);
  const before = await wholeCloneSnapshot(root);
  const token = `sha256:${'a'.repeat(64)}`;

  for (const [command, selector] of Object.entries(CONFIRMABLE_COMMANDS)) {
    // A confirmation with nothing to confirm could only mean "preview, then
    // obey your own preview", which puts the decision inside this process.
    const bare = await observe(root, [command, selector]);

    assert.equal(bare.exitCode, EXIT_UNRUNNABLE, `\`gate ${command} ${selector}\` was not refused.`);
    assert.equal(bare.document.failure.reasonCode, 'preview-and-confirm-refused');
    assert.equal(bare.document.failure.ownedBy, `gate ${command} ${selector} <token>`);
    assert.match(bare.stderr, /never previews and confirms in one invocation/);
    assert.equal(bare.document.mutation, null);

    // And asking for both explicitly is refused for the same stated reason.
    const both = await observe(root, [command, '--preview', selector, token]);

    assert.equal(both.exitCode, EXIT_UNRUNNABLE);
    assert.equal(both.document.failure.reasonCode, 'preview-and-confirm-refused');
    assert.match(both.stderr, /two separate runs/);

    // `--preview` alone is simply the default, spelled out.
    const explicit = await observe(root, [command, '--preview']);

    assert.equal(explicit.document.mutation, null);
  }

  // Something that is not a token is never accepted as one, so a shell that
  // dropped or mangled a token cannot be read as an approval.
  for (const value of ['yes', 'sha256:short', `sha256:${'g'.repeat(64)}`]) {
    const malformed = await observe(root, ['prune', '--confirm', value]);

    assert.equal(malformed.exitCode, EXIT_UNRUNNABLE);
    assert.equal(malformed.document.failure.reasonCode, 'selector-invalid');
  }

  // Every refusal above ran against a real activated clone and left it alone —
  // and none of them was recorded, because none of them reached an operation.
  assert.equal(await wholeCloneSnapshot(root), before);
  assert.equal((await store.readEvents()).filter((event) => event.outcome === 'refused').length, 0);
});

test('AC-LIFE-010 / FR-LIFE-019: a clobbered managed block is restored by a confirmed repair, and by nothing else', async (t) => {
  const { root, store, hookPath, configuration, projectAsset } = await populatedClone(t);
  const registered = await readFile(hookPath, 'utf8');
  const receipt = await store.activationReceipt().read();

  // Somebody clobbers the gate-owned block, leaving the markers in place.
  const clobbered = registered.replace(/\|\| exit \$\?/, '|| true');

  assert.notEqual(clobbered, registered);
  await writeFile(hookPath, clobbered, 'utf8');

  assert.equal((await observe(root, ['status'])).document.observation.health, 'broken');

  // EVERY OTHER COMMAND leaves the drift exactly where it found it.
  for (const argv of [
    ['status'],
    ['locks'],
    ['prune'],
    ['update'],
    ['deactivate'],
    ['cleanup'],
    ['uninstall', '--asset', projectAsset],
    ['repair', '--hook-script', FIXTURE_HOOK_SCRIPT],
  ]) {
    await observe(root, argv);

    assert.equal(
      await readFile(hookPath, 'utf8'),
      clobbered,
      `\`gate ${argv[0]}\` repaired drift without being asked to.`,
    );
  }

  const preview = await observe(root, ['repair', '--hook-script', FIXTURE_HOOK_SCRIPT]);

  assert.deepEqual(preview.document.observation.actions.map((action) => action.code), ['hook-block-tampered']);
  assert.deepEqual(preview.document.observation.unrepairable, []);
  assert.match(preview.stdout, /hook-block-tampered/);
  assert.equal(await readFile(hookPath, 'utf8'), clobbered);

  const repaired = await observe(root, [
    'repair', '--hook-script', FIXTURE_HOOK_SCRIPT, '--confirm', tokenOf(preview),
  ]);

  assert.equal(repaired.exitCode, EXIT_OBSERVED);
  assert.equal(repaired.document.mutation.performed, true);
  assert.deepEqual(repaired.document.mutation.actions.map((action) => action.kind), ['hook-registration']);

  // Restored to EXACTLY what the receipt authorizes, and to nothing else: the
  // repository's own prior chain is still byte for byte itself.
  const restored = await readFile(hookPath, 'utf8');

  assert.equal(restored, registered);
  assert.ok(restored.includes('echo "prior chain" > prior-ran'));
  assert.equal((await observe(root, ['status'])).document.observation.health, 'healthy');

  // Nothing outside the registration was touched by the repair.
  assert.equal(await readFile(configuration, 'utf8'), POPULATED_CONFIGURATION);
  assert.equal(await readFile(projectAsset, 'utf8'), '# project asset\n');
  assert.equal((await store.activationReceipt().read()).receiptId, receipt.receiptId);

  const events = await store.readEvents();

  assert.equal(events.at(-1).type, 'repair');
  assert.equal(events.at(-1).outcome, 'succeeded');

  // A repair with nothing left to repair is refused rather than reapplied.
  const again = await observe(root, ['repair', '--hook-script', FIXTURE_HOOK_SCRIPT]);

  assert.deepEqual(again.document.observation.actions, []);
  assert.match(again.stdout, /nothing to repair/);
});

test('a repair that cannot reproduce the pinned registration writes nothing and says so', async (t) => {
  const { root, store, hookPath } = await populatedClone(t);
  const registered = await readFile(hookPath, 'utf8');

  await writeFile(hookPath, registered.replace(/\|\| exit \$\?/, '|| true'), 'utf8');

  const drifted = await readFile(hookPath, 'utf8');
  // No `--hook-script`, so the surface states its honest default — the packaged
  // runner beside it — which is not the program this fixture registered.
  const preview = await observe(root, ['repair']);

  assert.ok(preview.document.observation.hookProgram.script.endsWith('gate-precommit.mjs'));

  const refused = await observe(root, ['repair', '--confirm', tokenOf(preview)]);

  assert.equal(refused.exitCode, EXIT_UNHEALTHY);
  assert.equal(refused.document.mutation.performed, false);
  assert.equal(refused.document.mutation.reasonCode, 'repair-refused');
  assert.deepEqual(
    refused.document.mutation.errors.map((error) => error.reason),
    ['registration-not-reproducible'],
  );

  // A repair it cannot prove is a repair it does not perform.
  assert.equal(await readFile(hookPath, 'utf8'), drifted);
  assert.equal((await store.readEvents()).at(-1).outcome, 'refused');
});

test('AC-LIFE-005: deactivation withdraws only gate-owned state, and uninstall only unchanged project assets', async (t) => {
  const fixture = await populatedClone(t);
  const {
    root, store, globalAssets, hooksDirectory, hookPath, projectAsset, configuration, receipt,
  } = fixture;
  const globalAsset = path.join(globalAssets, 'gate.md');
  const historicalBlobs = (await store.listBlobs()).length;
  const historicalLog = (await store.readLog()).length;

  assert.ok(historicalBlobs > 0, 'The fixture recorded no historical Evidence to preserve.');

  // Uninstall refuses first, because an activated clone is never uninstalled
  // out from under its own authoritative hook.
  const early = await observe(root, ['uninstall', '--asset', projectAsset]);
  const earlyRefused = await observe(root, [
    'uninstall', '--asset', projectAsset, '--confirm', tokenOf(early),
  ]);

  assert.equal(earlyRefused.exitCode, EXIT_UNHEALTHY);
  assert.equal(earlyRefused.document.mutation.reasonCode, 'deactivation-required');
  assert.equal(await readFile(projectAsset, 'utf8'), '# project asset\n');

  const preview = await observe(root, ['deactivate']);

  assert.equal(preview.document.observation.receiptId, receipt.receiptId);
  assert.deepEqual(
    preview.document.observation.registrations.map((entry) => entry.present),
    [true],
  );
  assert.ok(preview.document.observation.preserved.includes('historical-evidence'));

  const deactivated = await observe(root, ['deactivate', '--confirm', tokenOf(preview)]);

  assert.equal(deactivated.exitCode, EXIT_OBSERVED);
  assert.equal(deactivated.document.mutation.performed, true);
  assert.deepEqual(
    deactivated.document.mutation.removed.map((entry) => entry.kind).sort(),
    ['activation-receipt', 'hook-registration'],
  );

  // The prior chain is restored byte for byte, the unrelated hook is untouched,
  // and everything else survives.
  assert.equal(await readFile(hookPath, 'utf8'), PRIOR_HOOK);
  assert.equal(await readFile(path.join(hooksDirectory, 'pre-push'), 'utf8'), UNRELATED_HOOK);
  assert.equal(await readFile(configuration, 'utf8'), POPULATED_CONFIGURATION);
  assert.equal(await readFile(globalAsset, 'utf8'), '# global asset\n');
  assert.equal(await readFile(projectAsset, 'utf8'), '# project asset\n');
  assert.equal(await store.activationReceipt().read(), null);
  assert.equal((await store.listBlobs()).length, historicalBlobs);
  assert.equal((await store.readLog()).length, historicalLog);

  // A manifest reaching outside the project refuses the whole uninstall.
  const global = await observe(root, ['uninstall', '--asset', projectAsset, '--asset', globalAsset]);
  const globalRefused = await observe(root, [
    'uninstall', '--asset', projectAsset, '--asset', globalAsset, '--confirm', tokenOf(global),
  ]);

  assert.equal(globalRefused.document.mutation.performed, false);
  assert.equal(globalRefused.document.mutation.reasonCode, 'asset-refused');
  assert.deepEqual(
    globalRefused.document.mutation.refused.map((entry) => entry.reason),
    ['asset-outside-project'],
  );
  assert.equal(await readFile(globalAsset, 'utf8'), '# global asset\n');
  assert.equal(await readFile(projectAsset, 'utf8'), '# project asset\n');

  // So does one that names the shared configuration, or anything historical.
  for (const asset of [configuration, store.paths.log]) {
    const named = await observe(root, ['uninstall', '--asset', asset]);
    const refused = await observe(root, ['uninstall', '--asset', asset, '--confirm', tokenOf(named)]);

    assert.equal(refused.document.mutation.performed, false);
    assert.equal(refused.document.mutation.reasonCode, 'asset-refused');
  }

  assert.equal(await readFile(configuration, 'utf8'), POPULATED_CONFIGURATION);
  assert.equal((await store.readLog()).length, historicalLog);

  // The clean case removes exactly the unchanged project-installed asset.
  const clean = await observe(root, ['uninstall', '--asset', projectAsset]);
  const uninstalled = await observe(root, [
    'uninstall', '--asset', projectAsset, '--confirm', tokenOf(clean),
  ]);

  assert.equal(uninstalled.exitCode, EXIT_OBSERVED);
  assert.equal(uninstalled.document.mutation.performed, true);
  assert.deepEqual(uninstalled.document.mutation.removed.map((entry) => entry.path), [projectAsset]);
  assert.equal(await readFile(projectAsset, 'utf8').catch(() => null), null);

  // Assert the survivors, not merely the Gate's absence.
  assert.equal(await readFile(configuration, 'utf8'), POPULATED_CONFIGURATION);
  assert.equal(await readFile(globalAsset, 'utf8'), '# global asset\n');
  assert.equal(await readFile(hookPath, 'utf8'), PRIOR_HOOK);
  assert.equal(await readFile(path.join(hooksDirectory, 'pre-push'), 'utf8'), UNRELATED_HOOK);
  assert.equal((await store.listBlobs()).length, historicalBlobs);

  // Cleanup removes the Gate's own keys and nothing else, and never the file.
  const cleanupPreview = await observe(root, ['cleanup']);

  assert.deepEqual(cleanupPreview.document.observation.keys.map((key) => key.key), ['evaluation_gate']);

  const cleaned = await observe(root, ['cleanup', '--confirm', tokenOf(cleanupPreview)]);

  assert.equal(cleaned.exitCode, EXIT_OBSERVED);
  assert.deepEqual(cleaned.document.mutation.removedKeys, ['evaluation_gate']);
  assert.equal(cleaned.document.mutation.fileDeleted, false);

  const remaining = await readFile(configuration, 'utf8');

  assert.equal(remaining, [
    'schema_version: 4',
    'backend: laravel',
    'frontend: none',
    'history:',
    '  path: docs/history',
    '  required: true',
    '',
  ].join('\n'));

  // Every removal above is a Lifecycle event; none of them removed Evidence.
  const removals = (await store.readEvents()).filter((event) => event.type === 'removal');

  assert.ok(removals.filter((event) => event.outcome === 'succeeded').length >= 3);
  assert.ok(removals.filter((event) => event.outcome === 'refused').length >= 4);
  assert.equal((await store.listBlobs()).length, historicalBlobs);
});

test('AC-LIFE-007 / FR-LIFE-014: a distribution bump changes nothing until a confirmed update', async (t) => {
  const { root, store, hookPath } = await populatedClone(t);
  const pinned = await readFile(store.paths.activationReceipt, 'utf8');
  const before = await wholeCloneSnapshot(root);

  const preview = await observe(root, ['update']);

  assert.equal(preview.exitCode, EXIT_OBSERVED);
  assert.equal(preview.document.observation.active.version, ACTIVE_RELEASE.version);
  assert.equal(preview.document.observation.candidateAvailable, true);
  assert.notEqual(preview.document.observation.candidate.version, ACTIVE_RELEASE.version);

  // The candidate is what the INSTALLED distribution offers, read from its own
  // manifest rather than declared by this test.
  assert.ok(preview.document.observation.distribution.manifest.endsWith('package.json'));
  assert.equal(
    preview.document.observation.candidate.version,
    JSON.parse(await readFile(path.join(FRAMEWORK_ROOT, 'package.json'), 'utf8')).version,
  );

  // Seeing a newer distribution advances nothing.
  assert.equal(preview.document.observation.advancesActiveRelease, false);
  assert.equal(preview.document.mutation, null);
  assert.equal(await wholeCloneSnapshot(root), before);

  // Repeated previews still advance nothing.
  await observe(root, ['update']);
  await observe(root, ['update', '--json']);

  assert.equal(await readFile(store.paths.activationReceipt, 'utf8'), pinned);

  const updated = await observe(root, ['update', '--confirm', tokenOf(preview)]);

  assert.equal(updated.exitCode, EXIT_OBSERVED);
  assert.equal(updated.document.mutation.performed, true);
  assert.equal(updated.document.mutation.step, 'release-switch');
  assert.deepEqual(
    updated.document.mutation.order,
    ['preview', 'compatibility', 'migration', 'self-test', 'release-switch'],
  );

  const receipt = await store.activationReceipt().read();

  assert.equal(receipt.runtime.gate.version, preview.document.observation.candidate.version);
  assert.equal(receipt.supersedes.previewId, tokenOf(preview));

  // And the update repaired nothing on its way past: the registration on disk
  // still names the receipt that authorized it (`FR-LIFE-019`).
  assert.ok((await readFile(hookPath, 'utf8')).includes('echo "prior chain" > prior-ran'));
  assert.equal((await observe(root, ['status'])).document.observation.health, 'healthy');

  const updates = (await store.readEvents()).filter((event) => event.type === 'update');

  assert.deepEqual(updates.map((event) => event.outcome), ['succeeded']);
});

test('AC-LIFE-007: a failed update preserves the previous Active gate release', async (t) => {
  // A clone activated against a protocol the installed gate does not speak: an
  // in-place update cannot absorb a protocol change, so it is refused before
  // anything runs.
  const { root, store } = await populatedClone(t, {
    gate: { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '9.9' },
  });
  const pinned = await readFile(store.paths.activationReceipt, 'utf8');
  const preview = await observe(root, ['update']);
  const failed = await observe(root, ['update', '--confirm', tokenOf(preview)]);

  assert.equal(failed.exitCode, EXIT_UNHEALTHY);
  assert.equal(failed.document.mutation.performed, false);
  assert.equal(failed.document.mutation.reasonCode, 'update-incompatible');
  assert.equal(failed.document.mutation.step, 'compatibility');
  assert.equal(failed.document.mutation.state, 'preserved');
  assert.deepEqual(failed.document.mutation.rollback.actions, []);

  // The clone is on exactly the release it was on, by construction rather than
  // by compensation.
  assert.equal(await readFile(store.paths.activationReceipt, 'utf8'), pinned);
  assert.equal((await store.activationReceipt().read()).runtime.gate.version, '0.9.0');

  const updates = (await store.readEvents()).filter((event) => event.type === 'update');

  assert.deepEqual(updates.map((event) => event.outcome), ['failed']);
});

test('AC-EVID-002 / SG-EVID-001: a confirmed prune removes only previewed blobs and writes their tombstones', async (t) => {
  const { root, store } = await populatedClone(t);

  for (const index of [1, 2]) {
    await store.appendEvidence({
      decision: { evaluationId: `sha256:${String(index).repeat(64)}`, outcome: 'pass' },
      outputs: [{ checkId: 'broad_test', attempt: index, text: `output ${index}\n`.repeat(8) }],
    });
  }

  const logBefore = (await store.readLog()).length;
  const blobsBefore = (await store.listBlobs()).map((blob) => blob.blobId ?? blob.identity);

  // One evaluation only: the selector decides, and confirming it may remove
  // nothing that was not previewed.
  const preview = await observe(root, ['prune', '--evaluation', `sha256:${'1'.repeat(64)}`]);
  const previewed = preview.document.observation.blobs.map((blob) => blob.blobId);

  assert.equal(previewed.length, 1);

  const pruned = await observe(root, [
    'prune', '--evaluation', `sha256:${'1'.repeat(64)}`, '--confirm', tokenOf(preview),
  ]);

  assert.equal(pruned.exitCode, EXIT_OBSERVED);
  assert.equal(pruned.document.mutation.performed, true);
  assert.deepEqual(pruned.document.mutation.removed, previewed);
  assert.ok(pruned.document.mutation.reclaimedBytes > 0);
  assert.deepEqual(
    pruned.document.mutation.preserved,
    ['envelopes', 'decisions', 'lifecycle-events', 'pruning-records', 'tombstones'],
  );

  // Exactly the previewed blob, and everything else is still there.
  assert.deepEqual(
    (await store.listBlobs()).map((blob) => blob.blobId ?? blob.identity).sort(),
    blobsBefore.filter((blob) => !previewed.includes(blob)).sort(),
  );
  assert.deepEqual((await store.readTombstones()).map((entry) => entry.blobId), previewed);
  assert.equal((await store.readLog()).length, logBefore);
  assert.notEqual(await store.readEnvelope(`sha256:${'1'.repeat(64)}`), undefined);
  assert.notEqual(await store.activationReceipt().read(), null);
  assert.ok((await store.readEvents()).some(
    (event) => event.type === 'pruning' && event.outcome === 'succeeded',
  ));
});

test('FR-COORD-005: a stale lock is recovered only against its own token, and a live one is never taken', async (t) => {
  const { root, store } = await populatedClone(t);
  const lock = await openCoordinationLock({ repositoryRoot: root, runGit, store });
  const held = await lock.acquire({ bindingKey: 'fixture', executionId: 'fixture', role: 'authoritative' });

  assert.equal(held.acquired, true);

  // A LIVE holder is nobody's to take, however exactly the operator reproduces
  // the token they were shown.
  const live = await observe(root, ['locks']);

  assert.equal(live.document.observation.held, true);
  assert.equal(live.document.observation.stale, false);

  const refusedLive = await observe(root, ['locks', '--recover', tokenOf(live)]);

  assert.equal(refusedLive.exitCode, EXIT_UNHEALTHY);
  assert.equal(refusedLive.document.mutation.performed, false);
  assert.equal(refusedLive.document.mutation.reasonCode, 'lock-not-stale');
  assert.equal((await lock.readRecord()).lockId, held.record.lockId);

  // The same holder, with a heartbeat no reader can still believe in.
  const record = JSON.parse(await readFile(lock.lockPath, 'utf8'));

  await writeFile(
    lock.lockPath,
    JSON.stringify({ ...record, heartbeatAt: '2000-01-01T00:00:00.000Z' }),
    'utf8',
  );

  const stale = await observe(root, ['locks']);

  assert.equal(stale.exitCode, EXIT_UNHEALTHY);
  assert.equal(stale.document.observation.stale, true);
  assert.equal(stale.document.observation.action, 'gate locks --recover');
  assert.match(stale.stdout, /gate locks --recover sha256:/);

  const recovered = await observe(root, ['locks', '--recover', tokenOf(stale)]);

  assert.equal(recovered.exitCode, EXIT_OBSERVED);
  assert.equal(recovered.document.mutation.performed, true);

  // The abandoned holder's record is preserved, never simply deleted.
  assert.equal(
    JSON.parse(await readFile(recovered.document.mutation.recoveredPath, 'utf8')).lockId,
    record.lockId,
  );
  assert.equal(await lock.readRecord(), null);

  // The lock is free, and the next caller may really take it.
  const free = await observe(root, ['locks']);

  assert.equal(free.exitCode, EXIT_OBSERVED);
  assert.equal(free.document.observation.held, false);
  assert.equal((await lock.acquire({ bindingKey: 'next', executionId: 'next' })).acquired, true);

  const audited = (await store.readEvents()).filter((event) => event.type === 'stale-lock-recovery');

  assert.deepEqual(audited.map((event) => event.outcome), ['refused', 'succeeded']);
});

test('NFR-AUD-001: every operation and every refusal is recorded, and status records none', async (t) => {
  const { root, store, hookPath } = await populatedClone(t);
  const eventsBefore = (await store.readEvents()).length;

  // Observation records nothing, however many times it runs.
  for (const argv of [
    ['status'], ['status', '--json'], ['locks'], ['prune'],
    ['update'], ['cleanup'], ['deactivate'],
  ]) {
    await observe(root, argv);
  }

  assert.equal(
    (await store.readEvents()).length,
    eventsBefore,
    'A preview appended a Lifecycle event.',
  );

  // One performed operation and one refused one, and both are recorded.
  const registered = await readFile(hookPath, 'utf8');

  await writeFile(hookPath, registered.replace(/\|\| exit \$\?/, '|| true'), 'utf8');

  const preview = await observe(root, ['repair', '--hook-script', FIXTURE_HOOK_SCRIPT]);

  await observe(root, ['repair', '--hook-script', FIXTURE_HOOK_SCRIPT, '--confirm', `sha256:${'b'.repeat(64)}`]);
  await observe(root, ['repair', '--hook-script', FIXTURE_HOOK_SCRIPT, '--confirm', tokenOf(preview)]);

  const repairs = (await store.readEvents()).filter((event) => event.type === 'repair');

  assert.deepEqual(repairs.map((event) => event.outcome), ['refused', 'succeeded']);
  repairs.forEach((event) => assert.deepEqual(validateLifecycleEvent(event), []));

  // And `gate status` still records nothing, even now that this surface writes.
  const afterRepair = (await store.readEvents()).length;

  await observe(root, ['status']);
  await observe(root, ['status', '--json']);

  assert.equal((await store.readEvents()).length, afterRepair);
});

test('both renderings of one confirmed invocation agree, and the packaged program is the one that runs it', async (t) => {
  const { root, projectAsset } = await populatedClone(t);

  for (const argv of [
    ['repair', '--hook-script', FIXTURE_HOOK_SCRIPT],
    ['update'],
    ['deactivate'],
    ['cleanup'],
    ['uninstall', '--asset', projectAsset],
  ]) {
    const human = await observe(root, argv);
    const machine = await observe(root, [...argv, '--json']);

    assert.deepEqual(JSON.parse(machine.stdout), machine.document);
    assert.equal(human.exitCode, machine.exitCode);
    assert.equal(human.document.ok, machine.document.ok);
    assert.deepEqual(human.document.observation, machine.document.observation);

    // A preview says so in the words a person reads, not only in a null field.
    assert.match(human.stdout, /preview: nothing was written/);
    assert.ok(human.stdout.includes(human.document.trustBoundary.statement));
  }

  // The packaged program is the surface, driven as a real child process.
  const { stdout } = await runFile(process.execPath, [PACKAGED_COMMAND, 'deactivate', '--json'], {
    cwd: root,
    env: isolatedGitEnvironment(),
  });
  const document = JSON.parse(stdout);

  assert.equal(document.command, 'deactivate');
  assert.equal(document.mutation, null);
  assert.match(document.observation.confirmationToken, /^sha256:[0-9a-f]{64}$/);

  // A refused confirmation exits 1 through the packaged program — a real answer
  // that is not good news, never a failed invocation.
  const refused = await runFile(process.execPath, [
    PACKAGED_COMMAND, 'deactivate', '--confirm', `sha256:${'e'.repeat(64)}`,
  ], { cwd: root, env: isolatedGitEnvironment() }).catch((error) => error);

  assert.equal(refused.code, EXIT_UNHEALTHY);
  assert.match(refused.stdout, /performed: false/);
  assert.match(refused.stdout, /preview-mismatch/);

  const confirmed = await runFile(process.execPath, [
    PACKAGED_COMMAND, 'deactivate', '--confirm', document.observation.confirmationToken,
  ], { cwd: root, env: isolatedGitEnvironment() });

  assert.match(confirmed.stdout, /performed: true/);

  // And a clone with nothing left to deactivate could not run the command at
  // all — exit 2, distinguishable from the refusal above without parsing a
  // word of either.
  const unrunnable = await runFile(process.execPath, [
    PACKAGED_COMMAND, 'deactivate', '--confirm', document.observation.confirmationToken,
  ], { cwd: root, env: isolatedGitEnvironment() }).catch((error) => error);

  assert.equal(unrunnable.code, EXIT_UNRUNNABLE);
  assert.match(unrunnable.stderr, /not activated/);

  // And `--help` names every command this surface performs.
  const help = await runFile(process.execPath, [PACKAGED_COMMAND, '--help'], {
    cwd: root,
    env: isolatedGitEnvironment(),
  });

  for (const command of COMMANDS) {
    assert.ok(help.stdout.includes(`gate ${command}`), `--help does not name gate ${command}.`);
  }

  assert.match(help.stdout, /previews and confirms in one/);
});
