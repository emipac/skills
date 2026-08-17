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
 * 3. `packaged-policy-transition` — a candidate configuration that weakens the
 *    policy authorizing its own transition passes its own policy, fails the
 *    Trusted policy, and neither advances trust nor authorizes; a hash-bound
 *    approval advances only once both policies pass (`AC-CFG-003`,
 *    `SG-CFG-001`).
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
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { evaluate } from './lib/evaluate.mjs';
import { openEvidenceStore } from './lib/evidence-store.mjs';
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

const main = async () => {
  const asJson = process.argv.includes('--json');
  let scenarios = [];

  try {
    scenarios = [
      await packagedRuntimeInput(),
      await packagedDrift(),
      packagedPolicyTransition(),
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
