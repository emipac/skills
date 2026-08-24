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
import { inspectCoordination, statusGate } from '../skills/change-evaluation-gate/scripts/lib/lifecycle.mjs';
import {
  CONFIRMED_COMMANDS,
  CONFIRMED_SELECTORS,
  EXIT_OBSERVED,
  EXIT_UNHEALTHY,
  EXIT_UNRUNNABLE,
  OBSERVATIONS,
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

  // FOUND, AND REPORTED RATHER THAN FIXED: `inspectCoordination` opens the lock
  // through `openCoordinationLock`, which ensures the coordination directory
  // exists before it reads. On a clone that never acquired a lock, the first
  // inspection therefore creates one empty directory. It is the only
  // filesystem effect this whole slice has, it is inside the seam rather than
  // in this surface, and repairing it means changing a module the evaluation
  // runtime acquires its lock through — which this slice may not do.
  const created = JSON.parse(await wholeCloneSnapshot(root))
    .filter((entry) => !JSON.parse(virginTree).some(([knownPath]) => knownPath === entry[0]));

  assert.deepEqual(
    created.map(([createdPath, contents]) => [path.basename(createdPath), contents]),
    [['coordination', '<directory>']],
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
    [['locks', '--recover'], 'gate locks --recover'],
    [['locks', '--recover', token], 'gate locks --recover'],
    [['prune', '--confirm', token], 'gate prune --confirm'],
    [['prune', '--confirmation', token], 'gate prune --confirm'],
    [['prune', token], 'gate prune --confirm'],
    [['repair'], 'gate repair'],
    [['activate'], 'gate activate'],
    [['update'], 'gate update'],
    [['deactivate'], 'gate deactivate'],
    [['uninstall'], 'gate uninstall'],
    [['cleanup'], 'gate cleanup'],
    [['fix'], 'gate fix'],
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

  // The refusals are declared as data, so a later confirmed operation is added
  // to one table rather than to a second parser.
  assert.equal(CONFIRMED_SELECTORS['--recover'], 'gate locks --recover');
  assert.equal(CONFIRMED_COMMANDS.repair, 'gate repair');
  assert.deepEqual([...OBSERVATIONS], ['status', 'locks', 'prune']);

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
