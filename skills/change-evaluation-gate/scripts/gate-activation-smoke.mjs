#!/usr/bin/env node
/**
 * `gate-activation-smoke` — the packaged Activation transaction and the
 * authoritative commit it enables.
 *
 * Proves, against throwaway Git repositories, a real materialized Evaluation
 * snapshot, real spawned check processes, a real registered `pre-commit` hook,
 * and real `git commit` invocations:
 *
 * 1. `packaged-activation` — an explicit, previewed, consented activation
 *    resolves every logical runner to a platform executable, establishes
 *    client-controlled trust, validates the existing hook chain, self-tests the
 *    evaluation process and the selected adapters, publishes a pinned receipt,
 *    and enables authoritative Git LAST; repeating it refuses rather than
 *    taking over the hook it already owns (AC-LIFE-002, SG-HOOK-001).
 * 2. `authoritative-commit` — the activated clone really blocks a commit whose
 *    required check fails and really allows one whose checks pass. This is the
 *    only scenario that proves the gate is authoritative rather than advisory.
 *    Both decisions also leave an Evidence envelope and a Lifecycle event in
 *    the clone-local store the receipt identifies (TB-026, FR-EVID-001,
 *    FR-EVID-005, AC-EVID-001).
 * 3. `rollback-leaves-no-trace` — a genuine failure injected immediately before
 *    Git enablement leaves no receipt, no registration, and a clone that still
 *    commits exactly as it did while merely configured (FR-LIFE-005,
 *    NFR-REL-002, SG-LIFE-001).
 * 4. `hook-program-self-test` — a registered hook program that exits `0` for a
 *    change it must deny is refused at the `self-test` step: the clone is left
 *    configured with no receipt and no hook, the throwaway subject the proof
 *    ran against is gone, and the clone still commits (AC-LIFE-002,
 *    NFR-REL-003, SG-LIFE-001).
 * 5. `vendor-binary-commit` — a clone whose required check is a `composer-bin`
 *    descriptor runs the binary under its own vendor directory: activation pins
 *    it and the interpreter its shebang names, the binary loads the project's
 *    git-ignored installed dependencies from inside the materialized snapshot,
 *    commits are allowed and denied by it, the evidence names it, and a pin
 *    whose executable was removed denies as drift rather than re-resolving to
 *    another program (FR-EVAL-001, AC-EVAL-001, FR-PROF-010, NFR-REL-003,
 *    TB-028, TB-030).
 * 6. `interrupted-commit-leaves-no-root` — a real `git commit` interrupted with
 *    `SIGINT` mid-evaluation, the way a maintainer presses Ctrl-C on a slow
 *    commit, terminates under the signal, moves no HEAD, and leaves no
 *    execution root; a root an earlier abandoned run left behind is reclaimed
 *    by the next commit, and those commits still deny and allow exactly as they
 *    did before (TB-038, AC-CFG-004, AC-EVAL-004, SG-SECRET-001, NFR-REL-001).
 *
 * It is non-interactive and offline, requires no external toolchain beyond Git
 * and this Node runtime, and is safe to run repeatedly on a clean machine.
 *
 * SAFETY: every fixture is a throwaway repository created under the OS
 * temporary directory and removed afterwards. `assertThrowawayRepository`
 * refuses any root that is not under that directory or that lies inside this
 * repository, because an escaped fixture would register an authoritative hook
 * in the framework clone and block every later commit.
 *
 * Usage:
 *   node skills/change-evaluation-gate/scripts/gate-activation-smoke.mjs [--json]
 *
 * Exit status is 0 only when every scenario holds.
 */

import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  configureGate,
  draftGatePolicy,
  draftMigrationMapping,
  migrateConfiguration,
  previewConfigurationMigration,
  previewGateConfiguration,
} from '../../framework-setup/scripts/configure.mjs';
import {
  ACTIVATION_RECEIPT_VERSION,
  ACTIVATION_STEPS,
  activate,
  previewActivation,
  registerOwnedHook,
} from './lib/activation.mjs';
import { createBoundedExecutor } from './lib/bounded-execution.mjs';
import { createRunnerResolver } from './lib/command-descriptor.mjs';
import {
  CONFIGURATION_FILE,
  gateChecksFromConfiguration,
  readRepositoryConfiguration,
} from './lib/configuration.mjs';
import { evaluate } from './lib/evaluate.mjs';
import { openEvidenceStore } from './lib/evidence-store.mjs';
import {
  EXECUTION_ROOT_PREFIXES,
  EXECUTION_ROOT_RETENTION_MS,
} from './lib/hook-runner.mjs';
import { validateGatePolicy } from './lib/policy.mjs';

const CAPABILITY = 'gate-activation-smoke';

/**
 * The packaged runner an activated clone registers.
 *
 * This capability used to write its own fixture hook program, which is why it
 * passed while `registerOwnedHook` had nothing to point at. It now drives the
 * shipped entry point, so a clone that cannot be enforced fails here.
 */
const PACKAGED_RUNNER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'gate-precommit.mjs',
);

/** This repository. No fixture may ever touch its Git state or its hooks. */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const SOURCE = 'app/Order.php';

/** The token that makes the graded source fail its required check. */
const BREAKAGE = 'BROKEN';

/** The one check identity this fixture's Gate policy requires. */
const REQUIRED_CHECK = 'configuration.broad-tests.test';

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
  '-c', 'user.name=Gate Activation Smoke',
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
 * The schema v3 input the framework migrates before the packaged runner reads it.
 *
 * It is the single source for this fixture's Gate policy and its one required
 * check: the activation request derives both from it through the supported
 * configuration reader, and the registered runner reads the same file again at
 * commit time. Nothing here restates a command the configuration already owns.
 */
const SCHEMA_V3_MIGRATION_INPUT = [
  'schema_version: 3',
  'backend: unknown',
  'frontend: none',
  'tracker: local-markdown',
  'artifacts:',
  '  srs: null',
  '  glossary: null',
  '  adrs: null',
  'guidelines: []',
  'source_scopes:',
  '  backend:',
  '    - app',
  '  frontend: []',
  '  shared: []',
  'verification:',
  '  profile: gate-activation-smoke',
  '  capabilities: []',
  '  commands:',
  '    test:',
  '      backend: []',
  '      frontend: []',
  '      both:',
  '        - "node tools/check.mjs app/Order.php"',
  'history:',
  '  path: docs/history',
  '  required: false',
  'protected_files: []',
  '',
].join('\n');

const MIGRATION_MAPPINGS = {
  profiles: { backend: 'express-typescript' },
  commands: {
    'verification.commands.test.both[0]': {
      runner: 'repository-script',
      args: ['tools/check.mjs', SOURCE],
      timeout_seconds: 60,
      allowed_environment: ['PATH'],
    },
  },
};

const GATE_POLICY = {
  checks: { required: [REQUIRED_CHECK], advisory: [] },
  budget: { total_seconds: 600 },
  bypass: { enabled: false, marker: null },
  execution: { budget_skippable: [] },
  evidence: {},
};

const fixtureConfigurations = new Map();

/** A throwaway clone with one baseline commit, a check, and a configuration. */
const fixtureRepository = async ({
  mappings = MIGRATION_MAPPINGS,
  files = {},
  policy = GATE_POLICY,
} = {}) => {
  const root = await temporaryDirectory('gate-activation-smoke-repo-');

  await assertThrowawayRepository(root);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/check.mjs'), CHECK_SCRIPT, 'utf8');
  await writeFile(path.join(root, CONFIGURATION_FILE), SCHEMA_V3_MIGRATION_INPUT, 'utf8');

  for (const [relative, file] of Object.entries(files)) {
    const target = path.join(root, relative);

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.contents, { encoding: 'utf8', mode: file.mode ?? 0o644 });
  }

  const migration = await previewConfigurationMigration({
    projectRoot: root,
    mappings,
  });

  await migrateConfiguration({
    projectRoot: root,
    mappings,
    confirmation: migration.previewHash,
  });

  const gateConfiguration = await previewGateConfiguration({
    projectRoot: root,
    policy,
  });

  await configureGate({
    projectRoot: root,
    policy,
    confirmation: gateConfiguration.previewHash,
  });

  const configured = await readRepositoryConfiguration({ repositoryRoot: root });

  if (!configured.ok) {
    throw new Error(`the migrated and Gate-configured fixture is unreadable: ${configured.detail}`);
  }

  fixtureConfigurations.set(root, configured.configuration);
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
    actor: { name: 'gate-activation-smoke', source: 'fixture' },
    client: { id: 'git', surface: 'git-pre-commit', version: '1.0.0' },
    gate: { id: 'change-evaluation-gate', version: '1.0.0', protocolVersion: '1.0' },
    repository: { identity: `sha256:${'0'.repeat(64)}` },
  },
});

/**
 * The fixture's Gate policy and checks, read from the clone configuration.
 *
 * They are read rather than restated so the activation transaction and the
 * registered runner are bound by the same file. A fixture that stated its own
 * copy is exactly how release qualification came to pass while no packaged
 * runner existed at all.
 */
const configured = (root) => {
  const configuration = fixtureConfigurations.get(root);

  if (!configuration) {
    throw new Error(`the fixture configuration was not read for ${root}`);
  }

  const { checks, errors } = gateChecksFromConfiguration(configuration);

  if (errors.length > 0) {
    throw new Error(`the fixture configuration resolves no checks: ${JSON.stringify(errors)}`);
  }

  return { policy: configuration.evaluation_gate, checks };
};

const gatePolicy = (root) => configured(root).policy;

const activationRequest = (root) => ({
  scope: 'repository',
  trigger: 'explicit',
  repository: { root },
  configuration: { schemaVersion: 4, policy: gatePolicy(root) },
  client: { id: 'git', surface: 'git-pre-commit', version: '1.0.0' },
  gate: { id: 'change-evaluation-gate', version: '1.0.0', protocolVersion: '1.0' },
  actor: { name: 'gate-activation-smoke', source: 'fixture' },
  runtime: {
    runnerVersion: 'gate-activation-smoke/1.0.0',
    // The PACKAGED runner, not a fixture. This substitution is the point of
    // the extension: the fixture supplying its own hook program is why release
    // qualification passed while no packaged runner existed.
    hookProgram: { interpreter: process.execPath, script: PACKAGED_RUNNER, args: [] },
  },
  checks: configured(root).checks,
  adapters: [{ id: 'git', version: '1.0.0', authoritative: true }],
  runtimeInputs: [{ name: 'APP_TOKEN', source: 'approved-environment-file' }],
});

/**
 * A real self-test of the evaluation process: it materializes the snapshot,
 * spawns the check, and requires a contract decision before Git may be enabled.
 */
const selfTestEvaluation = async ({ repository }) => {
  const collected = { checks: configured(repository.root).checks };
  // The shipped resolution rule, not a fixture of one: a self-test that
  // resolved differently from activation would prove the wrong program.
  const resolve = createRunnerResolver({ repositoryRoot: repository.root });
  const executor = createBoundedExecutor({
    resolveExecutable: (command) => resolve(command.runner, command),
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
    executionRoot: await temporaryDirectory('gate-activation-smoke-exec-'),
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

// No `resolveExecutable` is injected. Activation resolves through the shipped
// rule, so this capability observes the executables a real clone would run
// rather than the ones a fixture asserted (TB-024).
const dependencies = (overrides = {}) => ({
  runGit,
  establishTrust: async () => ({
    established: true,
    grantedBy: 'gate-activation-smoke',
    at: new Date().toISOString(),
  }),
  selfTestEvaluation,
  selfTestAdapter: async (adapter) => ({ ok: true, detail: `${adapter.id} responded` }),
  ...overrides,
});

const check = (findings, condition, detail) => {
  if (!condition) {
    findings.push(detail);
  }
};

/** Activate one fixture clone for real, through the real registration seam. */
const activateFixture = async (root, store, overrides = {}, requestOverrides = {}) => {
  await assertThrowawayRepository(root);

  const request = { ...activationRequest(root), ...requestOverrides };
  const preview = await previewActivation(request, dependencies());
  const consent = {
    previewId: preview.previewId,
    repositoryIdentity: preview.repository.identity,
    configurationIdentity: preview.configuration.identity,
    actor: { name: 'gate-activation-smoke', source: 'fixture' },
    grantedAt: new Date().toISOString(),
  };
  const result = await activate({ ...request, consent }, dependencies({
    evidenceStore: store,
    ...overrides,
  }));

  return { preview, result };
};

/** One explicit, previewed, consented activation that enables Git last. */
const packagedActivation = async () => {
  const findings = [];
  const root = await fixtureRepository();
  const store = await storeFor(root);
  const receiptSeenBeforeGit = [];

  const { preview, result } = await activateFixture(root, store, {
    // The real registration seam, wrapped only to observe that the pinned
    // receipt is already published when authoritative Git is switched on.
    registerHook: async (registration) => {
      receiptSeenBeforeGit.push(await store.activationReceipt().read() !== null);

      return registerOwnedHook(registration);
    },
  });

  check(findings, result.activated === true, `Activation did not succeed: ${result.reasonCode}.`);
  check(findings, result.state === 'activated', `Expected the activated state, got ${result.state}.`);
  check(
    findings,
    JSON.stringify(result.order) === JSON.stringify([...ACTIVATION_STEPS]),
    `The transaction did not run its declared steps: ${JSON.stringify(result.order)}.`,
  );
  check(
    findings,
    receiptSeenBeforeGit.length === 1 && receiptSeenBeforeGit[0] === true,
    'Authoritative Git was not enabled last: the pinned receipt was not published first.',
  );

  const receipt = result.receipt ?? {};

  check(
    findings,
    receipt.receiptVersion === ACTIVATION_RECEIPT_VERSION,
    `The receipt does not declare ${ACTIVATION_RECEIPT_VERSION}.`,
  );
  check(findings, receipt.previewId === preview.previewId, 'The receipt does not pin the previewed identities.');
  check(
    findings,
    receipt.configuration?.identity === preview.configuration.identity,
    'The receipt does not pin the configuration identity.',
  );
  check(
    findings,
    receipt.runtime?.runners?.length === 1
      && receipt.runtime.runners[0].executable === process.execPath
      && receipt.runtime.runners[0].version === process.versions.node,
    'The receipt does not pin the resolved runner identity and version.',
  );
  check(
    findings,
    receipt.adapters?.length === 1 && receipt.adapters[0].version === '1.0.0'
      && receipt.adapters[0].selfTest?.ok === true,
    'The receipt does not pin the adapter version and its self-test result.',
  );
  check(
    findings,
    receipt.hooks?.length === 1 && receipt.hooks[0].path === preview.hooks[0].path,
    'The receipt does not pin the hook location.',
  );
  check(findings, receipt.trust?.established === true, 'The receipt does not pin the trust state.');
  check(
    findings,
    JSON.stringify(receipt.runtimeInputs) === JSON.stringify(['APP_TOKEN']),
    'The receipt does not pin the runtime input names.',
  );
  check(
    findings,
    (receipt.selfTests ?? []).length === 3 && receipt.selfTests.every((selfTest) => selfTest.ok),
    'The receipt does not pin the self-test results.',
  );
  check(
    findings,
    (receipt.selfTests ?? []).some((selfTest) => selfTest.name === 'hook-program' && selfTest.ok === true),
    'The receipt does not record that the registered hook program was proved to deny.',
  );
  check(
    findings,
    JSON.stringify(await store.activationReceipt().read()) === JSON.stringify(receipt),
    'The published receipt is not what the transaction returned.',
  );

  // A real, executable, clearly owned hook exists at the previewed location.
  const hookPath = preview.hooks[0].path;
  const shim = await readFile(hookPath, 'utf8').catch(() => null);

  check(findings, shim !== null, `No hook was registered at ${hookPath}.`);
  check(
    findings,
    (shim ?? '').includes('change-evaluation-gate'),
    'The registered hook does not identify its owner.',
  );
  check(
    findings,
    (shim ?? '').includes(receipt.receiptId ?? 'sha256:none'),
    'The registered hook does not name the activation receipt it belongs to.',
  );
  check(
    findings,
    (((await stat(hookPath).catch(() => ({ mode: 0 }))).mode) & 0o111) !== 0,
    'The registered hook is not executable.',
  );
  // The substitution this capability was extended to make. A fixture runner
  // here is what let release qualification pass while no packaged runner
  // existed, so it is asserted rather than assumed.
  check(
    findings,
    (shim ?? '').includes(PACKAGED_RUNNER),
    `The registered hook does not run the packaged runner at ${PACKAGED_RUNNER}.`,
  );

  const events = await store.readEvents();

  check(
    findings,
    events.length === 1 && events[0].type === 'activation' && events[0].outcome === 'succeeded',
    `Expected exactly one succeeded activation event, got ${JSON.stringify(events.map((event) => event.outcome))}.`,
  );

  // Running it again refuses rather than taking over the hook it already owns.
  const again = await activateFixture(root, store);

  check(findings, again.result.activated === false, 'A second activation took over the existing hook.');
  check(
    findings,
    again.result.reasonCode === 'hook-exists',
    `Expected hook-exists on re-activation, got ${again.result.reasonCode}.`,
  );
  check(
    findings,
    (await readFile(hookPath, 'utf8')) === shim,
    'A refused re-activation changed the registered hook.',
  );

  return { name: 'packaged-activation', ok: findings.length === 0, findings, root, store, hookPath };
};

/** The activated clone really blocks and really allows real commits. */
const authoritativeCommit = async (activated) => {
  const findings = [];
  const { root } = activated;

  await assertThrowawayRepository(root);

  const before = (await runGit(root, ['rev-list', '--count', 'HEAD'])).trim();

  // A change whose required check fails must not become a commit.
  await writeFile(path.join(root, SOURCE), `baseline\n${BREAKAGE}\n`, 'utf8');
  await git(root, ['add', '--all']);

  const blocked = await commit(root, 'a change the gate must refuse').then(
    () => ({ failed: false, stdout: '', stderr: '' }),
    (error) => ({ failed: true, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }),
  );

  check(findings, blocked.failed === true, 'An authoritative gate allowed a failing change to commit.');
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

  // TB-026: the denial the maintainer just read on stderr also left a record.
  // `activated.store` reads the same physical store the packaged runner opened
  // internally, so this proves the runner is wired to persistence, not merely
  // that persistence itself works.
  const deniedLog = await activated.store.readLog();

  check(
    findings,
    deniedLog.length === 1,
    `The blocked commit did not leave exactly one Evidence envelope (found ${deniedLog.length}).`,
  );

  const deniedEnvelope = deniedLog.length === 1
    ? await activated.store.readEnvelope(deniedLog[0].evidenceId)
    : null;

  check(
    findings,
    deniedEnvelope?.decision?.checks?.find((entry) => entry.id === REQUIRED_CHECK)?.outcome === 'failed',
    "The blocked commit's Evidence envelope does not name the failing required check.",
  );

  // The same clone must still let good work through.
  await writeFile(path.join(root, SOURCE), 'baseline\nrepaired\n', 'utf8');
  await git(root, ['add', '--all']);

  const allowed = await commit(root, 'a change the gate must allow').then(
    () => ({ failed: false }),
    (error) => ({ failed: true, stderr: error.stderr ?? '' }),
  );

  check(findings, allowed.failed === false, `An authoritative gate blocked a passing change: ${allowed.stderr}.`);
  check(
    findings,
    Number((await runGit(root, ['rev-list', '--count', 'HEAD'])).trim()) === Number(before) + 1,
    'An allowed commit did not move HEAD.',
  );

  // TB-026: the store is append-only, so the allowed commit's envelope is the
  // second entry — proving persistence survives across commits, not only once.
  const allowedLog = await activated.store.readLog();

  check(
    findings,
    allowedLog.length === 2,
    `The allowed commit did not append a second Evidence envelope (found ${allowedLog.length}).`,
  );

  const allowedEnvelope = allowedLog.length === 2
    ? await activated.store.readEnvelope(allowedLog[1].evidenceId)
    : null;

  check(
    findings,
    allowedEnvelope?.decision?.authorization === 'allow',
    "The allowed commit's Evidence envelope does not record an allow.",
  );

  const evaluationEvents = (await activated.store.readEvents())
    .filter((event) => event.type === 'evaluation');

  check(
    findings,
    evaluationEvents.length === 2,
    `Expected one Lifecycle event per commit-time evaluation, got ${evaluationEvents.length}.`,
  );

  return { name: 'authoritative-commit', ok: findings.length === 0, findings };
};

/**
 * The activated clone is graded by the configuration it activated, or it is not
 * graded at all (`AC-SEC-001`, `AC-CFG-004`, `NFR-SEC-004`).
 *
 * This runs on the clone `authoritativeCommit` just proved: a real hook, a real
 * receipt, real commits. The weakening is a hand edit of the configuration file
 * because the supported writer refuses to reconfigure an already-configured
 * clone — which is exactly why the edit has to be noticed here: it is the one
 * route left, it needs no unusual step, and nothing else would ever see it.
 */
const activatedConfigurationBinds = async (activated) => {
  const findings = [];
  const { root, hookPath } = activated;

  await assertThrowawayRepository(root);

  const before = (await runGit(root, ['rev-list', '--count', 'HEAD'])).trim();
  const configurationPath = path.join(root, CONFIGURATION_FILE);
  const trustedConfiguration = await readFile(configurationPath, 'utf8');
  const weakenedConfiguration = trustedConfiguration.replace(
    `  checks: ${JSON.stringify(GATE_POLICY.checks)}`,
    `  checks: ${JSON.stringify({ required: [], advisory: [REQUIRED_CHECK] })}`,
  );

  check(
    findings,
    weakenedConfiguration !== trustedConfiguration,
    'The fixture policy could not be weakened, so nothing below proves anything.',
  );
  await writeFile(configurationPath, weakenedConfiguration, 'utf8');

  // The staged change is the same one the clone just refused. Only the policy
  // changed — and it changed on disk, without even being staged, which is how
  // little it would take.
  await writeFile(path.join(root, SOURCE), `baseline\n${BREAKAGE}\n`, 'utf8');
  await git(root, ['add', '--', SOURCE]);

  const denied = await commit(root, 'a change the weakened policy would allow').then(
    () => ({ failed: false, stdout: '', stderr: '' }),
    (error) => ({ failed: true, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }),
  );
  const deniedOutput = `${denied.stdout}${denied.stderr}`;

  check(findings, denied.failed === true, 'A policy edited after activation graded the next commit.');
  check(findings, deniedOutput.includes('integrity-drift'), 'The denial did not name integrity drift.');
  check(
    findings,
    deniedOutput.includes('trusted-configuration'),
    'The denial did not name the trusted configuration surface.',
  );
  check(findings, deniedOutput.includes('gate repair'), 'The denial did not name `gate repair`.');
  check(
    findings,
    (await runGit(root, ['rev-list', '--count', 'HEAD'])).trim() === before,
    'A commit denied for drift still moved HEAD.',
  );

  // Nothing was repaired: the weakened configuration is still exactly as its
  // author left it, and the receipt still pins what activation pinned.
  check(
    findings,
    await readFile(configurationPath, 'utf8') === weakenedConfiguration,
    'Observing drift rewrote the configuration it disagreed with.',
  );

  // Restoring the activated policy restores enforcement, so drift is a
  // reconciliation and never a latch.
  await writeFile(configurationPath, trustedConfiguration, 'utf8');
  await writeFile(path.join(root, SOURCE), 'baseline\nrepaired again\n', 'utf8');
  await git(root, ['add', '--all']);

  const allowed = await commit(root, 'a change the activated policy allows').then(
    () => ({ failed: false, stderr: '' }),
    (error) => ({ failed: true, stderr: error.stderr ?? '' }),
  );

  check(findings, allowed.failed === false, `The restored clone refused a passing change: ${allowed.stderr}.`);

  // The other surface a maintainer can reach without trying: the registered
  // hook itself. Editing the gate-owned block is drift of what activation
  // pinned, and it is reported by name.
  const registration = await readFile(hookPath, 'utf8');

  await writeFile(hookPath, `${registration}\n# edited after activation\n`, { encoding: 'utf8', mode: 0o755 });
  await writeFile(path.join(root, SOURCE), 'baseline\nrepaired once more\n', 'utf8');
  await git(root, ['add', '--all']);

  const tampered = await commit(root, 'a change under an edited registration').then(
    () => ({ failed: false, stdout: '', stderr: '' }),
    (error) => ({ failed: true, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }),
  );
  const tamperedOutput = `${tampered.stdout}${tampered.stderr}`;

  check(findings, tampered.failed === true, 'An edited hook registration still authorized a commit.');
  check(
    findings,
    tamperedOutput.includes('managed-hooks'),
    `The denial did not name the managed-hooks surface: ${tamperedOutput}`,
  );
  check(
    findings,
    (await readFile(hookPath, 'utf8')).includes('# edited after activation'),
    'Observing an edited registration repaired it.',
  );

  return { name: 'activated-configuration-binds', ok: findings.length === 0, findings };
};

/**
 * Whether a clone still commits exactly as it did while merely configured.
 *
 * `configured` is not a label the transaction gets to assert: it is observable.
 * Git is not authoritative, so a change an activated clone would have refused
 * becomes a commit (AC-LIFE-002, AC-EVAL-001).
 */
const stillCommitsAsConfigured = async (root, message) => {
  await writeFile(path.join(root, SOURCE), `baseline\n${BREAKAGE}\n`, 'utf8');
  await git(root, ['add', '--all']);

  return commit(root, message).then(() => true, () => false);
};

/**
 * TB-035: a receipt that cannot be published never enables authoritative Git.
 *
 * Without this, the clone is left with a registered hook and nothing for it to
 * honour: every commit denies `activation-receipt-missing` while the maintainer
 * was told activation succeeded (NFR-REL-002).
 */
const receiptFailureLeavesNoTrace = async () => {
  const findings = [];
  const root = await fixtureRepository();
  const store = await storeFor(root);
  const refusing = {
    ...store,
    activationReceipt: () => ({
      ...store.activationReceipt(),
      write: async () => {
        throw new Error('injected failure while publishing the activation receipt');
      },
    }),
  };
  const { preview, result } = await activateFixture(root, refusing);

  check(findings, result.activated === false, 'An activation with no receipt on disk reported success.');
  check(
    findings,
    result.state === 'configured',
    `A receipt failure reported ${result.state} rather than the configured state.`,
  );
  check(
    findings,
    result.step === 'receipt' && result.reasonCode === 'receipt-write-failed',
    `Expected a receipt failure, got ${result.step}/${result.reasonCode}.`,
  );
  check(
    findings,
    (await store.activationReceipt().read()) === null,
    'A failed receipt write left a receipt on disk.',
  );
  check(
    findings,
    (await readFile(preview.hooks[0].path, 'utf8').catch(() => null)) === null,
    'An activation with no receipt still registered a hook.',
  );
  check(
    findings,
    await stillCommitsAsConfigured(root, 'a clone with no receipt still commits'),
    'A clone whose receipt was never written was left refusing commits.',
  );

  return findings;
};

/** TB-035: an exception after a gate-owned mutation is compensated, not thrown. */
const interruptedActivationLeavesNoTrace = async () => {
  const findings = [];
  const root = await fixtureRepository();
  const store = await storeFor(root);
  const revoked = [];
  const { preview, result } = await activateFixture(root, store, {
    revokeTrust: async () => revoked.push('trust'),
    selfTestAdapter: async () => {
      throw new Error('injected exception after trust was established');
    },
  });

  check(findings, result.activated === false, 'An interrupted activation reported success.');
  check(
    findings,
    result.state === 'configured',
    `An interrupted activation reported ${result.state} rather than the configured state.`,
  );
  check(
    findings,
    result.reasonCode === 'activation-interrupted',
    `An interrupted activation reported ${result.reasonCode}.`,
  );
  check(findings, revoked.length === 1, 'The mutation made before the exception was not compensated.');
  check(
    findings,
    (await readFile(preview.hooks[0].path, 'utf8').catch(() => null)) === null,
    'An interrupted activation left a registered hook behind.',
  );
  check(
    findings,
    (await store.activationReceipt().read()) === null,
    'An interrupted activation left a receipt on disk.',
  );
  check(
    findings,
    await stillCommitsAsConfigured(root, 'a clone whose activation threw still commits'),
    'An interrupted activation left the clone refusing commits.',
  );

  return findings;
};

/**
 * TB-035: a compensating action that fails is reported, never assumed away.
 *
 * The failures were always collected. What this proves is that the reported
 * state now reflects them, and that it names what the maintainer has to deal
 * with by hand (SG-LIFE-001, FR-LIFE-019).
 */
const failedCompensationReportsRecovery = async () => {
  const findings = [];
  const root = await fixtureRepository();
  const store = await storeFor(root);
  const { preview, result } = await activateFixture(root, store, {
    revokeTrust: async () => {
      throw new Error('the client refused to withdraw the trust it granted');
    },
    registerHook: async () => {
      throw new Error('injected failure immediately before Git enablement');
    },
  });

  check(findings, result.activated === false, 'A half-unwound activation reported success.');
  check(
    findings,
    result.state === 'recovery-required',
    `A half-unwound clone reported ${result.state}, the same state a clean unwind reports.`,
  );
  check(
    findings,
    JSON.stringify(result.rollback.failures.map((failure) => failure.action)) === JSON.stringify(['trust']),
    `The failed compensating action was not named: ${JSON.stringify(result.rollback.failures)}.`,
  );
  check(
    findings,
    result.rollback.remains.length === 1 && result.rollback.remains[0].includes('Trust established'),
    `The report does not say what remains on disk: ${JSON.stringify(result.rollback.remains)}.`,
  );

  // Everything that did unwind is really gone: only the named change survives.
  check(
    findings,
    (await store.activationReceipt().read()) === null,
    'A half-unwound activation left its receipt on disk.',
  );
  check(
    findings,
    (await readFile(preview.hooks[0].path, 'utf8').catch(() => null)) === null,
    'A half-unwound activation left a registered hook behind.',
  );

  const events = await store.readEvents();

  check(
    findings,
    /requires recovery/.test(events.at(-1)?.reason ?? ''),
    `The recorded event does not say the clone requires recovery: ${events.at(-1)?.reason}.`,
  );
  check(
    findings,
    await stillCommitsAsConfigured(root, 'a clone that needs recovery still commits'),
    'A half-unwound activation left the clone refusing commits.',
  );

  return findings;
};

/** A failure immediately before Git enablement leaves nothing behind. */
const rollbackLeavesNoTrace = async () => {
  const findings = [];
  const root = await fixtureRepository();
  const store = await storeFor(root);
  const revoked = [];
  const attempted = [];

  const { preview, result } = await activateFixture(root, store, {
    revokeTrust: async () => revoked.push('trust'),
    registerHook: async (registration) => {
      attempted.push(registration.path);

      throw new Error('injected failure immediately before Git enablement');
    },
  });

  check(findings, result.activated === false, 'An injected failure still activated the clone.');
  check(findings, result.state === 'configured', `Expected the configured state, got ${result.state}.`);
  check(
    findings,
    result.step === 'git-enablement' && result.reasonCode === 'hook-registration-failed',
    `Expected a git-enablement failure, got ${result.step}/${result.reasonCode}.`,
  );
  check(findings, attempted.length === 1, 'The transaction never reached Git enablement.');
  check(findings, result.receipt === null, 'A failed activation returned a receipt.');
  check(
    findings,
    (await store.activationReceipt().read()) === null,
    'A failed activation left a receipt on disk.',
  );
  check(
    findings,
    (await readFile(preview.hooks[0].path, 'utf8').catch(() => null)) === null,
    'A failed activation left a registration behind.',
  );
  check(
    findings,
    JSON.stringify(result.rollback.actions) === JSON.stringify(['receipt', 'trust']),
    `Rollback did not unwind in reverse: ${JSON.stringify(result.rollback.actions)}.`,
  );
  check(findings, result.rollback.failures.length === 0, 'Rollback reported failures.');
  check(findings, revoked.length === 1, 'Rollback did not withdraw the established trust.');

  const events = await store.readEvents();

  check(
    findings,
    events.length === 1 && events[0].type === 'activation' && events[0].outcome === 'failed',
    'The failed transition was not recorded exactly once as a failure.',
  );

  // The clone is still merely configured: it commits exactly as it did before.
  await writeFile(path.join(root, SOURCE), `baseline\n${BREAKAGE}\n`, 'utf8');
  await git(root, ['add', '--all']);

  const committed = await commit(root, 'a configured clone still commits').then(
    () => true,
    () => false,
  );

  check(findings, committed === true, 'A failed activation still blocked a commit.');

  // TB-035: the same scenario at the other points a transaction can fail after
  // it has already changed something. Each clone must be one the maintainer can
  // either use or fix — and the transaction must say which.
  findings.push(...await receiptFailureLeavesNoTrace());
  findings.push(...await interruptedActivationLeavesNoTrace());
  findings.push(...await failedCompensationReportsRecovery());

  return { name: 'rollback-leaves-no-trace', ok: findings.length === 0, findings };
};

/** The binary name a `composer-bin` descriptor stores as its leading argument. */
const VENDOR_BINARY = 'gradecheck';

/** Where that binary really lives in a clone that installed its dependencies. */
const VENDOR_BINARY_PATH = path.join('vendor', 'bin', VENDOR_BINARY);

/** Where the vendor binary records, from inside itself, that it really ran. */
const VENDOR_BINARY_LEDGER = path.join('vendor', 'bin', 'ran.log');

/**
 * The installed dependency this project's own tool loads before it can work.
 *
 * It lives inside the git-ignored `vendor/`, so it is in no snapshot the gate
 * materializes unless the project declared that root and the gate provided it.
 */
const VENDOR_AUTOLOAD = 'vendor/autoload.sh';

/** The directories this fixture project installs its dependencies into. */
const VENDOR_DEPENDENCY_ROOTS = Object.freeze(['vendor']);

/**
 * A real vendor binary. It records its own path each time it runs, so the
 * program that graded a commit is stated by the program itself — the whole
 * point of the defect TB-024 closes, where `composer` ran while the policy,
 * the preview, and the evidence all named a vendor binary.
 */
const VENDOR_BINARY_SCRIPT = [
  // The shebang a real vendor binary carries. `vendor/bin/pint` and
  // `vendor/bin/phpstan` both begin `#!/usr/bin/env php`, so the kernel must
  // find the interpreter on a search path before the tool runs at all. An
  // absolute `#!/bin/sh` needs no search path, which is exactly why this
  // fixture missed TB-028 the first time.
  '#!/usr/bin/env sh',
  'printf "%s\\n" "$0" >> "$(dirname "$0")/ran.log"',
  // The tool loads the project's installed dependencies before it can grade
  // anything — exactly as `artisan` requires `vendor/autoload.php` — and it
  // resolves them relative to the directory it runs in, which is the
  // materialized snapshot. Without TB-030 this file is simply not there.
  `. ./${VENDOR_AUTOLOAD}`,
  `grep -q ${BREAKAGE} "$1" && exit 1`,
  'exit 0',
  '',
].join('\n');

const VENDOR_MIGRATION_MAPPINGS = {
  profiles: { backend: 'express-typescript' },
  commands: {
    'verification.commands.test.both[0]': {
      // The leading argument names the binary under the vendor directory;
      // resolution consumes it and composition passes on the rest.
      runner: 'composer-bin',
      args: [VENDOR_BINARY, SOURCE],
      timeout_seconds: 60,
      // What a real migration writes when the maintainer declares nothing. A
      // check must be able to start without the project having had to know
      // that its own tool binary is a script (TB-028).
      allowed_environment: [],
    },
  },
};

const attemptCommit = (root, message) => commit(root, message).then(
  () => ({ failed: false, output: '' }),
  (error) => ({ failed: true, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }),
);

/**
 * An activated clone runs the vendor binary its policy names.
 *
 * Every other scenario here uses `repository-script`, which resolves to this
 * Node runtime and so could never have observed the defect: a `composer-bin`
 * check resolved to the `composer` front end on `PATH`, ran it with the
 * descriptor's arguments discarded, and either denied every commit or reported
 * a passed check for a program the policy never named (FR-EVAL-001,
 * AC-EVAL-001, FR-PROF-010, NFR-REL-003).
 */
const vendorBinaryCommit = async () => {
  const findings = [];
  const root = await fixtureRepository({
    mappings: VENDOR_MIGRATION_MAPPINGS,
    policy: { ...GATE_POLICY, execution: { budget_skippable: [], dependency_roots: [...VENDOR_DEPENDENCY_ROOTS] } },
    files: {
      // `vendor/` is git-ignored in a real clone, so the binary is never in the
      // graded snapshot. The tool is not the thing under test; the code is.
      '.gitignore': { contents: 'vendor/\n' },
      [VENDOR_BINARY_PATH]: { contents: VENDOR_BINARY_SCRIPT, mode: 0o755 },
      // What the tool loads before it grades anything. It is git-ignored, so it
      // reaches the snapshot only because the project declared its root.
      [VENDOR_AUTOLOAD]: { contents: '# the installed dependency tree\n' },
    },
  });
  const vendorBinary = path.join(root, VENDOR_BINARY_PATH);
  const store = await storeFor(root);
  const { preview, result } = await activateFixture(root, store);

  check(findings, result.activated === true, `Activation did not succeed: ${result.reasonCode}.`);

  const pin = result.receipt?.runtime?.runners?.[0] ?? null;

  check(
    findings,
    pin?.executable === vendorBinary,
    `The receipt pinned ${pin?.executable} rather than the vendor binary at ${vendorBinary}.`,
  );
  // The binary is a script, so what activation proved includes where its
  // interpreter was found; without that pin the commit-time search path cannot
  // be rebuilt and the tool exits 127 before reading a line (TB-028).
  check(
    findings,
    typeof pin?.interpreter === 'string' && path.basename(pin.interpreter) === 'sh',
    `The receipt pinned no interpreter for a shebang vendor binary: ${JSON.stringify(pin?.interpreter)}.`,
  );
  check(
    findings,
    preview.commands?.[0]?.preview === `${vendorBinary} ${SOURCE}`,
    `The previewed command is ${preview.commands?.[0]?.preview}, not the vendor binary the descriptor names.`,
  );
  check(
    findings,
    preview.commands?.[0]?.executable === vendorBinary,
    `The preview would run ${preview.commands?.[0]?.executable}, not the vendor binary the descriptor names.`,
  );

  if (result.activated !== true) {
    return { name: 'vendor-binary-commit', ok: false, findings };
  }

  // A change the vendor binary must fail really does not become a commit.
  await writeFile(path.join(root, SOURCE), `baseline\n${BREAKAGE}\n`, 'utf8');
  await git(root, ['add', '--all']);

  const blocked = await attemptCommit(root, 'a change the vendor binary must refuse');

  check(findings, blocked.failed === true, 'The activated clone allowed a change its vendor binary fails.');
  check(
    findings,
    blocked.output.includes(REQUIRED_CHECK),
    `The denial does not name the failing check: ${blocked.output}.`,
  );

  // And the same clone still lets good work through.
  await writeFile(path.join(root, SOURCE), 'baseline\nrepaired\n', 'utf8');
  await git(root, ['add', '--all']);

  const allowed = await attemptCommit(root, 'a change the vendor binary must allow');

  check(findings, allowed.failed === false, `The vendor binary blocked a passing change: ${allowed.output}.`);

  // Both decisions were reached by the vendor binary itself, which recorded
  // every run from inside its own process. A `composer` front end running with
  // the descriptor's arguments discarded could not have written this.
  const ran = (await readFile(path.join(root, VENDOR_BINARY_LEDGER), 'utf8').catch(() => ''))
    .split('\n')
    .filter((line) => line.trim().length > 0);

  check(
    findings,
    ran.length >= 2 && ran.every((line) => line === vendorBinary),
    `The vendor binary recorded ${JSON.stringify(ran)} rather than grading both commits itself.`,
  );

  // A pinned executable that is gone denies as drift and is never re-resolved.
  await rm(vendorBinary, { force: true });
  await writeFile(path.join(root, SOURCE), 'baseline\nrepaired twice\n', 'utf8');
  await git(root, ['add', '--all']);

  const drifted = await attemptCommit(root, 'a commit whose pinned runner is gone');

  check(
    findings,
    drifted.failed === true,
    'A clone whose pinned executable is gone still committed; the runner re-resolved to another program.',
  );
  check(
    findings,
    drifted.output.includes(VENDOR_BINARY_PATH) && drifted.output.includes('gate repair'),
    `The drift denial does not name the missing pin and the repair path: ${drifted.output}.`,
  );

  return { name: 'vendor-binary-commit', ok: findings.length === 0, findings };
};

/** Entries the self-test subject would leave behind if it left anything. */
const selfTestSubjects = async () => (await readdir(tmpdir()).catch(() => []))
  .filter((entry) => entry.startsWith('gate-hook-program-self-test-'));

/**
 * A registered hook program that enforces nothing is refused.
 *
 * The program here exits `0` for everything, which is exactly what a pure
 * library does when it is mistaken for a runner. Every weaker check — does it
 * exist, is it executable, does it run — passes on it. Only asserting that it
 * denies a change it must deny catches it (NFR-REL-003).
 */
const hookProgramSelfTest = async () => {
  const findings = [];
  const root = await fixtureRepository();
  const store = await storeFor(root);

  await writeFile(path.join(root, 'tools/allowing-runner.mjs'), 'process.exitCode = 0;\n', 'utf8');

  const before = await selfTestSubjects();
  const { preview, result } = await activateFixture(root, store, {}, {
    runtime: {
      runnerVersion: `${CAPABILITY}/1.0.0`,
      hookProgram: { interpreter: process.execPath, script: 'tools/allowing-runner.mjs', args: [] },
    },
  });

  check(findings, result.activated === false, 'A hook program that enforces nothing was activated.');
  check(findings, result.state === 'configured', `Expected the configured state, got ${result.state}.`);
  check(
    findings,
    result.step === 'self-test' && result.reasonCode === 'hook-program-self-test-failed',
    `Expected a self-test refusal, got ${result.step}/${result.reasonCode}.`,
  );
  check(
    findings,
    result.errors?.[0]?.reason === 'hook-program-allowed-denied-change',
    `The refusal does not say the program allowed a denied change: ${JSON.stringify(result.errors)}.`,
  );

  // No receipt, and no registered hook: the clone is left merely configured.
  check(findings, result.receipt === null, 'A refused activation returned a receipt.');
  check(
    findings,
    (await store.activationReceipt().read()) === null,
    'A refused activation left a receipt on disk.',
  );
  check(
    findings,
    (await readFile(preview.hooks[0].path, 'utf8').catch(() => null)) === null,
    'A refused activation left a registered hook behind.',
  );
  check(
    findings,
    (await readdir(path.join(store.gitCommonDirectory, 'hooks')).catch(() => []))
      .filter((entry) => !entry.endsWith('.sample')).length === 0,
    'A refused activation left a hook in the clone.',
  );

  // The proof ran against a throwaway subject and took it with it.
  check(
    findings,
    JSON.stringify(await selfTestSubjects()) === JSON.stringify(before),
    'The hook-program self-test left its throwaway subject behind.',
  );

  const events = await store.readEvents();

  check(
    findings,
    events.length === 1 && events[0].type === 'activation' && events[0].outcome === 'failed',
    `Expected exactly one failed activation event, got ${JSON.stringify(events.map((event) => event.outcome))}.`,
  );

  // And the clone still commits exactly as it did while merely configured.
  await writeFile(path.join(root, SOURCE), `baseline\n${BREAKAGE}\n`, 'utf8');
  await git(root, ['add', '--all']);

  check(
    findings,
    await commit(root, 'a configured clone still commits').then(() => true, () => false),
    'A refused activation still blocked a commit.',
  );

  // TB-035, NFR-REL-003: a program that starts, throws, and dies non-zero never
  // read the subject, so its exit status is the shell's, not a decision. It is
  // refused as unproved, distinctly from one that answered by allowing.
  const crashingRoot = await fixtureRepository();
  const crashingStore = await storeFor(crashingRoot);

  await writeFile(
    path.join(crashingRoot, 'tools/crashing-runner.mjs'),
    "throw new Error('the hook program crashed before it read anything');\n",
    'utf8',
  );

  const crashed = await activateFixture(crashingRoot, crashingStore, {}, {
    runtime: {
      runnerVersion: `${CAPABILITY}/1.0.0`,
      hookProgram: { interpreter: process.execPath, script: 'tools/crashing-runner.mjs', args: [] },
    },
  });

  check(
    findings,
    crashed.result.activated === false
      && crashed.result.errors?.[0]?.reason === 'hook-program-unproved',
    `A crashing hook program was not refused as unproved: ${JSON.stringify(crashed.result.errors)}.`,
  );
  check(
    findings,
    (await readFile(crashed.preview.hooks[0].path, 'utf8').catch(() => null)) === null,
    'A crashing hook program was still registered.',
  );
  check(
    findings,
    await stillCommitsAsConfigured(crashingRoot, 'a clone with an unproved program still commits'),
    'A refused crashing program left the clone refusing commits.',
  );

  return { name: 'hook-program-self-test', ok: findings.length === 0, findings };
};

/**
 * The proved facts that fill the mapping draft's `null` leaves.
 *
 * This is the maintainer's half of the exchange and nothing more: the document
 * being migrated is the draft's own, keyed and shaped by the tooling, and only
 * the values the framework refused to guess are supplied here.
 */
const PROVED_FILL = {
  profile: 'express-typescript',
  runner: 'repository-script',
  args: ['tools/check.mjs', SOURCE],
  timeout_seconds: 60,
};

const fillMappingDraft = (draft) => ({
  profiles: Object.fromEntries(
    Object.keys(draft.profiles).map((profile) => [profile, PROVED_FILL.profile]),
  ),
  commands: Object.fromEntries(Object.entries(draft.commands).map(([commandPath, fields]) => [
    commandPath,
    Object.fromEntries(Object.keys(fields).map((field) => [field, PROVED_FILL[field]])),
  ])),
});

/**
 * Activate a clone configured entirely through the drafted policy, then prove
 * a required drafted check binds for real: it denies a commit it must deny
 * and allows one it must allow.
 *
 * `derivedConfigurationRoundTrip` used to stop once the clone reported
 * `configured: true`, which never asked whether a drafted identity binds at
 * evaluation. This is the TB-023 extension that asks that question against a
 * real activated hook and real `git commit` invocations, the same proof
 * `authoritativeCommit` runs for the hand-written policy.
 */
const activateAndProveDerivedPolicyEnforces = async (root, configuration) => {
  const findings = [];

  fixtureConfigurations.set(root, configuration);
  await writeFile(path.join(root, SOURCE), 'baseline\n', 'utf8');
  await git(root, ['init', '--quiet']);
  await git(root, ['add', '--all']);
  await commit(root, 'baseline');

  const store = await storeFor(root);
  const { result } = await activateFixture(root, store);

  check(
    findings,
    result.activated === true,
    `Activation of the drafted, configured clone did not succeed: ${result.reasonCode}.`,
  );

  if (result.activated !== true) {
    return { name: 'derived-policy-enforces', ok: false, findings };
  }

  // A change whose required drafted check fails must not become a commit.
  await writeFile(path.join(root, SOURCE), `baseline\n${BREAKAGE}\n`, 'utf8');
  await git(root, ['add', '--all']);

  const blocked = await commit(root, 'a change the drafted policy must refuse').then(
    () => ({ failed: false, stdout: '', stderr: '' }),
    (error) => ({ failed: true, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }),
  );

  check(
    findings,
    blocked.failed === true,
    'A required identity drafted by --draft-policy did not deny a commit it should deny.',
  );
  check(
    findings,
    `${blocked.stdout}${blocked.stderr}`.includes('change-evaluation-gate'),
    'The blocked commit did not report the gate decision.',
  );

  // The same clone must still let good work through.
  await writeFile(path.join(root, SOURCE), 'baseline\nrepaired\n', 'utf8');
  await git(root, ['add', '--all']);

  const allowed = await commit(root, 'a change the drafted policy must allow').then(
    () => ({ failed: false }),
    (error) => ({ failed: true, stderr: error.stderr ?? '' }),
  );

  check(
    findings,
    allowed.failed === false,
    `The drafted, activated policy blocked a passing change: ${allowed.stderr}.`,
  );

  return { name: 'derived-policy-enforces', ok: findings.length === 0, findings };
};

/**
 * The round trip a maintainer actually walks, with no hand-written JSON.
 *
 * Draft the mapping, fill only its `null` leaves, migrate, draft the policy,
 * configure the Gate. Every document in the path is emitted by the tooling from
 * proved project facts, and the drafts are proved to be refused while they still
 * carry a `null` (AC-CFG-002, FR-PROF-010, SG-CMD-001, SG-OWNER-001). It then
 * activates the clone on the drafted policy alone and proves a required
 * drafted check actually binds and denies a commit it should deny
 * (FR-EVAL-001, NFR-REL-003).
 */
const derivedConfigurationRoundTrip = async () => {
  const findings = [];
  const root = await temporaryDirectory('gate-activation-smoke-draft-');

  await assertThrowawayRepository(root);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/check.mjs'), CHECK_SCRIPT, 'utf8');
  await writeFile(path.join(root, 'package.json'), '{"name":"gate-activation-smoke"}\n', 'utf8');
  await writeFile(path.join(root, CONFIGURATION_FILE), SCHEMA_V3_MIGRATION_INPUT, 'utf8');

  const before = await readFile(path.join(root, CONFIGURATION_FILE), 'utf8');
  const report = await previewConfigurationMigration({ projectRoot: root, mappings: {} });
  const mappingDraft = await draftMigrationMapping({ projectRoot: root });

  check(
    findings,
    JSON.stringify(Object.keys(mappingDraft.commands))
      === JSON.stringify(report.ambiguities
        .filter((ambiguity) => ambiguity.path.startsWith('verification.'))
        .map((ambiguity) => ambiguity.path)),
    `The mapping draft is not keyed by the reported ambiguities: ${JSON.stringify(Object.keys(mappingDraft.commands))}.`,
  );
  check(
    findings,
    ['status', 'fromVersion', 'previewHash', 'ambiguities']
      .every((envelopeKey) => !(envelopeKey in mappingDraft)),
    'The mapping draft carries the migration report envelope it must not.',
  );
  check(
    findings,
    (await readFile(path.join(root, CONFIGURATION_FILE), 'utf8')) === before,
    'Drafting the mapping changed the configuration.',
  );

  // A draft that still carries a `null` is refused, never filled with a guess.
  check(
    findings,
    await previewConfigurationMigration({ projectRoot: root, mappings: mappingDraft })
      .then(() => false, () => true),
    'A null-bearing mapping draft was accepted rather than refused.',
  );

  const mappings = fillMappingDraft(mappingDraft);
  const migration = await previewConfigurationMigration({ projectRoot: root, mappings });

  check(
    findings,
    migration.status === 'ready',
    `The filled mapping draft did not reach ready: ${migration.status}.`,
  );

  const migrated = await migrateConfiguration({
    projectRoot: root,
    mappings,
    confirmation: migration.previewHash,
  });

  check(findings, migrated.status === 'migrated', `The migration did not apply: ${migrated.status}.`);

  const migratedContents = await readFile(path.join(root, CONFIGURATION_FILE), 'utf8');
  const policyDraft = await draftGatePolicy({ projectRoot: root });
  const issues = validateGatePolicy(policyDraft);

  check(
    findings,
    issues.length === 0,
    `The drafted policy does not validate: ${JSON.stringify(issues)}.`,
  );
  check(
    findings,
    policyDraft.checks.required.length > 0
      && !policyDraft.checks.required.some(
        (identity) => policyDraft.checks.advisory.includes(identity),
      ),
    'The drafted policy does not partition required and advisory bindings.',
  );
  check(
    findings,
    !('previewHash' in policyDraft),
    'The policy draft is self-confirming: it carries a previewHash.',
  );
  check(
    findings,
    (await readFile(path.join(root, CONFIGURATION_FILE), 'utf8')) === migratedContents,
    'Drafting the policy changed the configuration.',
  );

  const preview = await previewGateConfiguration({ projectRoot: root, policy: policyDraft });

  check(findings, preview.configured === false, 'A Gate preview reported the clone as configured.');

  const gate = await configureGate({
    projectRoot: root,
    policy: policyDraft,
    confirmation: preview.previewHash,
  });

  check(findings, gate.status === 'configured', `The drafted policy did not configure: ${gate.status}.`);
  check(findings, gate.activated === false, 'Configuring the Gate activated the clone.');

  const read = await readRepositoryConfiguration({ repositoryRoot: root });
  const configured = read.ok && Boolean(read.configuration?.evaluation_gate);

  check(findings, configured, `The configured clone is unreadable: ${read.detail}.`);

  const enforcement = configured
    ? await activateAndProveDerivedPolicyEnforces(root, read.configuration)
    : { name: 'derived-policy-enforces', ok: false, findings: ['Skipped: the drafted policy did not configure.'] };

  findings.push(...enforcement.findings);

  return {
    name: 'derived-configuration-round-trip',
    ok: findings.length === 0 && enforcement.ok,
    configured,
    activated: enforcement.ok,
    findings,
  };
};

/**
 * A required check that announces it started and then refuses to finish.
 *
 * The only way to hold a real `git commit` inside a real evaluation long enough
 * to interrupt it from outside. The timer is a backstop: this capability kills
 * the process group long before it elapses, and nothing may be left running if
 * the kill never lands.
 */
const BLOCKING_CHECK_SCRIPT = (sentinel) => [
  "import { writeFileSync } from 'node:fs';",
  '',
  `writeFileSync(${JSON.stringify(sentinel)}, 'started\\n');`,
  'setTimeout(() => process.exit(0), 30_000);',
  '',
].join('\n');

const sleep = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

const executionRootsUnder = async (directory) => (await readdir(directory).catch(() => []))
  .filter((entry) => EXECUTION_ROOT_PREFIXES.some((prefix) => entry.startsWith(prefix)));

const until = async (predicate, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }

    await sleep(25);
  }

  return false;
};

/**
 * TB-038: a real commit interrupted mid-evaluation leaves no execution root.
 *
 * Every other scenario here runs an evaluation to completion, which is what
 * makes it a test — and is exactly why interruption was never observed. This
 * one presses Ctrl-C on a real `git commit` against a real activated clone by
 * signalling the whole process group the way a terminal does, and then requires
 * that the next commits still decide identically while reclaiming what an
 * earlier `SIGKILL`-style abandonment left behind (AC-CFG-004, AC-EVAL-004,
 * SG-SECRET-001, NFR-REL-001).
 */
const interruptedCommitLeavesNoRoot = async () => {
  const findings = [];
  const root = await fixtureRepository();
  const store = await storeFor(root);
  const { result } = await activateFixture(root, store);

  check(findings, result.activated === true, `Activation did not succeed: ${result.reasonCode}.`);

  if (result.activated !== true) {
    return { name: 'interrupted-commit-leaves-no-root', ok: false, findings };
  }

  // The interrupted commit gets its own temporary directory, so what it leaves
  // behind is observable in isolation and can never be confused with another
  // run's live root. The hook inherits TMPDIR through `git`.
  const temporaryRoot = await temporaryDirectory('gate-activation-smoke-tmp-');
  const sentinel = path.join(temporaryRoot, 'check-started');
  const abandoned = path.join(temporaryRoot, 'gate-hook-runner-exec-abandoned');
  const stale = new Date(Date.now() - EXECUTION_ROOT_RETENTION_MS - 3_600_000);

  // What a `SIGKILL` leaves: a root no signal handler could ever have removed.
  await mkdir(path.join(abandoned, 'snapshot'), { recursive: true });
  await writeFile(path.join(abandoned, 'snapshot', SOURCE.replace('/', '-')), 'orphan\n', 'utf8');
  await utimes(abandoned, stale, stale);

  await writeFile(path.join(root, 'tools/check.mjs'), BLOCKING_CHECK_SCRIPT(sentinel), 'utf8');
  await writeFile(path.join(root, SOURCE), 'baseline\nunder evaluation\n', 'utf8');
  await git(root, ['add', '--all']);

  const before = (await runGit(root, ['rev-list', '--count', 'HEAD'])).trim();
  const interrupted = spawn('git', [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Activation Smoke',
    'commit', '--quiet', '--message', 'a commit the maintainer interrupts',
  ], {
    cwd: root,
    detached: true,
    env: { ...gitEnvironment(), TMPDIR: temporaryRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  interrupted.stdout.resume();
  interrupted.stderr.resume();

  const ended = new Promise((resolve) => {
    interrupted.on('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });
  const started = await until(
    async () => stat(sentinel).then(() => true).catch(() => false),
    30_000,
  );

  check(findings, started === true, 'The commit never reached the check it grades with, so nothing was interrupted.');

  const live = await executionRootsUnder(temporaryRoot);

  check(
    findings,
    live.length === 1 && live[0] !== path.basename(abandoned),
    `The interrupted commit had no live execution root to observe: ${JSON.stringify(live)}.`,
  );
  // The commit now under way already reclaimed what the earlier abandoned run
  // left, before it materialized anything of its own.
  check(
    findings,
    await stat(abandoned).then(() => false).catch(() => true),
    'A commit did not reclaim the root an earlier abandoned run left behind.',
  );

  try {
    // The whole process group, which is what a terminal signals on Ctrl-C: the
    // hook and the check it spawned both receive it, exactly as they would.
    process.kill(-interrupted.pid, 'SIGINT');
  } catch {
    check(findings, false, 'The interrupted commit could not be signalled.');
  }

  const outcome = await ended;

  check(
    findings,
    outcome.signal === 'SIGINT' || outcome.exitCode !== 0,
    `The interrupted commit was not terminated by the signal: ${JSON.stringify(outcome)}.`,
  );
  check(
    findings,
    (await runGit(root, ['rev-list', '--count', 'HEAD'])).trim() === before,
    'An interrupted commit still moved HEAD.',
  );

  // The runner's own root goes with the signal. Polled rather than read once,
  // because `git` dies from the same signal and may report first.
  const reclaimed = await until(
    async () => (await executionRootsUnder(temporaryRoot)).length === 0,
    10_000,
  );

  check(
    findings,
    reclaimed === true,
    `An interrupted commit left its execution root behind: ${JSON.stringify(await executionRootsUnder(temporaryRoot))}.`,
  );

  // A second abandonment, so the reclamation is proved on a later run too and
  // not only on the one that happened to be interrupted.
  const abandonedAgain = path.join(temporaryRoot, 'gate-preflight-exec-abandoned');

  await mkdir(path.join(abandonedAgain, 'snapshot'), { recursive: true });
  await utimes(abandonedAgain, stale, stale);

  // And the same clone decides the next commits exactly as it did before,
  // reclaiming what the earlier abandonment left while it does.
  await writeFile(path.join(root, 'tools/check.mjs'), CHECK_SCRIPT, 'utf8');
  await writeFile(path.join(root, SOURCE), `baseline\n${BREAKAGE}\n`, 'utf8');
  await git(root, ['add', '--all']);

  const commitIn = (message) => runFile('git', [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Activation Smoke',
    'commit', '--quiet', '--message', message,
  ], { cwd: root, env: { ...gitEnvironment(), TMPDIR: temporaryRoot } }).then(
    () => ({ failed: false, output: '' }),
    (error) => ({ failed: true, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }),
  );

  const blocked = await commitIn('a change the gate must still refuse');

  check(findings, blocked.failed === true, 'The clone stopped blocking after an interrupted commit.');
  check(
    findings,
    blocked.output.includes(REQUIRED_CHECK),
    `The denial after an interruption does not name the failing check: ${blocked.output}.`,
  );

  await writeFile(path.join(root, SOURCE), 'baseline\nrepaired\n', 'utf8');
  await git(root, ['add', '--all']);

  const allowed = await commitIn('a change the gate must still allow');

  check(findings, allowed.failed === false, `The clone stopped allowing after an interrupted commit: ${allowed.output}.`);
  check(
    findings,
    Number((await runGit(root, ['rev-list', '--count', 'HEAD'])).trim()) === Number(before) + 1,
    'The allowed commit after an interruption did not move HEAD.',
  );
  check(
    findings,
    (await executionRootsUnder(temporaryRoot)).length === 0,
    `A later run did not reclaim the abandoned root: ${JSON.stringify(await executionRootsUnder(temporaryRoot))}.`,
  );

  return { name: 'interrupted-commit-leaves-no-root', ok: findings.length === 0, findings };
};

/**
 * A requirement this evaluation environment cannot satisfy, declared by the
 * clone the way it declares its commands.
 *
 * It names a property of the environment, never a tool: an evaluation
 * materializes its subject away from the repository so the graded tree cannot
 * move, and a tree of files is not a repository. A command whose arguments
 * depend on one therefore cannot run — which is one of the three faults a real
 * run reported as defects in the maintainer's project (`TB-044`).
 */
const UNSATISFIABLE_PREREQUISITE = Object.freeze({
  kind: 'environment',
  name: 'source-control-history',
});

/** Declare, in the clone's own configuration, what its configured check needs. */
const declarePrerequisite = async (root, prerequisite) => {
  const file = path.join(root, CONFIGURATION_FILE);
  const lines = (await readFile(file, 'utf8')).split('\n');
  const index = lines.findIndex((line) => /^\s+- \{.*"runner"/.test(line));

  if (index === -1) {
    throw new Error('the fixture configuration declares no command to require anything of.');
  }

  const marker = lines[index].indexOf('- ');
  const declared = JSON.parse(lines[index].slice(marker + 2));

  lines[index] = `${' '.repeat(marker)}- ${JSON.stringify({ ...declared, prerequisites: [prerequisite] })}`;
  await writeFile(file, lines.join('\n'), 'utf8');

  const configured = await readRepositoryConfiguration({ repositoryRoot: root });

  if (!configured.ok) {
    throw new Error(`the declared requirement made the configuration unreadable: ${configured.detail}`);
  }

  fixtureConfigurations.set(root, configured.configuration);
};

/**
 * A real commit, in a real activated clone, whose required check declared
 * something this environment does not provide.
 *
 * The commit is denied — a required `unverified` check denies exactly as it
 * denied before (`FR-POL-003`) — and what the maintainer reads is what the
 * check never got, not a verdict about their code. The distinction is the whole
 * point: it was a denial phrased as a verdict that sent an agent off to rewrite
 * a working project until the gate stopped complaining (`AC-EVAL-003`,
 * `NFR-OPER-001`).
 */
const unprovedPrerequisiteNamesWhatWasMissing = async () => {
  const findings = [];
  const root = await fixtureRepository();

  await declarePrerequisite(root, UNSATISFIABLE_PREREQUISITE);
  await git(root, ['add', '--all']);
  await commit(root, 'declare what the configured check needs');

  const store = await storeFor(root);
  const { result } = await activateFixture(root, store);

  check(findings, result.activated === true, `Activation did not succeed: ${result.reasonCode}.`);

  if (result.activated !== true) {
    return { name: 'unproved-prerequisite-names-what-was-missing', ok: false, findings };
  }

  const before = (await runGit(root, ['rev-list', '--count', 'HEAD'])).trim();

  // Content the check itself would reject. Before this, the check ran in an
  // environment it could not work in and its failure was reported as a finding
  // about this content.
  await writeFile(path.join(root, SOURCE), `baseline\n${BREAKAGE}\n`, 'utf8');
  await git(root, ['add', '--all']);

  const blocked = await attemptCommit(root, 'a change graded by a check that cannot run here');

  check(findings, blocked.failed === true, 'A required check that could not run still authorized a commit.');
  check(
    findings,
    (await runGit(root, ['rev-list', '--count', 'HEAD'])).trim() === before,
    'A denied commit still moved HEAD.',
  );
  check(
    findings,
    blocked.output.includes('prerequisite-missing'),
    `The denial does not say the check never ran: ${blocked.output}.`,
  );
  check(
    findings,
    blocked.output.includes(UNSATISFIABLE_PREREQUISITE.name),
    `The denial does not name what was not proved: ${blocked.output}.`,
  );
  check(
    findings,
    !blocked.output.includes('grader-negative'),
    `The denial reports an environment fault as a verdict about the code: ${blocked.output}.`,
  );

  const log = await store.readLog();
  const envelope = log.length > 0 ? await store.readEnvelope(log[log.length - 1].evidenceId) : null;
  const graded = envelope?.decision?.checks?.find((entry) => entry.id === REQUIRED_CHECK) ?? null;

  check(
    findings,
    graded?.outcome === 'unverified' && graded?.reasonCode === 'prerequisite-missing',
    `The recorded decision grades the check as ${graded?.outcome} (${graded?.reasonCode}).`,
  );
  check(
    findings,
    (graded?.summary ?? '').includes(UNSATISFIABLE_PREREQUISITE.name),
    `The recorded decision does not name the unproved requirement: ${graded?.summary}.`,
  );
  check(
    findings,
    graded?.attempts?.[0]?.exitCode === null,
    'The check whose requirement was not proved still ran its command.',
  );

  return {
    name: 'unproved-prerequisite-names-what-was-missing',
    ok: findings.length === 0,
    findings,
  };
};

const main = async () => {
  const asJson = process.argv.includes('--json');
  let scenarios = [];

  try {
    const activated = await packagedActivation();

    scenarios = [
      { name: activated.name, ok: activated.ok, findings: activated.findings },
      activated.ok
        ? await authoritativeCommit(activated)
        : {
          name: 'authoritative-commit',
          ok: false,
          findings: ['Skipped: the packaged activation did not succeed.'],
        },
      activated.ok
        ? await activatedConfigurationBinds(activated)
        : {
          name: 'activated-configuration-binds',
          ok: false,
          findings: ['Skipped: the packaged activation did not succeed.'],
        },
      await rollbackLeavesNoTrace(),
      await hookProgramSelfTest(),
      await vendorBinaryCommit(),
      await derivedConfigurationRoundTrip(),
      await interruptedCommitLeavesNoRoot(),
      await unprovedPrerequisiteNamesWhatWasMissing(),
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
