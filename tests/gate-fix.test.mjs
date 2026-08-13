import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { evaluate } from '../skills/change-evaluation-gate/scripts/lib/evaluate.mjs';
import { runFix } from '../skills/change-evaluation-gate/scripts/lib/fix.mjs';
import { validateDecision } from '../skills/change-evaluation-gate/scripts/lib/evaluation-contract.mjs';
import { collectChecks } from '../skills/change-evaluation-gate/scripts/lib/gate-core.mjs';
import laravelProvider from '../skills/change-evaluation-gate/scripts/lib/providers/laravel.mjs';

const command = (runner, args, category, overrides = {}) => ({
  runner,
  args,
  working_directory: '.',
  timeout_seconds: 60,
  allowed_environment: ['PATH'],
  evidence_category: category,
  source_scope: 'backend',
  ...overrides,
});

/** The non-mutating style check and its separately declared mutating fix. */
const formatterEvaluate = () => command('composer-bin', ['pint', '--test'], 'format');

const formatterFix = () => command('composer-bin', ['pint'], 'format');

const rewriteEvaluate = () => command('composer-bin', ['rector', 'process', '--dry-run'], 'static_analysis');

const rewriteFix = () => command('composer-bin', ['rector', 'process'], 'static_analysis');

const check = ({ id, stage, capability, claim, evaluate: evaluateCommand, fix = null, order = 10 }) => ({
  id,
  provider: 'laravel',
  stage,
  capability,
  scope: 'backend',
  applicability: { changed_path_globs: ['**'], required_facts: [] },
  prerequisites: [],
  policy: 'required',
  evaluate: evaluateCommand,
  fix,
  timeout_seconds: 120,
  declared_writes: [],
  evidence: { claims: [claim], success_exit_codes: [0], report: null },
  order,
  selection: null,
});

const formatterCheck = (overrides = {}) => check({
  id: 'laravel.format.formatter',
  stage: 'format',
  capability: 'formatter',
  claim: 'format:style',
  evaluate: formatterEvaluate(),
  fix: formatterFix(),
  ...overrides,
});

const rewriteCheck = (overrides = {}) => check({
  id: 'laravel.static-analysis.rewrite-check',
  stage: 'static-analysis',
  capability: 'rewrite-check',
  claim: 'static-analysis:rewrite',
  evaluate: rewriteEvaluate(),
  fix: rewriteFix(),
  ...overrides,
});

const evaluationRequest = (root) => ({
  protocolVersion: '1.0',
  operation: 'evaluate',
  repository: { root },
  change: { kind: 'git-index', baseRevision: 'HEAD' },
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
    sessionId: 'gate-fix-test-session',
  },
});

test('AC-POL-004: commit evaluation rejects a mutating descriptor and executes nothing', async () => {
  let executions = 0;
  const execute = async () => {
    executions += 1;

    return { executed: true, exitCode: 0, durationMs: 1 };
  };

  // A maintainer drops `--test`, so the check-only slot now carries exactly the
  // separately declared mutating command.
  const selfMutating = await evaluate(evaluationRequest('/absolute/repository'), {
    checks: [formatterCheck({ evaluate: formatterFix() })],
    execute,
    executionRoot: '/absolute/execution-root',
  });

  assert.deepEqual(validateDecision(selfMutating), []);
  assert.equal(selfMutating.outcome, 'unverified');
  assert.equal(selfMutating.authorization, 'deny');
  assert.deepEqual(
    selfMutating.diagnostics.map(({ reasonCode }) => reasonCode),
    ['configuration-invalid'],
  );
  assert.match(selfMutating.diagnostics[0].detail, /laravel\.format\.formatter/);

  // A mutating command declared as another check's fix is equally unavailable
  // to evaluation, whichever descriptor smuggles it in.
  const borrowedMutation = await evaluate(evaluationRequest('/absolute/repository'), {
    checks: [
      rewriteCheck(),
      formatterCheck({ id: 'laravel.format.borrowed', evaluate: rewriteFix(), fix: null }),
    ],
    execute,
    executionRoot: '/absolute/execution-root',
  });

  assert.deepEqual(validateDecision(borrowedMutation), []);
  assert.equal(borrowedMutation.outcome, 'unverified');
  assert.equal(borrowedMutation.authorization, 'deny');
  assert.match(borrowedMutation.diagnostics[0].detail, /laravel\.format\.borrowed/);

  assert.equal(executions, 0, 'Evaluation is check-only and must never invoke a mutating command.');
});

const provedLaravelFacts = () => ({
  scopes: { backend: ['app', 'tests'], frontend: ['resources/js'] },
  proved: {
    format: { evaluate: formatterEvaluate(), fix: formatterFix() },
    rewrite_check: { evaluate: rewriteEvaluate(), fix: rewriteFix() },
    static_analysis: {
      evaluate: command('composer-bin', ['phpstan', 'analyse'], 'static_analysis'),
      covers_tests: true,
    },
    static_analysis_tests: {
      evaluate: command('composer-bin', ['phpstan', 'analyse', 'tests'], 'static_analysis'),
    },
    focused_test: {
      evaluate: command('php-script', ['artisan', 'test', '--filter', 'OrderTest'], 'test'),
      selection: { kind: 'delivery-matrix', value: 'OrderTest' },
    },
    affected_test: {
      evaluate: command('php-script', ['artisan', 'test', '--testsuite', 'Feature'], 'test'),
      selection: { kind: 'impact-rule', value: 'Feature' },
    },
    smoke: { evaluate: command('php-script', ['artisan', 'test', '--group', 'smoke'], 'smoke') },
    build: {
      evaluate: command('package-script', ['build'], 'build', { source_scope: 'frontend' }),
    },
    broad_test: { evaluate: command('php-script', ['artisan', 'test'], 'test') },
  },
});

const policyById = (checks) => Object.fromEntries(
  checks.map((check) => [check.id, check.policy]),
);

test('AC-PROF-005: Laravel proposes only proved code-health defaults as required and earns the rest', () => {
  const unconfirmed = collectChecks([
    { provider: laravelProvider, facts: provedLaravelFacts() },
  ]);

  assert.equal(unconfirmed.valid, true);
  assert.deepEqual(
    unconfirmed.checks.filter((check) => check.policy === 'required').map((check) => check.id),
    [
      'laravel.format.formatter',
      'laravel.static-analysis.rewrite-check',
      'laravel.static-analysis.application',
      'laravel.broad-tests.test',
    ],
    'Only proved Pint, Rector dry-run, PHPStan/Larastan, and broad tests are proposed as required.',
  );
  assert.deepEqual(
    unconfirmed.checks.filter((check) => check.policy === 'advisory').map((check) => check.id),
    [
      'laravel.focused.test',
      'laravel.affected-tests.test',
      'laravel.smoke.runtime',
      'laravel.build.artifact',
    ],
    'Focused, affected-test, smoke, and build evidence stays advisory until it is confirmed.',
  );

  // Confirmation is what earns a required binding; being proved is not enough.
  const confirmed = collectChecks([{
    provider: laravelProvider,
    facts: { ...provedLaravelFacts(), confirmed_required: ['smoke', 'affected_test', 'browser'] },
  }]);

  assert.equal(confirmed.valid, true);

  const policies = policyById(confirmed.checks);

  assert.equal(policies['laravel.smoke.runtime'], 'required');
  assert.equal(policies['laravel.affected-tests.test'], 'required');
  assert.equal(policies['laravel.focused.test'], 'advisory');
  assert.equal(policies['laravel.build.artifact'], 'advisory');

  // Browser evidence was confirmed but never proved: confirmation never
  // conjures a command, so it stays a visible capability gap.
  assert.equal('laravel.browser.user-visible' in policies, false);
  assert.deepEqual(
    confirmed.capability_gaps.map((gap) => `${gap.capability}:${gap.reason}`),
    ['browser:command-not-proved'],
  );
});

test('AC-PROF-005 and SG-OWNER-001: the Laravel provider declares Rector before Pint and gate core only reads that order', async () => {
  const facts = provedLaravelFacts();
  const resolved = laravelProvider.resolve(facts);

  assert.deepEqual(
    resolved.fix_plan,
    [
      { check_id: 'laravel.static-analysis.rewrite-check', order: 10 },
      { check_id: 'laravel.format.formatter', order: 20 },
    ],
    'The provider owns fix ordering: a structural rewrite runs before formatting.',
  );

  const collected = collectChecks([{ provider: laravelProvider, facts }]);

  assert.deepEqual(collected.fix_plan, resolved.fix_plan);

  // Fix order is declared, not derived from the Evidence ladder: the ladder
  // runs format before static-analysis, and the fix plan is the reverse.
  const ladder = collected.checks.map((check) => check.id);

  assert.ok(
    ladder.indexOf('laravel.format.formatter')
      < ladder.indexOf('laravel.static-analysis.rewrite-check'),
    'The Evidence ladder still orders format before static-analysis.',
  );

  // A check whose mutating command was never proved contributes no fix step.
  const withoutRewriteFix = laravelProvider.resolve({
    ...facts,
    proved: { ...facts.proved, rewrite_check: { evaluate: rewriteEvaluate() } },
  });

  assert.deepEqual(
    withoutRewriteFix.fix_plan,
    [{ check_id: 'laravel.format.formatter', order: 20 }],
  );

  // Gate core and the fix orchestration stay stack neutral.
  const stackNames = /laravel|pint|rector|phpstan|larastan|pest|artisan|dusk|livewire|express|django|rails|symfony/i;

  for (const module of ['gate-core.mjs', 'fix.mjs', 'mutation.mjs']) {
    const source = await readFile(
      fileURLToPath(new URL(`../skills/change-evaluation-gate/scripts/lib/${module}`, import.meta.url)),
      'utf8',
    );

    assert.equal(stackNames.test(source), false, `${module} must not name a stack or a tool.`);
  }
});

const SOURCE = 'app/Order.php';

const temporaryRoots = [];

const temporaryDirectory = async (prefix) => {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));

  temporaryRoots.push(directory);

  return directory;
};

test.after(async () => {
  for (const root of temporaryRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

/** A throwaway repository whose worktree carries the change under evaluation. */
const fixtureRepository = async () => {
  const root = await temporaryDirectory('gate-fix-repo-');
  const runGit = (args) => promisify(execFile)('git', args, { cwd: root });

  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, SOURCE), 'baseline\n', 'utf8');
  await runGit(['init', '--quiet']);
  await runGit(['add', '--all']);
  await runGit([
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Fix',
    'commit', '--quiet', '--message', 'baseline',
  ]);
  await writeFile(path.join(root, SOURCE), 'baseline\nproposed\n', 'utf8');

  return root;
};

const worktreeRequest = (root, operation) => ({
  ...evaluationRequest(root),
  operation,
  change: { kind: 'worktree', baseRevision: 'HEAD' },
});

const fixtureChecks = () => {
  const collected = collectChecks([{
    provider: laravelProvider,
    facts: {
      scopes: { backend: ['app'], frontend: [] },
      proved: {
        format: { evaluate: formatterEvaluate(), fix: formatterFix() },
        rewrite_check: { evaluate: rewriteEvaluate(), fix: rewriteFix() },
      },
    },
  }]);

  return { checks: collected.checks, fixPlan: collected.fix_plan };
};

test('AC-POL-004 and AC-PROF-005: explicit fix mutates in the declared order and only a new evaluation authorizes', async () => {
  const root = await fixtureRepository();
  const { checks, fixPlan } = fixtureChecks();
  const evaluated = [];
  let failing = true;

  const priorDecision = await evaluate(worktreeRequest(root, 'evaluate'), {
    checks,
    execute: async ({ command, role }) => {
      evaluated.push({ role, args: command.args });

      return { executed: true, exitCode: failing ? 1 : 0, durationMs: 1 };
    },
    executionRoot: await temporaryDirectory('gate-fix-exec-'),
  });

  assert.equal(priorDecision.outcome, 'failed');
  assert.equal(priorDecision.authorization, 'deny');

  const mutated = [];

  failing = false;

  const result = await runFix(worktreeRequest(root, 'fix'), {
    checks,
    fixPlan,
    priorDecision,
    executeFix: async ({ checkId, role, command, repositoryRoot }) => {
      mutated.push({ checkId, role });

      await appendFile(path.join(repositoryRoot, SOURCE), `${command.args.join(' ')}\n`, 'utf8');

      return { executed: true, exitCode: 0, durationMs: 1 };
    },
    execute: async ({ command, role }) => {
      evaluated.push({ role, args: command.args });

      return { executed: true, exitCode: 0, durationMs: 1 };
    },
    executionRoot: await temporaryDirectory('gate-fix-exec-'),
  });

  assert.deepEqual(
    mutated,
    [
      { checkId: 'laravel.static-analysis.rewrite-check', role: 'fix' },
      { checkId: 'laravel.format.formatter', role: 'fix' },
    ],
    'Mutation follows the provider-declared order and uses the fix role only.',
  );
  assert.equal(result.operation, 'fix');
  assert.equal(result.mutated, true);
  assert.deepEqual(result.mutations.map(({ outcome }) => outcome), ['applied', 'applied']);

  // The mutation landed in the maintainer's repository, not in a snapshot.
  assert.equal(
    await readFile(path.join(root, SOURCE), 'utf8'),
    'baseline\nproposed\nrector process\npint\n',
  );

  // Only a complete non-mutating evaluation of the resulting snapshot can
  // authorize, and that snapshot is a new one.
  assert.deepEqual(validateDecision(result.reevaluation), []);
  assert.equal(result.reevaluation.outcome, 'passed');
  assert.equal(result.authorization, 'allow');
  assert.equal(result.authorizedBy, result.reevaluation.evaluationId);
  assert.equal(result.newSnapshot, true);
  assert.notEqual(result.reevaluation.snapshot.id, priorDecision.snapshot.id);
  assert.equal(result.supersededEvaluationId, priorDecision.evaluationId);
  assert.deepEqual(result.diagnostics, []);

  // No evaluation, before or after the fix, ever invoked a mutating command.
  assert.deepEqual([...new Set(evaluated.map(({ role }) => role))], ['evaluate']);
  assert.equal(
    evaluated.some(({ args }) => JSON.stringify(args) === JSON.stringify(formatterFix().args)),
    false,
  );
});

test('AC-POL-004: a mutation never authorizes itself and never runs outside the explicit fix operation', async () => {
  const root = await fixtureRepository();
  const { checks, fixPlan } = fixtureChecks();
  const applied = [];
  const executeFix = async ({ checkId, command, repositoryRoot }) => {
    applied.push(checkId);

    await appendFile(path.join(repositoryRoot, SOURCE), `${command.args.join(' ')}\n`, 'utf8');

    return { executed: true, exitCode: 0, durationMs: 1 };
  };

  // An evaluation request never mutates, whatever dependencies it is handed.
  const refused = await runFix(worktreeRequest(root, 'evaluate'), {
    checks,
    fixPlan,
    executeFix,
    execute: async () => ({ executed: true, exitCode: 0, durationMs: 1 }),
    executionRoot: await temporaryDirectory('gate-fix-exec-'),
  });

  assert.deepEqual(applied, []);
  assert.equal(refused.mutated, false);
  assert.equal(refused.reevaluation, null);
  assert.equal(refused.authorization, 'deny');
  assert.equal(refused.authorizedBy, null);
  assert.deepEqual(refused.diagnostics.map(({ reasonCode }) => reasonCode), ['configuration-invalid']);
  assert.equal(await readFile(path.join(root, SOURCE), 'utf8'), 'baseline\nproposed\n');

  // Every mutation applies cleanly, but the reevaluation cannot complete: the
  // fix denies rather than inheriting anything from the mutation itself.
  const unreevaluated = await runFix(worktreeRequest(root, 'fix'), {
    checks,
    fixPlan,
    executeFix,
    executionRoot: await temporaryDirectory('gate-fix-exec-'),
  });

  assert.deepEqual(applied, [
    'laravel.static-analysis.rewrite-check',
    'laravel.format.formatter',
  ]);
  assert.equal(unreevaluated.mutated, true);
  assert.deepEqual(unreevaluated.mutations.map(({ outcome }) => outcome), ['applied', 'applied']);
  assert.equal(unreevaluated.reevaluation.outcome, 'unverified');
  assert.equal(unreevaluated.authorization, 'deny');
  assert.equal(unreevaluated.newSnapshot, false, 'No snapshot was captured, so none was graded.');

  // A failed mutation halts the remaining declared order and still denies.
  const halting = await runFix(worktreeRequest(root, 'fix'), {
    checks,
    fixPlan,
    executeFix: async ({ checkId }) => {
      applied.push(checkId);

      return { executed: true, exitCode: 2, durationMs: 1 };
    },
    execute: async () => ({ executed: true, exitCode: 0, durationMs: 1 }),
    executionRoot: await temporaryDirectory('gate-fix-exec-'),
  });

  assert.deepEqual(halting.mutations.map(({ checkId, outcome }) => [checkId, outcome]), [
    ['laravel.static-analysis.rewrite-check', 'failed'],
    ['laravel.format.formatter', 'not-run'],
  ]);
  assert.equal(halting.halted, true);
  assert.equal(halting.mutated, false);
  assert.equal(
    applied.at(-1),
    'laravel.static-analysis.rewrite-check',
    'The declared order halts at the first failure instead of applying out of order.',
  );

  // The resulting tree is still graded: a halted fix never hides the snapshot
  // it left behind.
  assert.deepEqual(validateDecision(halting.reevaluation), []);
  assert.equal(halting.authorizedBy, halting.reevaluation.evaluationId);
});
