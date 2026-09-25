import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  activate,
  previewActivation,
  previewSync,
  syncActivation,
} from '../skills/change-evaluation-gate/scripts/lib/activation.mjs';
import { describeAdapter } from '../skills/change-evaluation-gate/scripts/lib/adapters.mjs';
import {
  gateChecksFromConfiguration,
  parseConfigurationDocument,
} from '../skills/change-evaluation-gate/scripts/lib/configuration.mjs';
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
  PACKAGED_HOOK_PROGRAM,
  quoteForShell,
  runOperatorCommand,
} from '../skills/change-evaluation-gate/scripts/lib/operator-surface.mjs';
import { REMEDIES, remedyInstruction } from '../skills/change-evaluation-gate/scripts/lib/remedies.mjs';
import { CONTROL_SURFACES } from '../skills/change-evaluation-gate/scripts/lib/security-control.mjs';

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

/**
 * The one check every fixture activates, under the identity the runners derive
 * for it from the configuration below. A receipt that pinned a check the
 * configuration does not declare describes a clone the runners deny, and
 * status observes exactly what the runners observe (`TB-060`).
 */
const CHECK_ID = 'configuration.broad-tests.test';

/** The verification command that check is derived from; not a Gate key, so cleanup keeps it. */
const VERIFICATION_CONFIGURATION = [
  'verification:',
  '  commands:',
  '    test:',
  '      backend:',
  '        - runner: package-script',
  '          args:',
  '            - test',
  '          working_directory: .',
  '          timeout_seconds: 300',
  '          allowed_environment:',
  '            - PATH',
  '          evidence_category: test',
  '          source_scope: backend',
  '      frontend: []',
  '      both: []',
];

const SHARED_CONFIGURATION = [
  'schema_version: 4',
  'backend: laravel',
  'frontend: none',
  ...VERIFICATION_CONFIGURATION,
  'evaluation_gate:',
  '  checks:',
  '    required:',
  `      - ${CHECK_ID}`,
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

/** The same configuration with no Gate policy section in it at all. */
const UNCONFIGURED_CONFIGURATION = [
  'schema_version: 4',
  'backend: laravel',
  'frontend: none',
  '',
].join('\n');

const gatePolicy = () => ({
  checks: { required: [CHECK_ID], advisory: [] },
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
  checks: [{ id: CHECK_ID, evaluate: testCommand() }],
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
  // An executable that exists on this machine, so the pin the receipt records
  // is one the runners — and therefore status — can re-observe.
  resolveExecutable: () => ({ executable: process.execPath, version: '1.0.0' }),
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

/**
 * A clone that is INSTALLED and holds no Gate policy at all.
 *
 * Its configuration is a real, readable, ordinary framework configuration —
 * this is not a broken file. It simply declares no `evaluation_gate` section,
 * which is the state every existing fixture configured its way out of before
 * observing anything (`AC-CFG-001`).
 */
const installedClone = async (t) => {
  const root = await throwawayRepository(t);

  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/gate-runner.mjs'), `${SELF_TEST_GUARD}process.exitCode = 0;\n`, 'utf8');
  await writeFile(path.join(root, '.agent-framework.yaml'), UNCONFIGURED_CONFIGURATION, 'utf8');

  return root;
};

/** A guarded activation: no fixture may activate anything outside a throwaway clone. */
const activatedClone = async (t, overrides = {}, { prepare = async () => {} } = {}) => {
  const root = await configuredClone(t);

  await prepare(root);

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

/** The one `next:` line a rendering printed, without its label. */
const nextLineOf = (result) => {
  const lines = result.stdout.split('\n').filter((entry) => entry.startsWith('next: '));

  assert.equal(lines.length, 1, `\`gate ${result.document.command}\` printed ${lines.length} \`next:\` lines.`);

  return lines[0].slice('next: '.length);
};

/**
 * Paste one printed line into a real POSIX shell, exactly as an operator would.
 *
 * `gate` resolves to a shim in a throwaway directory that hands its arguments
 * to the packaged program, so the only thing between the printed line and the
 * surface is the shell's own word splitting and quote handling — which is the
 * thing a printed instruction has to survive (`TB-053`).
 */
const pasteIntoShell = async (t, root, line) => {
  const bin = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-operator-bin-')));

  t.after(() => rm(bin, { recursive: true, force: true }));
  await writeFile(
    path.join(bin, 'gate'),
    `#!/bin/sh\nexec ${quoteForShell(process.execPath)} ${quoteForShell(PACKAGED_COMMAND)} "$@"\n`,
    { mode: 0o755 },
  );

  const run = await runFile('sh', ['-c', `${line} --json`], {
    cwd: root,
    env: { ...isolatedGitEnvironment(), PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  }).then(
    ({ stdout }) => ({ code: 0, stdout }),
    (error) => ({ code: error.code, stdout: error.stdout ?? '' }),
  );

  return { code: run.code, document: JSON.parse(run.stdout || 'null') };
};

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
  const cursor = describeAdapter('cursor');
  const cursorFile = (root) => path.join(root, cursor.registration.file);
  const emptyCursorFile = `${JSON.stringify({
    [cursor.registration.schemaVersion.key]: cursor.registration.schemaVersion.value,
    hooks: {},
  }, null, 2)}\n`;
  const { root, store } = await activatedClone(t, {
    adapters: [...DECLARED_ADAPTERS, { id: cursor.id, version: cursor.version, authoritative: false }],
  }, {
    prepare: async (clone) => {
      await mkdir(path.dirname(cursorFile(clone)), { recursive: true });
      await writeFile(cursorFile(clone), emptyCursorFile, 'utf8');
    },
  });

  assert.equal((await observe(root, ['status'])).document.observation.health, 'healthy');

  // A supporting surface whose registration is gone costs the clone a
  // surface, not its authority: nothing the runners pinned has moved.
  await writeFile(cursorFile(root), emptyCursorFile, 'utf8');

  const before = await wholeCloneSnapshot(root);
  const degraded = await observe(root, ['status']);

  assert.equal(degraded.document.observation.health, 'degraded');
  assert.equal(degraded.exitCode, EXIT_UNHEALTHY);
  assert.deepEqual(
    degraded.document.observation.findings.map((finding) => finding.code),
    ['adapter-registration-absent'],
  );
  assert.equal(await wholeCloneSnapshot(root), before);

  // An adapter the installed gate no longer declares is also a pinned
  // adapter set that moved, which the runners deny every commit for; status
  // now says so rather than calling that clone merely degraded
  // (`NFR-SEC-004`, `TB-060`). The loss itself is still graded `supporting`.
  const retired = await activatedClone(t, { adapters: RETIRED_ADAPTERS });
  const retiredStatus = await observe(retired.root, ['status']);

  assert.equal(retiredStatus.document.observation.health, 'broken');
  assert.deepEqual(
    retiredStatus.document.observation.findings.map((finding) => [finding.code, finding.severity, finding.surface ?? null]),
    [['adapter-lost', 'supporting', null], ['control-surface-drift', 'authoritative', 'adapters']],
  );

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

/**
 * THE FIRST RED TEST FOR TB-047.
 *
 * A clone that holds no Gate policy is INSTALLED, not configured. Before this
 * slice `statusGate` decided the lifecycle state from the Activation receipt
 * alone, so this clone — the state no fixture had ever started from — was
 * reported `configured` and `healthy`, which is what `gate activate` on the
 * same clone refuses to believe (`AC-CFG-001`, `FR-CFG-001`, `FR-LIFE-009`).
 */
test('a clone that holds no Gate policy observes as installed and names the missing policy', async (t) => {
  const root = await installedClone(t);
  const before = await wholeCloneSnapshot(root);

  const result = await observe(root, ['status']);

  assert.equal(result.exitCode, EXIT_OBSERVED);
  assert.equal(result.document.observation.state, 'installed');
  // Nothing is enforced and nothing has drifted: an unconfigured clone is not
  // an unhealthy one.
  assert.equal(result.document.observation.health, 'healthy');
  assert.equal(result.document.observation.findings.length, 1);
  assert.equal(result.document.observation.findings[0].code, 'gate-policy-missing');
  assert.equal(result.document.observation.findings[0].area, 'configuration');
  assert.equal(result.document.observation.findings[0].severity, 'informational');

  // What is missing is the policy, not the receipt, and it is named well enough
  // to act on without opening another file (`NFR-OPER-001`).
  assert.match(result.document.observation.findings[0].detail, /evaluation_gate/);
  assert.match(result.document.observation.findings[0].detail, /\.agent-framework\.yaml/);

  // Both renderings of the same run report the same state.
  assert.match(result.stdout, /^state: installed$/m);

  const machine = await observe(root, ['status', '--json']);

  assert.equal(machine.document.observation.state, 'installed');
  assert.equal(machine.document.observation.health, 'healthy');

  // Not one byte, and not one directory.
  assert.equal(await wholeCloneSnapshot(root), before);
});

test('gate status and gate activate agree about whether a clone holds a policy (AC-CFG-001)', async (t) => {
  const installed = await installedClone(t);
  const before = await wholeCloneSnapshot(installed);

  const unconfigured = await observe(installed, ['status']);
  const refused = await observe(installed, ['activate']);

  // One clone, two commands, one answer: this clone holds no policy, and both
  // name the same reason for saying so.
  assert.equal(unconfigured.document.observation.state, 'installed');
  assert.equal(refused.document.failure.reasonCode, 'gate-policy-missing');
  assert.equal(
    unconfigured.document.observation.findings[0].code,
    refused.document.failure.reasonCode,
  );
  assert.equal(await wholeCloneSnapshot(installed), before);

  // And a clone that does hold one is still configured, to both of them.
  const configured = await configuredClone(t);
  const observed = await observe(configured, ['status']);
  const previewed = await observe(configured, ['activate']);

  assert.equal(observed.document.observation.state, 'configured');
  assert.equal(observed.document.observation.findings[0].code, 'activation-absent');
  assert.equal(previewed.document.failure, null);
  assert.equal(previewed.document.observation.state, 'configured');
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
    // The one operation this surface still does not perform, refused by name.
    [['fix'], 'gate fix'],
    // A selector that names another command's work. `gate status` never
    // fixes as a side effect, whatever it is asked with.
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

  // `--repair` is no longer a selector anything owns: `repair` is a command
  // (`TB-041`), so the stale refused-selector entry is gone (`TB-050`). It is
  // still refused — as a selector `gate status` does not take — and still
  // repairs nothing as a side effect.
  const staleRepair = await observe(root, ['status', '--repair']);

  assert.equal(staleRepair.exitCode, EXIT_UNRUNNABLE);
  assert.equal(staleRepair.document.ok, false);
  assert.equal(staleRepair.document.failure.reasonCode, 'unknown-selector');
  assert.equal(staleRepair.document.failure.ownedBy, null);
  assert.equal(staleRepair.stdout, '');

  // Nothing can be forced, because nothing here changes anything.
  for (const flag of ['--force', '--yes']) {
    const forced = await observe(root, ['status', flag]);

    assert.equal(forced.exitCode, EXIT_UNRUNNABLE);
    assert.equal(forced.document.failure.reasonCode, 'mutation-refused');
    assert.equal(forced.document.failure.ownedBy, null);
  }

  // The refusals stayed data, and TB-041 moved entries OUT of these tables and
  // into the command registry rather than adding a second parser beside them.
  // `TB-042` moved `activate` out in turn, once the three seams `runActivation`
  // leaves abstract had real implementations to bind.
  assert.deepEqual(CONFIRMED_COMMANDS, { fix: 'gate fix' });
  assert.deepEqual(CONFIRMED_SELECTORS, { '--fix': 'gate fix' });
  assert.equal(CONFIRMED_SELECTORS['--recover'], undefined);
  assert.equal(CONFIRMED_SELECTORS['--repair'], undefined);
  assert.equal(CONFIRMED_COMMANDS.repair, undefined);
  assert.equal(CONFIRMED_COMMANDS.activate, undefined);
  assert.deepEqual(
    [...COMMANDS],
    ['activate', 'status', 'locks', 'prune', 'repair', 'update', 'deactivate', 'uninstall', 'cleanup', 'bypass', 'sync'],
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

    // And the refusal offers no token (`TB-053`): the token this invocation
    // recomputed names the operation THIS invocation described, which the
    // operator has not read, so the `next:` line names the preview to read
    // rather than a confirmation to paste. Nothing blames the clone either —
    // the surface cannot tell a changed clone from a changed invocation.
    assert.equal(nextLineOf(confirmed), `gate ${argv.join(' ')}`);
    assert.doesNotMatch(confirmed.stdout, /no longer match/);

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
    ...VERIFICATION_CONFIGURATION,
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

/* ------------------------------------------------------------------------- *
 * TB-053 — the instruction a preview prints performs that preview.
 * ------------------------------------------------------------------------- */

/**
 * THE FIRST RED TESTS OF TB-053, for the three commands this suite owns.
 *
 * Every fixture before this slice constructed its own confirmation argument
 * vector, so the line a preview PRINTS had never been executed by anything.
 * These read the printed `next:` line back out of the rendering, hand it to a
 * real shell exactly as an operator pastes it, and require the result to be
 * the previewed operation — with every selector the preview needed, once per
 * value for a repeatable one, and quoted wherever a path has a space or a
 * quote in it (`FR-LIFE-004`, `AC-LIFE-008`, `NFR-OPER-001`).
 */
test('TB-053: a prune preview prints an instruction carrying every selector, and pasting it performs that prune', async (t) => {
  const { root, store } = await populatedClone(t);
  const evaluations = [`sha256:${'1'.repeat(64)}`, `sha256:${'2'.repeat(64)}`];

  for (const [index, evaluationId] of evaluations.entries()) {
    await store.appendEvidence({
      decision: { evaluationId, outcome: 'pass' },
      outputs: [{ checkId: 'broad_test', attempt: index + 1, text: `output ${index}\n`.repeat(8) }],
    });
  }

  const argv = [
    'prune',
    '--evaluation', evaluations[0],
    '--evaluation', evaluations[1],
    '--before', '2999-01-01T00:00:00.000Z',
    '--reclaim', '1048576',
  ];
  const preview = await observe(root, argv);
  const token = tokenOf(preview);
  const previewed = preview.document.observation.blobs.map((blob) => blob.blobId);

  assert.equal(previewed.length, 2, 'The selector did not reach both evaluations.');
  // The document records the invocation the parser read, as an argument
  // vector, so an agent reading `--json` has the same instruction a person has.
  assert.deepEqual(preview.document.invocation.selectors, argv.slice(1));
  assert.equal(
    nextLineOf(preview),
    `gate prune --evaluation ${evaluations[0]} --evaluation ${evaluations[1]} --before 2999-01-01T00:00:00.000Z --reclaim 1048576 --confirm ${token}`,
  );

  // Idempotent: the printed line reproduces the preview, therefore the token.
  const again = await observe(root, argv);

  assert.equal(tokenOf(again), token);

  const pasted = await pasteIntoShell(t, root, nextLineOf(preview));

  assert.equal(pasted.code, 0, JSON.stringify(pasted.document?.mutation));
  assert.equal(pasted.document.mutation.performed, true);
  assert.deepEqual(pasted.document.mutation.removed, previewed);
  assert.equal(pasted.document.mutation.confirmation, token);
});

test('TB-053: a repair preview prints an instruction carrying --hook-script, and pasting it performs that repair', async (t) => {
  const { root, hookPath } = await populatedClone(t);
  const registered = await readFile(hookPath, 'utf8');

  await writeFile(hookPath, registered.replace(/\|\| exit \$\?/, '|| true'), 'utf8');

  const preview = await observe(root, ['repair', '--hook-script', FIXTURE_HOOK_SCRIPT]);
  const token = tokenOf(preview);

  assert.deepEqual(preview.document.invocation.selectors, ['--hook-script', FIXTURE_HOOK_SCRIPT]);
  assert.equal(nextLineOf(preview), `gate repair --hook-script ${FIXTURE_HOOK_SCRIPT} --confirm ${token}`);

  const pasted = await pasteIntoShell(t, root, nextLineOf(preview));

  assert.equal(pasted.code, 0, JSON.stringify(pasted.document?.mutation));
  assert.equal(pasted.document.mutation.performed, true);
  assert.deepEqual(pasted.document.mutation.actions.map((action) => action.kind), ['hook-registration']);
  // Restored to exactly what the receipt authorizes — `AC-LIFE-010` is
  // unchanged once the repair is correctly confirmed.
  assert.equal(await readFile(hookPath, 'utf8'), registered);
});

test('TB-053: an uninstall preview prints --asset once per asset, quoted so a path with a space or a quote pastes unchanged', async (t) => {
  const { root, projectAsset } = await populatedClone(t);
  const spaced = path.join(root, '.claude', 'skills', 'gate notes', 'read me.md');
  const quoted = path.join(root, '.claude', 'skills', "it's", 'gate.md');

  for (const asset of [spaced, quoted]) {
    await mkdir(path.dirname(asset), { recursive: true });
    await writeFile(asset, '# project asset\n', 'utf8');
  }

  // An activated clone is never uninstalled out from under its own hook.
  const deactivation = await observe(root, ['deactivate']);

  assert.equal((await observe(root, ['deactivate', '--confirm', tokenOf(deactivation)])).document.mutation.performed, true);

  const argv = ['uninstall', '--asset', projectAsset, '--asset', spaced, '--asset', quoted];
  const preview = await observe(root, argv);
  const token = tokenOf(preview);
  const line = nextLineOf(preview);

  assert.deepEqual(preview.document.invocation.selectors, argv.slice(1));
  // Bare where a shell would pass it through unchanged; single-quoted where it
  // would not, with the embedded quote spelled the one way every POSIX shell
  // reads identically.
  assert.equal(
    line,
    `gate uninstall --asset ${projectAsset} --asset '${spaced}' --asset '${quoted.replace("'", "'\\''")}' --confirm ${token}`,
  );

  const pasted = await pasteIntoShell(t, root, line);

  assert.equal(pasted.code, 0, JSON.stringify(pasted.document?.mutation));
  assert.equal(pasted.document.mutation.performed, true);
  assert.deepEqual(pasted.document.mutation.removed.map((entry) => entry.path).sort(), [projectAsset, spaced, quoted].sort());

  for (const asset of [projectAsset, spaced, quoted]) {
    assert.equal(await readFile(asset, 'utf8').catch(() => null), null, `${asset} survived the uninstall its own instruction confirmed.`);
  }
});

/**
 * The quoting rule, stated and proved against the shell it is for: a value made
 * only of characters a POSIX shell passes through bare is printed bare, and
 * anything else comes back from `sh` byte for byte.
 */
test('TB-053: a value is quoted for the shell iff a shell would split or interpret it, and every quoted value round-trips', async () => {
  assert.equal(quoteForShell('tools/gate-runner.mjs'), 'tools/gate-runner.mjs');
  assert.equal(quoteForShell('2999-01-01T00:00:00.000Z'), '2999-01-01T00:00:00.000Z');
  assert.equal(quoteForShell(`sha256:${'a'.repeat(64)}`), `sha256:${'a'.repeat(64)}`);
  assert.equal(quoteForShell('/Users/x/Library/Application Support/Herd/bin/php'), "'/Users/x/Library/Application Support/Herd/bin/php'");
  assert.equal(quoteForShell("it's"), "'it'\\''s'");

  for (const value of [
    '/Users/x/Library/Application Support/Herd/bin/php',
    "it's here",
    '$HOME/gate.md',
    'a;b && c | d',
    '`whoami`',
    'tab\there',
    '"double"',
    '*.md',
  ]) {
    const { stdout } = await runFile('sh', ['-c', `printf '%s' ${quoteForShell(value)}`]);

    assert.equal(stdout, value, `${JSON.stringify(value)} did not survive the shell.`);
  }
});

/**
 * The five commands whose invocation carries no preview-shaping selector print
 * exactly the line they always printed — the shared renderer changed, their
 * output did not (`TB-053`).
 */
test('TB-053: the commands with no preview-shaping selector print exactly the instruction they always printed', async (t) => {
  const fixture = await populatedClone(t);
  const { root } = fixture;

  // A stale lock, so `locks` has something to recover and a token to print.
  await STALE_SCENARIOS.find((scenario) => scenario.command === 'locks').prepare(fixture);

  const status = await observe(root, ['status']);

  // Status confirms nothing, so its one `next:` line names what to do about
  // what it found and never carries a token (`TB-060`).
  assert.doesNotMatch(nextLineOf(status), /--confirm|--recover|sha256:/);
  assert.deepEqual(status.document.invocation.selectors, []);

  for (const command of ['locks', 'update', 'deactivate', 'cleanup']) {
    const preview = await observe(root, [command]);
    const token = tokenOf(preview);

    assert.deepEqual(preview.document.invocation.selectors, []);
    assert.equal(nextLineOf(preview), `gate ${command} ${CONFIRMABLE_COMMANDS[command]} ${token}`);
  }
});

/**
 * A confirmation that dropped a selector its preview carried is refused, and
 * the refusal says what THIS invocation ran as rather than blaming the clone —
 * the one thing an operator can compare against the `next:` line they were
 * given (`NFR-OPER-001`).
 */
test('TB-053: a confirmation that omits a selector the preview carried is refused, names its own invocation, and offers no token', async (t) => {
  const { root, hookPath, store } = await populatedClone(t);
  const registered = await readFile(hookPath, 'utf8');
  const clobbered = registered.replace(/\|\| exit \$\?/, '|| true');

  await writeFile(hookPath, clobbered, 'utf8');

  const preview = await observe(root, ['repair', '--hook-script', FIXTURE_HOOK_SCRIPT]);
  const eventsBefore = (await store.readEvents()).length;
  // The operator pastes the token but not the selector.
  const refused = await observe(root, ['repair', '--confirm', tokenOf(preview)]);

  assert.equal(refused.exitCode, EXIT_UNHEALTHY);
  assert.equal(refused.document.mutation.performed, false);
  // Verified while writing this: the repair token is the identity of
  // `{ status, receiptId, actions }` and does NOT bind the hook program, so a
  // confirmation that dropped `--hook-script` reproduces the token and is
  // refused one step later, when the packaged program cannot reproduce the
  // pinned registration (`registration-not-reproducible`). Nothing is written
  // either way; this slice does not change the token's derivation, and the
  // `next:` line now carries the selector so the operator never gets here by
  // following the instruction.
  assert.equal(refused.document.mutation.reasonCode, 'repair-refused');
  assert.ok(
    JSON.stringify(refused.document.mutation.errors).includes('registration-not-reproducible'),
    JSON.stringify(refused.document.mutation.errors),
  );
  assert.deepEqual(refused.document.invocation.selectors, []);
  // The recomputed preview is still rendered — a different hook program — but
  // its token is not offered beside the refusal.
  assert.ok(refused.document.observation.hookProgram.script.endsWith('gate-precommit.mjs'));
  assert.equal(nextLineOf(refused), 'gate repair');
  assert.doesNotMatch(refused.stdout, /no longer match/);

  // Nothing was repaired, and the refusal was recorded.
  assert.equal(await readFile(hookPath, 'utf8'), clobbered);
  assert.ok((await store.readEvents()).length > eventsBefore);

  // The instruction the preview printed still performs the preview.
  const pasted = await pasteIntoShell(t, root, nextLineOf(preview));

  assert.equal(pasted.document.mutation.performed, true);
  assert.equal(await readFile(hookPath, 'utf8'), registered);
});

/*
 * TB-052 — `gate bypass`, where a bypass grant comes from.
 *
 * The runner side — a grant read once, applied or refused, spent — is proved
 * in the hook-runner suite. This is the command that writes one: two
 * invocations, a token bound to the staged snapshot, refused by the policy's
 * own rule, and recorded either way through the existing Lifecycle path.
 */

const BYPASS_MARKER = 'Gate-Bypass';

/** `SHARED_CONFIGURATION` with the bypass switch on, as a maintainer would write it. */
const bypassEnabledConfiguration = ({ requireReference = false } = {}) => SHARED_CONFIGURATION
  .replace(
    '  bypass:\n    enabled: false\n    marker: null\n',
    `  bypass:\n    enabled: true\n    marker: ${BYPASS_MARKER}\n${requireReference ? '    require_reference: true\n' : ''}`,
  );

const bypassPolicy = ({ requireReference = false } = {}) => ({
  ...gatePolicy(),
  bypass: {
    enabled: true,
    marker: BYPASS_MARKER,
    ...(requireReference ? { require_reference: true } : {}),
  },
});

/** An activated clone whose policy enables bypass, with one staged path a commit would grade. */
const bypassClone = async (t, options = {}) => {
  const fixture = await activatedClone(t, {
    configuration: { schemaVersion: 4, policy: bypassPolicy(options) },
  });

  await writeFile(path.join(fixture.root, '.agent-framework.yaml'), bypassEnabledConfiguration(options), 'utf8');
  await writeFile(path.join(fixture.root, 'source.txt'), 'BROKEN\n', 'utf8');
  await runGit(fixture.root, ['add', '--all']);

  return fixture;
};

test('TB-052: a bypass preview identifies the staged snapshot, offers a token, and writes nothing', async (t) => {
  const { root, store } = await bypassClone(t);
  const before = await wholeCloneSnapshot(root);
  const eventsBefore = (await store.readEvents()).length;

  const preview = await observe(root, ['bypass', '--reason', 'hotfix under incident 12']);

  assert.equal(preview.exitCode, EXIT_OBSERVED, preview.stderr);
  assert.equal(preview.document.command, 'bypass');
  assert.equal(preview.document.observation.grantable, true);
  assert.equal(preview.document.observation.rejectionCode, null);
  assert.deepEqual(preview.document.observation.policy, { enabled: true, requireReference: false, marker: BYPASS_MARKER });
  assert.match(preview.document.observation.snapshotId, /^sha256:[0-9a-f]{64}$/);
  assert.ok(preview.document.observation.changedPaths.includes('source.txt'));
  assert.equal(preview.document.observation.pending, null);
  assert.equal(preview.document.mutation, null);
  assert.equal(
    nextLineOf(preview),
    `gate bypass --reason 'hotfix under incident 12' --confirm ${tokenOf(preview)}`,
  );

  // Nothing written, nothing recorded — a preview is observation.
  assert.equal(await wholeCloneSnapshot(root), before);
  assert.equal((await store.readEvents()).length, eventsBefore);
});

test('TB-052 FR-POL-006: a confirmed bypass writes one grant bound to the previewed snapshot and records it', async (t) => {
  const { root, store } = await bypassClone(t);
  const preview = await observe(root, ['bypass', '--reason', 'hotfix under incident 12', '--actor', 'maintainer']);
  const pasted = await pasteIntoShell(t, root, nextLineOf(preview));

  assert.equal(pasted.code, EXIT_OBSERVED);
  assert.equal(pasted.document.mutation.performed, true);
  assert.match(pasted.document.mutation.grantId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(pasted.document.mutation.snapshotId, preview.document.observation.snapshotId);
  assert.equal(pasted.document.mutation.marker, BYPASS_MARKER);

  const grant = await store.bypassGrant().read();

  assert.equal(grant.grantVersion, 'change-evaluation-gate/bypass-grant/v1');
  assert.equal(grant.grantId, pasted.document.mutation.grantId);
  assert.equal(grant.snapshotId, preview.document.observation.snapshotId);
  assert.equal(grant.reason, 'hotfix under incident 12');
  assert.equal(grant.reference, null);
  assert.equal(grant.actor, 'maintainer');
  assert.equal(grant.marker, BYPASS_MARKER);
  assert.match(grant.requestedAt, /^\d{4}-\d{2}-\d{2}T/);

  const events = (await store.readEvents()).filter((event) => event.type === 'bypass');

  assert.equal(events.length, 1, 'NFR-AUD-001: the grant is one Lifecycle event of the existing bypass type.');
  assert.equal(events[0].outcome, 'succeeded');
  assert.equal(events[0].before, grant.snapshotId);
  assert.equal(events[0].after, grant.grantId);
  assert.deepEqual(validateLifecycleEvent(events[0]), []);

  // A later preview reports the pending grant; the ledger is untouched until
  // a commit consumes it.
  const again = await observe(root, ['bypass', '--reason', 'another']);

  assert.equal(again.document.observation.pending.snapshotId, grant.snapshotId);
  assert.deepEqual(await store.readBypassLedger(), []);
});

test('TB-052 FR-POL-006: staging anything between the preview and the confirmation refuses the confirmation, and the refusal is recorded', async (t) => {
  const { root, store } = await bypassClone(t);
  const preview = await observe(root, ['bypass', '--reason', 'hotfix']);
  const eventsBefore = (await store.readEvents()).length;

  await writeFile(path.join(root, 'source.txt'), 'BROKEN\nand more\n', 'utf8');
  await runGit(root, ['add', '--all']);

  const refused = await observe(root, ['bypass', '--reason', 'hotfix', '--confirm', tokenOf(preview)]);

  assert.equal(refused.exitCode, EXIT_UNHEALTHY);
  assert.equal(refused.document.mutation.performed, false);
  assert.equal(refused.document.mutation.reasonCode, 'preview-mismatch');
  assert.notEqual(refused.document.observation.snapshotId, preview.document.observation.snapshotId);
  assert.equal(nextLineOf(refused), 'gate bypass --reason hotfix', 'no token beside a refusal.');
  assert.equal(await store.bypassGrant().read(), null, 'nothing was granted.');

  const events = (await store.readEvents()).slice(eventsBefore);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'bypass');
  assert.equal(events[0].outcome, 'refused');
});

test('TB-052 FR-POL-008 / SG-BYP-001: the policy\'s own rule refuses a grant it would refuse at commit time, and a confirmation cannot change that', async (t) => {
  // Disabled: the switch is off, and nothing can be granted.
  const disabled = await activatedClone(t);

  await writeFile(path.join(disabled.root, 'source.txt'), 'BROKEN\n', 'utf8');
  await runGit(disabled.root, ['add', '--all']);

  const off = await observe(disabled.root, ['bypass', '--reason', 'please']);

  assert.equal(off.exitCode, EXIT_UNHEALTHY);
  assert.equal(off.document.observation.grantable, false);
  assert.equal(off.document.observation.rejectionCode, 'bypass-disabled');
  assert.equal(off.document.observation.confirmationToken, null);
  assert.match(off.stdout, /next: this clone's Gate policy disables bypass/);

  const forced = await observe(disabled.root, ['bypass', '--reason', 'please', '--confirm', `sha256:${'e'.repeat(64)}`]);

  assert.equal(forced.exitCode, EXIT_UNHEALTHY);
  assert.equal(forced.document.mutation.performed, false);
  assert.equal(forced.document.mutation.reasonCode, 'bypass-disabled');
  assert.equal(await disabled.store.bypassGrant().read(), null);
  assert.equal((await disabled.store.readEvents()).filter((event) => event.type === 'bypass').length, 1, 'the refused confirmation is recorded.');

  // Enabled, but the grant is incomplete: no reason, then no required reference.
  const strict = await bypassClone(t, { requireReference: true });
  const noReason = await observe(strict.root, ['bypass']);

  assert.equal(noReason.document.observation.rejectionCode, 'reason-missing');
  assert.match(noReason.stdout, /next: name the reason with --reason/);

  const noReference = await observe(strict.root, ['bypass', '--reason', 'hotfix']);

  assert.equal(noReference.document.observation.rejectionCode, 'reference-missing');
  assert.match(noReference.stdout, /next: this clone's Gate policy requires a reference/);

  const complete = await observe(strict.root, ['bypass', '--reason', 'hotfix', '--reference', 'INC-12']);

  assert.equal(complete.document.observation.grantable, true);
  assert.equal(
    nextLineOf(complete),
    `gate bypass --reason hotfix --reference INC-12 --confirm ${tokenOf(complete)}`,
  );
});

test('TB-052: a bypass is granted only against an activated clone with a Gate policy', async (t) => {
  const configured = await configuredClone(t);
  const unactivated = await observe(configured, ['bypass', '--reason', 'hotfix']);

  assert.equal(unactivated.exitCode, EXIT_UNRUNNABLE);
  assert.equal(unactivated.document.failure.reasonCode, 'activation-receipt-missing');

  const installed = await installedClone(t);
  const unconfigured = await observe(installed, ['bypass', '--reason', 'hotfix']);

  assert.equal(unconfigured.exitCode, EXIT_UNRUNNABLE);
  assert.equal(unconfigured.document.failure.reasonCode, 'gate-policy-missing');
});

/* ------------------------------------------------------------------------- *
 * TB-060 — status sees the configuration it pinned, and says what next.
 *
 * Every fixture above activates through the library with executables that do
 * not exist on this machine, which is exactly why none of them could ever ask
 * status about a clone the runners would call healthy. These activate through
 * the real command, on a real configuration, with a check that really runs —
 * and then edit the configuration by hand, which nothing above ever did.
 * ------------------------------------------------------------------------- */

const LIBRARY = path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts/lib');

/** A check that grades one file and, when asked, leaves a mark every time it runs. */
const markingCheckScript = (marker) => [
  "import { appendFileSync } from 'node:fs';",
  "import { readFile } from 'node:fs/promises';",
  '',
  ...(marker === null ? [] : [`appendFileSync(${JSON.stringify(marker)}, 'ran\\n');`]),
  "const graded = await readFile(process.argv[2], 'utf8').catch(() => '');",
  '',
  'process.stdout.write(`graded ${graded.length} bytes\\n`);',
  "process.exitCode = graded.includes('BROKEN') ? 1 : 0;",
  '',
].join('\n');

const activatableConfiguration = ({ totalSeconds = 600 } = {}) => [
  'schema_version: 4',
  'backend: laravel',
  'frontend: none',
  'verification:',
  '  commands:',
  '    test:',
  '      backend: []',
  '      frontend: []',
  '      both:',
  '        - runner: repository-script',
  '          args:',
  '            - tools/check.mjs',
  '            - app/Order.php',
  '          working_directory: .',
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
  `    total_seconds: ${totalSeconds}`,
  '  bypass:',
  '    enabled: false',
  '    marker: null',
  '  execution:',
  '    budget_skippable: []',
  '  evidence: {}',
  '',
].join('\n');

const commitAttempt = async (root, message) => runFile('git', [
  '-c', 'user.email=gate@example.test',
  '-c', 'user.name=Gate',
  'commit', '--quiet', '--message', message,
], { cwd: root, env: isolatedGitEnvironment() }).then(
  () => ({ committed: true, output: '' }),
  (error) => ({ committed: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }),
);

/** Stage one ordinary edit, the way a maintainer's next commit would. */
const stageEdit = async (root, contents) => {
  await writeFile(path.join(root, 'app/Order.php'), contents, 'utf8');
  await runGit(root, ['add', '--all']);
};

/**
 * A clone activated through the real `gate activate`, from a real
 * configuration, with a check the hook really runs: the clone the runners call
 * healthy, and the only kind worth asking status about.
 */
const commandActivatedClone = async (t, { marker = null } = {}) => {
  const root = await throwawayRepository(t);

  await mkdir(path.join(root, 'tools'), { recursive: true });
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, 'tools/check.mjs'), markingCheckScript(marker), 'utf8');
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\n', 'utf8');
  await writeFile(path.join(root, '.agent-framework.yaml'), activatableConfiguration(), 'utf8');
  await runGit(root, ['add', '--all']);
  await commitAttempt(root, 'baseline');

  const preview = await observe(root, ['activate']);
  const confirmed = await observe(root, ['activate', '--confirm', tokenOf(preview)]);

  assert.equal(confirmed.document.mutation.performed, true, `The fixture failed to activate: ${confirmed.document.mutation.reasonCode}.`);
  assert.equal(confirmed.document.mutation.shortcut.registered, true);

  return root;
};

/** Every byte of the clone — `.git` included — as one comparable value. */
const cloneFingerprint = (root) => wholeCloneSnapshot(root);

/**
 * THE FIRST RED TEST OF TB-060.
 *
 * `NFR-SEC-004`, `AC-SEC-001`. A clone whose `.agent-framework.yaml` changed
 * since activation reports `broken` with a `trusted-configuration` finding and
 * names a new Activation transaction — where before this slice status never
 * observed the configuration, reported `healthy` with nothing, and the next
 * commit was denied for a reason status had just said did not exist.
 */
test('TB-060 NFR-SEC-004 / AC-SEC-001: a clone whose configuration changed since activation is broken, and status names the remedy', async (t) => {
  const root = await commandActivatedClone(t);

  assert.equal((await observe(root, ['status'])).document.observation.health, 'healthy');

  await writeFile(path.join(root, '.agent-framework.yaml'), activatableConfiguration({ totalSeconds: 900 }), 'utf8');

  const before = await cloneFingerprint(root);
  const status = await observe(root, ['status']);
  const machine = await observe(root, ['status', '--json']);

  // FR-LIFE-009, AC-LIFE-010, SG-LIFE-001: observation writes nothing and
  // repairs nothing — not one byte of the worktree or of `.git`.
  assert.equal(await cloneFingerprint(root), before);
  assert.equal(status.document.observation.repaired, false);
  assert.deepEqual(status.document.observation.mutations, []);

  assert.equal(status.exitCode, EXIT_UNHEALTHY);
  assert.equal(status.document.observation.health, 'broken');

  const drift = status.document.observation.findings.filter((finding) => finding.code === 'control-surface-drift');

  assert.deepEqual(drift.map((finding) => finding.surface), ['trusted-configuration']);
  assert.equal(drift[0].severity, 'authoritative');
  assert.equal(drift[0].path, path.join(root, '.agent-framework.yaml'));
  assert.match(drift[0].detail, /\.agent-framework\.yaml changed since this clone was activated/);

  // The remedy is the Activation transaction that re-pins a configuration
  // under the adapters the clone already has, through the clone's own
  // shortcut — never `gate repair`, which cannot re-pin a policy (`TB-062`).
  const next = nextLineOf(status);

  assert.equal(next, remedyInstruction('sync', 'git gate'));
  assert.match(next, /^git gate sync — /);
  assert.deepEqual(
    status.document.observation.next.remedies.map((remedy) => remedy.remedy),
    ['sync'],
  );
  assert.deepEqual(machine.document.observation.next, status.document.observation.next);
  assert.deepEqual(machine.document.observation.controlSurface.drifted, ['trusted-configuration']);

  // Status and the next evaluation agree: the commit is denied for the same
  // reason status named.
  await stageEdit(root, 'baseline\nrepaired\n');

  const denied = await commitAttempt(root, 'after the configuration changed');

  assert.equal(denied.committed, false, 'a commit against a drifted configuration was accepted.');
  assert.match(denied.output, /integrity-drift/);
  assert.match(denied.output, /trusted-configuration/);

  // And the remedy status named is the one that performs: one sync,
  // previewed and confirmed, and the clone is healthy again.
  const sync = await observe(root, ['sync']);

  assert.equal((await observe(root, ['sync', '--confirm', tokenOf(sync)])).document.mutation.performed, true);

  const recovered = await observe(root, ['status']);

  assert.equal(recovered.document.observation.health, 'healthy');
  assert.equal(nextLineOf(recovered), 'nothing');
  assert.equal((await commitAttempt(root, 'after the re-pin')).committed, true);
});

test('TB-060: a healthy clone prints next: nothing and otherwise exactly what it printed before, and its commit is not denied', async (t) => {
  const root = await commandActivatedClone(t);
  const status = await observe(root, ['status']);
  const { observation } = status.document;

  assert.equal(status.exitCode, EXIT_OBSERVED);
  assert.equal(observation.health, 'healthy');
  assert.deepEqual(observation.findings, []);
  assert.equal(nextLineOf(status), 'nothing');

  // Byte for byte, the rendering before this slice plus one line.
  assert.equal(status.stdout, [
    'gate status',
    `repository: ${root}`,
    'state: activated',
    'health: healthy',
    `release: ${observation.release.id} ${observation.release.version} (protocol ${observation.release.protocolVersion})`,
    `receipt: ${observation.receiptId}`,
    'findings: 0',
    'repaired: false',
    'mutations: 0',
    'next: nothing',
    'preview: nothing was written, nothing was repaired, and nothing was removed.',
    status.document.trustBoundary.statement,
    '',
  ].join('\n'));

  // `--json` keeps every field it had, in order, and gains two.
  const machine = await observe(root, ['status', '--json']);

  assert.deepEqual(Object.keys(machine.document.observation), [
    'state', 'health', 'release', 'receiptId', 'repaired', 'mutations', 'findings', 'controlSurface', 'next',
  ]);
  assert.deepEqual(machine.document.observation.next, {
    instruction: 'nothing',
    shortcut: 'git gate',
    remedies: [],
    informational: [],
  });
  assert.deepEqual(machine.document.observation.controlSurface.drifted, []);
  assert.equal(
    machine.document.observation.controlSurface.observed.configurationId,
    JSON.parse(await readFile(path.join(root, '.git/change-evaluation-gate/evidence/activation/receipt.json'), 'utf8')).configuration.identity,
  );

  // The clone status calls healthy is not denied for drift: it commits.
  await stageEdit(root, 'baseline\nrepaired\n');

  const committed = await commitAttempt(root, 'on a healthy clone');

  assert.equal(committed.committed, true, committed.output);
});

test('TB-060: observing runner pins during status spawns no pinned program, and costs a stat per pin', async (t) => {
  const markers = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-operator-marker-')));

  t.after(() => rm(markers, { recursive: true, force: true }));

  const marker = path.join(markers, 'check-ran');
  const root = await commandActivatedClone(t, { marker });

  // Activation self-tests the hook program, never the check; nothing has run.
  await rm(marker, { force: true });

  const rounds = 5;
  const started = process.hrtime.bigint();

  for (let round = 0; round < rounds; round += 1) {
    assert.equal((await observe(root, ['status'])).document.observation.health, 'healthy');
  }

  const perStatus = Number(process.hrtime.bigint() - started) / 1e6 / rounds;

  t.diagnostic(`gate status with runner-pin observation: ${perStatus.toFixed(1)} ms per invocation over ${rounds} runs`);

  assert.equal(await readFile(marker, 'utf8').catch(() => null), null, 'status ran a pinned check program.');

  // The marker is real: the commit that does run the check leaves it.
  await stageEdit(root, 'baseline\nrepaired\n');
  assert.equal((await commitAttempt(root, 'the check runs here')).committed, true);
  assert.match(await readFile(marker, 'utf8'), /ran/);
});

test('TB-060: next: uses git gate only where the shortcut activation records is present, and names each state\'s remedy', async (t) => {
  // A configured clone has no shortcut yet, and its remedy is activation.
  const configured = await configuredClone(t);
  const unactivated = await observe(configured, ['status']);

  assert.equal(nextLineOf(unactivated), 'gate activate');
  assert.equal(unactivated.document.observation.next.shortcut, null);

  // An installed clone has nothing to enforce, and nothing to do.
  const installed = await observe(await installedClone(t), ['status']);

  assert.equal(nextLineOf(installed), 'nothing');
  assert.deepEqual(installed.document.observation.next.informational, ['gate-policy-missing']);

  // A lost hook is repaired; the clone activated without a shortcut says
  // `gate`, not `git gate`.
  const { root, store } = await activatedClone(t);

  await rm((await store.activationReceipt().read()).hooks[0].path, { force: true });

  const broken = await observe(root, ['status']);

  assert.equal(broken.document.observation.health, 'broken');
  assert.equal(nextLineOf(broken), remedyInstruction('repair', 'gate'));
  assert.match(nextLineOf(broken), /^gate repair — /);

  // A `gate` alias somebody else owns is not the shortcut activation records,
  // and status never sends a maintainer to it.
  const shadowed = await commandActivatedClone(t);

  await runGit(shadowed, ['config', '--local', 'alias.gate', '!echo mine']);
  await writeFile(path.join(shadowed, '.agent-framework.yaml'), activatableConfiguration({ totalSeconds: 900 }), 'utf8');

  assert.match(nextLineOf(await observe(shadowed, ['status'])), /^gate sync — /);
});

/**
 * `NFR-OPER-001`. Every finding code `gate status` can emit has a remedy or an
 * explicit informational marker. The codes are read from the sources that
 * emit them, so a code added later with no entry fails here rather than
 * printing a finding nobody is told how to act on.
 */
test('TB-060 NFR-OPER-001: every finding status can emit maps to a remedy or an explicit informational marker', async () => {
  const lifecycle = await readFile(path.join(LIBRARY, 'lifecycle.mjs'), 'utf8');
  const hookRunner = await readFile(path.join(LIBRARY, 'hook-runner.mjs'), 'utf8');
  const configurationSource = await readFile(path.join(LIBRARY, 'configuration.mjs'), 'utf8');
  const literals = (source) => [...source.matchAll(/'([a-z][a-z0-9-]+)'/g)].map((match) => match[1]);
  const body = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length));

  const statusBody = body(lifecycle, 'export const statusGate', '\nexport const ');
  const registrationCodes = literals(body(lifecycle, 'const REGISTRATION_FINDING_CODES', '});'))
    .filter((literal) => literal.startsWith('adapter-registration-'));
  // What `resolveConfiguration` can answer, which an unactivated clone reports
  // as its finding's code.
  const configurationCodes = [
    ...literals(body(hookRunner, 'export const resolveConfiguration', '\nexport const ')),
    ...literals(body(configurationSource, 'export const readRepositoryConfiguration', '\n};')),
    ...literals(body(configurationSource, 'reasonCode: \'configuration-unreadable\'', '\n')),
  ].filter((literal) => /^(configuration|gate-policy)-/.test(literal));
  const codes = new Set();

  for (const [, expression] of statusBody.matchAll(/\bcode: ([^\n]+)/g)) {
    if (expression.startsWith('REGISTRATION_FINDING_CODES')) {
      registrationCodes.forEach((code) => codes.add(code));
    } else if (expression.startsWith('configuration.reasonCode')) {
      [...configurationCodes, 'repository-unresolved'].forEach((code) => codes.add(code));
    } else {
      const named = literals(expression);

      assert.ok(named.length > 0, `statusGate emits a finding code this fixture cannot enumerate: ${expression}`);
      named.forEach((code) => codes.add(code));
    }
  }

  assert.match(statusBody, /reconcileControlSurface\(/);

  for (const code of codes) {
    const entry = REMEDIES[code];

    assert.equal(typeof entry, 'string', `status can emit ${code}, and no remedy or informational marker is recorded for it.`);
  }

  // Control-surface drift has one remedy per surface, and every surface has one.
  for (const surface of CONTROL_SURFACES) {
    assert.equal(
      typeof REMEDIES['control-surface-drift'][surface],
      'string',
      `control-surface drift of ${surface} has no remedy.`,
    );
  }

  // The settled lines: a gate-owned Git registration is repaired, a changed
  // configuration is re-pinned by a sync (`TB-062`), an unactivated clone is
  // activated.
  for (const code of ['hook-absent', 'hook-block-tampered', 'hook-receipt-mismatch']) {
    assert.equal(REMEDIES[code], 'repair');
  }

  assert.equal(REMEDIES['control-surface-drift']['managed-hooks'], 'repair');
  assert.equal(REMEDIES['control-surface-drift']['trusted-configuration'], 'sync');
  assert.equal(REMEDIES['control-surface-drift']['command-descriptors'], 'sync');
  assert.equal(REMEDIES['control-surface-drift'].adapters, 'activation-transaction');
  assert.equal(REMEDIES['activation-absent'], 'activate');
  assert.equal(REMEDIES['gate-policy-missing'], 'informational');
  assert.ok(codes.has('configuration-missing') && codes.has('gate-policy-invalid') && codes.has('adapter-registration-drifted'));
});

/* -------------------------------------------------------------------------
 * TB-062: re-pin a changed policy in one consented step.
 *
 * Every fixture below is a clone activated through the real `gate activate`,
 * whose `.agent-framework.yaml` a maintainer then edits by hand — the only
 * path by which a policy ever changes on a real project.
 * ------------------------------------------------------------------------- */

/** The same configuration with its one required check demoted to advisory. */
const demotedConfiguration = () => activatableConfiguration()
  .replace(
    '    required:\n      - configuration.broad-tests.test\n    advisory: []\n',
    '    required: []\n    advisory:\n      - configuration.broad-tests.test\n',
  );

/**
 * THE FIRST RED TEST OF TB-062.
 *
 * `SG-CFG-001`, `AC-CFG-003`. A clone whose policy was weakened since
 * activation, asked to `sync`, refuses with the weakening named and no token —
 * where the deactivate/activate pair pins the same edit without comment.
 */
test('TB-062 SG-CFG-001 / AC-CFG-003: a sync of a weakened policy is refused with the weakening named and no token', async (t) => {
  const root = await commandActivatedClone(t);

  await writeFile(path.join(root, '.agent-framework.yaml'), demotedConfiguration(), 'utf8');

  const before = await cloneFingerprint(root);
  const preview = await observe(root, ['sync']);
  const { observation } = preview.document;

  assert.equal(await cloneFingerprint(root), before, 'a sync preview wrote to the clone.');
  assert.equal(preview.exitCode, EXIT_UNHEALTHY);
  assert.equal(preview.document.mutation, null);
  assert.equal(observation.confirmationToken, null);
  assert.equal(observation.refusal.reasonCode, 'weakening-unacknowledged');
  assert.equal(observation.transition.weakened, true);
  assert.deepEqual(
    observation.transition.weakenings.map((weakening) => [weakening.code, weakening.checkId]),
    [['required-check-demoted', 'configuration.broad-tests.test']],
  );
  assert.notEqual(observation.trusted.identity, observation.candidate.identity);
  assert.match(preview.stdout, /WEAKER than the trusted policy/);
  assert.match(preview.stdout, /required-check-demoted configuration\.broad-tests\.test/);
  assert.match(nextLineOf(preview), /--acknowledge-weakening/);
  assert.doesNotMatch(nextLineOf(preview), /--confirm/);
});

/** Where an activated clone's receipt lives. */
const receiptPathOf = (root) => path.join(root, '.git/change-evaluation-gate/evidence/activation/receipt.json');

const receiptOf = async (root) => JSON.parse(await readFile(receiptPathOf(root), 'utf8'));

/** Every byte of every registration a sync must keep, and of the receipt. */
const registrationBytes = async (root, files = []) => JSON.stringify(await Promise.all(
  ['.git/hooks/pre-commit', ...files].map(async (file) => [file, await readFile(path.join(root, file), 'base64').catch(() => null)]),
));

/** A tightened policy: a shorter budget is never weaker. */
const tightenedConfiguration = () => activatableConfiguration({ totalSeconds: 300 });

/**
 * `FR-LIFE-004`, `AC-LIFE-010`, `NFR-SEC-004`. One previewed, confirmed
 * command re-pins a policy that is not weaker, keeps the registration byte for
 * byte, and the next commit is graded under the candidate with no drift.
 */
test('TB-062 FR-LIFE-004 / AC-LIFE-010: one confirmed sync pins a candidate that is not weaker, and the next commit is graded under it', async (t) => {
  const root = await commandActivatedClone(t);
  const prior = await receiptOf(root);
  const hookBefore = await registrationBytes(root);

  await writeFile(path.join(root, '.agent-framework.yaml'), tightenedConfiguration(), 'utf8');

  const preview = await observe(root, ['sync']);
  const { observation } = preview.document;

  // What was, what is, and the adapters it keeps — and no extra selector.
  assert.equal(preview.exitCode, EXIT_OBSERVED);
  assert.equal(observation.trusted.identity, prior.configuration.identity);
  assert.equal(observation.trusted.source, 'committed-configuration');
  assert.notEqual(observation.candidate.identity, prior.configuration.identity);
  assert.equal(observation.transition.weakened, false);
  assert.deepEqual(observation.transition.weakenings, []);
  assert.deepEqual(observation.adapters.map((adapter) => adapter.id), ['git']);
  assert.equal(observation.hook.action, 'keep');
  assert.equal(observation.refusal, null);
  assert.match(preview.stdout, /^policy transition: not weaker than the trusted policy$/m);
  assert.match(preview.stdout, /^adapters kept: git$/m);
  assert.equal(nextLineOf(preview), `gate sync --confirm ${tokenOf(preview)}`);

  const confirmed = await observe(root, ['sync', '--confirm', tokenOf(preview)]);

  assert.equal(confirmed.exitCode, EXIT_OBSERVED, confirmed.document.mutation.summary);
  assert.equal(confirmed.document.mutation.performed, true);
  assert.equal(confirmed.document.mutation.priorReceiptId, prior.receiptId);

  // NFR-SEC-004: the receipt pins the candidate, and keeps its lineage.
  const synced = await receiptOf(root);

  assert.equal(synced.configuration.identity, observation.candidate.identity);
  assert.equal(synced.configuration.policy.budget.total_seconds, 300);
  assert.deepEqual(synced.receiptLineage, [prior.receiptId]);
  assert.equal(synced.activatedAt, prior.activatedAt);
  assert.deepEqual(synced.runtime.gate, prior.runtime.gate);
  assert.equal(synced.receiptId, confirmed.document.mutation.receiptId);

  // The registration was kept, byte for byte — it still names the receipt
  // that authorized it, which the lineage keeps this activation's.
  assert.equal(await registrationBytes(root), hookBefore);

  // Status and the next commit agree: healthy, and graded under the candidate.
  const status = await observe(root, ['status']);

  assert.equal(status.document.observation.health, 'healthy');
  assert.equal(nextLineOf(status), 'nothing');

  await stageEdit(root, 'baseline\nBROKEN\n');

  const denied = await commitAttempt(root, 'a failing change');

  assert.equal(denied.committed, false);
  assert.doesNotMatch(denied.output, /integrity-drift/);
  assert.match(denied.output, /failed/);

  await stageEdit(root, 'baseline\nrepaired\n');
  assert.equal((await commitAttempt(root, 'after the sync')).committed, true);

  // Recorded as the Activation transaction it is.
  const events = (await (await storeFor(root)).readEvents()).filter((event) => event.type === 'activation');

  assert.equal(events.at(-1).outcome, 'succeeded');
  assert.equal(events.at(-1).before, prior.receiptId);
  assert.equal(events.at(-1).after, synced.receiptId);

  // A second sync over an unchanged configuration has nothing to do.
  const again = await observe(root, ['sync']);

  assert.equal(again.exitCode, EXIT_OBSERVED);
  assert.equal(again.document.observation.confirmationToken, null);
  assert.equal(nextLineOf(again), 'nothing to sync');
});

/**
 * `SG-CFG-001`, `AC-CFG-003`. The acknowledgement is a selector the operator
 * names, and the token binds the candidate and that acknowledgement together:
 * a confirmation without it, or against a candidate that moved, pins nothing.
 * The trusted policy a second sync judges against is the one the first pinned.
 */
test('TB-062 SG-CFG-001 / AC-CFG-003: an acknowledged weakening is pinned only by the token that binds the candidate and the acknowledgement', async (t) => {
  const root = await commandActivatedClone(t);

  // First a sync that is not weaker, left uncommitted, so the trusted policy
  // of the next one can only come from the receipt the first one wrote.
  await writeFile(path.join(root, '.agent-framework.yaml'), tightenedConfiguration(), 'utf8');
  assert.equal((await observe(root, ['sync', '--confirm', tokenOf(await observe(root, ['sync']))])).document.mutation.performed, true);

  const trustedReceipt = await receiptOf(root);
  const hookBefore = await registrationBytes(root);

  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    demotedConfiguration().replace('total_seconds: 600', 'total_seconds: 300'),
    'utf8',
  );

  const refused = await observe(root, ['sync']);

  assert.equal(refused.document.observation.trusted.source, 'receipt');
  assert.equal(refused.document.observation.refusal.reasonCode, 'weakening-unacknowledged');
  assert.equal(refused.document.observation.confirmationToken, null);

  const acknowledged = await observe(root, ['sync', '--acknowledge-weakening']);
  const token = tokenOf(acknowledged);

  assert.equal(acknowledged.exitCode, EXIT_OBSERVED);
  assert.equal(acknowledged.document.observation.acknowledgedWeakening, true);
  assert.equal(acknowledged.document.observation.transition.weakened, true);
  assert.match(acknowledged.stdout, /^policy transition: WEAKER than the trusted policy \(1\)$/m);
  assert.match(acknowledged.stdout, /^weakening acknowledged: true$/m);
  assert.equal(nextLineOf(acknowledged), `gate sync --acknowledge-weakening --confirm ${token}`);

  // The same token without the acknowledgement is refused, recorded, and
  // writes nothing: the preview it reproduces offers no token at all.
  const unacknowledged = await observe(root, ['sync', '--confirm', token]);

  assert.equal(unacknowledged.exitCode, EXIT_UNHEALTHY);
  assert.equal(unacknowledged.document.mutation.performed, false);
  assert.equal(unacknowledged.document.mutation.reasonCode, 'weakening-unacknowledged');
  assert.deepEqual(await receiptOf(root), trustedReceipt);

  // A candidate that moved after the preview is a different candidate.
  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    demotedConfiguration().replace('total_seconds: 600', 'total_seconds: 200'),
    'utf8',
  );

  const moved = await observe(root, ['sync', '--acknowledge-weakening', '--confirm', token]);

  assert.equal(moved.document.mutation.performed, false);
  assert.equal(moved.document.mutation.reasonCode, 'preview-mismatch');
  assert.deepEqual(await receiptOf(root), trustedReceipt);

  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    demotedConfiguration().replace('total_seconds: 600', 'total_seconds: 300'),
    'utf8',
  );

  const pinned = await observe(root, ['sync', '--acknowledge-weakening', '--confirm', token]);

  assert.equal(pinned.document.mutation.performed, true, pinned.document.mutation.summary);
  assert.match(pinned.document.mutation.summary, /weaker than the policy it replaced.*required-check-demoted configuration\.broad-tests\.test/);
  assert.deepEqual(
    (await receiptOf(root)).supersedes.weakenings.map((weakening) => weakening.code),
    ['required-check-demoted'],
  );
  assert.deepEqual((await receiptOf(root)).receiptLineage, [trustedReceipt.receiptId, ...trustedReceipt.receiptLineage]);
  assert.equal(await registrationBytes(root), hookBefore);

  // The weaker policy is the one the next commit is graded under: the check
  // is advisory now, so a failing change is no longer blocked.
  await stageEdit(root, 'baseline\nBROKEN\n');

  const committed = await commitAttempt(root, 'graded under the acknowledged policy');

  assert.equal(committed.committed, true, committed.output);
});

/**
 * The hook block and every adapter registration file are byte-identical before
 * and after a sync that changed only the policy, for a desktop client whose
 * registration lives in its own file.
 */
test('TB-062: a sync keeps every registration file byte for byte, a desktop client\'s included', async (t) => {
  const root = await throwawayRepository(t);
  const surface = describeAdapter('cursor').registration.file;

  await mkdir(path.join(root, 'tools'), { recursive: true });
  await mkdir(path.join(root, 'app'), { recursive: true });
  await mkdir(path.join(root, path.dirname(surface)), { recursive: true });
  await writeFile(path.join(root, surface), `${JSON.stringify({ version: 1, hooks: {} }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(root, 'tools/check.mjs'), markingCheckScript(null), 'utf8');
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\n', 'utf8');
  await writeFile(path.join(root, '.agent-framework.yaml'), activatableConfiguration(), 'utf8');
  await runGit(root, ['add', '--all']);
  await commitAttempt(root, 'baseline');

  const activation = await observe(root, ['activate', '--client', 'cursor']);

  assert.equal((await observe(root, ['activate', '--client', 'cursor', '--confirm', tokenOf(activation)])).document.mutation.performed, true);

  const before = await registrationBytes(root, [surface]);
  const prior = await receiptOf(root);

  assert.match(await readFile(path.join(root, surface), 'utf8'), /gate-preflight\.mjs/, 'the fixture registered nothing in the client file.');

  await writeFile(path.join(root, '.agent-framework.yaml'), tightenedConfiguration(), 'utf8');

  const preview = await observe(root, ['sync']);

  assert.deepEqual(preview.document.observation.adapters.map((adapter) => adapter.id), ['git', 'cursor']);
  assert.deepEqual(
    preview.document.observation.adapterRegistrations.map((registration) => [registration.adapter, registration.state, registration.action]),
    [['cursor', 'registered', 'keep']],
  );

  const confirmed = await observe(root, ['sync', '--confirm', tokenOf(preview)]);

  assert.equal(confirmed.document.mutation.performed, true, confirmed.document.mutation.summary);
  assert.equal(await registrationBytes(root, [surface]), before);
  assert.deepEqual(
    (await receiptOf(root)).adapters.map((adapter) => adapter.registration ?? null),
    prior.adapters.map((adapter) => adapter.registration ?? null),
  );
  assert.equal((await observe(root, ['status'])).document.observation.health, 'healthy');
});

/** The library request `gate sync` builds, for a failure-injection fixture. */
const librarySyncRequest = async (root) => {
  const configuration = parseConfigurationDocument(await readFile(path.join(root, '.agent-framework.yaml'), 'utf8')).value;
  const committed = parseConfigurationDocument(activatableConfiguration()).value;

  return {
    scope: 'repository',
    trigger: 'explicit',
    repository: { root },
    configuration: { schemaVersion: configuration.schema_version, policy: configuration.evaluation_gate },
    runtime: { hookProgram: { interpreter: process.execPath, script: PACKAGED_HOOK_PROGRAM, args: [] } },
    checks: gateChecksFromConfiguration(configuration).checks,
    runtimeInputs: [],
    prior: await receiptOf(root),
    trusted: { schemaVersion: committed.schema_version, policy: committed.evaluation_gate, source: 'fixture' },
  };
};

const librarySyncDependencies = (overrides = {}) => ({
  runGit,
  environment: isolatedGitEnvironment(),
  establishTrust: async () => ({ established: true, grantedBy: 'fixture', at: '2026-09-25T00:00:00.000Z' }),
  selfTestEvaluation: async () => ({ ok: true, detail: 'evaluation process reached a decision' }),
  selfTestHookProgram: async () => ({ ok: true, detail: 'hook program denied its subject' }),
  selfTestAdapter: async (adapter) => ({ ok: true, detail: `${adapter.id} responded` }),
  ...overrides,
});

/**
 * `AC-LIFE-009`. A sync that fails at any step leaves the prior receipt and
 * every registration exactly as they were — before the receipt switch, and
 * after it, where the switch itself is what the rollback takes back.
 */
test('TB-062 AC-LIFE-009: a sync that fails a self-test, or fails after the switch, leaves the prior receipt and registrations intact', async (t) => {
  const root = await commandActivatedClone(t);

  await writeFile(path.join(root, '.agent-framework.yaml'), tightenedConfiguration(), 'utf8');

  const receiptBytes = await readFile(receiptPathOf(root), 'utf8');
  const registrations = await registrationBytes(root);
  const request = await librarySyncRequest(root);
  const preview = await previewSync(request, librarySyncDependencies());
  const consent = {
    previewId: preview.previewId,
    repositoryIdentity: preview.repository.identity,
    configurationIdentity: preview.candidate.identity,
    grantedAt: '2026-09-25T00:00:00.000Z',
  };

  assert.equal(preview.refusal, null);

  // A self-test that cannot prove the evaluation process denies.
  const store = await storeFor(root);
  const failed = await syncActivation({ ...request, consent }, librarySyncDependencies({
    evidenceStore: store,
    selfTestEvaluation: async () => ({ ok: false, detail: 'the evaluation process did not deny its subject' }),
  }));

  assert.equal(failed.activated, false);
  assert.equal(failed.step, 'self-test');
  assert.equal(failed.reasonCode, 'self-test-failed');
  assert.equal(failed.state, 'activated');
  assert.equal(await readFile(receiptPathOf(root), 'utf8'), receiptBytes);
  assert.equal(await registrationBytes(root), registrations);
  assert.equal((await store.readEvents()).at(-1).outcome, 'failed');
  assert.match((await store.readEvents()).at(-1).reason, /the prior receipt .* and every registration are exactly as they were/);

  // A switch that cannot be recorded is taken back: the prior receipt is
  // restored exactly, never left half re-pinned.
  const unrecordable = { ...store, appendLifecycleEvent: async () => { throw new Error('the store refused the append'); } };
  const unrecorded = await syncActivation({ ...request, consent }, librarySyncDependencies({ evidenceStore: unrecordable }));

  assert.equal(unrecorded.activated, false);
  assert.equal(unrecorded.step, 'git-enablement');
  assert.equal(unrecorded.reasonCode, 'activation-record-failed');
  assert.equal(unrecorded.state, 'activated');
  assert.deepEqual(unrecorded.rollback.actions, ['receipt']);
  assert.deepEqual(JSON.parse(await readFile(receiptPathOf(root), 'utf8')), JSON.parse(receiptBytes));
  assert.equal(await registrationBytes(root), registrations);

  // And the clone is exactly as drifted as it was: the next commit is still
  // denied for the configuration nobody re-pinned.
  await stageEdit(root, 'baseline\nrepaired\n');
  assert.match((await commitAttempt(root, 'still drifted')).output, /integrity-drift/);
});

/**
 * Sync keeps the adapter set its receipt pins and infers it from nothing else.
 * A receipt whose adapters the installed gate no longer declares is refused
 * and names deactivate/activate; a receipt that no longer reproduces its own
 * identity is refused rather than re-pinned on top of; a trusted policy no
 * document reproduces is refused rather than guessed.
 */
test('TB-062: sync refuses a changed adapter set, a drifted receipt, and an unrecoverable trusted policy, and names what to do', async (t) => {
  // The adapter set: a supporting surface this installed gate stopped declaring.
  const { root, store } = await activatedClone(t, { adapters: RETIRED_ADAPTERS });
  const before = await cloneOutsideEvidence(root, store.paths.root);
  const retired = await observe(root, ['sync']);

  assert.equal(retired.exitCode, EXIT_UNHEALTHY);
  assert.equal(retired.document.observation.refusal.reasonCode, 'adapter-set-changed');
  assert.equal(retired.document.observation.confirmationToken, null);
  assert.equal(nextLineOf(retired), remedyInstruction('activation-transaction', 'gate'));
  assert.match(nextLineOf(retired), /^gate deactivate, then gate activate — /);

  const forced = await observe(root, ['sync', '--confirm', `sha256:${'d'.repeat(64)}`]);

  assert.equal(forced.document.mutation.performed, false);
  assert.equal(forced.document.mutation.reasonCode, 'adapter-set-changed');
  assert.equal(await cloneOutsideEvidence(root, store.paths.root), before);
  assert.equal((await store.readEvents()).at(-1).outcome, 'refused');

  // A receipt edited by hand is receipt drift, never a base to re-pin on.
  const edited = await commandActivatedClone(t);
  const receipt = await receiptOf(edited);

  await writeFile(receiptPathOf(edited), `${JSON.stringify({ ...receipt, runtimeInputs: ['EDITED'] }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(edited, '.agent-framework.yaml'), tightenedConfiguration(), 'utf8');

  const drifted = await observe(edited, ['sync']);

  assert.equal(drifted.document.observation.refusal.reasonCode, 'receipt-drifted');
  // Through the shortcut this clone's activation recorded (`TB-065`).
  assert.match(nextLineOf(drifted), /^git gate deactivate, then git gate activate — /);

  // The trusted policy is accepted only from a document that reproduces the
  // pinned identity. A committed file that moved past it does not.
  const moved = await commandActivatedClone(t);

  await writeFile(path.join(moved, '.agent-framework.yaml'), tightenedConfiguration(), 'utf8');
  await runGit(moved, ['add', '--all']);
  await runGit(moved, ['-c', 'user.email=gate@example.test', '-c', 'user.name=Gate', 'commit', '--quiet', '--no-verify', '--message', 'past the gate']);
  await writeFile(path.join(moved, '.agent-framework.yaml'), demotedConfiguration(), 'utf8');

  const unrecoverable = await observe(moved, ['sync', '--acknowledge-weakening']);

  assert.equal(unrecoverable.document.observation.refusal.reasonCode, 'trusted-configuration-unrecoverable');
  assert.equal(unrecoverable.document.observation.trusted.source, null);
  assert.equal(unrecoverable.document.observation.confirmationToken, null);
  assert.match(unrecoverable.stdout, /^policy transition: cannot be judged/m);
});

/* -------------------------------------------------------------------------
 * TB-065: name the command that actually recovers.
 *
 * Every place the Gate tells a maintainer what to run renders through the one
 * remedy table in `remedies.mjs`. These fixtures run the named command on a
 * real clone rather than reading the sentence alone.
 * ------------------------------------------------------------------------- */

/** The incident's edit: a descriptor corrected after activation, the policy section untouched. */
const correctedDescriptorConfiguration = () => activatableConfiguration().replace(
  '            - app/Order.php\n',
  '            - app/Order.php\n            - --memory-limit=512M\n',
);

test('TB-065 NFR-OPER-001 / FR-LIFE-019 / AC-SEC-001: a corrected descriptor is denied naming git gate sync, repair refuses it and names the same remedy, and following that remedy exactly lets the next commit through', async (t) => {
  const root = await commandActivatedClone(t);

  assert.notEqual(correctedDescriptorConfiguration(), activatableConfiguration());
  await writeFile(path.join(root, '.agent-framework.yaml'), correctedDescriptorConfiguration(), 'utf8');
  await stageEdit(root, 'baseline\nrepaired\n');

  // AC-SEC-001: the denial is what it always was — `integrity-drift`, on the
  // descriptor surface — and now names what recovers it, through the shortcut
  // this clone's activation recorded.
  const denied = await commitAttempt(root, 'after the descriptor was corrected');

  assert.equal(denied.committed, false, 'a commit against drifted descriptors was accepted.');
  assert.match(denied.output, /unverified \/ deny/);
  assert.match(denied.output, /integrity-drift: The Gate control surface drifted independently of this change \(command-descriptors\)/);
  assert.ok(
    denied.output.includes(`Next: ${remedyInstruction('sync', 'git gate')}.`),
    `the denial does not name the sync that recovers it: ${denied.output}`,
  );
  assert.doesNotMatch(denied.output, /gate repair/);

  // Status and repair read the same table. Repair keeps its three findings,
  // restores nothing here, and says what does recover the clone.
  const status = await observe(root, ['status']);

  assert.equal(nextLineOf(status), remedyInstruction('sync', 'git gate'));

  const before = await cloneFingerprint(root);
  const repair = await observe(root, ['repair']);

  assert.deepEqual(repair.document.observation.actions, [], 'repair offered to restore something that is not a registration.');
  assert.deepEqual(
    repair.document.observation.unrepairable.map((finding) => `${finding.code}:${finding.surface}`),
    ['control-surface-drift:command-descriptors'],
  );
  assert.equal(nextLineOf(repair), remedyInstruction('sync', 'git gate'));
  assert.equal(await cloneFingerprint(root), before, 'previewing a repair wrote something.');

  // Performing exactly the named command — `git gate sync`, previewed and
  // confirmed through the clone's own shortcut — recovers the clone.
  const [, named] = denied.output.match(/Next: (git gate sync) — /);
  const verb = named.split(' ').at(-1);
  const preview = JSON.parse(await runGit(root, ['gate', verb, '--json']));
  const confirmed = JSON.parse(await runGit(root, ['gate', verb, '--confirm', preview.observation.confirmationToken, '--json']));

  assert.equal(confirmed.mutation.performed, true, JSON.stringify(confirmed.mutation));
  assert.equal((await observe(root, ['status'])).document.observation.health, 'healthy');

  const recovered = await commitAttempt(root, 'after the named recovery');

  assert.equal(recovered.committed, true, recovered.output);
});

test('TB-065: a remedy names git gate only where the clone carries the shortcut activation records', async (t) => {
  const root = await commandActivatedClone(t);

  // A `gate` alias somebody else owns runs something else.
  await runGit(root, ['config', '--local', 'alias.gate', '!echo mine']);
  await writeFile(path.join(root, '.agent-framework.yaml'), correctedDescriptorConfiguration(), 'utf8');
  await stageEdit(root, 'baseline\nrepaired\n');

  const denied = await commitAttempt(root, 'with a foreign alias');

  assert.equal(denied.committed, false);
  assert.ok(denied.output.includes(`Next: ${remedyInstruction('sync', 'gate')}.`), denied.output);
  assert.doesNotMatch(denied.output, /git gate/);
});

/**
 * `NFR-OPER-001`. Every runner-pin reason code the runners deny with has a
 * remedy, read from the source that emits them, and none of them is `gate
 * repair`, which re-pins nothing. With the TB-060 fixture above covering every
 * status code and every control surface, no drift the Gate reports can reach a
 * maintainer without a remedy.
 */
test('TB-065 NFR-OPER-001: every control surface and every runner-pin reason code has a remedy entry, and only a registration is repaired', async () => {
  const hookRunner = await readFile(path.join(LIBRARY, 'hook-runner.mjs'), 'utf8');
  const pinning = hookRunner.slice(
    hookRunner.indexOf('export const pinnedRunners'),
    hookRunner.indexOf('\n};\n', hookRunner.indexOf('export const pinnedRunners')),
  );
  const pinCodes = new Set([...pinning.matchAll(/pinDenial\(\s*'([a-z-]+)'/g)].map((match) => match[1]));

  assert.deepEqual([...pinCodes].sort(), ['runner-pin-drift', 'runner-unpinned']);
  // Every denial in the pinning path renders through the table.
  assert.doesNotMatch(pinning, /reasonCode: 'runner-/);

  for (const code of pinCodes) {
    assert.equal(typeof REMEDIES[code], 'string', `${code} has no remedy entry.`);
    assert.equal(REMEDIES[code], 'sync', `${code} is re-pinned by a sync, never repaired.`);
    assert.ok(remedyInstruction(REMEDIES[code]) !== null, `${code}'s remedy renders nothing.`);
  }

  for (const surface of CONTROL_SURFACES) {
    const remedy = REMEDIES['control-surface-drift'][surface];

    assert.equal(typeof remedy, 'string', `control-surface drift of ${surface} has no remedy.`);
    assert.ok(remedyInstruction(remedy) !== null, `${surface}'s remedy renders nothing.`);
    // FR-LIFE-019: a gate-owned registration is repaired; everything else is
    // re-established by an Activation transaction.
    assert.equal(
      remedy === 'repair',
      surface === 'managed-hooks',
      `${surface} names ${remedy}, but only the managed hook registration is repair's to restore.`,
    );
    assert.ok(['repair', 'sync', 'activation-transaction'].includes(remedy), `${surface} names ${remedy}.`);
  }

  // What survives each recovery is stated in it.
  for (const remedy of ['repair', 'sync', 'activation-transaction']) {
    assert.match(remedyInstruction(remedy), /keeps \.agent-framework\.yaml and all historical Evidence/);
  }
});

/**
 * One table, proved by absence: no Gate library module but the table's own
 * names a recovery command in its code. Comments may mention a command; the
 * usage text lists them; neither tells a maintainer what recovers a drift.
 */
test('TB-065: one remedy table serves every site, and no inline remedy string remains', async () => {
  const sources = (await readdir(LIBRARY)).filter((entry) => entry.endsWith('.mjs'));
  const inline = /gate repair|gate deactivate|deactivate, then|`gate sync`|'gate sync'|re-pin what this clone was activated with/;

  for (const source of sources) {
    const contents = await readFile(path.join(LIBRARY, source), 'utf8');

    if (source === 'remedies.mjs') {
      continue;
    }

    const code = contents
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\/\*\*?|\*)/.test(line))
      // The usage text lists every command; it recommends none.
      .filter((line) => !/^\s*'  gate [a-z]+ /.test(line));

    for (const line of code) {
      assert.doesNotMatch(line, inline, `${source} names a remedy inline: ${line.trim()}`);
    }

    assert.doesNotMatch(contents, /REMEDIES = |remedyInstruction = /, `${source} defines a second remedy table.`);
  }
});

/**
 * AC-LIFE-010. Repair's scope is untouched: it previews exactly the three
 * registration findings, and reports a drifted configuration beside them as
 * unrepairable rather than restoring it.
 */
test('TB-065 AC-LIFE-010: repair still restores exactly its three findings and reports configuration drift beside them as unrepairable', async (t) => {
  const root = await commandActivatedClone(t);
  const hookPath = path.join(root, '.git/hooks/pre-commit');

  await writeFile(hookPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await writeFile(path.join(root, '.agent-framework.yaml'), correctedDescriptorConfiguration(), 'utf8');

  const preview = await observe(root, ['repair']);
  const { observation } = preview.document;

  assert.ok(observation.actions.length > 0, 'the clobbered registration is repair\'s to restore.');
  assert.ok(
    observation.actions.every((action) => ['hook-absent', 'hook-block-tampered', 'hook-receipt-mismatch'].includes(action.code)
      && action.kind === 'hook-registration'),
    JSON.stringify(observation.actions),
  );
  assert.deepEqual(
    observation.unrepairable.map((finding) => `${finding.code}:${finding.surface}`),
    ['control-surface-drift:command-descriptors'],
  );
  assert.deepEqual(observation.next.remedies.map((remedy) => remedy.remedy), ['sync']);
});
