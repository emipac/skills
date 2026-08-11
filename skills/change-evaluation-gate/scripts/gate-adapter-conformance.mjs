#!/usr/bin/env node
/**
 * `gate-adapter-conformance` — the supported desktop preflight adapters.
 *
 * Proves, against throwaway Git repositories, a real registered `pre-commit`
 * hook, real `git commit` invocations, and the three supported desktop
 * surfaces driven by their own native payload shapes:
 *
 * 1. `one-decision-four-surfaces` — a real commit is really blocked by
 *    authoritative Git on `deny`, and the *same decision that blocked it*,
 *    read back from disk, presents on Claude Code Desktop, Codex Desktop, and
 *    Cursor as a structured `not-authoritative` preflight result that blocks
 *    nothing and leaves the repository untouched (AC-ADAPT-001, FR-ADAPT-001,
 *    FR-ADAPT-003, FR-ADAPT-007).
 * 2. `supported-desktop-baseline` — every named desktop surface passes the
 *    shared compatibility baseline against a real repository and real Git
 *    despite declaring no native blocking; the exact Gate, Git, Node.js,
 *    client, and operating-system versions and every per-check outcome are
 *    recorded; and an unproved cloud variant or a context without repository,
 *    process, and Git access cannot claim support (AC-ADAPT-002,
 *    FR-ADAPT-002, FR-ADAPT-006, SG-SUPPORT-001, NFR-COMP-001).
 * 3. `failures-are-unverified` — a trust failure, a failed invocation, a
 *    timeout, a capability the surface does not have, and output the contract
 *    rejects each present as `unverified` on every desktop surface, and none of
 *    them is mistakable for a clean preflight (FR-ADAPT-005).
 *
 * NO DESKTOP CLIENT IS REQUIRED. Nothing here launches, probes, or detects
 * Claude Code Desktop, Codex Desktop, or Cursor. Each surface is driven by an
 * injected native payload built from that adapter's own declared field paths,
 * so this capability runs offline on a clean machine with none of those
 * clients installed. Git and this Node runtime are the only external tools.
 *
 * SAFETY: every fixture is a throwaway repository created under the OS
 * temporary directory and removed afterwards. `assertThrowawayRepository`
 * refuses any root that is not under that directory or that lies inside this
 * repository, and is checked again immediately before every removal. This
 * repository's own Git state and hooks are never read, written, or removed.
 *
 * Usage:
 *   node skills/change-evaluation-gate/scripts/gate-adapter-conformance.mjs [--json]
 *
 * Exit status is 0 only when every scenario holds.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { activate, previewActivation } from './lib/activation.mjs';
import {
  DESKTOP_ADAPTER_IDS,
  classifySupport,
  describeAdapter,
  normalizeTrigger,
  presentDecision,
  runAdapterEvaluation,
  runCompatibilityBaseline,
} from './lib/adapters.mjs';
import { openEvidenceStore } from './lib/evidence-store.mjs';
import { evaluate } from './lib/evaluate.mjs';

const CAPABILITY = 'gate-adapter-conformance';

/** This repository. No fixture may ever touch its Git state or its hooks. */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const LIBRARY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'lib');

const ACTIVE_RELEASE = { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' };

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
const gitEnvironment = (extra = {}) => ({
  ...process.env,
  ...extra,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

const git = async (cwd, args, extraEnvironment = {}) => runFile('git', args, {
  cwd,
  env: gitEnvironment(extraEnvironment),
});

const runGit = async (repositoryRoot, args) => (await git(repositoryRoot, args)).stdout;

const commit = (cwd, message, extraEnvironment = {}) => git(cwd, [
  '-c', 'user.email=gate@example.test',
  '-c', `user.name=${CAPABILITY}`,
  'commit', '--quiet', '--message', message,
], extraEnvironment);

const check = (findings, condition, detail) => {
  if (!condition) {
    findings.push(detail);
  }
};

/**
 * The real hook program.
 *
 * Git runs this as `pre-commit`. It reaches a decision through the shared
 * evaluation seam, presents it through the *authoritative Git adapter*, and
 * exits with exactly the status that adapter reports. Nothing here decides
 * anything: the exit status is the adapter's presentation, which is the whole
 * claim of FR-ADAPT-001.
 */
const HOOK_RUNNER = `import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { evaluate } from ${JSON.stringify(path.join(LIBRARY_ROOT, 'evaluate.mjs'))};
import { presentDecision } from ${JSON.stringify(path.join(LIBRARY_ROOT, 'adapters.mjs'))};

const repositoryRoot = process.cwd();
const verdict = process.env.GATE_FIXTURE_VERDICT ?? 'pass';
const outputDirectory = process.env.GATE_FIXTURE_OUT;
const executionRoot = await mkdtemp(path.join(tmpdir(), 'gate-adapter-hook-'));

const decision = await evaluate({
  protocolVersion: '1.0',
  operation: 'evaluate',
  repository: { root: repositoryRoot },
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
    sessionId: String(process.pid),
  },
}, {
  executionRoot,
  checks: [{
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
  }],
  execute: async () => ({
    executed: true,
    exitCode: verdict === 'fail' ? 1 : 0,
    timedOut: false,
    error: null,
    durationMs: 5,
  }),
});

const presented = presentDecision({ adapterId: 'git', decision });

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, 'decision.json'), JSON.stringify(decision), 'utf8');
await writeFile(path.join(outputDirectory, 'presentation.json'), JSON.stringify(presented), 'utf8');

process.exit(presented.exitCode);
`;

const gatePolicy = () => ({
  checks: { required: ['broad_test'], advisory: [] },
  budget: { total_seconds: 600 },
  bypass: { enabled: false, marker: null },
  execution: { budget_skippable: [] },
  evidence: {},
});

/**
 * The activation request. Every v1 adapter is selected, so activation
 * self-tests and registers the authoritative Git adapter and all three
 * supported desktop preflight adapters as one all-or-nothing set.
 */
const activationRequest = (root) => ({
  scope: 'repository',
  trigger: 'explicit',
  repository: { root },
  configuration: { schemaVersion: 4, policy: gatePolicy() },
  client: { id: 'git', surface: 'git-pre-commit', version: '1.0.0' },
  gate: { ...ACTIVE_RELEASE },
  actor: { name: CAPABILITY, source: 'fixture' },
  runtime: {
    runnerVersion: 'change-evaluation-gate/0.9.0',
    hookProgram: { interpreter: process.execPath, script: 'tools/gate-runner.mjs', args: [] },
  },
  checks: [{
    id: 'broad_test',
    evaluate: {
      runner: 'repository-script',
      args: ['tools/check.mjs'],
      working_directory: '.',
      timeout_seconds: 60,
      allowed_environment: ['PATH'],
      evidence_category: 'test',
      source_scope: 'backend',
    },
  }],
  adapters: [
    { id: 'git', version: describeAdapter('git').version, authoritative: true },
    ...DESKTOP_ADAPTER_IDS.map((id) => ({
      id,
      version: describeAdapter(id).version,
      authoritative: false,
    })),
  ],
  runtimeInputs: [],
});

const storeFor = async (root) => openEvidenceStore({
  repositoryRoot: root,
  runGit,
  identity: {
    actor: { name: CAPABILITY, source: 'fixture' },
    client: { id: 'git', surface: 'git-pre-commit', version: '1.0.0' },
    gate: { ...ACTIVE_RELEASE },
    repository: { identity: `sha256:${'0'.repeat(64)}` },
  },
});

const selfTested = [];

const activationDependencies = (overrides = {}) => ({
  runGit,
  resolveExecutable: (runner) => (
    runner === 'repository-script'
      ? { executable: process.execPath, version: process.versions.node }
      : { executable: `/usr/bin/${runner}`, version: '1.0.0' }
  ),
  establishTrust: async () => ({
    established: true,
    grantedBy: CAPABILITY,
    at: new Date().toISOString(),
  }),
  selfTestEvaluation: async () => ({ ok: true, detail: 'the evaluation process reached a decision' }),
  selfTestAdapter: async (adapter) => {
    selfTested.push(adapter.id);

    return { ok: true, detail: `${adapter.id} responded` };
  },
  ...overrides,
});

/** A throwaway clone with the real hook program in it, activated for real. */
const activatedClone = async () => {
  const root = await temporaryDirectory(`${CAPABILITY}-repo-`);

  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/gate-runner.mjs'), HOOK_RUNNER, 'utf8');
  await writeFile(path.join(root, 'tools/check.mjs'), 'process.exitCode = 0;\n', 'utf8');
  await writeFile(path.join(root, 'source.txt'), 'baseline\n', 'utf8');
  await git(root, ['init', '--quiet']);
  await git(root, ['add', '--all']);
  await commit(root, 'baseline');

  const store = await storeFor(root);

  await assertThrowawayRepository(root);

  const request = activationRequest(root);
  const preview = await previewActivation(request, activationDependencies());
  const result = await activate({
    ...request,
    consent: {
      previewId: preview.previewId,
      repositoryIdentity: preview.repository.identity,
      configurationIdentity: preview.configuration.identity,
      actor: { name: CAPABILITY, source: 'fixture' },
      grantedAt: new Date().toISOString(),
    },
  }, activationDependencies({ evidenceStore: store }));

  if (result.activated !== true) {
    throw new Error(`${CAPABILITY} could not activate its fixture: ${result.reasonCode}.`);
  }

  return { root, store, receipt: result.receipt };
};

/**
 * Scenario 1. One decision, four surfaces, one real commit.
 */
const oneDecisionFourSurfaces = async () => {
  const findings = [];
  const { root } = await activatedClone();
  const outputDirectory = await temporaryDirectory(`${CAPABILITY}-out-`);

  check(
    findings,
    ['git', ...DESKTOP_ADAPTER_IDS].every((id) => selfTested.includes(id)),
    `Activation did not self-test every selected adapter; it tested ${JSON.stringify(selfTested)}.`,
  );

  await writeFile(path.join(root, 'source.txt'), 'changed by the fixture\n', 'utf8');
  await git(root, ['add', '--all']);

  // A real commit, against a real registered hook, with a denying decision.
  let blocked = false;

  try {
    await commit(root, 'this commit must be refused', {
      GATE_FIXTURE_VERDICT: 'fail',
      GATE_FIXTURE_OUT: outputDirectory,
    });
  } catch (error) {
    blocked = error.code !== 0;
  }

  check(findings, blocked, 'Authoritative Git did not block a commit on a deny decision.');

  const headAfterDeny = (await runGit(root, ['rev-list', '--count', 'HEAD'])).trim();

  check(findings, headAfterDeny === '1', `A blocked commit still landed: HEAD holds ${headAfterDeny} commits.`);

  const decision = JSON.parse(await readFile(path.join(outputDirectory, 'decision.json'), 'utf8'));
  const gitPresentation = JSON.parse(await readFile(path.join(outputDirectory, 'presentation.json'), 'utf8'));

  check(findings, decision.outcome === 'failed', `The blocking decision was ${decision.outcome}.`);
  check(findings, gitPresentation.authorization === 'deny', 'The Git surface did not present a deny.');
  check(findings, gitPresentation.blocking === true, 'The Git surface did not report that it blocked.');
  check(findings, gitPresentation.presentation.kind === 'blocked', 'The Git surface presented the wrong result kind.');

  // The SAME decision, on every supported desktop surface.
  for (const adapterId of DESKTOP_ADAPTER_IDS) {
    const view = presentDecision({ adapterId, decision });

    check(findings, view.role === 'preflight', `${adapterId} claimed an authoritative role.`);
    check(
      findings,
      view.authorization === 'not-authoritative',
      `${adapterId} presented ${view.authorization} instead of not-authoritative.`,
    );
    check(findings, view.blocking === false, `${adapterId} blocked something.`);
    check(findings, view.exitCode === 0, `${adapterId} failed its host process.`);
    check(findings, view.presentation.kind === 'preflight', `${adapterId} presented the wrong result kind.`);
    check(
      findings,
      view.presentation.evaluationId === decision.evaluationId,
      `${adapterId} presented a different evaluation from the one that blocked the commit.`,
    );
    check(
      findings,
      JSON.stringify(view.presentation.checks.map((entry) => [entry.id, entry.outcome, entry.reasonCode]))
        === JSON.stringify(decision.checks.map((entry) => [entry.id, entry.outcome, entry.reasonCode])),
      `${adapterId} did not present the decision's own structured checks.`,
    );

    // Each surface normalizes its own event, and only its own.
    check(
      findings,
      normalizeTrigger({ adapterId, nativeEvent: describeAdapter(adapterId).nativeEvents['work-complete'] })
        === 'work-complete',
      `${adapterId} did not normalize its declared completion event to work-complete.`,
    );
  }

  const headAfterPreflight = (await runGit(root, ['rev-list', '--count', 'HEAD'])).trim();

  check(
    findings,
    headAfterPreflight === headAfterDeny,
    'Presenting a preflight result changed the repository.',
  );

  // The same activated clone, the same hook, a passing decision: the commit
  // really lands. Blocking is the decision's doing, not the hook's.
  let allowed = true;

  try {
    await commit(root, 'this commit must be allowed', {
      GATE_FIXTURE_VERDICT: 'pass',
      GATE_FIXTURE_OUT: outputDirectory,
    });
  } catch {
    allowed = false;
  }

  check(findings, allowed, 'Authoritative Git blocked a commit on a passing decision.');

  const allowedPresentation = JSON.parse(
    await readFile(path.join(outputDirectory, 'presentation.json'), 'utf8'),
  );

  check(findings, allowedPresentation.authorization === 'allow', 'A passing decision did not authorize the commit.');

  return { name: 'one-decision-four-surfaces', ok: findings.length === 0, findings };
};

/**
 * Scenario 2. The shared compatibility baseline and the support tiers.
 */
const supportedDesktopBaseline = async () => {
  const findings = [];
  const root = await temporaryDirectory(`${CAPABILITY}-baseline-`);
  const executionRoot = await temporaryDirectory(`${CAPABILITY}-exec-`);

  await writeFile(path.join(root, 'source.txt'), 'baseline\n', 'utf8');
  await git(root, ['init', '--quiet']);
  await git(root, ['add', '--all']);
  await commit(root, 'baseline');

  const dependencies = {
    evaluate: async (request) => evaluate(request, {
      executionRoot,
      checks: [],
      execute: async () => ({ executed: true, exitCode: 0, timedOut: false, error: null, durationMs: 1 }),
    }),
    runGit: async (args) => (await runGit(root, args)).trim(),
    versions: {
      gate: `change-evaluation-gate/${ACTIVE_RELEASE.version}`,
      node: process.version,
      os: `${process.platform} ${process.arch}`,
      // The exact client version this run is evidence for. It is a snapshot of
      // what was tested, never a permanent allowlist (Q-004).
      client: 'fixture/1.0.0',
    },
    clock: () => new Date(),
  };

  const localCapabilities = { repositoryFilesystem: true, processExecution: true, git: true };
  const recorded = [];

  for (const adapterId of DESKTOP_ADAPTER_IDS) {
    const baseline = await runCompatibilityBaseline({ adapterId, repositoryRoot: root }, dependencies);

    check(
      findings,
      baseline.passed === true,
      `${adapterId} failed the shared baseline: ${JSON.stringify(baseline.failedChecks)}.`,
    );
    check(
      findings,
      describeAdapter(adapterId).capabilities.blocking.native === false,
      `${adapterId} unexpectedly declares native blocking.`,
    );

    for (const field of ['gate', 'git', 'node', 'os', 'client']) {
      check(
        findings,
        typeof baseline.versions[field] === 'string' && baseline.versions[field].length > 0,
        `${adapterId} recorded no exact ${field} version.`,
      );
    }

    const supported = classifySupport({
      adapterId,
      variant: 'desktop',
      capabilities: localCapabilities,
      baseline,
    });

    check(
      findings,
      supported.tier === 'supported',
      `${adapterId} passed its baseline but was classified ${supported.tier}.`,
    );

    // SG-SUPPORT-001: without the evidence, the same surface is not supported.
    check(
      findings,
      classifySupport({ adapterId, variant: 'desktop', capabilities: localCapabilities, baseline: null }).tier
        === 'experimental',
      `${adapterId} claimed support without a baseline run.`,
    );

    // FR-ADAPT-006: unproved variants and hosted contexts.
    for (const variant of ['cli', 'ssh', 'remote', 'cloud', 'background-agent']) {
      check(
        findings,
        classifySupport({ adapterId, variant, capabilities: localCapabilities, baseline }).tier === 'experimental',
        `${adapterId} claimed support for its unproved ${variant} variant.`,
      );
    }

    check(
      findings,
      classifySupport({
        adapterId,
        variant: 'desktop',
        capabilities: { repositoryFilesystem: false, processExecution: false, git: false },
        baseline,
      }).tier === 'unsupported',
      `${adapterId} claimed support for a chat-only or hosted context.`,
    );

    recorded.push({
      adapterId,
      surface: baseline.surface,
      tier: supported.tier,
      versions: baseline.versions,
      checks: baseline.checks.map((entry) => ({ id: entry.id, ok: entry.ok })),
      recordedAt: baseline.recordedAt,
    });
  }

  return {
    name: 'supported-desktop-baseline',
    ok: findings.length === 0,
    findings,
    // AC-ADAPT-002: the exact versions and outcomes, recorded per surface.
    compatibility: recorded,
  };
};

/**
 * Scenario 3. Every defined failure is `unverified` on every desktop surface.
 */
const failuresAreUnverified = async () => {
  const findings = [];
  const root = await temporaryDirectory(`${CAPABILITY}-failure-`);
  const executionRoot = await temporaryDirectory(`${CAPABILITY}-failure-exec-`);

  await writeFile(path.join(root, 'source.txt'), 'baseline\n', 'utf8');
  await git(root, ['init', '--quiet']);
  await git(root, ['add', '--all']);
  await commit(root, 'baseline');

  const context = {
    change: { kind: 'worktree', baseRevision: 'HEAD' },
    evaluation: { purpose: 'regression-only', contractRef: null },
  };

  const healthyEvaluate = async (request) => evaluate(request, {
    executionRoot,
    checks: [],
    execute: async () => ({ executed: true, exitCode: 0, timedOut: false, error: null, durationMs: 1 }),
  });

  for (const adapterId of DESKTOP_ADAPTER_IDS) {
    const adapter = describeAdapter(adapterId);
    const nativeFor = (event, sessionId) => {
      const payload = {};
      const write = (dotted, value) => {
        const segments = dotted.split('.');
        const leaf = segments.pop();
        const container = segments.reduce((node, segment) => {
          node[segment] = node[segment] ?? {};

          return node[segment];
        }, payload);

        container[leaf] = value;
      };

      write(adapter.nativeIdentity.event, event);
      write(adapter.nativeIdentity.repositoryRoot, root);
      write(adapter.nativeIdentity.sessionId, sessionId);

      return payload;
    };

    const declaredEvent = adapter.nativeEvents['work-complete'];
    const healthy = await runAdapterEvaluation(
      { adapterId, native: nativeFor(declaredEvent, 'conformance-healthy'), context },
      { evaluate: healthyEvaluate, establishTrust: async () => ({ established: true }) },
    );

    check(
      findings,
      healthy.outcome === 'passed' && healthy.presentation.kind === 'preflight' && healthy.failure === null,
      `${adapterId} could not produce a clean preflight to contrast failures against.`,
    );

    const families = [
      ['trust', 'prerequisite-missing', declaredEvent, {
        evaluate: healthyEvaluate,
        establishTrust: async () => ({ established: false, detail: 'the grant was revoked' }),
      }],
      ['invocation', 'crash', declaredEvent, {
        establishTrust: async () => ({ established: true }),
        evaluate: async () => {
          throw new Error('spawn gate ENOENT');
        },
      }],
      ['timeout', 'timeout', declaredEvent, {
        establishTrust: async () => ({ established: true }),
        timeoutMs: 5,
        evaluate: () => new Promise(() => {}),
      }],
      ['capability', 'configuration-invalid', 'surface.event-this-client-does-not-have', {
        establishTrust: async () => ({ established: true }),
        evaluate: healthyEvaluate,
      }],
      ['output', 'malformed-output', declaredEvent, {
        establishTrust: async () => ({ established: true }),
        evaluate: async () => ({ verdict: 'looks fine to me' }),
      }],
    ];

    for (const [family, reasonCode, event, dependencies] of families) {
      const result = await runAdapterEvaluation(
        { adapterId, native: nativeFor(event, `conformance-${family}`), context },
        dependencies,
      );

      check(
        findings,
        result.outcome === 'unverified',
        `${adapterId} reported ${result.outcome} for a ${family} failure.`,
      );
      check(
        findings,
        result.failure?.family === family && result.failure?.reasonCode === reasonCode,
        `${adapterId} classified its ${family} failure as ${JSON.stringify(result.failure)}.`,
      );
      check(
        findings,
        result.presentation.kind === 'unverified',
        `${adapterId} presented a ${family} failure as ${result.presentation.kind}.`,
      );
      check(
        findings,
        result.blocking === false && result.authorization === 'not-authoritative',
        `${adapterId} claimed authority while failing.`,
      );
    }
  }

  return { name: 'failures-are-unverified', ok: findings.length === 0, findings };
};

const main = async () => {
  const asJson = process.argv.includes('--json');
  let scenarios = [];

  try {
    scenarios = [
      await oneDecisionFourSurfaces(),
      await supportedDesktopBaseline(),
      await failuresAreUnverified(),
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
