#!/usr/bin/env node
/**
 * `gate-fix-smoke` — explicit-fix smoke capability.
 *
 * Proves, against real spawned processes and a real materialized Evaluation
 * snapshot, that mutation is reachable only through the explicit fix operation
 * and that only a new evaluation of the resulting snapshot can authorize it:
 *
 * 1. `check-only-evaluation` — a descriptor offering a declared mutating
 *    command as its evaluation command is rejected before anything runs, and
 *    the repository is left untouched (AC-POL-004).
 * 2. `ordered-fix-and-reevaluation` — the explicit fix applies the declared
 *    mutations in the provider-declared order, the repository really changes,
 *    and a complete non-mutating evaluation of the resulting new snapshot
 *    authorizes it (AC-PROF-005).
 * 3. `mutation-never-self-authorizes` — a fix whose reevaluation fails denies,
 *    however cleanly every mutation applied, and the superseded decision never
 *    authorizes the mutated tree (AC-POL-004).
 *
 * It is non-interactive and offline. Every fixture is a throwaway Git
 * repository, every command is a repository script executed by this Node
 * runtime, and no PHP, Composer, or framework toolchain is required or
 * consulted. It never touches this repository's Git state.
 *
 * Usage:
 *   node skills/change-evaluation-gate/scripts/gate-fix-smoke.mjs [--json]
 *
 * Exit status is 0 only when every scenario holds.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createBoundedExecutor } from './lib/bounded-execution.mjs';
import { evaluate } from './lib/evaluate.mjs';
import { validateDecision } from './lib/evaluation-contract.mjs';
import { runFix } from './lib/fix.mjs';
import { collectChecks } from './lib/gate-core.mjs';
import laravelProvider from './lib/providers/laravel.mjs';

const CAPABILITY = 'gate-fix-smoke';

const SOURCE = 'app/Order.php';

const runFile = promisify(execFile);

const temporaryRoots = [];

const temporaryDirectory = async (prefix) => {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));

  temporaryRoots.push(directory);

  return directory;
};

const git = (cwd, args) => runFile('git', args, { cwd });

/**
 * Two repository scripts stand in for a stack's check-only and mutating tools.
 *
 * `check.mjs` reads the source it is run against and fails when the marker it
 * requires is absent; `apply.mjs` appends that marker. Both resolve the source
 * relative to their working directory, so a check genuinely grades whichever
 * tree it was pointed at — the materialized snapshot for evaluation, the
 * maintainer's repository for a fix — and the applied order is readable from
 * the resulting file rather than from the harness that called them.
 */
const CHECK_SCRIPT = [
  'import { readFile } from \'node:fs/promises\';',
  '',
  'const contents = await readFile(process.argv[2], \'utf8\').catch(() => \'\');',
  '',
  'process.exit(contents.split(\'\\n\').includes(process.argv[3]) ? 0 : 1);',
  '',
].join('\n');

const APPLY_SCRIPT = [
  'import { appendFile } from \'node:fs/promises\';',
  '',
  'await appendFile(process.argv[2], `${process.argv[3]}\\n`, \'utf8\');',
  '',
].join('\n');

/** A throwaway repository whose worktree carries the change under evaluation. */
const fixtureRepository = async () => {
  const root = await temporaryDirectory('gate-fix-smoke-repo-');

  await mkdir(path.join(root, 'app'), { recursive: true });
  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/check.mjs'), CHECK_SCRIPT, 'utf8');
  await writeFile(path.join(root, 'tools/apply.mjs'), APPLY_SCRIPT, 'utf8');
  await writeFile(path.join(root, SOURCE), 'baseline\n', 'utf8');
  await git(root, ['init', '--quiet']);
  await git(root, ['add', '--all']);
  await git(root, [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Fix Smoke',
    'commit', '--quiet', '--message', 'baseline',
  ]);
  await writeFile(path.join(root, SOURCE), 'baseline\nproposed\n', 'utf8');

  return root;
};

const repositoryScript = (script, marker, category) => ({
  runner: 'repository-script',
  args: [script, SOURCE, marker],
  working_directory: '.',
  timeout_seconds: 30,
  allowed_environment: ['PATH'],
  evidence_category: category,
  source_scope: 'backend',
});

const checkCommand = (marker, category) => repositoryScript('tools/check.mjs', marker, category);

const fixCommand = (marker, category) => repositoryScript('tools/apply.mjs', marker, category);

/** Proved facts for a repository whose style and rewrite tooling are scripts. */
const provedFacts = ({ unfixableBroadTest = false } = {}) => ({
  scopes: { backend: ['app'], frontend: [] },
  proved: {
    format: {
      evaluate: checkCommand('formatted', 'format'),
      fix: fixCommand('formatted', 'format'),
    },
    rewrite_check: {
      evaluate: checkCommand('rewritten', 'static_analysis'),
      fix: fixCommand('rewritten', 'static_analysis'),
    },
    // A required check no declared mutation can satisfy: fixing style never
    // makes a failing suite pass.
    ...(unfixableBroadTest
      ? { broad_test: { evaluate: checkCommand('never-applied', 'test') } }
      : {}),
  },
});

const request = (root, operation) => ({
  protocolVersion: '1.0',
  operation,
  repository: { root },
  change: { kind: 'worktree', baseRevision: 'HEAD' },
  evaluation: { purpose: 'regression-only', contractRef: null },
  invocation: {
    role: 'authoritative',
    trigger: 'work-complete',
    adapter: {
      id: 'git',
      surface: 'git-pre-commit',
      version: '1.0.0',
      capabilities: { nativeBlocking: true },
    },
    sessionId: `${CAPABILITY}-session`,
  },
});

/**
 * Bind the logical `repository-script` runner to this Node runtime. Resolution
 * is an activation-time fact supplied by the caller; nothing here looks a
 * command up in a shell.
 */
const boundExecutor = () => createBoundedExecutor({
  resolveExecutable: (command) => (
    command.runner === 'repository-script' ? { executable: process.execPath } : null
  ),
});

/** Adapt the bounded executor to the mutating seam, which runs in the repository. */
const mutatingSeam = () => {
  const executor = boundExecutor();

  return ({ command, repositoryRoot, timeoutSeconds }) => executor.execute({
    command,
    executionRoot: repositoryRoot,
    timeoutSeconds,
  });
};

const evaluationDependencies = async () => ({
  executionRoot: await temporaryDirectory('gate-fix-smoke-exec-'),
  runnerVersion: `${CAPABILITY}/1.0.0`,
  providerVersions: { laravel: '1.0.0' },
  resolvePrerequisite: () => true,
  execute: boundExecutor().execute,
});

const check = (findings, condition, detail) => {
  if (!condition) {
    findings.push(detail);
  }
};

const resolved = (options) => {
  const collected = collectChecks([{ provider: laravelProvider, facts: provedFacts(options) }]);

  return { checks: collected.checks, fixPlan: collected.fix_plan };
};

/** A mutating command in the check-only slot is refused before anything runs. */
const checkOnlyEvaluation = async () => {
  const findings = [];
  const root = await fixtureRepository();
  const { checks } = resolved();
  const smuggled = checks.map((entry) => (
    entry.id === 'laravel.format.formatter' ? { ...entry, evaluate: entry.fix } : entry
  ));

  const decision = await evaluate(request(root, 'evaluate'), {
    ...await evaluationDependencies(),
    checks: smuggled,
  });

  check(findings, validateDecision(decision).length === 0, 'The decision envelope is not contract valid.');
  check(findings, decision.outcome === 'unverified', `Expected unverified, got ${decision.outcome}.`);
  check(findings, decision.authorization === 'deny', `Expected deny, got ${decision.authorization}.`);
  check(
    findings,
    decision.diagnostics.some(({ reasonCode }) => reasonCode === 'configuration-invalid'),
    'The rejection was not reported as invalid configuration.',
  );
  check(findings, decision.checks.length === 0, 'A rejected binding still graded a check.');
  check(
    findings,
    await readFile(path.join(root, SOURCE), 'utf8') === 'baseline\nproposed\n',
    'Evaluation changed the repository.',
  );

  return { name: 'check-only-evaluation', ok: findings.length === 0, findings };
};

/** Explicit fix mutates in declared order and a new evaluation authorizes it. */
const orderedFixAndReevaluation = async () => {
  const findings = [];
  const root = await fixtureRepository();
  const { checks, fixPlan } = resolved();
  const target = path.join(root, SOURCE);

  // Nothing has been rewritten or formatted yet, so the check-only evaluation
  // of the proposed snapshot fails and there is something for the fix to do.
  const before = await evaluate(request(root, 'evaluate'), {
    ...await evaluationDependencies(),
    checks,
  });

  check(findings, before.outcome === 'failed', `Expected a failed pre-fix decision, got ${before.outcome}.`);

  const result = await runFix(request(root, 'fix'), {
    ...await evaluationDependencies(),
    checks,
    fixPlan,
    priorDecision: before,
    executeFix: mutatingSeam(),
  });

  check(
    findings,
    JSON.stringify(result.ordered) === JSON.stringify([
      'laravel.static-analysis.rewrite-check',
      'laravel.format.formatter',
    ]),
    `The declared fix order was not honored: ${JSON.stringify(result.ordered)}.`,
  );
  check(
    findings,
    await readFile(target, 'utf8') === 'baseline\nproposed\nrewritten\nformatted\n',
    'The declared mutations did not reach the repository in their declared order.',
  );
  check(findings, result.mutated === true, 'The explicit fix reported no mutation.');
  check(findings, result.halted === false, 'The explicit fix halted unexpectedly.');
  check(
    findings,
    validateDecision(result.reevaluation).length === 0,
    'The post-fix decision envelope is not contract valid.',
  );
  check(
    findings,
    result.reevaluation.outcome === 'passed',
    `Expected a passed reevaluation, got ${result.reevaluation.outcome}.`,
  );
  check(findings, result.authorization === 'allow', `Expected allow, got ${result.authorization}.`);
  check(
    findings,
    result.authorizedBy === result.reevaluation.evaluationId,
    'Authorization did not come from the post-fix evaluation.',
  );
  check(findings, result.newSnapshot === true, 'The fix did not produce a new evaluated snapshot.');
  check(
    findings,
    result.reevaluation.snapshot.id !== before.snapshot.id,
    'The post-fix decision names the pre-fix snapshot.',
  );
  check(
    findings,
    result.supersededEvaluationId === before.evaluationId,
    'The superseded decision was not recorded.',
  );

  return { name: 'ordered-fix-and-reevaluation', ok: findings.length === 0, findings };
};

/** A mutation never carries its own authorization. */
const mutationNeverSelfAuthorizes = async () => {
  const findings = [];
  const root = await fixtureRepository();
  const { checks, fixPlan } = resolved({ unfixableBroadTest: true });
  const target = path.join(root, SOURCE);

  // Every declared mutation applies cleanly, but a required check no mutation
  // can satisfy still fails, so the resulting snapshot is not authorized.
  const result = await runFix(request(root, 'fix'), {
    ...await evaluationDependencies(),
    checks,
    fixPlan,
    executeFix: mutatingSeam(),
  });

  check(
    findings,
    result.mutations.every(({ outcome }) => outcome === 'applied'),
    `Not every declared mutation applied: ${JSON.stringify(result.mutations)}.`,
  );
  check(findings, result.reevaluation.outcome === 'failed', `Expected a failed reevaluation, got ${result.reevaluation.outcome}.`);
  check(findings, result.authorization === 'deny', `Expected deny, got ${result.authorization}.`);

  // An evaluation request never mutates, whatever dependencies it is handed.
  const before = await readFile(target, 'utf8');
  const refused = await runFix(request(root, 'evaluate'), {
    ...await evaluationDependencies(),
    checks,
    fixPlan,
    executeFix: mutatingSeam(),
  });

  check(findings, refused.mutated === false, 'A non-fix operation mutated the repository.');
  check(findings, refused.reevaluation === null, 'A refused fix still produced a decision.');
  check(findings, refused.authorization === 'deny', `Expected deny, got ${refused.authorization}.`);
  check(findings, await readFile(target, 'utf8') === before, 'A non-fix operation changed the repository.');

  return { name: 'mutation-never-self-authorizes', ok: findings.length === 0, findings };
};

const main = async () => {
  const asJson = process.argv.includes('--json');
  let scenarios = [];

  try {
    scenarios = [
      await checkOnlyEvaluation(),
      await orderedFixAndReevaluation(),
      await mutationNeverSelfAuthorizes(),
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
