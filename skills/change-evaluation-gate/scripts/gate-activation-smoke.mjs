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
 * 3. `rollback-leaves-no-trace` — a genuine failure injected immediately before
 *    Git enablement leaves no receipt, no registration, and a clone that still
 *    commits exactly as it did while merely configured (FR-LIFE-005,
 *    NFR-REL-002, SG-LIFE-001).
 * 4. `hook-program-self-test` — a registered hook program that exits `0` for a
 *    change it must deny is refused at the `self-test` step: the clone is left
 *    configured with no receipt and no hook, the throwaway subject the proof
 *    ran against is gone, and the clone still commits (AC-LIFE-002,
 *    NFR-REL-003, SG-LIFE-001).
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

import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  ACTIVATION_RECEIPT_VERSION,
  ACTIVATION_STEPS,
  activate,
  previewActivation,
  registerOwnedHook,
} from './lib/activation.mjs';
import { createBoundedExecutor } from './lib/bounded-execution.mjs';
import {
  CONFIGURATION_FILE,
  gateChecksFromConfiguration,
  parseConfigurationDocument,
} from './lib/configuration.mjs';
import { evaluate } from './lib/evaluate.mjs';
import { openEvidenceStore } from './lib/evidence-store.mjs';

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
 * The clone configuration the packaged runner reads.
 *
 * It is the single source for this fixture's Gate policy and its one required
 * check: the activation request derives both from it through the supported
 * configuration reader, and the registered runner reads the same file again at
 * commit time. Nothing here restates a command the configuration already owns.
 */
const CONFIGURATION = [
  'schema_version: 4',
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
  `      - ${REQUIRED_CHECK}`,
  '    advisory: []',
  '  budget:',
  '    total_seconds: 600',
  '  bypass:',
  '    enabled: false',
  '    marker: null',
  '  execution:',
  '    budget_skippable: []',
  '  evidence: {}',
  'history:',
  '  path: docs/history',
  '  required: false',
  'protected_files: []',
  '',
].join('\n');

/** A throwaway clone with one baseline commit, a check, and a configuration. */
const fixtureRepository = async () => {
  const root = await temporaryDirectory('gate-activation-smoke-repo-');

  await assertThrowawayRepository(root);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/check.mjs'), CHECK_SCRIPT, 'utf8');
  await writeFile(path.join(root, CONFIGURATION_FILE), CONFIGURATION, 'utf8');
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
const configured = () => {
  const parsed = parseConfigurationDocument(CONFIGURATION);

  if (!parsed.ok) {
    throw new Error(`the fixture configuration is unreadable: ${parsed.detail}`);
  }

  const { checks, errors } = gateChecksFromConfiguration(parsed.value);

  if (errors.length > 0) {
    throw new Error(`the fixture configuration resolves no checks: ${JSON.stringify(errors)}`);
  }

  return { policy: parsed.value.evaluation_gate, checks };
};

const gatePolicy = () => configured().policy;

const activationRequest = (root) => ({
  scope: 'repository',
  trigger: 'explicit',
  repository: { root },
  configuration: { schemaVersion: 4, policy: gatePolicy() },
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
  checks: configured().checks,
  adapters: [{ id: 'git', version: '1.0.0', authoritative: true }],
  runtimeInputs: [{ name: 'APP_TOKEN', source: 'approved-environment-file' }],
});

/**
 * A real self-test of the evaluation process: it materializes the snapshot,
 * spawns the check, and requires a contract decision before Git may be enabled.
 */
const selfTestEvaluation = async ({ repository }) => {
  const collected = { checks: configured().checks };
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

const dependencies = (overrides = {}) => ({
  runGit,
  resolveExecutable: (runner) => (
    runner === 'repository-script'
      ? { executable: process.execPath, version: process.versions.node }
      : null
  ),
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

  return { name: 'authoritative-commit', ok: findings.length === 0, findings };
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

  return { name: 'rollback-leaves-no-trace', ok: findings.length === 0, findings };
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

  return { name: 'hook-program-self-test', ok: findings.length === 0, findings };
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
      await rollbackLeavesNoTrace(),
      await hookProgramSelfTest(),
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
