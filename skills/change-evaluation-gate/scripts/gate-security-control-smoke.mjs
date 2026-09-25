#!/usr/bin/env node
/**
 * `gate-security-control-smoke` — the packaged security control surfaces.
 *
 * Proves, against throwaway Git repositories, a real Evidence store, real child
 * processes, and a real isolated materialization:
 *
 * 1. `packaged-runtime-input` — only a runtime input the Activation receipt
 *    approved is copied into the isolated materialization; a real check process
 *    reads the approved value and echoes it raw, base64, and percent-encoded;
 *    the materialization is removed with the evaluation; and no recognized form
 *    of either canary survives in retained configuration, decisions, envelopes,
 *    blobs, Lifecycle events, or the receipt (`AC-CFG-004`, `FR-CFG-006`,
 *    `SG-SECRET-001`).
 * 2. `packaged-drift` — independent Gate control-surface drift makes
 *    `gate status` report `broken` and makes a real authoritative evaluation
 *    `unverified` with `deny`, while the same clone without drift is `healthy`
 *    and authorizes. Observation repairs nothing: the receipt and the store are
 *    byte-identical afterwards (`AC-SEC-001`, `NFR-SEC-004`, `FR-LIFE-019`).
 * 3. `packaged-runner-drift` — the SHIPPED entry point, `gate-precommit.mjs`,
 *    run as a real process against an activated clone: it authorizes an
 *    undrifted commit and refuses the next one after the clone's Gate policy is
 *    edited, naming `integrity-drift`, the drifted surface, and `gate repair`,
 *    and leaving the receipt byte-identical. Scenario 2 proves the rule against
 *    a hand-assembled surface, which is how a reconciliation nothing called
 *    could look proved for as long as it did (`AC-SEC-001`, `AC-CFG-004`,
 *    `AC-EVAL-001`).
 * 4. `packaged-policy-transition` — a candidate configuration that weakens the
 *    policy authorizing its own transition passes its own policy, fails the
 *    Trusted policy, and neither advances trust nor authorizes; a hash-bound
 *    approval advances only once both policies pass (`AC-CFG-003`,
 *    `SG-CFG-001`).
 * 5. `configured-declaration` — a Sensitive input declared in the clone's OWN
 *    configuration (`evaluation_gate.evidence.sensitive_inputs`) reaches the
 *    preview, the receipt, and the store through `gate activate` and a real
 *    commit; a check that prints the value in a shape no built-in pattern
 *    matches leaves no recognized form of it anywhere the clone keeps; and the
 *    same name absent from the environment is recorded as unresolved rather
 *    than erroring or passing silently. Scenario 1 supplies its declaration
 *    from the fixture, which is exactly what no project could do before
 *    `TB-045` (`AC-CFG-004`, `NFR-SEC-003`, `FR-CFG-006`).
 * 6. `declared-environment-file` — a stack-shaped clone whose check boots only
 *    with a key the project keeps in a git-ignored environment file beside a
 *    value nobody declared, and whose descriptor allows no ambient variable:
 *    through `gate activate` and real commits by the shipped hook, the
 *    approved name is resolved from the declared file, reaches the check, is
 *    absent from every byte the clone keeps in every recognized form, and its
 *    owner-only materialization is gone with the execution root; the decoy
 *    reaches neither the check nor the store; a required failure still
 *    blocks; and with the file removed the same commit fails inside the
 *    snapshot exactly as every such project did before `TB-059`, recorded as
 *    unresolved with the sources searched (`FR-CFG-006`, `AC-EVAL-001`,
 *    `AC-CFG-004`, `SG-EVAL-001`, `SG-SECRET-001`).
 * 7. `packaged-bypass` — the bypass switch means something (`TB-052`). On a
 *    clone whose policy enables bypass, the shipped hook's denial names the
 *    escape hatch, the shipped `gate bypass` previews the staged snapshot and
 *    confirms a one-shot grant, a grant for another snapshot is refused as
 *    `snapshot-mismatch` and spent, a fresh grant lets exactly one real
 *    `git commit` proceed as `bypassed` — never `passed` — with the failure
 *    preserved, the ledger consumed, the marker printed, and every record
 *    through the existing Evidence and Lifecycle paths; the next commit is
 *    denied as before. On the twin clone with bypass disabled the denial is
 *    byte-for-byte what it always was, no bypass record, ledger, or grant
 *    exists, and `gate bypass` refuses as `bypass-disabled` (`FR-POL-006`,
 *    `FR-POL-007`, `FR-POL-008`, `SG-BYP-001`, `NFR-AUD-001`).
 * 8. `packaged-policy-sync` — the transition check on the real re-pin path
 *    (`TB-062`). On a clone activated by the shipped command whose policy is
 *    then weakened by demoting its required check, the shipped `gate sync`
 *    refuses with the weakening named and no token, while a real commit is
 *    still denied for the drift; with `--acknowledge-weakening` it offers a
 *    token, confirming it pins the candidate, and the next real commit — a
 *    failing change the trusted policy would have blocked — is graded under
 *    the acknowledged policy with no drift. The registered hook is
 *    byte-identical throughout (`SG-CFG-001`, `AC-CFG-003`, `FR-CFG-005`,
 *    `NFR-SEC-004`).
 *
 * Every canary in this file is a synthetic literal invented for the fixture. No
 * real environment variable, credential store, key file, or developer secret is
 * read anywhere in this capability.
 *
 * HONEST SCOPE: the Gate is a cooperative local process running with the
 * machine owner's own permissions. What this capability proves is DETECTION and
 * non-retention, never resistance to the machine owner (`ASM-001`,
 * `SG-TRUST-001`).
 *
 * It is non-interactive and offline, requires no external toolchain beyond Git
 * and this Node runtime, and is safe to run repeatedly on a clean machine.
 *
 * SAFETY: every fixture is a throwaway repository created under the OS
 * temporary directory and removed afterwards. `assertThrowawayRepository`
 * refuses any root that is not under that directory or that lies inside this
 * repository. This capability removes files, so that guard is checked again
 * immediately before every removal, not only at fixture creation.
 *
 * Usage:
 *   node skills/change-evaluation-gate/scripts/gate-security-control-smoke.mjs [--json]
 *
 * Exit status is 0 only when every scenario holds.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { configurationIdentity } from './lib/activation.mjs';
import { commandPreview } from './lib/command-descriptor.mjs';
import {
  gateChecksFromConfiguration,
  readRepositoryConfiguration,
} from './lib/configuration.mjs';
import { evaluate } from './lib/evaluate.mjs';
import { contentIdentity, openEvidenceStore } from './lib/evidence-store.mjs';
import { statusGate } from './lib/lifecycle.mjs';
import { createRedactor, secretForms } from './lib/redaction.mjs';
import {
  CONTROL_SURFACES,
  TRUST_BOUNDARY,
  evaluatePolicyTransition,
  materializeRuntimeInputs,
  policyIdentity,
} from './lib/security-control.mjs';

const CAPABILITY = 'gate-security-control-smoke';

/** This repository. No fixture may ever touch its Git state or its hooks. */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Synthetic canaries invented for this fixture. They are not credentials, they
 * are not read from any environment or credential store, and they grant access
 * to nothing.
 */
const APPROVED_CANARY = 'canary-approved-b71c05e93d2a';

const UNAPPROVED_CANARY = 'canary-unapproved-2fa6c8140b93';

const runFile = promisify(execFile);

const temporaryRoots = [];

const isInside = (parent, candidate) => candidate === parent
  || candidate.startsWith(`${parent}${path.sep}`);

/** The guard. Nothing in this capability reads, writes, or removes outside a throwaway root. */
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
  await assertThrowawayRepository(directory);

  return directory;
};

/** Git with its own configuration, so no developer setting can reach a fixture. */
const gitEnvironment = () => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

const git = async (cwd, args) => runFile('git', args, { cwd, env: gitEnvironment() });

const check = (findings, condition, message) => {
  if (!condition) {
    findings.push(message);
  }
};

/** Every byte of a directory tree, so a canary cannot hide in one file. */
const treeContents = async (root) => {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const contents = [];

  for (const entry of entries) {
    if (entry.isFile()) {
      contents.push(await readFile(path.join(entry.parentPath ?? entry.path, entry.name), 'utf8'));
    }
  }

  return contents.join('\n');
};

const storeIdentity = () => ({
  actor: { name: CAPABILITY, source: 'fixture' },
  client: { id: 'git', surface: 'git-pre-commit', version: '1.0.0' },
  gate: { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' },
  repository: { identity: `sha256:${'0'.repeat(64)}` },
});

const receiptFixture = () => ({
  receiptVersion: 'change-evaluation-gate/activation/v1',
  receiptId: `sha256:${'a'.repeat(64)}`,
  configuration: { schemaVersion: 4, identity: `sha256:${'b'.repeat(64)}` },
  runtime: {
    gate: { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' },
    runnerVersion: 'change-evaluation-gate/0.9.0',
    runners: [{
      check_id: 'broad_test',
      role: 'evaluate',
      runner: 'repository-script',
      executable: process.execPath,
      version: process.versions.node,
    }],
  },
  adapters: [{ id: 'git', version: '1.0.0', authoritative: true }],
  hooks: [],
  hookChain: { blockIdentity: `sha256:${'c'.repeat(64)}` },
  providers: { 'node-package': '1.0.0' },
  runtimeInputs: ['APP_TOKEN'],
});

const observedFrom = (receipt, overrides = {}) => ({
  receiptId: receipt.receiptId,
  configurationId: receipt.configuration.identity,
  runtime: { gate: receipt.runtime.gate, runnerVersion: receipt.runtime.runnerVersion },
  runners: receipt.runtime.runners,
  adapters: receipt.adapters,
  hookBlockIdentity: receipt.hookChain.blockIdentity,
  providers: receipt.providers,
  ...overrides,
});

/**
 * A real check process. It reads the approved value from the environment the
 * materialization handed it and from the temporary file, and echoes both in
 * three recognizable forms — exactly the accident redaction must survive.
 */
const CHECK_SCRIPT = [
  "const { readFileSync } = require('node:fs');",
  'const value = process.env.APP_TOKEN ?? "";',
  'const fromFile = readFileSync(process.argv[2], "utf8");',
  'process.stdout.write(`env ${value}\\n`);',
  'process.stdout.write(`file ${fromFile}\\n`);',
  'process.stdout.write(`base64 ${Buffer.from(value, "utf8").toString("base64")}\\n`);',
  'process.stdout.write(`escaped ${encodeURIComponent(value)}\\n`);',
  'process.stdout.write(`shadow ${process.env.SHADOW_TOKEN ?? "absent"}\\n`);',
  '',
].join('\n');

const packagedRuntimeInput = async () => {
  const findings = [];
  const repositoryRoot = await temporaryDirectory(`${CAPABILITY}-inputs-repo-`);
  const executionRoot = await temporaryDirectory(`${CAPABILITY}-inputs-exec-`);

  await git(repositoryRoot, ['init', '--quiet']);
  await writeFile(path.join(executionRoot, 'check.cjs'), CHECK_SCRIPT, 'utf8');

  const receipt = receiptFixture();
  const materialized = await materializeRuntimeInputs({
    // Approval is the list the Activation receipt pinned, and nothing else.
    approved: receipt.runtimeInputs,
    inputs: [
      { name: 'APP_TOKEN', source: 'approved-environment-file', value: APPROVED_CANARY },
      { name: 'SHADOW_TOKEN', source: 'ambient-environment', value: UNAPPROVED_CANARY },
    ],
    executionRoot,
  });

  check(findings, materialized.materialized === true, 'The approved runtime input was not materialized.');
  check(
    findings,
    JSON.stringify(materialized.record) === JSON.stringify([{ name: 'APP_TOKEN', source: 'approved-environment-file' }]),
    'The runtime input record is not name-and-source only.',
  );
  check(
    findings,
    materialized.refused.length === 1 && materialized.refused[0].code === 'runtime-input-unapproved',
    'An unapproved runtime input was not refused by name.',
  );
  check(
    findings,
    !JSON.stringify(materialized.refused).includes(UNAPPROVED_CANARY),
    'The refusal carried the unapproved value.',
  );

  // A real child process, run with exactly the environment the materialization
  // approved. The unapproved input is absent from it.
  const { stdout } = await runFile(
    process.execPath,
    [path.join(executionRoot, 'check.cjs'), path.join(materialized.directory, 'APP_TOKEN')],
    { cwd: executionRoot, env: { PATH: process.env.PATH, ...materialized.environment } },
  );

  check(findings, stdout.includes(`env ${APPROVED_CANARY}`), 'The approved value did not reach the check process.');
  check(findings, stdout.includes(`file ${APPROVED_CANARY}`), 'The temporary materialized file was not readable by the check.');
  check(findings, stdout.includes('shadow absent'), 'The unapproved runtime input reached the check process.');

  const store = await openEvidenceStore({
    repositoryRoot,
    redactor: createRedactor({
      secrets: materialized.record.map((entry) => ({
        ...entry,
        value: materialized.environment[entry.name],
      })),
    }),
    identity: storeIdentity(),
  });

  await store.activationReceipt().write({ ...receipt, runtimeInputs: materialized.record });

  const appended = await store.appendEvidence({
    decision: {
      protocolVersion: '1.0',
      evaluationId: 'evaluation-runtime-input',
      outcome: 'failed',
      checks: [{
        id: 'broad_test',
        outcome: 'failed',
        summary: `broad_test failed while using APP_TOKEN (${APPROVED_CANARY})`,
      }],
      evidence: { id: 'sha256:decision', format: 'change-evaluation-gate/v1', persisted: false },
    },
    outputs: [{ checkId: 'broad_test', attempt: 1, text: stdout }],
  });

  check(findings, appended.appended === true, 'Redacted evidence for an approved runtime input was not persisted.');

  await store.appendLifecycleEvent({
    type: 'activation',
    before: null,
    after: receipt.receiptId,
    outcome: 'succeeded',
    reason: `Approved runtime input ${materialized.record[0].name} from ${materialized.record[0].source} was materialized temporarily and removed.`,
  });

  // Retained configuration records the approval by name and source only.
  const configurationPath = path.join(repositoryRoot, '.agent-framework.yaml');

  await writeFile(configurationPath, [
    'schema_version: 4',
    'evaluation_gate:',
    '  runtime_inputs:',
    ...materialized.record.flatMap((entry) => [
      `    - name: ${entry.name}`,
      `      source: ${entry.source}`,
    ]),
    '',
  ].join('\n'), 'utf8');

  const released = await materialized.release();

  check(findings, released.released === true, 'The materialization was not released.');
  check(findings, !existsSync(materialized.directory), 'The materialization survived its release.');

  const retained = [
    await readFile(configurationPath, 'utf8'),
    await treeContents(store.root),
    await treeContents(executionRoot),
    await treeContents(repositoryRoot),
  ].join('\n');

  for (const canary of [APPROVED_CANARY, UNAPPROVED_CANARY]) {
    for (const form of secretForms(canary)) {
      check(
        findings,
        !retained.includes(form),
        `A recognized form of a canary survived in retained state (${form.slice(0, 10)}…).`,
      );
    }
  }

  check(findings, retained.includes('APP_TOKEN'), 'The approved runtime input name was not retained.');
  check(
    findings,
    retained.includes('approved-environment-file'),
    'The approved runtime input source was not retained.',
  );
  check(findings, (await store.listBlobs()).length > 0, 'No output blob was retained to scan.');
  check(findings, (await store.readEvents()).length > 0, 'No Lifecycle event was retained to scan.');

  return { name: 'packaged-runtime-input', ok: findings.length === 0, findings };
};

const passingAttempt = () => ({
  executed: true,
  exitCode: 0,
  timedOut: false,
  error: null,
  durationMs: 3,
});

const evaluationRequest = (root) => ({
  protocolVersion: '1.0',
  operation: 'evaluate',
  repository: { root },
  change: { kind: 'worktree', baseRevision: 'HEAD' },
  evaluation: { purpose: 'regression-only', contractRef: null },
  invocation: {
    role: 'authoritative',
    trigger: 'commit-attempt',
    adapter: {
      id: 'git',
      surface: 'git-pre-commit',
      version: '1.0.0',
      capabilities: { nativeBlocking: true },
    },
    sessionId: 'session-drift',
  },
});

const descriptor = () => ({
  id: 'node-package.broad-tests.test',
  provider: 'node-package',
  stage: 'broad-tests',
  capability: 'test',
  scope: 'both',
  applicability: { changed_path_globs: ['**'], required_facts: [] },
  prerequisites: [],
  policy: 'required',
  evaluate: {
    runner: 'package-script',
    args: ['test'],
    working_directory: '.',
    timeout_seconds: 60,
    allowed_environment: ['PATH'],
    evidence_category: 'test',
    source_scope: 'both',
  },
  fix: null,
  timeout_seconds: 120,
  declared_writes: [],
  evidence: { claims: ['test:broad'], success_exit_codes: [0], report: null },
  order: 10,
  selection: null,
});

const packagedDrift = async () => {
  const findings = [];
  const repositoryRoot = await temporaryDirectory(`${CAPABILITY}-drift-repo-`);

  await writeFile(path.join(repositoryRoot, 'source.txt'), 'baseline\n', 'utf8');
  await git(repositoryRoot, ['init', '--quiet']);
  await git(repositoryRoot, ['add', '--all']);

  const store = await openEvidenceStore({ repositoryRoot, identity: storeIdentity() });
  const receipt = receiptFixture();

  await store.activationReceipt().write(receipt);

  const before = await readFile(store.activationReceipt().path, 'utf8');
  const beforeStore = await treeContents(store.root);

  const healthy = await statusGate({
    evidenceStore: store,
    controlSurface: observedFrom(receipt),
  });

  check(findings, healthy.status === 'healthy', `An unchanged control surface reported ${healthy.status}.`);

  // Every declared control surface, drifted one at a time.
  const drifts = {
    runtime: { runtime: { gate: receipt.runtime.gate, runnerVersion: 'change-evaluation-gate/9.9.9' } },
    adapters: { adapters: [{ id: 'git', version: '2.0.0', authoritative: true }] },
    'managed-hooks': { hookBlockIdentity: `sha256:${'d'.repeat(64)}` },
    receipt: { receiptId: `sha256:${'e'.repeat(64)}` },
    'trusted-configuration': { configurationId: `sha256:${'f'.repeat(64)}` },
    'command-descriptors': {
      runners: [{ ...receipt.runtime.runners[0], executable: '/somewhere/else/node' }],
    },
    providers: { providers: { 'node-package': '2.0.0' } },
  };

  for (const surface of CONTROL_SURFACES) {
    const status = await statusGate({
      evidenceStore: store,
      controlSurface: observedFrom(receipt, drifts[surface]),
    });
    const drifted = status.findings.filter((finding) => finding.code === 'control-surface-drift');

    check(findings, status.status === 'broken', `Drift of ${surface} reported ${status.status}, not broken.`);
    check(
      findings,
      drifted.length === 1 && drifted[0].surface === surface,
      `Drift of ${surface} was not reconciled on its own.`,
    );
    check(findings, status.repaired === false, `Observing drift of ${surface} claimed a repair.`);
    check(findings, status.mutations.length === 0, `Observing drift of ${surface} reported a mutation.`);
  }

  // Observation repaired nothing and wrote nothing.
  check(
    findings,
    await readFile(store.activationReceipt().path, 'utf8') === before,
    'Observing drift changed the Activation receipt.',
  );
  check(
    findings,
    await treeContents(store.root) === beforeStore,
    'Observing drift changed the Evidence store.',
  );

  const evaluateWith = async (observed) => evaluate(evaluationRequest(repositoryRoot), {
    checks: [descriptor()],
    executionRoot: await temporaryDirectory(`${CAPABILITY}-drift-exec-`),
    execute: async () => passingAttempt(),
    controlSurface: { receipt, observed },
  });

  const denied = await evaluateWith(observedFrom(receipt, drifts['managed-hooks']));

  check(findings, denied.outcome === 'unverified', `An authoritative evaluation under drift was ${denied.outcome}.`);
  check(findings, denied.authorization === 'deny', `An authoritative evaluation under drift returned ${denied.authorization}.`);
  check(
    findings,
    denied.diagnostics.some((diagnostic) => diagnostic.reasonCode === 'integrity-drift'),
    'The denied decision did not name integrity drift.',
  );
  check(
    findings,
    denied.checks[0]?.outcome === 'passed',
    'Drift rewrote what the check itself reported.',
  );

  const allowed = await evaluateWith(observedFrom(receipt));

  check(findings, allowed.outcome === 'passed', `The same evaluation without drift was ${allowed.outcome}.`);
  check(findings, allowed.authorization === 'allow', `The same evaluation without drift returned ${allowed.authorization}.`);

  // The honest scope of all of the above.
  check(findings, TRUST_BOUNDARY.tamperResistant === false, 'The trust boundary claimed resistance.');
  check(findings, TRUST_BOUNDARY.resistsMachineOwner === false, 'The trust boundary claimed machine-owner resistance.');

  return { name: 'packaged-drift', ok: findings.length === 0, findings };
};

/** The packaged authoritative entry point a registered `pre-commit` shim runs. */
const PACKAGED_RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'gate-precommit.mjs');

const RUNNER_CHECK_ID = 'configuration.broad-tests.test';

/** The clone configuration the packaged runner reads: one required broad test. */
const runnerConfiguration = ({ required = [RUNNER_CHECK_ID], advisory = [] } = {}) => [
  'schema_version: 4',
  'backend: unknown',
  'frontend: none',
  'verification:',
  '  profile: gate-security-control-smoke',
  '  capabilities: []',
  '  commands:',
  '    test:',
  '      backend: []',
  '      frontend: []',
  '      both:',
  '        - runner: repository-script',
  '          args:',
  '            - tools/check.mjs',
  '            - source.txt',
  '          working_directory: "."',
  '          timeout_seconds: 60',
  '          allowed_environment:',
  '            - PATH',
  '          evidence_category: test',
  '          source_scope: both',
  'evaluation_gate:',
  '  checks:',
  ...(required.length === 0
    ? ['    required: []']
    : ['    required:', ...required.map((id) => `      - ${id}`)]),
  ...(advisory.length === 0
    ? ['    advisory: []']
    : ['    advisory:', ...advisory.map((id) => `      - ${id}`)]),
  '  budget:',
  '    total_seconds: 600',
  '  bypass:',
  '    enabled: false',
  '  execution: {}',
  '  evidence: {}',
  '',
].join('\n');

const RUNNER_CHECK_SCRIPT = [
  "import { readFile } from 'node:fs/promises';",
  '',
  "const graded = await readFile(process.argv[2], 'utf8').catch(() => '');",
  '',
  'process.stdout.write(`graded ${graded.length} bytes\\n`);',
  "process.exitCode = graded.includes('BROKEN') ? 1 : 0;",
  '',
].join('\n');

/**
 * The receipt a real activation of this clone publishes.
 *
 * Every pinned identity is computed the way `activate` computes it, so this is
 * a clone that could exist. A receipt of placeholders would make the runner
 * report drift for the wrong reason and prove nothing about what it compares.
 */
const publishRunnerReceipt = async (repositoryRoot) => {
  const read = await readRepositoryConfiguration({ repositoryRoot });
  const configured = gateChecksFromConfiguration(read.configuration)
    .checks.find((check) => check.id === RUNNER_CHECK_ID);
  const common = (await git(repositoryRoot, ['rev-parse', '--git-common-dir'])).stdout.trim();
  const directory = path.resolve(repositoryRoot, common, 'change-evaluation-gate/evidence/activation');
  const body = {
    receiptVersion: 'change-evaluation-gate/activation/v1',
    previewId: `sha256:${'1'.repeat(64)}`,
    repository: { root: repositoryRoot },
    configuration: {
      schemaVersion: read.configuration?.schema_version ?? null,
      identity: configurationIdentity({
        schemaVersion: read.configuration?.schema_version ?? null,
        policy: read.configuration?.evaluation_gate ?? null,
      }),
    },
    runtime: {
      gate: { id: 'change-evaluation-gate', version: '1.0.0', protocolVersion: '1.0' },
      runnerVersion: 'gate-security-control-smoke/1.0.0',
      runners: [{
        check_id: RUNNER_CHECK_ID,
        role: 'evaluate',
        runner: 'repository-script',
        executable: process.execPath,
        interpreter: null,
        version: process.versions.node,
        preview: commandPreview(configured.evaluate, process.execPath),
      }],
    },
    adapters: [{ id: 'git', version: '1.0.0', authoritative: true }],
    hooks: [],
    hookChain: {
      strategy: 'gate-owned-shim', manager: null, path: null, priorIdentity: null, blockIdentity: null,
    },
    runtimeInputs: [],
  };

  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'receipt.json'),
    `${JSON.stringify({ ...body, receiptId: contentIdentity(body) }, null, 2)}\n`,
    'utf8',
  );

  return path.join(directory, 'receipt.json');
};

const runPackagedRunner = (cwd) => runFile(process.execPath, [PACKAGED_RUNNER], {
  cwd,
  env: gitEnvironment(),
}).then(
  (result) => ({ exitCode: 0, output: `${result.stdout}${result.stderr}` }),
  (error) => ({ exitCode: error.code ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }),
);

/**
 * The SHIPPED entry point, reconciling what the receipt pinned.
 *
 * Everything above proves the rule against a hand-assembled surface, which is
 * how a reconciliation nothing called could look thoroughly proved for as long
 * as it did. This drives `gate-precommit.mjs` itself: the program a registered
 * hook runs, on a clone whose policy was edited after activation
 * (`AC-SEC-001`, `AC-CFG-004`, `AC-EVAL-001`).
 */
const packagedRunnerDrift = async () => {
  const findings = [];
  const repositoryRoot = await temporaryDirectory(`${CAPABILITY}-runner-repo-`);

  await mkdir(path.join(repositoryRoot, 'tools'), { recursive: true });
  await writeFile(path.join(repositoryRoot, 'tools/check.mjs'), RUNNER_CHECK_SCRIPT, 'utf8');
  await writeFile(path.join(repositoryRoot, 'source.txt'), 'baseline\n', 'utf8');
  await writeFile(path.join(repositoryRoot, '.agent-framework.yaml'), runnerConfiguration(), 'utf8');
  await git(repositoryRoot, ['init', '--quiet']);
  await git(repositoryRoot, ['add', '--all']);
  await git(repositoryRoot, [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Security Control Smoke',
    'commit', '--quiet', '--message', 'baseline',
  ]);

  const receiptPath = await publishRunnerReceipt(repositoryRoot);
  const pinned = await readFile(receiptPath, 'utf8');

  await writeFile(path.join(repositoryRoot, 'source.txt'), 'baseline\nrepaired\n', 'utf8');
  await git(repositoryRoot, ['add', '--all']);

  const undrifted = await runPackagedRunner(repositoryRoot);

  check(findings, undrifted.exitCode === 0, `The undrifted clone was refused: ${undrifted.output}`);
  check(
    findings,
    !undrifted.output.includes('integrity-drift'),
    `The undrifted clone reported drift: ${undrifted.output}`,
  );

  // The one edit an agent whose commit was blocked would reach for.
  await writeFile(
    path.join(repositoryRoot, '.agent-framework.yaml'),
    runnerConfiguration({ required: [], advisory: [RUNNER_CHECK_ID] }),
    'utf8',
  );
  await writeFile(path.join(repositoryRoot, 'source.txt'), 'baseline\nBROKEN\n', 'utf8');
  await git(repositoryRoot, ['add', '--all']);

  const drifted = await runPackagedRunner(repositoryRoot);

  check(findings, drifted.exitCode !== 0, `A weakened policy graded a commit: ${drifted.output}`);
  check(findings, drifted.output.includes('integrity-drift'), `The denial did not name drift: ${drifted.output}`);
  check(
    findings,
    drifted.output.includes('trusted-configuration'),
    `The denial did not name the drifted surface: ${drifted.output}`,
  );
  check(findings, drifted.output.includes('gate repair'), `The denial did not name gate repair: ${drifted.output}`);
  check(
    findings,
    await readFile(receiptPath, 'utf8') === pinned,
    'The packaged runner re-pinned the receipt it disagreed with.',
  );

  return { name: 'packaged-runner-drift', ok: findings.length === 0, findings };
};

const gatePolicy = () => ({
  checks: { required: ['broad_test', 'static_analysis'], advisory: ['format'] },
  budget: { total_seconds: 600 },
  bypass: { enabled: false, marker: null },
  execution: { budget_skippable: [] },
  evidence: {},
});

const packagedPolicyTransition = () => {
  const findings = [];
  const trusted = gatePolicy();
  const candidate = {
    ...trusted,
    checks: { required: ['broad_test'], advisory: ['format', 'static_analysis'] },
  };
  const failing = [
    { id: 'broad_test', outcome: 'passed' },
    { id: 'static_analysis', outcome: 'failed' },
    { id: 'format', outcome: 'passed' },
  ];
  const passing = failing.map((entry) => ({ ...entry, outcome: 'passed' }));

  const weakened = evaluatePolicyTransition({
    trusted: { policy: trusted },
    candidate: { policy: candidate },
    checks: failing,
    role: 'authoritative',
    approval: { candidateId: policyIdentity(candidate), grantedBy: CAPABILITY },
  });

  check(findings, weakened.candidate.outcome === 'passed', 'The weaker candidate policy did not pass on its own terms.');
  check(findings, weakened.trusted.outcome === 'failed', 'The Trusted policy did not fail the weakening change.');
  check(findings, weakened.advanced === false, 'A candidate weakening advanced trust.');
  check(findings, weakened.authorization === 'deny', `A candidate weakening returned ${weakened.authorization}.`);
  check(
    findings,
    weakened.reasonCode === 'trusted-policy-unsatisfied',
    `A candidate weakening was refused for ${weakened.reasonCode}.`,
  );

  const unapproved = evaluatePolicyTransition({
    trusted: { policy: trusted },
    candidate: { policy: candidate },
    checks: passing,
    role: 'authoritative',
  });

  check(findings, unapproved.advanced === false, 'Trust advanced with no hash-bound approval.');
  check(
    findings,
    unapproved.reasonCode === 'approval-missing',
    `An unapproved transition was refused for ${unapproved.reasonCode}.`,
  );

  const approved = evaluatePolicyTransition({
    trusted: { policy: trusted },
    candidate: { policy: candidate },
    checks: passing,
    role: 'authoritative',
    approval: { candidateId: policyIdentity(candidate), grantedBy: CAPABILITY },
  });

  check(findings, approved.advanced === true, 'A hash-bound approval with both policies passing did not advance trust.');
  check(
    findings,
    approved.trustedNext === policyIdentity(candidate),
    'Trust advanced to something other than the approved candidate hash.',
  );

  const mismatched = evaluatePolicyTransition({
    trusted: { policy: trusted },
    candidate: { policy: candidate },
    checks: passing,
    role: 'authoritative',
    approval: { candidateId: `sha256:${'0'.repeat(64)}`, grantedBy: CAPABILITY },
  });

  check(findings, mismatched.advanced === false, 'An approval of another configuration advanced this one.');
  check(
    findings,
    mismatched.reasonCode === 'approval-mismatch',
    `A mismatched approval was refused for ${mismatched.reasonCode}.`,
  );

  return { name: 'packaged-policy-transition', ok: findings.length === 0, findings };
};

/** The packaged operator command, run the way a maintainer or an agent runs it. */
const PACKAGED_COMMAND = path.join(path.dirname(fileURLToPath(import.meta.url)), 'gate.mjs');

const runPackagedCommand = (cwd, args, environment = {}) => runFile(
  process.execPath,
  [PACKAGED_COMMAND, ...args],
  { cwd, env: { ...gitEnvironment(), ...environment } },
).then(
  (result) => ({ exitCode: 0, stdout: result.stdout, stderr: result.stderr }),
  (error) => ({ exitCode: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }),
);

/**
 * A synthetic canary in a shape NO built-in pattern matches: a bare value
 * inside a stack frame, with no variable name, no `=`, no scheme, no URL. Only
 * a rule armed from the declared value can catch it. Scenario 1 prints its
 * canary beside recognizable labels and would pass on the pattern layer alone.
 */
const DECLARED_CANARY = 'wq4n8k2vz7m1p5r9t3y6x0';

const DECLARED_INPUT = 'APP_KEY';

/** A required check that fails loudly and prints the declared value bare. */
const DECLARED_CHECK_SCRIPT = [
  "import { readFile } from 'node:fs/promises';",
  '',
  "const graded = await readFile(process.argv[2], 'utf8').catch(() => '');",
  `const key = process.env.${DECLARED_INPUT} ?? '';`,
  '',
  "process.stdout.write('Error: connection refused\\n');",
  'process.stdout.write(`    at connect (${key})\\n`);',
  'process.stdout.write(`${key}\\n`);',
  'process.stdout.write(`graded ${graded.length} bytes\\n`);',
  "process.exitCode = graded.includes('BROKEN') ? 1 : 0;",
  '',
].join('\n');

/** The clone configuration: the same one check, now declaring one Sensitive input. */
const declaredConfiguration = () => runnerConfiguration()
  .replace("            - PATH\n", `            - PATH\n            - ${DECLARED_INPUT}\n`)
  .replace('  evidence: {}', `  evidence: {"sensitive_inputs":["${DECLARED_INPUT}"]}`);

const commitAttempt = (root, message, environment) => runFile('git', [
  '-c', 'user.email=gate@example.test',
  '-c', 'user.name=Gate Security Control Smoke',
  'commit', '--quiet', '--message', message,
], { cwd: root, env: { ...gitEnvironment(), ...environment } }).then(
  () => ({ failed: false, output: '' }),
  (error) => ({ failed: true, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }),
);

/**
 * A declaration written in the clone's own configuration, reaching the store
 * through `gate activate` and a real commit — the reachability `TB-045` is
 * about. Scenario 1 proves the redactor with a declaration the fixture supplies
 * itself; until this slice no project could supply one, so every real clone
 * ran with no declared secret and the pattern layer alone.
 *
 * The check prints the declared value in a shape no built-in pattern matches,
 * the commit is denied by a real required failure, and no recognized form of
 * the value survives anywhere the clone keeps: the store, the receipt, the hook,
 * the configuration, or the runner's own output (`AC-CFG-004`, `NFR-SEC-003`,
 * `FR-CFG-006`). A second commit with the declared name absent from the
 * environment is not an error and not silent: the envelope names it as
 * unresolved.
 */
const configuredDeclaration = async () => {
  const findings = [];
  const repositoryRoot = await temporaryDirectory(`${CAPABILITY}-declared-repo-`);

  await mkdir(path.join(repositoryRoot, 'tools'), { recursive: true });
  await writeFile(path.join(repositoryRoot, 'tools/check.mjs'), DECLARED_CHECK_SCRIPT, 'utf8');
  await writeFile(path.join(repositoryRoot, 'source.txt'), 'baseline\n', 'utf8');
  await writeFile(path.join(repositoryRoot, '.agent-framework.yaml'), declaredConfiguration(), 'utf8');
  await git(repositoryRoot, ['init', '--quiet']);
  await git(repositoryRoot, ['add', '--all']);
  await git(repositoryRoot, [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Security Control Smoke',
    'commit', '--quiet', '--message', 'baseline',
  ]);

  // The preview names the declared input, so consent is granted against it.
  const preview = await runPackagedCommand(repositoryRoot, ['activate']);

  check(findings, preview.exitCode === 0, `The activation preview exited ${preview.exitCode}: ${preview.stderr}`);
  check(
    findings,
    preview.stdout.includes(`runtime inputs: ${DECLARED_INPUT}`),
    `The preview did not name the declared input: ${preview.stdout}`,
  );

  const previewed = await runPackagedCommand(repositoryRoot, ['activate', '--json']);
  const token = JSON.parse(previewed.stdout || '{}').observation?.confirmationToken ?? '';
  const confirmed = await runPackagedCommand(repositoryRoot, ['activate', '--confirm', token, '--json']);
  const confirmedDocument = JSON.parse(confirmed.stdout || '{}');

  check(
    findings,
    confirmedDocument.mutation?.performed === true,
    `The command did not activate the clone: ${confirmed.stdout}${confirmed.stderr}`,
  );

  if (confirmedDocument.mutation?.performed !== true) {
    return { name: 'configured-declaration', ok: false, findings };
  }

  const common = (await git(repositoryRoot, ['rev-parse', '--git-common-dir'])).stdout.trim();
  const gitDirectory = path.resolve(repositoryRoot, common);
  const receiptPath = path.join(gitDirectory, 'change-evaluation-gate/evidence/activation/receipt.json');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));

  check(
    findings,
    JSON.stringify(receipt.runtimeInputs) === JSON.stringify([DECLARED_INPUT]),
    `The receipt did not pin the declared name: ${JSON.stringify(receipt.runtimeInputs)}.`,
  );

  // A real commit, denied by a real required failure that printed the value.
  await writeFile(path.join(repositoryRoot, 'source.txt'), 'baseline\nBROKEN\n', 'utf8');
  await git(repositoryRoot, ['add', '--all']);

  const denied = await commitAttempt(repositoryRoot, 'prints the declared value', {
    [DECLARED_INPUT]: DECLARED_CANARY,
  });

  check(findings, denied.failed === true, 'The failing check was not denied.');
  check(
    findings,
    !denied.output.includes(DECLARED_CANARY),
    'The declared value reached the runner output shown to the committer.',
  );

  const storeRoot = path.join(gitDirectory, 'change-evaluation-gate');
  const store = await openEvidenceStore({ repositoryRoot, identity: storeIdentity() });
  const log = await store.readLog();

  check(findings, log.length === 1, `Expected one logged envelope, found ${log.length}.`);

  const envelope = log.length > 0 ? await store.readEnvelope(log[0].evidenceId) : null;

  check(
    findings,
    JSON.stringify(envelope?.redaction?.secrets) === JSON.stringify([{ name: DECLARED_INPUT, source: 'environment' }]),
    `The envelope did not record the declared input by name and source: ${JSON.stringify(envelope?.redaction?.secrets)}.`,
  );
  check(
    findings,
    (envelope?.redaction?.rules ?? []).some((rule) => rule.rule === `declared:${DECLARED_INPUT}` && rule.count >= 2),
    `The declared rule did not catch the bare value: ${JSON.stringify(envelope?.redaction?.rules)}.`,
  );
  check(findings, (await store.listBlobs()).length > 0, 'No output blob was retained to scan.');

  // Every byte the clone keeps: store, receipt, hook, configuration, worktree.
  const retained = [
    await treeContents(storeRoot),
    await treeContents(path.join(gitDirectory, 'hooks')),
    await readFile(path.join(repositoryRoot, '.agent-framework.yaml'), 'utf8'),
    denied.output,
  ].join('\n');

  for (const form of secretForms(DECLARED_CANARY)) {
    check(
      findings,
      !retained.includes(form),
      `A recognized form of the declared value survived in retained state (${form.slice(0, 6)}…).`,
    );
  }

  check(findings, retained.includes(DECLARED_INPUT), 'The declared input name was not retained.');

  // The same declared name, absent from the environment: not an error, not
  // silent. The commit is graded, and the envelope says nothing was armed.
  await writeFile(path.join(repositoryRoot, 'source.txt'), 'baseline\nrepaired\n', 'utf8');
  await git(repositoryRoot, ['add', '--all']);

  const environment = { ...process.env };

  delete environment[DECLARED_INPUT];

  const allowed = await runFile('git', [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Security Control Smoke',
    'commit', '--quiet', '--message', 'declared input absent from the environment',
  ], { cwd: repositoryRoot, env: { ...environment, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }).then(
    () => ({ failed: false, output: '' }),
    (error) => ({ failed: true, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }),
  );

  check(findings, allowed.failed === false, `An absent declared input was treated as an error: ${allowed.output}`);

  const afterLog = await store.readLog();
  const latest = afterLog.length > 1 ? await store.readEnvelope(afterLog.at(-1).evidenceId) : null;

  check(
    findings,
    JSON.stringify(latest?.redaction?.unresolved) === JSON.stringify([{ name: DECLARED_INPUT, source: 'environment' }]),
    `The envelope did not record the absent declared input as unresolved: ${JSON.stringify(latest?.redaction)}.`,
  );
  check(
    findings,
    JSON.stringify(latest?.redaction?.secrets) === '[]',
    'An absent declared input was recorded as armed.',
  );

  return { name: 'configured-declaration', ok: findings.length === 0, findings };
};

/**
 * A synthetic key in a shape no built-in pattern matches, and a synthetic
 * decoy that must never be read. Neither is a credential; both are invented
 * for this fixture.
 */
const FILE_CANARY = 'p9x2k7m4w1r8c5v3b6n0zq';

const DECOY_CANARY = 'decoy-t3y6u9i2o5p8a1s4d7';

const DECLARED_FILE = '.env';

/**
 * Where the check reports what it observed of its own execution root. The
 * store elides every host path, so the only way to learn where the check ran
 * and what the owner-only file looked like while it ran is for the check to
 * say so out of band. Removed before and after each run.
 */
const OBSERVATION_FILE = path.join(tmpdir(), `${CAPABILITY}-envfile-observation.json`);

/** A required check that boots only with the key, and prints it bare. */
const KEYED_CHECK_SCRIPT = [
  "import { readFile, stat, writeFile } from 'node:fs/promises';",
  "import path from 'node:path';",
  '',
  "const graded = await readFile(process.argv[2], 'utf8').catch(() => '');",
  `const key = process.env.${DECLARED_INPUT} ?? '';`,
  `const inputFile = path.join(process.cwd(), '.change-evaluation-gate-runtime-inputs', '${DECLARED_INPUT}');`,
  'const observed = await stat(inputFile).then(',
  '  (entry) => ({ present: true, mode: entry.mode & 0o777 }),',
  '  () => ({ present: false, mode: null }),',
  ');',
  '',
  `await writeFile(${JSON.stringify(OBSERVATION_FILE)}, JSON.stringify({`,
  '  executionRoot: process.cwd(),',
  '  inputFile,',
  '  ...observed,',
  '  sameValue: observed.present && (await readFile(inputFile, "utf8")) === key,',
  "}), 'utf8');",
  '',
  "if (key === '') {",
  "  process.stdout.write('No application encryption key has been specified.\\n');",
  '  process.exit(1);',
  '}',
  '',
  'process.stdout.write(`    at boot (${key})\\n`);',
  'process.stdout.write(`key length ${key.length}\\n`);',
  "process.stdout.write(`decoy ${process.env.OTHER_SECRET ?? 'absent'}\\n`);",
  "process.stdout.write(`home ${process.env.HOME ?? 'absent'}\\n`);",
  'process.stdout.write(`graded ${graded.length} bytes\\n`);',
  "process.exitCode = graded.includes('BROKEN') ? 1 : 0;",
  '',
].join('\n');

/**
 * The clone configuration: the same one check, declaring the input AND the
 * file, and allowing NO ambient variable at all — so the only way the key can
 * reach the check is the approval the receipt pinned.
 */
const keyedConfiguration = () => runnerConfiguration()
  .replace('          allowed_environment:\n            - PATH\n', '          allowed_environment: []\n')
  .replace(
    '  evidence: {}',
    `  evidence: {"sensitive_inputs":["${DECLARED_INPUT}"],"environment_files":["${DECLARED_FILE}"]}`,
  );

/** The runner's environment with nothing of the fixture in it. */
const bareEnvironment = () => {
  const environment = { ...gitEnvironment() };

  delete environment[DECLARED_INPUT];
  delete environment.OTHER_SECRET;

  return environment;
};

const commitWith = (root, message, environment) => runFile('git', [
  '-c', 'user.email=gate@example.test',
  '-c', 'user.name=Gate Security Control Smoke',
  'commit', '--quiet', '--message', message,
], { cwd: root, env: environment }).then(
  () => ({ failed: false, output: '' }),
  (error) => ({ failed: true, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }),
);

const declaredEnvironmentFile = async () => {
  const findings = [];
  const repositoryRoot = await temporaryDirectory(`${CAPABILITY}-envfile-repo-`);

  await mkdir(path.join(repositoryRoot, 'tools'), { recursive: true });
  await writeFile(path.join(repositoryRoot, 'tools/check.mjs'), KEYED_CHECK_SCRIPT, 'utf8');
  await writeFile(path.join(repositoryRoot, 'source.txt'), 'baseline\n', 'utf8');
  await writeFile(path.join(repositoryRoot, '.gitignore'), `${DECLARED_FILE}\n`, 'utf8');
  await writeFile(path.join(repositoryRoot, '.agent-framework.yaml'), keyedConfiguration(), 'utf8');
  await git(repositoryRoot, ['init', '--quiet']);
  await git(repositoryRoot, ['add', '--all']);
  await git(repositoryRoot, [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Security Control Smoke',
    'commit', '--quiet', '--message', 'baseline',
  ]);
  // The git-ignored file, written after the baseline so it is in no commit.
  await writeFile(
    path.join(repositoryRoot, DECLARED_FILE),
    `# local settings\n${DECLARED_INPUT}=${FILE_CANARY}\nOTHER_SECRET=${DECOY_CANARY}\n`,
    'utf8',
  );

  const tracked = (await git(repositoryRoot, ['ls-files', '--', DECLARED_FILE])).stdout.trim();

  check(findings, tracked === '', `The fixture's environment file is tracked: ${tracked}`);

  const preview = await runPackagedCommand(repositoryRoot, ['activate'], bareEnvironment());

  check(findings, preview.exitCode === 0, `The activation preview exited ${preview.exitCode}: ${preview.stderr}`);
  check(
    findings,
    preview.stdout.includes(`runtime inputs: ${DECLARED_INPUT}`),
    `The preview did not name the declared input: ${preview.stdout}`,
  );

  const previewed = await runPackagedCommand(repositoryRoot, ['activate', '--json'], bareEnvironment());
  const token = JSON.parse(previewed.stdout || '{}').observation?.confirmationToken ?? '';
  const confirmed = await runPackagedCommand(repositoryRoot, ['activate', '--confirm', token, '--json'], bareEnvironment());
  const confirmedDocument = JSON.parse(confirmed.stdout || '{}');

  check(
    findings,
    confirmedDocument.mutation?.performed === true,
    `The command did not activate the clone: ${confirmed.stdout}${confirmed.stderr}`,
  );

  if (confirmedDocument.mutation?.performed !== true) {
    return { name: 'declared-environment-file', ok: false, findings };
  }

  const common = (await git(repositoryRoot, ['rev-parse', '--git-common-dir'])).stdout.trim();
  const gitDirectory = path.resolve(repositoryRoot, common);
  const receipt = JSON.parse(await readFile(
    path.join(gitDirectory, 'change-evaluation-gate/evidence/activation/receipt.json'),
    'utf8',
  ));

  check(
    findings,
    JSON.stringify(receipt.runtimeInputs) === JSON.stringify([DECLARED_INPUT]),
    `The receipt did not pin the declared name: ${JSON.stringify(receipt.runtimeInputs)}.`,
  );

  // A real commit by the shipped hook, with the key in no environment: it
  // boots, because the approved name was resolved from the declared file.
  await writeFile(path.join(repositoryRoot, 'source.txt'), 'baseline\nrepaired\n', 'utf8');
  await git(repositoryRoot, ['add', '--all']);
  await rm(OBSERVATION_FILE, { force: true });

  const allowed = await commitWith(repositoryRoot, 'boots with the resolved key', bareEnvironment());

  check(findings, allowed.failed === false, `The check did not boot with the resolved key: ${allowed.output}`);

  // What the check saw while it ran, and what is left of it now.
  const observed = JSON.parse(await readFile(OBSERVATION_FILE, 'utf8').catch(() => 'null'));

  await rm(OBSERVATION_FILE, { force: true });
  check(findings, observed !== null, 'The check left no observation of its execution root.');
  check(findings, observed?.present === true, 'The owner-only input file was not beside the check while it ran.');
  check(findings, observed?.mode === 0o600, `The input file was not owner-only: ${observed?.mode?.toString(8)}.`);
  check(findings, observed?.sameValue === true, 'The input file and the environment did not carry one value.');
  check(
    findings,
    typeof observed?.executionRoot === 'string' && isInside(await realpath(tmpdir()), observed.executionRoot),
    `The check did not run under the OS temporary directory: ${observed?.executionRoot}.`,
  );
  check(
    findings,
    typeof observed?.inputFile === 'string' && !existsSync(observed.inputFile),
    `The owner-only input file survived the evaluation: ${observed?.inputFile}.`,
  );
  check(
    findings,
    typeof observed?.executionRoot === 'string' && !existsSync(observed.executionRoot),
    `The execution root survived the evaluation: ${observed?.executionRoot}.`,
  );

  // The same clone with a required failure is still denied.
  await writeFile(path.join(repositoryRoot, 'source.txt'), 'baseline\nBROKEN\n', 'utf8');
  await git(repositoryRoot, ['add', '--all']);

  const denied = await commitWith(repositoryRoot, 'a required failure', bareEnvironment());

  check(findings, denied.failed === true, 'The failing check was not denied.');

  const storeRoot = path.join(gitDirectory, 'change-evaluation-gate');
  const store = await openEvidenceStore({ repositoryRoot, identity: storeIdentity() });
  const log = await store.readLog();

  check(findings, log.length === 2, `Expected two logged envelopes, found ${log.length}.`);

  const envelope = log.length > 0 ? await store.readEnvelope(log[0].evidenceId) : null;
  const inline = (envelope?.retention?.attempts ?? []).map((attempt) => attempt.inline ?? '').join('\n');

  check(findings, /at boot \(\[redacted]\)/.test(inline), `The check did not print the redacted key: ${inline}`);
  check(findings, inline.includes(`key length ${FILE_CANARY.length}`), 'The value the check received is not the file value.');
  check(findings, inline.includes('decoy absent'), 'The undeclared name in the file reached the check.');
  check(findings, inline.includes('home absent'), 'An ambient variable the descriptor did not list reached the check.');
  check(
    findings,
    JSON.stringify(envelope?.redaction?.secrets) === JSON.stringify([{ name: DECLARED_INPUT, source: DECLARED_FILE }]),
    `The envelope did not record the input by name and file source: ${JSON.stringify(envelope?.redaction?.secrets)}.`,
  );
  check(
    findings,
    JSON.stringify(envelope?.redaction?.environmentFiles) === JSON.stringify([{ path: DECLARED_FILE, status: 'read' }]),
    `The envelope did not record the declared file's status: ${JSON.stringify(envelope?.redaction?.environmentFiles)}.`,
  );
  check(findings, (await store.listBlobs()).length > 0, 'No output blob was retained to scan.');

  // The stored decision names no host path at all, so the observation above
  // is the only place the real root was ever written — and it is gone.
  check(
    findings,
    typeof observed?.executionRoot !== 'string' || !JSON.stringify(envelope).includes(observed.executionRoot),
    'The stored envelope carries the host path of the execution root.',
  );

  // Every byte the clone keeps: store, receipt, hook, configuration, and what
  // the committer was shown. Neither value, in any recognized form.
  const retained = [
    await treeContents(storeRoot),
    await treeContents(path.join(gitDirectory, 'hooks')),
    await readFile(path.join(repositoryRoot, '.agent-framework.yaml'), 'utf8'),
    allowed.output,
    denied.output,
  ].join('\n');

  for (const canary of [FILE_CANARY, DECOY_CANARY]) {
    for (const form of secretForms(canary)) {
      check(
        findings,
        !retained.includes(form),
        `A recognized form of ${canary === FILE_CANARY ? 'the key' : 'the decoy'} survived in retained state (${form.slice(0, 6)}…).`,
      );
    }
  }

  check(findings, retained.includes(DECLARED_INPUT), 'The declared input name was not retained.');
  check(findings, !retained.includes('OTHER_SECRET'), 'The undeclared name was read from the file.');

  // With the file gone, the same commit fails inside the snapshot exactly as
  // every such project did before this slice — and the envelope says why.
  await rm(path.join(repositoryRoot, DECLARED_FILE));
  await writeFile(path.join(repositoryRoot, 'source.txt'), 'baseline\nrepaired again\n', 'utf8');
  await git(repositoryRoot, ['add', '--all']);
  await rm(OBSERVATION_FILE, { force: true });

  const withoutFile = await commitWith(repositoryRoot, 'no key anywhere', bareEnvironment());
  const unprovisioned = JSON.parse(await readFile(OBSERVATION_FILE, 'utf8').catch(() => 'null'));

  await rm(OBSERVATION_FILE, { force: true });
  check(findings, withoutFile.failed === true, 'A check that needs the key booted without it.');
  check(findings, unprovisioned?.present === false, 'An input file was materialized with nothing resolved.');

  const afterLog = await store.readLog();
  const latest = afterLog.length > 2 ? await store.readEnvelope(afterLog.at(-1).evidenceId) : null;
  const latestInline = (latest?.retention?.attempts ?? []).map((attempt) => attempt.inline ?? '').join('\n');

  check(findings, latestInline.includes('No application encryption key'), `The check did not fail for the missing key: ${latestInline}`);
  check(
    findings,
    JSON.stringify(latest?.redaction?.unresolved) === JSON.stringify([
      { name: DECLARED_INPUT, source: 'environment', searched: ['environment'] },
    ]),
    `The envelope did not record the absent input as unresolved with its searched sources: ${JSON.stringify(latest?.redaction)}.`,
  );
  check(
    findings,
    JSON.stringify(latest?.redaction?.environmentFiles) === JSON.stringify([{ path: DECLARED_FILE, status: 'missing' }]),
    `The envelope did not record the missing file: ${JSON.stringify(latest?.redaction?.environmentFiles)}.`,
  );
  // The snapshot's own re-check saw nothing beside the tracked content: the
  // runtime-input directory is outside the identity and its verification.
  // (Identity equality with and without the input, over one tracked tree, is
  // proved by the runner's unit suite.)
  for (const stored of [envelope, latest]) {
    check(
      findings,
      !(stored?.decision?.diagnostics ?? []).some((diagnostic) => diagnostic.reasonCode === 'snapshot-mismatch'),
      'The immutability re-check saw the runtime-input directory.',
    );
  }

  return { name: 'declared-environment-file', ok: findings.length === 0, findings };
};

const BYPASS_MARKER = 'Gate-Bypass';

/** The same one-check clone, with the bypass switch on the way a maintainer writes it. */
const bypassConfiguration = () => runnerConfiguration()
  .replace('  bypass:\n    enabled: false\n', `  bypass:\n    enabled: true\n    marker: ${BYPASS_MARKER}\n`);

/** Activate one throwaway clone through the packaged command, as a maintainer does. */
const activateClone = async (repositoryRoot, findings) => {
  const previewed = await runPackagedCommand(repositoryRoot, ['activate', '--json']);
  const token = JSON.parse(previewed.stdout || '{}').observation?.confirmationToken ?? '';
  const confirmed = await runPackagedCommand(repositoryRoot, ['activate', '--confirm', token, '--json']);
  const document = JSON.parse(confirmed.stdout || '{}');

  check(
    findings,
    document.mutation?.performed === true,
    `The command did not activate the clone: ${confirmed.stdout}${confirmed.stderr}`,
  );

  return document.mutation?.performed === true;
};

const cloneWithPolicy = async (prefix, configuration) => {
  const repositoryRoot = await temporaryDirectory(`${CAPABILITY}-${prefix}-repo-`);

  await mkdir(path.join(repositoryRoot, 'tools'), { recursive: true });
  await writeFile(path.join(repositoryRoot, 'tools/check.mjs'), RUNNER_CHECK_SCRIPT, 'utf8');
  await writeFile(path.join(repositoryRoot, 'source.txt'), 'baseline\n', 'utf8');
  await writeFile(path.join(repositoryRoot, '.agent-framework.yaml'), configuration, 'utf8');
  await git(repositoryRoot, ['init', '--quiet']);
  await git(repositoryRoot, ['add', '--all']);
  await git(repositoryRoot, [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Security Control Smoke',
    'commit', '--quiet', '--message', 'baseline',
  ]);

  return repositoryRoot;
};

const stageBroken = async (repositoryRoot, suffix = '') => {
  await writeFile(path.join(repositoryRoot, 'source.txt'), `baseline\nBROKEN\n${suffix}`, 'utf8');
  await git(repositoryRoot, ['add', '--all']);
};

const grantBypass = async (repositoryRoot, reason) => {
  const previewed = await runPackagedCommand(repositoryRoot, ['bypass', '--reason', reason, '--json']);
  const preview = JSON.parse(previewed.stdout || '{}');
  const token = preview.observation?.confirmationToken ?? '';
  const confirmed = await runPackagedCommand(repositoryRoot, ['bypass', '--reason', reason, '--confirm', token, '--json']);

  return { preview, confirmed: JSON.parse(confirmed.stdout || '{}'), exitCode: confirmed.exitCode };
};

/**
 * The bypass switch means something (`TB-052`): the SHIPPED command grants a
 * one-shot bypass and the SHIPPED hook honours it, against a real activated
 * clone and a real `git commit`.
 *
 * Enabled: a denied commit names the escape hatch; `gate bypass` previews the
 * staged snapshot and confirms a grant; staging anything more refuses that
 * grant as `snapshot-mismatch` and spends it; a fresh grant lets the next
 * commit proceed as `bypassed` — never `passed` — with the failure preserved
 * in the decision, the ledger consumed, the marker printed for the message,
 * and every record through the existing Evidence and Lifecycle paths; and the
 * commit after that, with no grant, is denied exactly as before (`FR-POL-006`,
 * `FR-POL-007`, `SG-BYP-001`, `NFR-AUD-001`).
 *
 * Disabled: the same clone with the switch off denies the same commit with
 * the same lines it always printed, its decision carries no bypass record, no
 * ledger and no grant directory exist, and `gate bypass` refuses by the
 * policy's own `bypass-disabled` (`FR-POL-008`).
 */
const packagedBypass = async () => {
  const findings = [];
  const enabled = await cloneWithPolicy('bypass-on', bypassConfiguration());

  if (!(await activateClone(enabled, findings))) {
    return { name: 'packaged-bypass', ok: false, findings };
  }

  await stageBroken(enabled);

  // 1. Denied, and told where the escape hatch is.
  const denied = await commitAttempt(enabled, 'broken, no grant');

  check(findings, denied.failed === true, 'A broken commit with no grant was allowed.');
  check(findings, denied.output.includes('bypass available'), `The denial did not name the enabled bypass: ${denied.output}`);
  check(findings, denied.output.includes('gate bypass --reason'), `The denial did not name the command: ${denied.output}`);

  // 2. Preview and grant, bound to the staged snapshot.
  const first = await grantBypass(enabled, 'hotfix under incident 12');

  check(findings, first.preview.observation?.grantable === true, `The preview refused a grantable bypass: ${JSON.stringify(first.preview)}`);
  check(findings, first.confirmed.mutation?.performed === true, `The grant was not written: ${JSON.stringify(first.confirmed)}`);

  // 3. One more staged byte: the grant names a snapshot this commit is not.
  await stageBroken(enabled, 'and more\n');

  const mismatched = await commitAttempt(enabled, 'broken, stale grant');

  check(findings, mismatched.failed === true, 'A grant for another snapshot authorized a commit.');
  check(findings, mismatched.output.includes('bypass refused (snapshot-mismatch)'), `The stale grant was not refused by name: ${mismatched.output}`);

  const common = path.resolve(enabled, (await git(enabled, ['rev-parse', '--git-common-dir'])).stdout.trim());
  const store = await openEvidenceStore({ repositoryRoot: enabled, identity: storeIdentity() });

  check(findings, await store.bypassGrant().read() === null, 'The refused grant was left in front of the next commit.');
  check(findings, (await store.readBypassLedger()).length === 0, 'A refused grant was consumed.');

  // 4. A fresh grant for the snapshot as it is now, and the commit proceeds.
  const second = await grantBypass(enabled, 'hotfix under incident 12, re-granted');

  check(findings, second.confirmed.mutation?.performed === true, `The second grant was not written: ${JSON.stringify(second.confirmed)}`);

  const bypassed = await runFile('git', [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Security Control Smoke',
    'commit', '--message', `broken, bypassed\n\n${BYPASS_MARKER}: incident 12`,
  ], { cwd: enabled, env: gitEnvironment() }).then(
    (result) => ({ failed: false, output: `${result.stdout}${result.stderr}` }),
    (error) => ({ failed: true, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }),
  );

  check(findings, bypassed.failed === false, `The granted commit was denied: ${bypassed.output}`);
  check(findings, bypassed.output.includes('bypassed / allow'), `The hook did not report bypassed: ${bypassed.output}`);
  check(findings, bypassed.output.includes(`bypass marker: ${BYPASS_MARKER}`), `The marker was not printed for the message: ${bypassed.output}`);
  check(findings, bypassed.output.includes('configuration.broad-tests.test: failed'), 'The preserved failure was hidden from the maintainer.');

  const head = (await git(enabled, ['log', '-1', '--format=%s'])).stdout.trim();

  check(findings, head === 'broken, bypassed', `The bypassed commit was not created: HEAD is ${JSON.stringify(head)}.`);

  const ledger = await store.readBypassLedger();
  const log = await store.readLog();
  const envelope = log.length > 0 ? await store.readEnvelope(log.at(-1).evidenceId) : null;
  const bypassEvents = (await store.readEvents()).filter((event) => event.type === 'bypass');

  check(findings, ledger.length === 1, `Expected one consumed grant in the ledger, found ${ledger.length}.`);
  check(findings, ledger[0]?.bypassId === second.confirmed.mutation?.grantId, 'The ledger consumed a grant other than the one written.');
  check(findings, envelope?.decision?.outcome === 'bypassed', `The persisted decision is ${envelope?.decision?.outcome}, not bypassed.`);
  check(findings, envelope?.decision?.bypass?.applied === true, 'The persisted decision carries no applied bypass.');
  check(
    findings,
    envelope?.decision?.checks?.find((entry) => entry.id === RUNNER_CHECK_ID)?.outcome === 'failed',
    'SG-BYP-001: the bypassed decision rewrote the failed check.',
  );
  check(findings, envelope?.decision?.bypass?.marker === BYPASS_MARKER, 'The decision does not carry the configured marker.');
  // Two grants written, one refused-by-mismatch commit (no event: the refusal
  // is the decision's own record), one consumption: three `bypass` events,
  // all of the existing type, all `succeeded`.
  check(
    findings,
    bypassEvents.length === 3 && bypassEvents.every((event) => event.outcome === 'succeeded'),
    `Expected three succeeded bypass Lifecycle events, found ${JSON.stringify(bypassEvents.map((event) => event.outcome))}.`,
  );
  check(findings, await store.bypassGrant().read() === null, 'The consumed grant was not spent.');

  // 5. The next broken commit, with no grant, is denied as before.
  await stageBroken(enabled, 'still broken\n');

  const after = await commitAttempt(enabled, 'broken again');

  check(findings, after.failed === true, 'A bypass carried forward to a later commit.');
  check(findings, after.output.includes('failed / deny'), `The later denial is not a denial: ${after.output}`);
  check(findings, !after.output.includes('bypass applied'), 'A later commit reported a bypass nobody granted.');

  // 6. The disabled twin: byte-for-byte what it always was.
  const disabled = await cloneWithPolicy('bypass-off', runnerConfiguration());

  if (!(await activateClone(disabled, findings))) {
    return { name: 'packaged-bypass', ok: false, findings };
  }

  await stageBroken(disabled);

  const deniedOff = await commitAttempt(disabled, 'broken, bypass disabled');
  const offLines = deniedOff.output.split('\n').filter((line) => line.startsWith('change-evaluation-gate:'));

  check(findings, deniedOff.failed === true, 'A disabled-bypass clone allowed a broken commit.');
  check(
    findings,
    JSON.stringify(offLines) === JSON.stringify([
      'change-evaluation-gate: failed / deny',
      `change-evaluation-gate:   ${RUNNER_CHECK_ID}: failed (grader-negative)`,
      'change-evaluation-gate: this commit was not authorized. Fix the reported evidence and commit again.',
      'change-evaluation-gate: local enforcement only; it can be removed or bypassed by whoever owns this machine.',
    ]),
    `FR-POL-008: the disabled clone did not print exactly what it always printed: ${JSON.stringify(offLines)}`,
  );

  const offStore = await openEvidenceStore({ repositoryRoot: disabled, identity: storeIdentity() });
  const offLog = await offStore.readLog();
  const offEnvelope = offLog.length > 0 ? await offStore.readEnvelope(offLog.at(-1).evidenceId) : null;

  check(findings, offEnvelope?.decision?.bypass === null, 'A disabled clone recorded a bypass field it never resolved.');
  check(findings, (await offStore.readBypassLedger()).length === 0, 'A disabled clone has a ledger.');
  check(findings, !existsSync(path.join(offStore.root, 'bypass')), 'A disabled clone has a grant directory.');
  check(findings, !existsSync(path.join(common, 'change-evaluation-gate', 'evidence', 'bypass', 'grant.json')), 'A spent grant survived on the enabled clone.');

  const offGrant = await runPackagedCommand(disabled, ['bypass', '--reason', 'please', '--json']);
  const offDocument = JSON.parse(offGrant.stdout || '{}');

  check(findings, offGrant.exitCode === 1, `gate bypass on a disabled policy exited ${offGrant.exitCode}, not 1.`);
  check(findings, offDocument.observation?.rejectionCode === 'bypass-disabled', `gate bypass did not refuse by the policy's own code: ${JSON.stringify(offDocument.observation)}`);
  check(findings, offDocument.observation?.confirmationToken === null, 'gate bypass offered a token against a disabled policy.');

  return { name: 'packaged-bypass', ok: findings.length === 0, findings };
};

/**
 * The dual-policy transition reached by the command a maintainer runs
 * (`TB-062`): `evaluatePolicyTransition` judges a real re-pin, not a fixture
 * pair, and a weakening is pinned only by a token that acknowledged it.
 */
const packagedPolicySync = async () => {
  const findings = [];
  const root = await cloneWithPolicy('sync', runnerConfiguration());

  if (!(await activateClone(root, findings))) {
    return { name: 'packaged-policy-sync', ok: false, findings };
  }

  const hookPath = path.join(root, '.git', 'hooks', 'pre-commit');
  const hookBytes = await readFile(hookPath, 'utf8').catch(() => null);
  const sync = async (args) => {
    const run = await runPackagedCommand(root, ['sync', ...args, '--json']);

    return { exitCode: run.exitCode, document: JSON.parse(run.stdout || '{}') };
  };

  check(findings, hookBytes !== null, 'The shipped activation registered no pre-commit hook.');

  // The maintainer demotes the one required check, as they would in an editor.
  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    runnerConfiguration({ required: [], advisory: [RUNNER_CHECK_ID] }),
    'utf8',
  );

  const refused = await sync([]);
  const weakenings = refused.document.observation?.transition?.weakenings ?? [];

  check(findings, refused.exitCode === 1, `A weakening sync preview exited ${refused.exitCode} rather than 1.`);
  check(
    findings,
    refused.document.observation?.refusal?.reasonCode === 'weakening-unacknowledged',
    `A weakening sync was not refused as unacknowledged: ${JSON.stringify(refused.document.observation?.refusal)}.`,
  );
  check(findings, refused.document.observation?.confirmationToken === null, 'A refused weakening offered a token.');
  check(
    findings,
    weakenings.length === 1 && weakenings[0].code === 'required-check-demoted' && weakenings[0].checkId === RUNNER_CHECK_ID,
    `The weakening was not named: ${JSON.stringify(weakenings)}.`,
  );

  // Until it is pinned, the drift is what the commit is denied for.
  await stageBroken(root);

  const drifted = await commitAttempt(root, 'broken, before the re-pin');

  check(findings, drifted.failed && drifted.output.includes('integrity-drift'), `The commit before the re-pin was not denied for drift: ${drifted.output}`);

  const acknowledged = await sync(['--acknowledge-weakening']);
  const token = acknowledged.document.observation?.confirmationToken ?? null;

  check(findings, typeof token === 'string', 'An acknowledged weakening offered no token.');
  check(findings, acknowledged.document.observation?.acknowledgedWeakening === true, 'The acknowledgement was not bound into the preview.');

  const unacknowledged = await sync(['--confirm', token ?? `sha256:${'0'.repeat(64)}`]);

  check(findings, unacknowledged.document.mutation?.performed === false, 'The acknowledged token pinned a weakening from an invocation that did not acknowledge it.');

  const pinned = await sync(['--acknowledge-weakening', '--confirm', token ?? `sha256:${'0'.repeat(64)}`]);

  check(findings, pinned.document.mutation?.performed === true, `The acknowledged sync did not perform: ${pinned.document.mutation?.summary}`);
  check(findings, (await readFile(hookPath, 'utf8').catch(() => null)) === hookBytes, 'The sync rewrote the registered pre-commit hook.');

  // The same failing change, now graded under the acknowledged policy.
  const graded = await commitAttempt(root, 'broken, under the acknowledged policy');

  check(findings, graded.failed === false, `The commit after the re-pin was not graded under the acknowledged policy: ${graded.output}`);
  check(findings, !graded.output.includes('integrity-drift'), 'The commit after the re-pin still reported drift.');
  check(findings, (await readFile(hookPath, 'utf8').catch(() => null)) === hookBytes, 'The registered pre-commit hook changed across the commit.');

  return { name: 'packaged-policy-sync', ok: findings.length === 0, findings };
};

const main = async () => {
  const asJson = process.argv.includes('--json');
  let scenarios = [];

  try {
    scenarios = [
      await packagedRuntimeInput(),
      await packagedDrift(),
      await packagedRunnerDrift(),
      packagedPolicyTransition(),
      await configuredDeclaration(),
      await declaredEnvironmentFile(),
      await packagedBypass(),
      await packagedPolicySync(),
    ];
  } finally {
    for (const root of temporaryRoots) {
      // The guard again, immediately before the only recursive removal in this
      // capability. A fixture root that somehow escaped is never deleted.
      await assertThrowawayRepository(root);
      await rm(root, { recursive: true, force: true });
    }
  }

  const ok = scenarios.every((scenario) => scenario.ok);
  const report = {
    capability: CAPABILITY,
    ok,
    trustBoundary: TRUST_BOUNDARY.statement,
    scenarios,
  };

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
