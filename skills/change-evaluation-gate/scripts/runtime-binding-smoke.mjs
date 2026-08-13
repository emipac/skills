#!/usr/bin/env node
/**
 * `gate-runtime-binding-smoke` — served-source binding smoke capability.
 *
 * Proves, against a real local HTTP runtime and a real materialized Evaluation
 * snapshot, that HTTP evidence authorizes a snapshot only when the runtime is
 * proved to serve that snapshot's source:
 *
 * 1. `bound-snapshot-runtime`   — a runtime serving the materialized snapshot
 *                                 proves its binding and can pass.
 * 2. `live-worktree-runtime`    — a runtime still serving the live worktree is
 *                                 `unverified` and denies (SG-EVAL-002).
 * 3. `unprovable-runtime`       — no resolvable runtime, no declared probe, and
 *                                 an unreachable runtime are each `unverified`;
 *                                 absence of evidence is never success.
 *
 * It is non-interactive and offline: every fixture is a throwaway Git
 * repository and a loopback HTTP server on an ephemeral port. It never touches
 * this repository's Git state and requires no external service or framework.
 *
 * Usage:
 *   node skills/change-evaluation-gate/scripts/runtime-binding-smoke.mjs [--json]
 *
 * Exit status is 0 only when every scenario holds.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { evaluate } from './lib/evaluate.mjs';
import { validateDecision } from './lib/evaluation-contract.mjs';

const CAPABILITY = 'gate-runtime-binding-smoke';

const PROBE = 'public/app.txt';

const runFile = promisify(execFile);

const temporaryRoots = [];

const servers = [];

const temporaryDirectory = async (prefix) => {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));

  temporaryRoots.push(directory);

  return directory;
};

const git = (cwd, args) => runFile('git', args, { cwd });

/**
 * A throwaway repository whose staged snapshot and live worktree disagree, so
 * "served the snapshot" and "served the worktree" are distinguishable by
 * content rather than by path.
 */
const divergedRepository = async () => {
  const root = await temporaryDirectory('gate-binding-repo-');

  await mkdir(path.join(root, 'public'), { recursive: true });
  await writeFile(path.join(root, PROBE), 'baseline\n', 'utf8');
  await git(root, ['init', '--quiet']);
  await git(root, ['add', '--all']);
  await git(root, [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Smoke',
    'commit', '--quiet', '--message', 'baseline',
  ]);

  await writeFile(path.join(root, PROBE), 'snapshot\n', 'utf8');
  await git(root, ['add', '--all']);
  await writeFile(path.join(root, PROBE), 'live-worktree\n', 'utf8');

  return root;
};

/** A loopback HTTP runtime serving one directory. */
const serveDirectory = async (directory) => {
  const base = path.resolve(directory);
  const server = createServer((incoming, response) => {
    const relative = decodeURIComponent(
      new URL(incoming.url, 'http://127.0.0.1').pathname,
    ).replace(/^\/+/, '');
    const absolute = path.resolve(base, relative);

    if (absolute !== base && !absolute.startsWith(`${base}${path.sep}`)) {
      response.writeHead(403).end();

      return;
    }

    readFile(absolute).then(
      (body) => response.writeHead(200).end(body),
      () => response.writeHead(404).end(),
    );
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  servers.push(server);

  return `http://127.0.0.1:${server.address().port}`;
};

const browserCheck = () => ({
  id: 'smoke.browser.journey',
  provider: 'smoke',
  stage: 'browser',
  capability: 'journey',
  scope: 'both',
  applicability: { changed_path_globs: ['**'], required_facts: [] },
  prerequisites: [],
  policy: 'required',
  evaluate: {
    runner: 'package-script',
    args: ['test:browser'],
    working_directory: '.',
    timeout_seconds: 60,
    allowed_environment: ['PATH'],
    evidence_category: 'browser',
    source_scope: 'both',
  },
  fix: null,
  timeout_seconds: 120,
  declared_writes: [],
  evidence: { claims: ['browser:journey'], success_exit_codes: [0], report: null },
  order: 10,
  selection: null,
});

const stagedRequest = (root) => ({
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
    sessionId: `${CAPABILITY}-session`,
  },
});

const evaluateWith = async (root, dependencies) => evaluate(stagedRequest(root), {
  checks: [browserCheck()],
  executionRoot: await temporaryDirectory('gate-binding-exec-'),
  runnerVersion: `${CAPABILITY}/1.0.0`,
  providerVersions: { smoke: '1.0.0' },
  ...dependencies,
});

const check = (findings, condition, detail) => {
  if (!condition) {
    findings.push(detail);
  }
};

/** A runtime serving the materialized snapshot proves its binding. */
const boundSnapshotRuntime = async () => {
  const findings = [];
  const root = await divergedRepository();
  const decision = await evaluateWith(root, {
    resolveRuntime: async ({ executionRoot }) => ({
      baseUrl: await serveDirectory(executionRoot),
      probePaths: [PROBE],
    }),
    execute: async () => ({ executed: true, exitCode: 0, durationMs: 1 }),
  });

  check(findings, validateDecision(decision).length === 0, 'The decision envelope is not contract valid.');
  check(findings, decision.outcome === 'passed', `Expected a passed decision, got ${decision.outcome}.`);
  check(findings, decision.authorization === 'allow', `Expected allow, got ${decision.authorization}.`);
  check(findings, decision.integrity.runtimeBinding.proved === true, 'The served-source binding was not proved.');
  check(
    findings,
    decision.integrity.runtimeBinding.snapshotId === decision.snapshot.id,
    'The runtime binding is not bound to the evaluated snapshot identity.',
  );

  return { name: 'bound-snapshot-runtime', ok: findings.length === 0, findings };
};

/** A runtime still serving the live worktree can never authorize. */
const liveWorktreeRuntime = async () => {
  const findings = [];
  const root = await divergedRepository();
  let executed = false;

  const decision = await evaluateWith(root, {
    resolveRuntime: async () => ({
      baseUrl: await serveDirectory(root),
      probePaths: [PROBE],
    }),
    execute: async () => {
      executed = true;

      return { executed: true, exitCode: 0, durationMs: 1 };
    },
  });

  check(findings, validateDecision(decision).length === 0, 'The decision envelope is not contract valid.');
  check(findings, decision.outcome === 'unverified', `Expected unverified, got ${decision.outcome}.`);
  check(findings, decision.authorization === 'deny', `Expected deny, got ${decision.authorization}.`);
  check(findings, executed === false, 'An unbound runtime was allowed to produce HTTP evidence.');
  check(
    findings,
    decision.checks[0].reasonCode === 'snapshot-mismatch',
    `Expected snapshot-mismatch, got ${decision.checks[0].reasonCode}.`,
  );
  check(findings, decision.integrity.runtimeBinding.proved === false, 'An unbound runtime was reported as proved.');
  check(findings, decision.coverage.provedClaims.length === 0, 'An unbound runtime proved a claim.');

  return { name: 'live-worktree-runtime', ok: findings.length === 0, findings };
};

/** Unprovable routing is unverified; absence of evidence is never success. */
const unprovableRuntime = async () => {
  const findings = [];
  const root = await divergedRepository();

  const cases = [
    ['no resolvable runtime', {}],
    ['no declared probe', {
      resolveRuntime: async ({ executionRoot }) => ({
        baseUrl: await serveDirectory(executionRoot),
        probePaths: [],
      }),
    }],
    ['unreachable runtime', {
      resolveRuntime: async () => ({ baseUrl: 'http://127.0.0.1:1/', probePaths: [PROBE] }),
    }],
  ];

  for (const [label, dependencies] of cases) {
    const decision = await evaluateWith(root, {
      execute: async () => ({ executed: true, exitCode: 0, durationMs: 1 }),
      ...dependencies,
    });

    check(findings, validateDecision(decision).length === 0, `${label}: the decision envelope is not contract valid.`);
    check(findings, decision.outcome === 'unverified', `${label}: expected unverified, got ${decision.outcome}.`);
    check(findings, decision.authorization === 'deny', `${label}: expected deny, got ${decision.authorization}.`);
    check(
      findings,
      decision.integrity.runtimeBinding.required === true
        && decision.integrity.runtimeBinding.proved === false,
      `${label}: the runtime binding was not reported as required and unproved.`,
    );
    check(
      findings,
      decision.checks[0].reasonCode === 'prerequisite-missing',
      `${label}: expected prerequisite-missing, got ${decision.checks[0].reasonCode}.`,
    );
  }

  return { name: 'unprovable-runtime', ok: findings.length === 0, findings };
};

const main = async () => {
  const asJson = process.argv.includes('--json');
  let scenarios = [];

  try {
    scenarios = [
      await boundSnapshotRuntime(),
      await liveWorktreeRuntime(),
      await unprovableRuntime(),
    ];
  } finally {
    for (const server of servers) {
      await new Promise((resolve) => server.close(resolve));
    }

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
