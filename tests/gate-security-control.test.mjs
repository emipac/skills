import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { evaluate } from '../skills/change-evaluation-gate/scripts/lib/evaluate.mjs';
import { validateDecision } from '../skills/change-evaluation-gate/scripts/lib/evaluation-contract.mjs';
import { openEvidenceStore } from '../skills/change-evaluation-gate/scripts/lib/evidence-store.mjs';
import {
  changedGraderSurfaces,
  touchesControlSurface,
} from '../skills/change-evaluation-gate/scripts/lib/grader-surface.mjs';
import { statusGate } from '../skills/change-evaluation-gate/scripts/lib/lifecycle.mjs';
import { createRedactor, secretForms } from '../skills/change-evaluation-gate/scripts/lib/redaction.mjs';
import {
  CONTROL_SURFACES,
  TRUST_BOUNDARY,
  evaluatePolicyTransition,
  materializeRuntimeInputs,
  policyIdentity,
  reconcileControlSurface,
} from '../skills/change-evaluation-gate/scripts/lib/security-control.mjs';

const runFile = promisify(execFile);

/**
 * Synthetic canaries invented for these fixtures. They are not credentials, are
 * not read from any environment, keychain, or credential store, and grant
 * access to nothing.
 */
const APPROVED_CANARY = 'canary-approved-4f81ba2c7d09';

const UNAPPROVED_CANARY = 'canary-unapproved-6e3d09fa15b7';

const temporaryRoot = async (t, prefix) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));

  t.after(() => rm(root, { recursive: true, force: true }));

  return root;
};

const trustedPolicy = () => ({
  checks: { required: ['broad_test', 'static_analysis'], advisory: ['format'] },
  budget: { total_seconds: 600 },
  bypass: { enabled: false, marker: null },
  execution: { budget_skippable: [] },
  evidence: {},
});

const resolvedChecks = () => [
  { id: 'broad_test', outcome: 'passed' },
  { id: 'static_analysis', outcome: 'failed' },
  { id: 'format', outcome: 'passed' },
];

test('a candidate that removes a required check cannot authorize its own transition', () => {
  const trusted = trustedPolicy();
  // The candidate drops `static_analysis` — the one required check this change
  // does not satisfy — from the required set entirely.
  const candidate = {
    ...trusted,
    checks: { required: ['broad_test'], advisory: ['format', 'static_analysis'] },
  };

  const transition = evaluatePolicyTransition({
    trusted: { policy: trusted },
    candidate: { policy: candidate },
    checks: resolvedChecks(),
    role: 'authoritative',
  });

  // Under its own weaker policy the candidate reads as a pass.
  assert.equal(transition.candidate.outcome, 'passed');
  // Under the policy that is actually Trusted it does not.
  assert.equal(transition.trusted.outcome, 'failed');

  // The transition is decided by the Trusted policy, so it neither advances
  // trust nor authorizes anything (SG-CFG-001, AC-CFG-003).
  assert.equal(transition.outcome, 'failed');
  assert.equal(transition.authorization, 'deny');
  assert.equal(transition.advanced, false);
  assert.equal(transition.reasonCode, 'trusted-policy-unsatisfied');

  // The weakening itself is named, so the refusal is diagnosable.
  assert.deepEqual(
    transition.weakenings.map((weakening) => ({
      code: weakening.code,
      checkId: weakening.checkId ?? null,
    })),
    [{ code: 'required-check-demoted', checkId: 'static_analysis' }],
  );
  assert.equal(transition.weakened, true);
});

test('hash-bound approval advances trust only after both policies pass', () => {
  const trusted = trustedPolicy();
  const candidate = {
    ...trusted,
    checks: { required: ['broad_test'], advisory: ['format', 'static_analysis'] },
  };
  const passing = resolvedChecks().map((check) => ({ ...check, outcome: 'passed' }));
  const request = {
    trusted: { policy: trusted },
    candidate: { policy: candidate },
    checks: passing,
    role: 'authoritative',
  };

  // Both policies now pass, and that alone still advances nothing.
  const unapproved = evaluatePolicyTransition(request);

  assert.equal(unapproved.trusted.outcome, 'passed');
  assert.equal(unapproved.candidate.outcome, 'passed');
  assert.equal(unapproved.advanced, false);
  assert.equal(unapproved.reasonCode, 'approval-missing');
  assert.equal(unapproved.trustedNext, null);

  // Approval is bound to the candidate hash, so an approval of some other
  // configuration cannot carry this one through.
  const mismatched = evaluatePolicyTransition({
    ...request,
    approval: { candidateId: `sha256:${'0'.repeat(64)}`, grantedBy: 'operator' },
  });

  assert.equal(mismatched.advanced, false);
  assert.equal(mismatched.reasonCode, 'approval-mismatch');
  assert.equal(mismatched.trustedNext, null);

  const approved = evaluatePolicyTransition({
    ...request,
    approval: { candidateId: unapproved.candidateId, grantedBy: 'operator' },
  });

  assert.equal(approved.advanced, true);
  assert.equal(approved.reasonCode, null);
  assert.equal(approved.authorization, 'allow');
  assert.equal(approved.trustedNext, unapproved.candidateId);
  // The weakening is still reported: advancing trust never hides what changed.
  assert.equal(approved.weakened, true);

  // Where the two policies differ, BOTH must be satisfied. A candidate that is
  // stricter than the Trusted policy is refused by its own requirement, even
  // with a matching hash-bound approval.
  const stricterCandidate = {
    ...trusted,
    checks: { required: ['broad_test', 'lint'], advisory: ['format', 'static_analysis'] },
  };
  const checksWithLint = [...passing, { id: 'lint', outcome: 'failed' }];
  const candidateId = policyIdentity(stricterCandidate);
  const refused = evaluatePolicyTransition({
    trusted: { policy: { ...trusted, checks: { required: ['broad_test', 'static_analysis'], advisory: ['format', 'lint'] } } },
    candidate: { policy: stricterCandidate },
    checks: checksWithLint,
    role: 'authoritative',
    approval: { candidateId, grantedBy: 'operator' },
  });

  assert.equal(refused.trusted.outcome, 'passed');
  assert.equal(refused.candidate.outcome, 'failed');
  assert.equal(refused.advanced, false);
  assert.equal(refused.reasonCode, 'candidate-policy-unsatisfied');
  assert.equal(refused.authorization, 'deny');
});

test('a candidate configuration is validated separately as a candidate', () => {
  const trusted = trustedPolicy();
  // Invalid on its own terms: an enabled bypass that emits no commit-visible
  // marker. Nothing about the Trusted policy or the check results says so.
  const candidate = { ...trusted, bypass: { enabled: true, marker: null } };
  const passing = resolvedChecks().map((check) => ({ ...check, outcome: 'passed' }));

  const result = evaluatePolicyTransition({
    trusted: { policy: trusted },
    candidate: { policy: candidate },
    checks: passing,
    role: 'authoritative',
    approval: { candidateId: policyIdentity(candidate), grantedBy: 'operator' },
  });

  assert.equal(result.trusted.valid, true);
  assert.equal(result.candidate.valid, false);
  assert.deepEqual(
    result.candidate.errors.map((issue) => issue.code),
    ['gate-policy-bypass-invalid'],
  );

  // A candidate that is not valid configuration cannot become Trusted, and an
  // evaluation under it proves nothing.
  assert.equal(result.advanced, false);
  assert.equal(result.trustedNext, null);
  assert.equal(result.reasonCode, 'candidate-policy-invalid');
  assert.equal(result.outcome, 'unverified');
  assert.equal(result.authorization, 'deny');
});

test('only runtime inputs approved at activation reach the isolated materialization', async (t) => {
  const executionRoot = await temporaryRoot(t, 'gate-security-inputs-');

  const materialized = await materializeRuntimeInputs({
    // The Activation receipt records runtime input NAMES only; that pinned list
    // is the whole approval (FR-CFG-006, AC-CFG-004).
    approved: ['APP_TOKEN'],
    inputs: [
      { name: 'APP_TOKEN', source: 'approved-environment-file', value: APPROVED_CANARY },
      { name: 'SHADOW_TOKEN', source: 'ambient-environment', value: UNAPPROVED_CANARY },
    ],
    executionRoot,
  });

  assert.equal(materialized.materialized, true);

  // Recorded by NAME AND SOURCE ONLY.
  assert.deepEqual(materialized.record, [
    { name: 'APP_TOKEN', source: 'approved-environment-file' },
  ]);
  assert.equal(JSON.stringify(materialized.record).includes(APPROVED_CANARY), false);

  // The unapproved input is refused by name; its value never travels.
  assert.deepEqual(materialized.refused, [
    { name: 'SHADOW_TOKEN', source: 'ambient-environment', code: 'runtime-input-unapproved' },
  ]);
  assert.equal(JSON.stringify(materialized.refused).includes(UNAPPROVED_CANARY), false);

  // Only the approved value is available to the isolated materialization.
  assert.equal(materialized.environment.APP_TOKEN, APPROVED_CANARY);
  assert.equal('SHADOW_TOKEN' in materialized.environment, false);

  assert.deepEqual(await readdir(materialized.directory), ['APP_TOKEN']);
  assert.equal(
    await readFile(path.join(materialized.directory, 'APP_TOKEN'), 'utf8'),
    APPROVED_CANARY,
  );

  // The materialization lives inside the isolated execution root, nowhere else.
  assert.equal(materialized.directory.startsWith(`${executionRoot}${path.sep}`), true);
});

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

test('an approved sensitive value is removed with its materialization and never retained', async (t) => {
  const repositoryRoot = await temporaryRoot(t, 'gate-security-canary-repo-');
  const executionRoot = await temporaryRoot(t, 'gate-security-canary-exec-');

  await runFile('git', ['init', '--quiet'], { cwd: repositoryRoot });

  const configurationPath = path.join(repositoryRoot, '.agent-framework.yaml');
  const materialized = await materializeRuntimeInputs({
    approved: ['APP_TOKEN'],
    inputs: [{ name: 'APP_TOKEN', source: 'approved-environment-file', value: APPROVED_CANARY }],
    executionRoot,
  });

  // Retained configuration records the approval by name and source, exactly as
  // the materialization reported it.
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

  const store = await openEvidenceStore({
    repositoryRoot,
    redactor: createRedactor({
      secrets: materialized.record.map((entry) => ({
        ...entry,
        value: materialized.environment[entry.name],
      })),
    }),
    identity: {
      actor: { name: 'gate-security-control-test', source: 'fixture' },
      client: { id: 'git', surface: 'git-pre-commit', version: '1.0.0' },
      gate: { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' },
      repository: { identity: `sha256:${'0'.repeat(64)}` },
    },
  });

  // The Activation receipt pins runtime input names, never values.
  await store.activationReceipt().write({
    receiptVersion: 'change-evaluation-gate/activation/v1',
    receiptId: `sha256:${'a'.repeat(64)}`,
    runtimeInputs: materialized.record,
  });

  // A check that echoed the value in three recognizable forms.
  const appended = await store.appendEvidence({
    decision: {
      protocolVersion: '1.0',
      evaluationId: 'evaluation-canary',
      outcome: 'failed',
      checks: [{
        id: 'broad_test',
        outcome: 'failed',
        summary: `broad_test failed using APP_TOKEN (${APPROVED_CANARY})`,
      }],
      evidence: { id: 'sha256:decision', format: 'change-evaluation-gate/v1', persisted: false },
    },
    outputs: [{
      checkId: 'broad_test',
      attempt: 1,
      text: [
        `raw ${APPROVED_CANARY}`,
        `base64 ${Buffer.from(APPROVED_CANARY, 'utf8').toString('base64')}`,
        `escaped ${encodeURIComponent(APPROVED_CANARY)}`,
      ].join('\n'),
    }],
  });

  assert.equal(appended.appended, true);

  await store.appendLifecycleEvent({
    type: 'activation',
    before: null,
    after: `sha256:${'a'.repeat(64)}`,
    outcome: 'succeeded',
    reason: `Approved runtime input ${materialized.record[0].name} from ${materialized.record[0].source} was materialized temporarily.`,
  });

  // The materialization is removed with the evaluation that needed it.
  const released = await materialized.release();

  assert.equal(released.released, true);
  assert.deepEqual(released.removed, [materialized.directory]);
  assert.equal(existsSync(materialized.directory), false);
  assert.equal(existsSync(path.join(materialized.directory, 'APP_TOKEN')), false);

  // Every retained byte: configuration, decisions, envelopes, blobs, lifecycle
  // events, the receipt, and whatever else the store wrote.
  const retained = [
    await readFile(configurationPath, 'utf8'),
    await treeContents(store.root),
    await treeContents(executionRoot),
  ].join('\n');

  for (const form of secretForms(APPROVED_CANARY)) {
    assert.equal(
      retained.includes(form),
      false,
      `A recognized form of the canary survived in retained state: ${form.slice(0, 10)}…`,
    );
  }

  assert.equal(retained.includes(APPROVED_CANARY), false);
  assert.equal(retained.includes(Buffer.from(APPROVED_CANARY, 'utf8').toString('base64')), false);
  assert.equal(retained.includes(encodeURIComponent(APPROVED_CANARY)), false);

  // The name and the source did survive; that is exactly what may be recorded.
  assert.equal(retained.includes('APP_TOKEN'), true);
  assert.equal(retained.includes('approved-environment-file'), true);
  assert.equal((await store.readEvents()).length > 0, true);
  assert.equal((await store.listBlobs()).length > 0, true);
});

const receiptFixture = () => ({
  receiptId: `sha256:${'a'.repeat(64)}`,
  configuration: { schemaVersion: 4, identity: `sha256:${'b'.repeat(64)}` },
  runtime: {
    gate: { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' },
    runnerVersion: 'change-evaluation-gate/0.9.0',
    runners: [{
      check_id: 'broad_test',
      role: 'evaluate',
      runner: 'repository-script',
      executable: '/usr/bin/node',
      version: '20.0.0',
    }],
  },
  adapters: [{ id: 'git', version: '1.0.0', authoritative: true }],
  hookChain: { blockIdentity: `sha256:${'c'.repeat(64)}` },
  providers: { 'node-package': '1.0.0' },
});

/** What a caller observed on this machine right now. */
const observedFixture = (receipt, overrides = {}) => ({
  receiptId: receipt.receiptId,
  configurationId: receipt.configuration.identity,
  runtime: { gate: receipt.runtime.gate, runnerVersion: receipt.runtime.runnerVersion },
  runners: receipt.runtime.runners,
  adapters: receipt.adapters,
  hookBlockIdentity: receipt.hookChain.blockIdentity,
  providers: receipt.providers,
  ...overrides,
});

/** One observation per declared control surface that drifts it and nothing else. */
const driftFor = (receipt) => ({
  runtime: { runtime: { gate: receipt.runtime.gate, runnerVersion: 'change-evaluation-gate/9.9.9' } },
  adapters: { adapters: [{ id: 'git', version: '2.0.0', authoritative: true }] },
  'managed-hooks': { hookBlockIdentity: `sha256:${'d'.repeat(64)}` },
  receipt: { receiptId: `sha256:${'e'.repeat(64)}` },
  'trusted-configuration': { configurationId: `sha256:${'f'.repeat(64)}` },
  'command-descriptors': {
    runners: [{ ...receipt.runtime.runners[0], executable: '/usr/local/bin/node' }],
  },
  providers: { providers: { 'node-package': '2.0.0' } },
});

test('independent control-surface drift is broken health and an authoritative unverified', () => {
  const receipt = receiptFixture();
  const reconciled = reconcileControlSurface({
    receipt,
    observed: observedFixture(receipt, { hookBlockIdentity: `sha256:${'d'.repeat(64)}` }),
    role: 'authoritative',
  });

  assert.equal(reconciled.drifted, true);
  assert.equal(reconciled.health, 'broken');
  assert.equal(reconciled.outcome, 'unverified');
  assert.equal(reconciled.reasonCode, 'integrity-drift');
  assert.equal(reconciled.authorization, 'deny');
  assert.deepEqual(reconciled.findings.map((finding) => finding.surface), ['managed-hooks']);

  // Detection repairs nothing and writes nothing: drift stays exactly where it
  // was found until an operator confirms a repair (FR-LIFE-019, SG-LIFE-001).
  assert.equal(reconciled.repaired, false);
  assert.deepEqual(reconciled.mutations, []);

  const healthy = reconcileControlSurface({
    receipt,
    observed: observedFixture(receipt),
    role: 'authoritative',
  });

  assert.equal(healthy.drifted, false);
  assert.equal(healthy.health, 'healthy');
  assert.equal(healthy.outcome, null);
  assert.equal(healthy.reasonCode, null);
  assert.deepEqual(healthy.findings, []);
});

test('every declared control surface is reconciled', () => {
  const receipt = receiptFixture();
  const drifts = driftFor(receipt);

  assert.deepEqual([...CONTROL_SURFACES].sort(), Object.keys(drifts).sort());

  for (const surface of CONTROL_SURFACES) {
    const reconciled = reconcileControlSurface({
      receipt,
      observed: observedFixture(receipt, drifts[surface]),
      role: 'authoritative',
    });

    assert.deepEqual(
      reconciled.findings.map((finding) => finding.surface),
      [surface],
      `Drift of the ${surface} control surface was not reconciled on its own.`,
    );
    assert.equal(reconciled.health, 'broken', `Drift of ${surface} did not report broken health.`);
    assert.equal(reconciled.outcome, 'unverified');
    assert.equal(reconciled.authorization, 'deny');
  }
});

test('an ordinary grader change stays visible and is never classified as malicious', async (t) => {
  const executionRoot = await temporaryRoot(t, 'gate-security-grader-');
  const receipt = receiptFixture();

  await mkdir(path.join(executionRoot, 'tests'), { recursive: true });
  await writeFile(path.join(executionRoot, 'tests/example.test.mjs'), '// a test\n', 'utf8');
  await writeFile(path.join(executionRoot, '.agent-framework.yaml'), 'schema_version: 4\n', 'utf8');

  const ordinary = await changedGraderSurfaces({
    changedPaths: ['tests/example.test.mjs'],
    checks: [],
    declarations: { tests: ['tests/**'] },
    executionRoot,
  });

  assert.deepEqual(ordinary.map((surface) => surface.kind), ['test']);
  assert.equal(touchesControlSurface(ordinary), false);

  const reconciled = reconcileControlSurface({
    receipt,
    observed: observedFixture(receipt),
    graderSurfaces: ordinary,
    role: 'authoritative',
  });

  // The edited Grader surface is REPORTED …
  assert.deepEqual(
    reconciled.visibleGraderSurfaces.map((surface) => surface.path),
    ['tests/example.test.mjs'],
  );

  // … and reporting it classifies nothing and nobody. Editing your own tests is
  // ordinary work, not an attack (SG-CFG-001 non-goal).
  assert.equal(reconciled.classification, 'none');
  assert.equal(reconciled.drifted, false);
  assert.equal(reconciled.health, 'healthy');
  assert.equal(reconciled.outcome, null);
  assert.equal(reconciled.policyTransitionRequired, false);
  assert.equal(/malicious|attacker|hostile/i.test(JSON.stringify(reconciled)), false);

  // A change that edits the Gate control surface requires the dual-policy
  // transition — which is still not an accusation, and is still not drift.
  const controlSurface = await changedGraderSurfaces({
    changedPaths: ['.agent-framework.yaml'],
    checks: [],
    declarations: {},
    executionRoot,
  });

  assert.equal(touchesControlSurface(controlSurface), true);

  const gated = reconcileControlSurface({
    receipt,
    observed: observedFixture(receipt),
    graderSurfaces: controlSurface,
    role: 'authoritative',
  });

  assert.equal(gated.policyTransitionRequired, true);
  assert.equal(gated.classification, 'none');
  // A control-surface edit inside the proposed change is not drift of the
  // machine's own control surface; the two are reported separately.
  assert.equal(gated.drifted, false);
  assert.equal(gated.health, 'healthy');
  assert.equal(/malicious|attacker|hostile/i.test(JSON.stringify(gated)), false);
});

test('gate status reports independent control-surface drift as broken and repairs nothing', async (t) => {
  const repositoryRoot = await temporaryRoot(t, 'gate-security-status-');

  await runFile('git', ['init', '--quiet'], { cwd: repositoryRoot });

  const store = await openEvidenceStore({
    repositoryRoot,
    identity: {
      actor: { name: 'gate-security-control-test', source: 'fixture' },
      client: { id: 'git', surface: 'git-pre-commit', version: '1.0.0' },
      gate: { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' },
      repository: { identity: `sha256:${'0'.repeat(64)}` },
    },
  });
  const receipt = { ...receiptFixture(), hooks: [] };

  await store.activationReceipt().write(receipt);

  const healthy = await statusGate({
    evidenceStore: store,
    controlSurface: observedFixture(receipt),
  });

  assert.equal(healthy.status, 'healthy');

  const broken = await statusGate({
    evidenceStore: store,
    controlSurface: observedFixture(receipt, { configurationId: `sha256:${'f'.repeat(64)}` }),
  });

  assert.equal(broken.status, 'broken');
  assert.deepEqual(
    broken.findings
      .filter((finding) => finding.code === 'control-surface-drift')
      .map((finding) => finding.surface),
    ['trusted-configuration'],
  );

  // Observation still repairs nothing and writes nothing.
  assert.equal(broken.repaired, false);
  assert.deepEqual(broken.mutations, []);
  assert.deepEqual(await store.activationReceipt().read(), receipt);
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

const passingDescriptor = () => ({
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
    args: ['run', 'test'],
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

test('an authoritative evaluation under control-surface drift is unverified and denies', async (t) => {
  const repositoryRoot = await temporaryRoot(t, 'gate-security-drift-repo-');
  const receipt = receiptFixture();

  await writeFile(path.join(repositoryRoot, 'source.txt'), 'baseline\n', 'utf8');
  await runFile('git', ['init', '--quiet'], { cwd: repositoryRoot });
  await runFile('git', ['add', '--all'], { cwd: repositoryRoot });

  const evaluateWith = async (observed) => evaluate(evaluationRequest(repositoryRoot), {
    checks: [passingDescriptor()],
    executionRoot: await temporaryRoot(t, 'gate-security-drift-exec-'),
    execute: async () => ({
      executed: true,
      exitCode: 0,
      timedOut: false,
      error: null,
      durationMs: 3,
    }),
    controlSurface: { receipt, observed },
  });

  const drifted = await evaluateWith(
    observedFixture(receipt, { hookBlockIdentity: `sha256:${'d'.repeat(64)}` }),
  );

  assert.equal(drifted.outcome, 'unverified');
  assert.equal(drifted.authorization, 'deny');
  assert.deepEqual(
    drifted.diagnostics.map((diagnostic) => diagnostic.reasonCode),
    ['integrity-drift'],
  );
  // The check itself still reports what it found; drift never rewrote it.
  assert.equal(drifted.checks[0].outcome, 'passed');
  assert.deepEqual(validateDecision(drifted), []);

  const clean = await evaluateWith(observedFixture(receipt));

  assert.equal(clean.outcome, 'passed');
  assert.equal(clean.authorization, 'allow');
  assert.deepEqual(clean.diagnostics, []);
});

/**
 * Claims this feature may never make. Every one of them would describe a
 * property a cooperative local process on the owner's own machine does not
 * have (ASM-001, SG-TRUST-001).
 *
 * Detection words — `tampered`, `tampering`, `tamper detection` — are NOT on
 * this list: detecting a change and resisting one are different claims.
 */
const FORBIDDEN_CLAIMS = Object.freeze([
  'tamper-proof',
  'tamperproof',
  'tamper resistant',
  'tamper-resistant',
  'tamper resistance',
  'sandbox',
  'sandboxed',
  'encrypted',
  'encryption',
  'hostile-code containment',
  'hostile code containment',
]);

/**
 * A claim is acceptable only where the same line denies it.
 *
 * These match as whole words. Substring matching would let an ordinary word
 * that merely contains a negator — "another", "note", "nothing" — suppress a
 * real claim, so `Another sandbox protects the runtime` would pass unnoticed.
 */
const NEGATOR_WORDS = Object.freeze([
  'not',
  'never',
  'no',
  'nothing',
  'none',
  'neither',
  'nor',
  'false',
  'rather than',
  'without',
  'cannot',
]);

/**
 * Contraction suffixes, matched as substrings on purpose: `n't` is bounded by
 * its own apostrophe and must still be found inside "doesn't".
 */
const NEGATOR_SUFFIXES = Object.freeze(["n't"]);

const escapeForRegExp = (value) => value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

const NEGATOR_PATTERNS = Object.freeze(
  NEGATOR_WORDS.map((word) => new RegExp(`\\b${escapeForRegExp(word)}\\b`)),
);

/** True when the line denies the claim it contains. */
const denies = (line) => NEGATOR_PATTERNS.some((pattern) => pattern.test(line))
  || NEGATOR_SUFFIXES.some((suffix) => line.includes(suffix));

const gateSourceFiles = async (root) => {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && /\.(mjs|md|ya?ml)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
};

test('the trust boundary is stated honestly and nothing claims resistance', async () => {
  assert.equal(TRUST_BOUNDARY.model, 'cooperative-local-process');
  assert.equal(TRUST_BOUNDARY.tamperResistant, false);
  assert.equal(TRUST_BOUNDARY.resistsMachineOwner, false);
  assert.match(TRUST_BOUNDARY.statement, /machine owner/i);

  // The boundary travels with every drift result, so a reader can never take
  // drift detection for resistance.
  const receipt = receiptFixture();
  const reconciled = reconcileControlSurface({
    receipt,
    observed: observedFixture(receipt, { receiptId: `sha256:${'e'.repeat(64)}` }),
    role: 'authoritative',
  });

  assert.equal(reconciled.drifted, true);
  assert.equal(reconciled.tamperResistant, false);
  assert.equal(reconciled.trustBoundary, TRUST_BOUNDARY.statement);

  // No Gate module, script, or contract document may make the claim at all.
  const root = path.resolve('skills/change-evaluation-gate');
  const offences = [];

  for (const file of await gateSourceFiles(root)) {
    const lines = (await readFile(file, 'utf8')).split('\n');

    lines.forEach((line, index) => {
      const lowered = line.toLowerCase();
      const claimed = FORBIDDEN_CLAIMS.filter((claim) => lowered.includes(claim));

      if (claimed.length === 0 || denies(lowered)) {
        return;
      }

      offences.push(`${path.relative(root, file)}:${index + 1} ${claimed.join(', ')}`);
    });
  }

  assert.deepEqual(offences, []);
});
