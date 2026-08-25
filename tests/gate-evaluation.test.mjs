import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { evidenceLadderStages } from '../skills/verify-change/scripts/verification-plan.mjs';
import {
  DECISION_OUTCOMES,
  ENFORCEMENT_ROLES,
  PROTOCOL_VERSION,
  REASON_OUTCOMES,
  SNAPSHOT_TARGET_KINDS,
  TRIGGERS,
  UNVERIFIED_REASONS,
  classifyAttempt,
  reconcileAttempts,
  validateDecision,
  validateEvaluationRequest,
} from '../skills/change-evaluation-gate/scripts/lib/evaluation-contract.mjs';
import { evaluate } from '../skills/change-evaluation-gate/scripts/lib/evaluate.mjs';
import { PREREQUISITE_KINDS } from '../skills/change-evaluation-gate/scripts/lib/check-descriptor.mjs';
import {
  createPrerequisiteResolver,
  describeMissingPrerequisites,
} from '../skills/change-evaluation-gate/scripts/lib/prerequisites.mjs';

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
  const root = await temporaryDirectory('gate-eval-repo-');

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

const request = (overrides = {}) => ({
  protocolVersion: '1.0',
  operation: 'evaluate',
  repository: { root: overrides.root },
  change: { kind: 'worktree', baseRevision: 'HEAD' },
  evaluation: { purpose: 'regression-only', contractRef: null },
  invocation: {
    role: 'preflight',
    trigger: 'work-complete',
    adapter: {
      id: 'claude',
      surface: 'claude-code-desktop',
      version: '1.0.0',
      capabilities: { nativeBlocking: false },
    },
    sessionId: 'session-a',
  },
  ...overrides.request,
});

const passingAttempt = () => ({
  executed: true,
  exitCode: 0,
  timedOut: false,
  error: null,
  durationMs: 5,
});

test('AC-EVAL-004: a live worktree edit made after snapshot capture cannot alter evaluated output or snapshot identity', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });
  const executionRoot = await temporaryDirectory('gate-eval-exec-');
  const observed = [];

  const decision = await evaluate(request({ root }), {
    checks: [descriptor()],
    executionRoot,
    async execute({ executionRoot: root_ }) {
      // The live worktree is edited after the snapshot was captured, while the
      // delegated check is running.
      await writeFile(path.join(root, 'src/order.txt'), 'tampered\n', 'utf8');

      observed.push(await readFile(path.join(root_, 'src/order.txt'), 'utf8'));

      return passingAttempt();
    },
  });

  assert.deepEqual(observed, ['original\n']);
  assert.equal(decision.outcome, 'passed');
  assert.equal(decision.snapshot.kind, 'worktree');
  assert.equal(decision.environment.sourceMutable, false);

  // The gate never writes to the live worktree: the tester's edit survives.
  assert.equal(await readFile(path.join(root, 'src/order.txt'), 'utf8'), 'tampered\n');

  // The materialized execution root still holds the captured content.
  assert.equal(
    await readFile(path.join(executionRoot, 'src/order.txt'), 'utf8'),
    'original\n',
  );

  // SG-EVAL-001: the returned identity is the identity of the execution root,
  // not of the mutated live worktree.
  const afterEdit = await evaluate(request({ root }), {
    checks: [descriptor()],
    executionRoot: await temporaryDirectory('gate-eval-exec-'),
    execute: async () => passingAttempt(),
  });

  assert.notEqual(afterEdit.snapshot.id, decision.snapshot.id);
});

test('AC-EVAL-002: the versioned request carries exactly the identities the process contract defines', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });
  const valid = request({ root });

  assert.deepEqual(validateEvaluationRequest(valid), []);
  assert.equal(PROTOCOL_VERSION, '1.0');
  assert.deepEqual([...SNAPSHOT_TARGET_KINDS], ['git-index', 'worktree']);
  assert.deepEqual([...ENFORCEMENT_ROLES], ['authoritative', 'preflight']);
  assert.deepEqual([...TRIGGERS], ['commit-attempt', 'work-complete']);
  assert.deepEqual(
    [...DECISION_OUTCOMES],
    ['passed', 'failed', 'unverified', 'bypassed'],
  );

  const codes = (mutate) => {
    const candidate = structuredClone(valid);

    mutate(candidate);

    return validateEvaluationRequest(candidate).map((error) => error.code).sort();
  };

  assert.deepEqual(codes((r) => { delete r.repository.root; }), ['repository-root-invalid']);
  assert.deepEqual(codes((r) => { r.repository.root = 'relative/path'; }), ['repository-root-invalid']);
  assert.deepEqual(codes((r) => { r.change.kind = 'live-worktree'; }), ['snapshot-target-invalid']);
  assert.deepEqual(codes((r) => { delete r.evaluation.contractRef; }), ['contract-reference-invalid']);
  assert.deepEqual(codes((r) => { r.invocation.role = 'owner'; }), ['role-invalid']);
  assert.deepEqual(codes((r) => { r.invocation.trigger = 'on-save'; }), ['trigger-invalid']);
  assert.deepEqual(codes((r) => { delete r.invocation.adapter.capabilities; }), ['adapter-identity-invalid']);
  assert.deepEqual(codes((r) => { r.invocation.sessionId = ''; }), ['session-identity-invalid']);
  assert.deepEqual(codes((r) => { r.protocolVersion = '2.0'; }), ['protocol-version-unsupported']);
  assert.deepEqual(codes((r) => { r.operation = 'fix'; }), ['operation-unsupported']);

  // A request never carries client-native payloads, commands, or policy.
  assert.deepEqual(codes((r) => { r.policy = { checks: { required: [] } }; }), ['request-field-unknown']);
  assert.deepEqual(codes((r) => { r.verification = { commands: ['npm test'] }; }), ['request-field-unknown']);
  assert.deepEqual(codes((r) => { r.invocation.nativeEvent = { hook: 'pre-commit' }; }), ['request-field-unknown']);
});

test('AC-EVAL-002 / NFR-AUD-002 / NFR-OPER-001: every decision outcome carries identity, authorization, diagnostics, coverage, integrity, and evidence', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });

  const decisionFor = async (attempt, role = 'authoritative') => evaluate(
    request({ root, request: { invocation: { ...request({ root }).invocation, role } } }),
    {
      checks: [descriptor()],
      executionRoot: await temporaryDirectory('gate-eval-exec-'),
      profile: 'node-package',
      providerVersions: { 'node-package': '1.0.0' },
      runnerVersion: 'gate-runner/1.0.0',
      execute: async () => attempt,
    },
  );

  const passed = await decisionFor(passingAttempt());
  const failed = await decisionFor({ ...passingAttempt(), exitCode: 1 });
  const unverified = await decisionFor({ ...passingAttempt(), timedOut: true, exitCode: null });

  assert.equal(passed.outcome, 'passed');
  assert.equal(failed.outcome, 'failed');
  assert.equal(unverified.outcome, 'unverified');

  for (const decision of [passed, failed, unverified]) {
    assert.deepEqual(validateDecision(decision), []);
    assert.equal(decision.protocolVersion, '1.0');
    assert.match(decision.evaluationId, /^sha256:[0-9a-f]{64}$/);
    assert.equal(decision.task.purpose, 'regression-only');
    assert.equal(decision.task.contractId, null);
    assert.equal(decision.environment.snapshotId, decision.snapshot.id);
    assert.equal(decision.integrity.environmentId, decision.environment.id);
    assert.equal(decision.integrity.configurationId, decision.configurationId);
    assert.deepEqual(decision.integrity.providerVersions, { 'node-package': '1.0.0' });
    assert.equal(decision.evidence.format, 'change-evaluation-gate/v1');
    assert.equal(decision.evidence.persisted, false);
    assert.deepEqual(decision.coverage.requiredClaims, ['test:broad']);

    const [check] = decision.checks;

    assert.equal(check.grader.type, 'code');
    assert.equal(check.grader.method, 'test');
    assert.equal(check.grader.target, 'test');
    assert.deepEqual(check.assertions.map(({ id }) => id), ['test:broad']);
    assert.equal(check.assertions[0].outcome, check.outcome);
    assert.ok(check.summary.length > 0);
  }

  // Transport success is independent of authorization.
  assert.equal(passed.authorization, 'allow');
  assert.equal(failed.authorization, 'deny');
  assert.equal(unverified.authorization, 'deny');
  assert.deepEqual(passed.coverage.gaps, []);
  assert.deepEqual(failed.coverage.gaps, ['test:broad']);
  assert.deepEqual(unverified.coverage.gaps, ['test:broad']);

  // A preflight adapter never claims authority, whatever the outcome is.
  const preflight = await decisionFor(passingAttempt(), 'preflight');

  assert.equal(preflight.outcome, 'passed');
  assert.equal(preflight.authorization, 'not-authoritative');

  // The bypassed outcome is declared by this contract even though bypass
  // authorization itself is owned by a later slice.
  const bypassed = {
    ...passed,
    outcome: 'bypassed',
    bypass: { reason: 'Emergency release', reference: 'INC-123' },
  };

  assert.deepEqual(validateDecision(bypassed), []);

  // An invalid request still returns a complete, honest decision envelope.
  const rejected = await evaluate({ ...request({ root }), operation: 'fix' }, {
    checks: [descriptor()],
    executionRoot: await temporaryDirectory('gate-eval-exec-'),
    execute: async () => passingAttempt(),
  });

  assert.deepEqual(validateDecision(rejected), []);
  assert.equal(rejected.outcome, 'unverified');
  assert.equal(rejected.authorization, 'not-authoritative');
  assert.deepEqual(rejected.diagnostics.map(({ reasonCode }) => reasonCode), ['configuration-invalid']);
  assert.deepEqual(rejected.checks, []);
});

test('AC-EVAL-003 / SG-OWNER-001: one identical binding preserves Evidence ladder order and configured inputs while invoking only check-only commands', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });

  const formatter = descriptor({
    id: 'node-package.format.formatter',
    stage: 'format',
    capability: 'formatter',
    applicability: { changed_path_globs: ['src/**'], required_facts: [] },
    evaluate: command(['run', 'format:check'], { evidence_category: 'format' }),
    fix: command(['run', 'format'], { evidence_category: 'format' }),
    evidence: { claims: ['format:style'], success_exit_codes: [0], report: null },
  });
  const focused = descriptor({
    id: 'node-package.focused.test',
    stage: 'focused',
    applicability: { changed_path_globs: ['web/**'], required_facts: [] },
    evaluate: command(['run', 'test:focused']),
    evidence: { claims: ['test:focused'], success_exit_codes: [0], report: null },
    selection: { kind: 'explicit-filter', value: 'orders' },
  });
  const broad = descriptor();

  const evaluateOnce = async () => {
    const invocations = [];

    const decision = await evaluate(request({ root }), {
      // Deliberately supplied out of Evidence ladder order.
      checks: [broad, focused, formatter],
      executionRoot: await temporaryDirectory('gate-eval-exec-'),
      profile: 'node-package',
      providerVersions: { 'node-package': '1.0.0' },
      runnerVersion: 'gate-runner/1.0.0',
      async execute(invocation) {
        invocations.push(invocation);

        return passingAttempt();
      },
    });

    return { decision, invocations };
  };

  const first = await evaluateOnce();
  const second = await evaluateOnce();

  // Order is the settled Evidence ladder order owned by verify-change.
  assert.deepEqual(first.decision.checks.map(({ id }) => id), [
    'node-package.focused.test',
    'node-package.format.formatter',
    'node-package.broad-tests.test',
  ]);
  assert.deepEqual(first.decision.delegation.seam, 'verify-change');
  assert.deepEqual(first.decision.delegation.ladder, [...evidenceLadderStages]);
  assert.deepEqual(first.decision.delegation.invokedRoles, ['evaluate']);

  // A check whose deterministic applicability does not match is not applicable
  // and is never executed; it is never reported as passed.
  const [notApplicable] = first.decision.checks;

  assert.equal(notApplicable.outcome, 'not-applicable');
  assert.deepEqual(notApplicable.attempts, []);

  // Only non-mutating evaluation commands reach the seam, with the configured
  // inputs untouched.
  assert.deepEqual(first.invocations.map(({ checkId }) => checkId), [
    'node-package.format.formatter',
    'node-package.broad-tests.test',
  ]);
  assert.deepEqual([...new Set(first.invocations.map(({ role }) => role))], ['evaluate']);
  assert.deepEqual(first.invocations[0].command, formatter.evaluate);
  assert.equal(first.invocations[0].timeoutSeconds, formatter.timeout_seconds);
  assert.deepEqual(first.invocations[0].allowedEnvironment, formatter.evaluate.allowed_environment);

  for (const invocation of first.invocations) {
    assert.notDeepEqual(invocation.command, formatter.fix);
  }

  // Reproducible, not incidental: an identical binding yields an identical
  // decision apart from the host-local execution root.
  const withoutRoot = ({ snapshot, ...rest }) => ({
    ...rest,
    snapshot: { ...snapshot, executionRoot: null },
  });

  assert.notEqual(
    first.decision.snapshot.executionRoot,
    second.decision.snapshot.executionRoot,
  );
  assert.deepEqual(withoutRoot(first.decision), withoutRoot(second.decision));
  assert.deepEqual(
    first.invocations.map(({ executionRoot, ...rest }) => rest),
    second.invocations.map(({ executionRoot, ...rest }) => rest),
  );
});

test('SG-OWNER-001: the gate imports the Evidence ladder from verify-change instead of restating it', async () => {
  const sources = [
    'verification-seam.mjs',
    'evaluate.mjs',
    'evaluation-contract.mjs',
    'snapshot.mjs',
  ];
  let importsLadder = false;

  for (const source of sources) {
    const contents = await readFile(
      fileURLToPath(new URL(
        `../skills/change-evaluation-gate/scripts/lib/${source}`,
        import.meta.url,
      )),
      'utf8',
    );

    if (contents.includes('verify-change/scripts/verification-plan.mjs')) {
      importsLadder = true;
    }

    // Stages whose names belong to the ladder alone; `format`, `build`,
    // `smoke`, and `browser` are also ordinary contract words.
    for (const stage of ['static-analysis', 'affected-tests', 'broad-tests']) {
      assert.ok(evidenceLadderStages.includes(stage));
      assert.equal(
        contents.includes(`'${stage}'`),
        false,
        `${source} restates the Evidence ladder stage ${stage}`,
      );
    }
  }

  assert.equal(importsLadder, true);
});

test('AC-EVAL-006: every defined harness failure family normalizes to unverified and can never pass', async () => {
  for (const reason of [
    'prerequisite-missing',
    'configuration-invalid',
    'timeout',
    'crash',
    'malformed-output',
    'snapshot-mismatch',
    'integrity-drift',
    'coordination-failure',
    'attempt-conflict',
  ]) {
    assert.equal(REASON_OUTCOMES[reason], 'unverified', reason);
    assert.ok(UNVERIFIED_REASONS.includes(reason), reason);
  }

  assert.deepEqual(
    classifyAttempt({ executed: true, exitCode: 0 }),
    { outcome: 'passed', reasonCode: 'grader-positive' },
  );
  assert.deepEqual(
    classifyAttempt({ executed: true, exitCode: 2 }),
    { outcome: 'failed', reasonCode: 'grader-negative' },
  );
  assert.deepEqual(
    classifyAttempt({ executed: true, exitCode: 2 }, { successExitCodes: [0, 2] }),
    { outcome: 'passed', reasonCode: 'grader-positive' },
  );
  assert.deepEqual(
    classifyAttempt({ executed: true, exitCode: 0 }, { applicable: false }),
    { outcome: 'not-applicable', reasonCode: 'not-applicable' },
  );
  assert.deepEqual(
    classifyAttempt({ executed: true, exitCode: 0, timedOut: true }),
    { outcome: 'unverified', reasonCode: 'timeout' },
  );
  assert.deepEqual(
    classifyAttempt({ executed: true, exitCode: 0, error: 'ENOENT' }),
    { outcome: 'unverified', reasonCode: 'crash' },
  );
  assert.deepEqual(
    classifyAttempt({ executed: true, exitCode: 0, malformedOutput: true }),
    { outcome: 'unverified', reasonCode: 'malformed-output' },
  );
  assert.deepEqual(
    classifyAttempt({ executed: false, exitCode: null }),
    { outcome: 'unverified', reasonCode: 'malformed-output' },
  );

  // A stated harness reason wins over a convenient exit code.
  for (const reason of UNVERIFIED_REASONS) {
    assert.deepEqual(
      classifyAttempt({ executed: true, exitCode: 0, reasonCode: reason }),
      { outcome: 'unverified', reasonCode: reason },
      reason,
    );
  }

  // Equivalent attempts that disagree are a conflict, never a chosen winner.
  assert.deepEqual(
    reconcileAttempts([
      { outcome: 'failed', reasonCode: 'grader-negative' },
      { outcome: 'passed', reasonCode: 'grader-positive' },
    ]),
    { outcome: 'unverified', reasonCode: 'attempt-conflict' },
  );
  assert.deepEqual(
    reconcileAttempts([
      { outcome: 'passed', reasonCode: 'grader-positive' },
      { outcome: 'passed', reasonCode: 'grader-positive' },
    ]),
    { outcome: 'passed', reasonCode: 'grader-positive' },
  );
  assert.deepEqual(
    reconcileAttempts([]),
    { outcome: 'unverified', reasonCode: 'malformed-output' },
  );
});

test('AC-EVAL-006 / RISK-007: conflicting equivalent attempts are all retained and deny authorization', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });
  let calls = 0;

  const decision = await evaluate(
    request({
      root,
      request: {
        invocation: { ...request({ root }).invocation, role: 'authoritative', trigger: 'commit-attempt' },
      },
    }),
    {
      checks: [descriptor()],
      executionRoot: await temporaryDirectory('gate-eval-exec-'),
      execute: async () => {
        calls += 1;

        return [
          { executed: true, exitCode: 1, durationMs: 11 },
          { executed: true, exitCode: 0, durationMs: 9 },
        ];
      },
    },
  );

  // The gate never retries silently: the executor is invoked once.
  assert.equal(calls, 1);

  const [check] = decision.checks;

  assert.equal(check.outcome, 'unverified');
  assert.equal(check.reasonCode, 'attempt-conflict');
  assert.deepEqual(check.attempts, [
    { attempt: 1, outcome: 'failed', reasonCode: 'grader-negative', exitCode: 1, durationMs: 11 },
    { attempt: 2, outcome: 'passed', reasonCode: 'grader-positive', exitCode: 0, durationMs: 9 },
  ]);
  assert.equal(decision.outcome, 'unverified');
  assert.equal(decision.authorization, 'deny');
  assert.deepEqual(decision.coverage.provedClaims, []);
  assert.deepEqual(validateDecision(decision), []);
});

test('AC-EVAL-006 / NFR-REL-003: prerequisite, configuration, timeout, crash, malformed-output, integrity, and coordination failures all deny', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });

  const evaluateWith = async (dependencies) => evaluate(
    request({
      root,
      request: {
        invocation: { ...request({ root }).invocation, role: 'authoritative', trigger: 'commit-attempt' },
      },
    }),
    {
      checks: [descriptor()],
      executionRoot: await temporaryDirectory('gate-eval-exec-'),
      execute: async () => passingAttempt(),
      ...dependencies,
    },
  );

  const cases = [
    ['prerequisite-missing', {
      checks: [descriptor({ prerequisites: [{ kind: 'executable', name: 'node' }] })],
      resolvePrerequisite: () => false,
      execute: async () => {
        throw new Error('an unproved prerequisite must never reach the executor');
      },
    }],
    ['timeout', { execute: async () => ({ executed: true, exitCode: null, timedOut: true, durationMs: 1 }) }],
    ['crash', { execute: async () => ({ executed: false, exitCode: null, error: 'ENOENT', durationMs: 1 }) }],
    ['malformed-output', { execute: async () => ({ executed: true, exitCode: 0, malformedOutput: true, durationMs: 1 }) }],
    ['integrity-drift', { execute: async () => ({ executed: true, exitCode: 0, reasonCode: 'integrity-drift', durationMs: 1 }) }],
    ['coordination-failure', { execute: async () => ({ executed: true, exitCode: 0, reasonCode: 'coordination-failure', durationMs: 1 }) }],
  ];

  for (const [reasonCode, dependencies] of cases) {
    const decision = await evaluateWith(dependencies);

    assert.equal(decision.checks[0].reasonCode, reasonCode, reasonCode);
    assert.equal(decision.checks[0].outcome, 'unverified', reasonCode);
    assert.equal(decision.outcome, 'unverified', reasonCode);
    assert.equal(decision.authorization, 'deny', reasonCode);
    assert.deepEqual(validateDecision(decision), [], reasonCode);
    assert.ok(decision.checks[0].attempts.length >= 1, reasonCode);
  }

  // Invalid configuration: Gate policy binds a check no provider resolved.
  const misconfigured = await evaluateWith({
    policy: { checks: { required: ['node-package.analysis.absent'], advisory: [] } },
  });

  assert.equal(misconfigured.outcome, 'unverified');
  assert.equal(misconfigured.authorization, 'deny');
  assert.deepEqual(
    misconfigured.diagnostics.map(({ reasonCode }) => reasonCode),
    ['configuration-invalid'],
  );
  assert.deepEqual(validateDecision(misconfigured), []);

  // No execution seam is bound at all.
  const unbound = await evaluateWith({ execute: undefined });

  assert.equal(unbound.outcome, 'unverified');
  assert.deepEqual(unbound.checks, []);

  // Snapshot mismatch: the execution root changed while the check ran.
  const drifted = await evaluateWith({
    execute: async ({ executionRoot }) => {
      await writeFile(path.join(executionRoot, 'src/order.txt'), 'rewritten\n', 'utf8');

      return passingAttempt();
    },
  });

  assert.equal(drifted.checks[0].outcome, 'passed');
  assert.equal(drifted.outcome, 'unverified');
  assert.equal(drifted.authorization, 'deny');
  assert.deepEqual(
    drifted.diagnostics.map(({ reasonCode }) => reasonCode),
    ['snapshot-mismatch'],
  );
  assert.deepEqual(validateDecision(drifted), []);
});

test('AC-EVAL-004 / SG-EVAL-001: a git-index target grades the staged snapshot, not the dirty worktree', async () => {
  const root = await createRepository({ 'src/order.txt': 'staged\n' });

  await writeFile(path.join(root, 'src/order.txt'), 'dirty\n', 'utf8');

  const executionRoot = await temporaryDirectory('gate-eval-exec-');
  const observed = [];

  const decision = await evaluate(
    request({ root, request: { change: { kind: 'git-index', baseRevision: 'HEAD' } } }),
    {
      checks: [descriptor()],
      executionRoot,
      async execute({ executionRoot: materialized }) {
        observed.push(await readFile(path.join(materialized, 'src/order.txt'), 'utf8'));

        return passingAttempt();
      },
    },
  );

  assert.deepEqual(observed, ['staged\n']);
  assert.equal(decision.snapshot.kind, 'git-index');
  assert.equal(decision.outcome, 'passed');
  assert.equal(await readFile(path.join(root, 'src/order.txt'), 'utf8'), 'dirty\n');
  assert.deepEqual(validateDecision(decision), []);
});

test('AC-EVAL-006 / SG-EVAL-001: a declared prerequisite that cannot be proved is unverified, never assumed present', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });

  const decision = await evaluate(request({ root }), {
    checks: [descriptor({ prerequisites: [{ kind: 'service', name: 'database' }] })],
    executionRoot: await temporaryDirectory('gate-eval-exec-'),
    // No prerequisite resolver is bound, so nothing about the service is proved.
    execute: async () => {
      throw new Error('an unproved prerequisite must never reach the executor');
    },
  });

  assert.equal(decision.checks[0].outcome, 'unverified');
  assert.equal(decision.checks[0].reasonCode, 'prerequisite-missing');
  assert.equal(decision.outcome, 'unverified');
  assert.deepEqual(validateDecision(decision), []);
});

/**
 * TB-033 — a validator refusal is a refusal, not an exception.
 *
 * `validateDecision` is the contract's own completeness rule, and the
 * authoritative runner now denies on its findings. The one input it must never
 * mishandle is the malformed one it exists to reject: a validator that throws
 * on that turns a refusal into a crash, and the crash path is the one that can
 * be trusted least (`NFR-REL-003`, `AC-EVAL-002`).
 */
test('TB-033 AC-EVAL-002: validateDecision returns findings for every malformed decision and throws for none', () => {
  const malformed = [
    null,
    undefined,
    0,
    '',
    'a decision',
    true,
    [],
    [{ authorization: 'allow' }],
    {},
    { authorization: 'allow', outcome: 'passed' },
    // The shapes that reached a member access rather than a finding: a section
    // the contract iterates, carrying something it cannot iterate.
    { authorization: 'allow', outcome: 'passed', checks: 'not-an-array' },
    { authorization: 'allow', outcome: 'passed', checks: [{ assertions: 'not-an-array' }] },
    {
      authorization: 'allow',
      outcome: 'passed',
      coverage: { scope: 'regression-only', limitations: [] },
      checks: 'not-an-array',
    },
    { integrity: { changedGraderSurfaces: 'not-an-array' } },
    {
      checks: undefined,
      integrity: { runtimeBinding: { required: true, proved: null, probes: [], servedSourceId: null, reasonCode: null } },
    },
  ];

  for (const decision of malformed) {
    const findings = validateDecision(decision);

    assert.ok(Array.isArray(findings), `${JSON.stringify(decision)} must be answered with findings.`);
    assert.ok(findings.length > 0, `${JSON.stringify(decision)} must be refused, not accepted.`);
  }
});

/**
 * TB-044: what "proved" means for each declared kind, asked of the one resolver
 * both production runners bind. Every unknown answers false, because an
 * unproved requirement is `unverified` and `unverified` denies (`NFR-REL-003`).
 */
test('TB-044 AC-EVAL-003: each prerequisite kind is proved from established facts, and nothing else is', () => {
  const resolve = createPrerequisiteResolver({
    searchPath: path.dirname(process.execPath),
    environment: { DECLARED: 'value', UNDECLARED: 'value' },
  });
  const context = {
    check: { evaluate: { allowed_environment: ['DECLARED'] } },
    repositoryRoot: '/repository',
    snapshot: { executionRoot: '/execution-root' },
    // Tracked content this evaluation materialized, and one dependency root it
    // provided beside it — the same lists materialization already reported.
    evaluatedPaths: ['app/Order.php', 'vendor'],
  };

  const cases = [
    ['an executable the checks run with', { kind: 'executable', name: path.basename(process.execPath) }, true],
    ['an executable that is nowhere on that path', { kind: 'executable', name: 'no-such-program-anywhere' }, false],
    ['a path the snapshot holds', { kind: 'configuration', name: 'app' }, true],
    ['a dependency root that was provided', { kind: 'configuration', name: 'vendor' }, true],
    ['a path only a build step would generate', { kind: 'configuration', name: 'app/generated' }, false],
    ['a service, which nothing here probes', { kind: 'service', name: 'database' }, false],
    ['an environment name the check is given', { kind: 'environment', name: 'DECLARED' }, true],
    ['an environment name the check never declared', { kind: 'environment', name: 'UNDECLARED' }, false],
    ['source-control history a materialized snapshot cannot have', { kind: 'environment', name: 'source-control-history' }, false],
    ['a kind no descriptor may declare', { kind: 'invented', name: 'anything' }, false],
    ['nothing readable at all', null, false],
  ];

  for (const [label, prerequisite, expected] of cases) {
    assert.equal(resolve(prerequisite, context), expected, label);
  }
});

test('TB-044 SG-EVAL-001: source-control history is proved only where the executed tree is the repository, never asserted', () => {
  const resolve = createPrerequisiteResolver({});
  const prerequisite = { kind: 'environment', name: 'source-control-history' };

  assert.equal(
    resolve(prerequisite, { repositoryRoot: '/repository', snapshot: { executionRoot: '/repository' } }),
    true,
    'the fact is derived from where the checks run, not hard-coded.',
  );
  assert.equal(
    resolve(prerequisite, { repositoryRoot: '/repository', snapshot: { executionRoot: '/somewhere-else' } }),
    false,
    'an evaluation materializes its subject elsewhere, so the history is not there.',
  );
  assert.equal(resolve(prerequisite, {}), false, 'nothing established is nothing proved.');
});

test('TB-044 NFR-OPER-001: an unproved requirement is named as declared, so no tool log is needed to read the denial', () => {
  const stated = describeMissingPrerequisites([
    { kind: 'environment', name: 'source-control-history' },
    { kind: 'configuration', name: 'app/generated' },
  ]);

  assert.match(stated, /environment "source-control-history"/);
  assert.match(stated, /configuration "app\/generated"/);
  assert.match(stated, /Nothing here is a finding about the code/i);
});

test('TB-044 SG-OWNER-001: every kind the descriptor contract validates has a proof, and no proof exists for a kind it does not', () => {
  const resolve = createPrerequisiteResolver({});

  for (const kind of PREREQUISITE_KINDS) {
    assert.equal(
      typeof resolve({ kind, name: 'anything-at-all' }, {}),
      'boolean',
      `${kind} must be answered rather than assumed proved.`,
    );
  }
});
