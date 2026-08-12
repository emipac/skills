import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { evaluate } from '../skills/change-evaluation-gate/scripts/lib/evaluate.mjs';
import { createBoundedExecutor } from '../skills/change-evaluation-gate/scripts/lib/bounded-execution.mjs';
import {
  classifyAttempt,
  validateDecision,
} from '../skills/change-evaluation-gate/scripts/lib/evaluation-contract.mjs';
import {
  GATE_POLICY_SUBCONTRACTS,
  authorizeDecision,
  bindingOf,
  validateGatePolicy,
} from '../skills/change-evaluation-gate/scripts/lib/policy.mjs';

const runFile = promisify(execFile);

const git = (cwd, args) => runFile('git', args, { cwd });

const temporaryRoots = [];

const temporaryDirectory = async (prefix) => {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));

  temporaryRoots.push(directory);

  return directory;
};

/** A throwaway Git repository. This repository's own Git state is never used. */
const createRepository = async (files) => {
  const root = await temporaryDirectory('gate-policy-repo-');

  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(root, relative);

    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, 'utf8');
  }

  await git(root, ['init', '--quiet']);
  await git(root, ['add', '--all']);

  return root;
};

test.after(async () => {
  for (const root of temporaryRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

const command = (args, overrides = {}) => ({
  runner: 'package-script',
  args,
  working_directory: '.',
  timeout_seconds: 60,
  allowed_environment: ['PATH'],
  evidence_category: 'test',
  source_scope: 'both',
  ...overrides,
});

const descriptor = (overrides = {}) => ({
  id: 'node-package.broad-tests.test',
  provider: 'node-package',
  stage: 'broad-tests',
  capability: 'test',
  scope: 'both',
  applicability: { changed_path_globs: ['**'], required_facts: [] },
  prerequisites: [],
  policy: 'required',
  evaluate: command(['run', 'test']),
  fix: null,
  timeout_seconds: 120,
  declared_writes: [],
  evidence: { claims: ['test:broad'], success_exit_codes: [0], report: null },
  order: 10,
  selection: null,
  ...overrides,
});

const authoritativeRequest = (root, overrides = {}) => ({
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
    sessionId: 'session-a',
  },
  ...overrides,
});

const passingAttempt = () => ({
  executed: true,
  exitCode: 0,
  timedOut: false,
  error: null,
  durationMs: 5,
});

const failingAttempt = () => ({
  executed: true,
  exitCode: 1,
  timedOut: false,
  error: null,
  durationMs: 5,
});

test('AC-POL-001 / FR-POL-003 / SG-EVAL-001: a completed older pass cannot authorize a changed snapshot', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });
  const policy = {
    checks: { required: ['node-package.broad-tests.test'], advisory: [] },
    budget: { total_seconds: 600 },
    bypass: { enabled: false },
    execution: {},
    evidence: {},
  };

  const older = await evaluate(authoritativeRequest(root), {
    checks: [descriptor()],
    policy,
    executionRoot: await temporaryDirectory('gate-policy-exec-'),
    execute: async () => passingAttempt(),
  });

  assert.equal(older.outcome, 'passed');
  assert.equal(older.authorization, 'allow');

  // The snapshot changes and the same required check now detects a problem.
  await writeFile(path.join(root, 'src/order.txt'), 'changed\n', 'utf8');

  const current = await evaluate(authoritativeRequest(root), {
    checks: [descriptor()],
    policy,
    executionRoot: await temporaryDirectory('gate-policy-exec-'),
    execute: async () => failingAttempt(),
  });

  assert.equal(current.outcome, 'failed');
  assert.equal(current.authorization, 'deny');
  assert.notEqual(current.snapshot.id, older.snapshot.id);

  // Replaying the older completed pass against the current binding must never
  // authorize it: authorization binds to the exact current snapshot.
  const replayed = authorizeDecision(older, bindingOf(current));

  assert.equal(replayed.outcome, 'unverified');
  assert.equal(replayed.authorization, 'deny');
  assert.deepEqual(
    replayed.diagnostics.map((diagnostic) => diagnostic.reasonCode),
    ['snapshot-mismatch'],
  );

  // The same decision still authorizes its own binding, so the refusal is the
  // stale binding and not a blanket denial.
  const own = authorizeDecision(older, bindingOf(older));

  assert.equal(own.outcome, 'passed');
  assert.equal(own.authorization, 'allow');
  assert.deepEqual(own.diagnostics, []);
});

test('AC-POL-001 / SG-POL-001 / FR-CFG-002: repository policy owns required identity and advisory failure never blocks', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });
  const checks = [
    descriptor(),
    descriptor({
      id: 'node-package.static-analysis.lint',
      stage: 'static-analysis',
      capability: 'lint',
      evaluate: command(['run', 'lint'], { evidence_category: 'lint' }),
      evidence: { claims: ['lint:static'], success_exit_codes: [0], report: null },
      order: 5,
      // The provider proposes `required`; only repository policy decides.
      policy: 'required',
    }),
  ];

  const run = async (policy, outcomes) => evaluate(authoritativeRequest(root), {
    checks,
    policy,
    executionRoot: await temporaryDirectory('gate-policy-exec-'),
    execute: async ({ checkId }) => (outcomes[checkId] ? passingAttempt() : failingAttempt()),
  });

  // An advisory check that fails records evidence and never blocks, and the
  // required check that passed is not credited with the advisory outcome.
  const advisoryFailure = await run(
    {
      checks: {
        required: ['node-package.broad-tests.test'],
        advisory: ['node-package.static-analysis.lint'],
      },
      budget: { total_seconds: 600 },
      bypass: { enabled: false },
      execution: {},
      evidence: {},
    },
    { 'node-package.broad-tests.test': true },
  );

  const lint = advisoryFailure.checks.find((check) => check.id === 'node-package.static-analysis.lint');

  assert.equal(lint.policy, 'advisory');
  assert.equal(lint.outcome, 'failed');
  assert.deepEqual(advisoryFailure.advisories, ['node-package.static-analysis.lint']);
  assert.equal(advisoryFailure.outcome, 'passed');
  assert.equal(advisoryFailure.authorization, 'allow');

  // Advisory success never compensates for a required failure.
  const requiredFailure = await run(
    {
      checks: {
        required: ['node-package.broad-tests.test'],
        advisory: ['node-package.static-analysis.lint'],
      },
      budget: { total_seconds: 600 },
      bypass: { enabled: false },
      execution: {},
      evidence: {},
    },
    { 'node-package.static-analysis.lint': true },
  );

  assert.equal(requiredFailure.outcome, 'failed');
  assert.equal(requiredFailure.authorization, 'deny');

  // A provider proposal that repository policy never adopted cannot block.
  const unadopted = await run(
    {
      checks: { required: ['node-package.broad-tests.test'], advisory: [] },
      budget: { total_seconds: 600 },
      bypass: { enabled: false },
      execution: {},
      evidence: {},
    },
    { 'node-package.broad-tests.test': true },
  );

  assert.equal(
    unadopted.checks.find((check) => check.id === 'node-package.static-analysis.lint').policy,
    'advisory',
  );
  assert.equal(unadopted.outcome, 'passed');
  assert.equal(unadopted.authorization, 'allow');

  // An ambiguous binding is configuration, not a coin flip.
  const ambiguous = await run(
    {
      checks: {
        required: ['node-package.broad-tests.test'],
        advisory: ['node-package.broad-tests.test'],
      },
      budget: { total_seconds: 600 },
      bypass: { enabled: false },
      execution: {},
      evidence: {},
    },
    { 'node-package.broad-tests.test': true, 'node-package.static-analysis.lint': true },
  );

  assert.equal(ambiguous.outcome, 'unverified');
  assert.equal(ambiguous.authorization, 'deny');
  assert.deepEqual(
    ambiguous.diagnostics.map((diagnostic) => diagnostic.reasonCode),
    ['configuration-invalid'],
  );
});

test('NFR-PERF-001 / FR-POL-004 / SG-OWNER-001: Gate policy validation rejects missing limits, command ownership, and exemption knobs', () => {
  const valid = {
    checks: {
      required: ['node-package.broad-tests.test'],
      advisory: ['node-package.static-analysis.lint'],
    },
    budget: { total_seconds: 600 },
    bypass: { enabled: true, require_reference: true, marker: 'Gate-Bypass' },
    execution: { budget_skippable: ['node-package.static-analysis.lint'] },
    evidence: { retain: 'all' },
  };

  assert.deepEqual(validateGatePolicy(valid), []);
  assert.deepEqual(
    GATE_POLICY_SUBCONTRACTS,
    ['checks', 'budget', 'bypass', 'execution', 'evidence'],
  );

  const codes = (mutate) => {
    const policy = structuredClone(valid);

    mutate(policy);

    return validateGatePolicy(policy).map((error) => error.code);
  };

  // Every subcontract is mandatory: a missing total budget is a plan error,
  // never an invented default (Q-007).
  assert.deepEqual(codes((policy) => { delete policy.budget; }), ['gate-policy-subcontract-missing']);
  assert.deepEqual(codes((policy) => { delete policy.bypass; }), ['gate-policy-subcontract-missing']);
  assert.deepEqual(codes((policy) => { policy.budget = {}; }), ['gate-policy-budget-invalid']);
  assert.deepEqual(
    codes((policy) => { policy.budget = { total_seconds: 0 }; }),
    ['gate-policy-budget-invalid'],
  );

  // The Gate policy section has exactly five subcontracts, so no baseline
  // exemption or persistent pass cache is even expressible (FR-POL-004).
  assert.deepEqual(
    codes((policy) => { policy.baseline = { exempt_preexisting: true }; }),
    ['gate-policy-subcontract-unknown'],
  );
  assert.deepEqual(
    codes((policy) => { policy.cache = { persist_passes: true }; }),
    ['gate-policy-subcontract-unknown'],
  );

  // Verification stays the sole owner of command definitions.
  assert.deepEqual(
    codes((policy) => { policy.execution.command = { runner: 'package-script' }; }),
    ['gate-policy-command-ownership'],
  );
  assert.deepEqual(
    codes((policy) => { policy.evidence.args = ['run', 'test']; }),
    ['gate-policy-command-ownership'],
  );

  // Severity must be unambiguous and identities must be real identities.
  assert.deepEqual(
    codes((policy) => { policy.checks.advisory.push('node-package.broad-tests.test'); }),
    ['gate-policy-check-ambiguous'],
  );
  assert.deepEqual(
    codes((policy) => { policy.checks.required.push('node-package.broad-tests.test'); }),
    ['gate-policy-check-duplicated'],
  );
  assert.deepEqual(
    codes((policy) => { policy.checks.required = ['']; }),
    ['gate-policy-check-identity-invalid'],
  );
  assert.deepEqual(
    codes((policy) => { delete policy.checks.advisory; }),
    ['gate-policy-checks-invalid'],
  );

  // Bypass policy is explicit; it is never inferred.
  assert.deepEqual(codes((policy) => { delete policy.bypass.enabled; }), ['gate-policy-bypass-invalid']);
  assert.deepEqual(codes((policy) => { policy.bypass.marker = 42; }), ['gate-policy-bypass-invalid']);

  // Required work is never eligible to be skipped for the budget.
  assert.deepEqual(
    codes((policy) => { policy.execution.budget_skippable = ['node-package.broad-tests.test']; }),
    ['gate-policy-skippable-required'],
  );
});

/** Poll until a predicate holds or the deadline passes. */
const waitFor = async (predicate, timeoutMs = 4000) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }

    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }

  return false;
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

test('AC-POL-002 / FR-POL-005: a per-check timeout terminates the whole process tree, not only the direct child', async () => {
  const workspace = await temporaryDirectory('gate-policy-tree-');
  const pidFile = path.join(workspace, 'grandchild.pid');
  const beatFile = path.join(workspace, 'grandchild.beat');

  await writeFile(
    path.join(workspace, 'grandchild.mjs'),
    [
      "import { writeFileSync } from 'node:fs';",
      'const [pidFile, beatFile] = process.argv.slice(2);',
      'writeFileSync(pidFile, String(process.pid));',
      'setInterval(() => writeFileSync(beatFile, String(Date.now())), 25);',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(workspace, 'parent.mjs'),
    [
      "import { spawn } from 'node:child_process';",
      'const [grandchild, pidFile, beatFile] = process.argv.slice(2);',
      "spawn(process.execPath, [grandchild, pidFile, beatFile], { stdio: 'ignore' });",
      'setInterval(() => {}, 1000);',
      '',
    ].join('\n'),
    'utf8',
  );

  const executor = createBoundedExecutor({
    totalSeconds: 30,
    resolveExecutable: () => ({ executable: process.execPath, version: process.version }),
  });

  const attempt = await executor.execute({
    checkId: 'node-package.broad-tests.test',
    role: 'evaluate',
    command: {
      runner: 'repository-script',
      args: ['parent.mjs', 'grandchild.mjs', pidFile, beatFile],
      working_directory: '.',
      allowed_environment: ['PATH'],
    },
    executionRoot: workspace,
    timeoutSeconds: 1,
  });

  assert.equal(attempt.timedOut, true);
  assert.deepEqual(
    classifyAttempt(attempt),
    { outcome: 'unverified', reasonCode: 'timeout' },
  );

  // The grandchild outlives its direct parent unless the process tree is
  // terminated: it must be gone once the timeout fired.
  const grandchildPid = Number.parseInt(await readFile(pidFile, 'utf8'), 10);

  assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0);

  const terminated = await waitFor(async () => !alive(grandchildPid));

  if (!terminated) {
    try {
      process.kill(-grandchildPid, 'SIGKILL');
    } catch {
      process.kill(grandchildPid, 'SIGKILL');
    }
  }

  assert.equal(terminated, true, 'the timed-out process tree must be terminated');

  // Background completion can never authorize the current commit.
  const lastBeat = await readFile(beatFile, 'utf8');

  await new Promise((resolve) => { setTimeout(resolve, 200); });
  assert.equal(await readFile(beatFile, 'utf8'), lastBeat);
});

test('AC-POL-002 / FR-POL-005 / SG-POL-001: an exhausted budget skips only eligible advisory work and blocks incomplete required coverage', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });
  const slowRequired = descriptor({
    id: 'node-package.static-analysis.lint',
    stage: 'static-analysis',
    capability: 'lint',
    evaluate: command(['run', 'lint'], { evidence_category: 'lint' }),
    evidence: { claims: ['lint:static'], success_exit_codes: [0], report: null },
    order: 1,
  });
  const eligibleAdvisory = descriptor({
    id: 'node-package.broad-tests.docs',
    capability: 'docs',
    evaluate: command(['run', 'docs'], { evidence_category: 'docs' }),
    evidence: { claims: ['docs:broad'], success_exit_codes: [0], report: null },
    order: 20,
  });
  const ineligibleAdvisory = descriptor({
    id: 'node-package.broad-tests.audit',
    capability: 'audit',
    evaluate: command(['run', 'audit'], { evidence_category: 'audit' }),
    evidence: { claims: ['audit:broad'], success_exit_codes: [0], report: null },
    order: 30,
  });

  const run = async (checks, policy, durationMs) => {
    const invoked = [];
    const decision = await evaluate(authoritativeRequest(root), {
      checks,
      policy,
      executionRoot: await temporaryDirectory('gate-policy-exec-'),
      execute: async ({ checkId }) => {
        invoked.push(checkId);

        return { ...passingAttempt(), durationMs };
      },
    });

    return { decision, invoked };
  };

  const budgeted = await run(
    [slowRequired, eligibleAdvisory, ineligibleAdvisory],
    {
      checks: {
        required: ['node-package.static-analysis.lint'],
        advisory: ['node-package.broad-tests.docs', 'node-package.broad-tests.audit'],
      },
      budget: { total_seconds: 1 },
      bypass: { enabled: false },
      execution: { budget_skippable: ['node-package.broad-tests.docs'] },
      evidence: {},
    },
    900,
  );

  const outcomeOf = (decision, id) => decision.checks.find((check) => check.id === id);

  // The required check runs first and consumes almost the whole budget.
  assert.equal(outcomeOf(budgeted.decision, 'node-package.static-analysis.lint').outcome, 'passed');

  // Only the advisory check the project confirmed as skippable is skipped.
  const skipped = outcomeOf(budgeted.decision, 'node-package.broad-tests.docs');

  assert.equal(skipped.outcome, 'unverified');
  assert.equal(skipped.reasonCode, 'budget-exhausted');
  assert.ok(!budgeted.invoked.includes('node-package.broad-tests.docs'));

  // An advisory check the project did not mark skippable still runs.
  assert.ok(budgeted.invoked.includes('node-package.broad-tests.audit'));
  assert.equal(outcomeOf(budgeted.decision, 'node-package.broad-tests.audit').outcome, 'passed');

  // Advisory work that was skipped is visible and still does not block.
  assert.deepEqual(budgeted.decision.advisories, ['node-package.broad-tests.docs']);
  assert.equal(budgeted.decision.outcome, 'passed');
  assert.equal(budgeted.decision.authorization, 'allow');

  // Required coverage that the budget cannot complete is blocking `unverified`,
  // never a skip and never a pass.
  const exhausted = await run(
    [slowRequired, descriptor()],
    {
      checks: {
        required: ['node-package.static-analysis.lint', 'node-package.broad-tests.test'],
        advisory: [],
      },
      budget: { total_seconds: 1 },
      bypass: { enabled: false },
      execution: { budget_skippable: [] },
      evidence: {},
    },
    1000,
  );

  const starved = outcomeOf(exhausted.decision, 'node-package.broad-tests.test');

  assert.equal(starved.policy, 'required');
  assert.equal(starved.outcome, 'unverified');
  assert.equal(starved.reasonCode, 'budget-exhausted');
  assert.ok(!exhausted.invoked.includes('node-package.broad-tests.test'));
  assert.equal(exhausted.decision.outcome, 'unverified');
  assert.equal(exhausted.decision.authorization, 'deny');
  assert.deepEqual(exhausted.decision.coverage.gaps, ['test:broad']);
  assert.deepEqual(validateDecision(exhausted.decision), []);
});

test('AC-POL-003 / FR-POL-006 / FR-POL-007 / FR-POL-008 / SG-BYP-001: bypass is disableable, one-shot, snapshot- and reason-bound, and never a pass', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });
  const checks = [descriptor()];
  const basePolicy = (bypass) => ({
    checks: { required: ['node-package.broad-tests.test'], advisory: [] },
    budget: { total_seconds: 600 },
    bypass,
    execution: {},
    evidence: {},
  });

  const run = async (policy, dependencies = {}) => evaluate(authoritativeRequest(root), {
    checks,
    policy,
    executionRoot: await temporaryDirectory('gate-policy-exec-'),
    execute: async () => failingAttempt(),
    ...dependencies,
  });

  const grant = (overrides = {}) => ({
    actor: 'release-owner',
    reason: 'Production incident hotfix',
    reference: 'INC-4711',
    requestedAt: '2026-08-10T09:00:00.000Z',
    ...overrides,
  });

  // No bypass requested: the field stays null and the failure blocks.
  const untouched = await run(basePolicy({ enabled: false }));

  assert.equal(untouched.bypass, null);
  assert.equal(untouched.outcome, 'failed');
  assert.equal(untouched.authorization, 'deny');

  const snapshotId = untouched.snapshot.id;

  // A project may disable bypass entirely; the request is rejected and the
  // required failure remains blocking.
  const disabled = await run(
    basePolicy({ enabled: false }),
    { bypass: grant({ snapshotId }) },
  );

  assert.equal(disabled.bypass.applied, false);
  assert.equal(disabled.bypass.rejectionCode, 'bypass-disabled');
  assert.equal(disabled.outcome, 'failed');
  assert.equal(disabled.authorization, 'deny');

  const enabled = { enabled: true, require_reference: true, marker: 'Gate-Bypass' };

  // A bypass is never accepted without its required reason and reference.
  for (const [rejectionCode, overrides] of [
    ['reason-missing', { snapshotId, reason: '   ' }],
    ['reference-missing', { snapshotId, reference: null }],
    ['snapshot-mismatch', { snapshotId: 'sha256:'.padEnd(71, '0') }],
  ]) {
    const rejected = await run(basePolicy(enabled), { bypass: grant(overrides) });

    assert.equal(rejected.bypass.applied, false, rejectionCode);
    assert.equal(rejected.bypass.rejectionCode, rejectionCode, rejectionCode);
    assert.equal(rejected.outcome, 'failed', rejectionCode);
    assert.equal(rejected.authorization, 'deny', rejectionCode);
    assert.deepEqual(validateDecision(rejected), [], rejectionCode);
  }

  // An accepted bypass is visibly bypassed, evidence-backed, marker-emitting,
  // and preserves every failure exactly as graded.
  const consumed = [];
  const ledger = {
    isConsumed: (id) => consumed.includes(id),
    consume: (record) => consumed.push(record.id),
  };
  const bypassed = await run(
    basePolicy(enabled),
    { bypass: grant({ snapshotId }), bypassLedger: ledger },
  );

  assert.equal(bypassed.outcome, 'bypassed');
  assert.equal(bypassed.authorization, 'allow');
  assert.equal(bypassed.checks[0].outcome, 'failed');
  assert.equal(bypassed.checks[0].reasonCode, 'grader-negative');
  assert.deepEqual(bypassed.coverage.provedClaims, []);
  assert.deepEqual(bypassed.coverage.gaps, ['test:broad']);
  assert.equal(bypassed.bypass.applied, true);
  assert.equal(bypassed.bypass.oneShot, true);
  assert.equal(bypassed.bypass.marker, 'Gate-Bypass');
  assert.equal(bypassed.bypass.actor, 'release-owner');
  assert.equal(bypassed.bypass.reason, 'Production incident hotfix');
  assert.equal(bypassed.bypass.reference, 'INC-4711');
  assert.equal(bypassed.bypass.snapshotId, snapshotId);
  assert.deepEqual(bypassed.bypass.preservedFailures, ['node-package.broad-tests.test']);
  assert.deepEqual(bypassed.bypass.preservedUnverified, []);
  // Local enforcement is never presented as tamper-proof (SG-TRUST-001).
  assert.equal(bypassed.bypass.tamperEvident, false);
  assert.match(bypassed.bypass.evidence.id, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(validateDecision(bypassed), []);
  assert.deepEqual(consumed, [bypassed.bypass.id]);

  // One-shot: the same grant cannot authorize a second attempt.
  const replayed = await run(
    basePolicy(enabled),
    { bypass: grant({ snapshotId }), bypassLedger: ledger },
  );

  assert.equal(replayed.bypass.applied, false);
  assert.equal(replayed.bypass.rejectionCode, 'bypass-already-consumed');
  assert.equal(replayed.outcome, 'failed');
  assert.equal(replayed.authorization, 'deny');
});

test('AC-EVAL-001 / FR-EVAL-001 / FR-POL-001: every commit in an activated fixture evaluates, passes allow and one required failure blocks', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });
  const policy = {
    checks: { required: ['node-package.broad-tests.test'], advisory: [] },
    budget: { total_seconds: 600 },
    bypass: { enabled: false },
    execution: {},
    evidence: {},
  };
  const invocations = [];

  /** The activated pre-commit path: evaluate the staged snapshot, then commit. */
  const attemptCommit = async (message, gradeAs, gatePolicy = policy) => {
    await git(root, ['add', '--all']);

    const decision = await evaluate(
      {
        ...authoritativeRequest(root),
        change: { kind: 'git-index', baseRevision: 'HEAD' },
      },
      {
        checks: [descriptor()],
        policy: gatePolicy,
        executionRoot: await temporaryDirectory('gate-policy-exec-'),
        execute: async () => gradeAs(),
      },
    );

    invocations.push({ message, authorization: decision.authorization });

    if (decision.authorization === 'allow') {
      await git(root, [
        '-c', 'user.email=gate@example.test',
        '-c', 'user.name=Gate Fixture',
        '-c', 'commit.gpgsign=false',
        'commit', '--quiet', '-m', message,
      ]);
    }

    return decision;
  };

  const allowed = await attemptCommit('first change', passingAttempt);

  assert.equal(allowed.outcome, 'passed');
  assert.equal(allowed.authorization, 'allow');

  await writeFile(path.join(root, 'src/order.txt'), 'second\n', 'utf8');

  const blocked = await attemptCommit('second change', failingAttempt);

  assert.equal(blocked.outcome, 'failed');
  assert.equal(blocked.authorization, 'deny');

  // Every commit attempt evaluated; none skipped the gate.
  assert.deepEqual(invocations, [
    { message: 'first change', authorization: 'allow' },
    { message: 'second change', authorization: 'deny' },
  ]);

  const { stdout: log } = await git(root, ['log', '--pretty=%s']);

  assert.deepEqual(log.trim().split('\n'), ['first change']);

  // An activated repository whose Gate policy is not usable fails closed
  // rather than evaluating with invented limits.
  const misconfigured = await attemptCommit('third change', passingAttempt, {
    checks: { required: ['node-package.broad-tests.test'], advisory: [] },
    bypass: { enabled: true },
    execution: {},
    evidence: {},
  });

  assert.equal(misconfigured.outcome, 'unverified');
  assert.equal(misconfigured.authorization, 'deny');
  assert.deepEqual(
    misconfigured.diagnostics.map((diagnostic) => diagnostic.reasonCode),
    ['configuration-invalid'],
  );
  assert.match(misconfigured.diagnostics[0].detail, /budget/);
  assert.deepEqual(validateDecision(misconfigured), []);
});

test('SG-POL-001 / NFR-REL-003: reauthorizing a decision never upgrades a recorded unverified outcome to a pass', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });
  const drifted = await evaluate(authoritativeRequest(root), {
    checks: [descriptor()],
    policy: {
      checks: { required: ['node-package.broad-tests.test'], advisory: [] },
      budget: { total_seconds: 600 },
      bypass: { enabled: false },
      execution: {},
      evidence: {},
    },
    executionRoot: await temporaryDirectory('gate-policy-exec-'),
    execute: async ({ executionRoot }) => {
      await writeFile(path.join(executionRoot, 'src/order.txt'), 'rewritten\n', 'utf8');

      return passingAttempt();
    },
  });

  // The grader passed but the evaluation itself is unverified.
  assert.equal(drifted.checks[0].outcome, 'passed');
  assert.equal(drifted.outcome, 'unverified');

  const reauthorized = authorizeDecision(drifted, bindingOf(drifted));

  assert.equal(reauthorized.outcome, 'unverified');
  assert.equal(reauthorized.authorization, 'deny');
});
