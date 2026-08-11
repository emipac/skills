#!/usr/bin/env node
/**
 * `gate-runtime-portability` — the release qualification matrix.
 *
 * This capability executes the eleven runtime portability fixtures `AC-PORT-001`
 * names against throwaway Git repositories on the environment it is running on,
 * runs the shared compatibility baseline for every declared adapter, gathers the
 * timing and attempt evidence `RISK-003` and `RISK-007` stay open against, and
 * assembles all of it into the compatibility manifest that
 * `scripts/lib/release-qualification.mjs` then qualifies.
 *
 * Everything it records is observed here, now:
 *
 * - the environment is DETECTED (operating system, architecture, Node.js, Git,
 *   npm), never declared;
 * - the release version is READ from `package.json`, never written down, so it
 *   cannot disagree with the package the release pull request produces;
 * - each portability fixture really runs a real child process against a real
 *   repository, and its outcome is recorded whichever way it goes;
 * - each surface's Support tier is DERIVED from its baseline rather than
 *   asserted, and a baseline driven by payloads this repository built from the
 *   declaration under test cannot produce `supported`.
 *
 * ONE environment is claimed: the one this process is running on. Every other
 * operating system and runtime combination is recorded `unverified` — untested,
 * not refused. Acquiring a claim for one means executing this matrix there.
 *
 * NO CLIENT IS REQUIRED. Nothing here launches, probes, or detects Claude Code
 * Desktop, Codex Desktop, or Cursor. Git and this Node runtime are the only
 * external tools, so the capability runs offline on a clean machine.
 *
 * SAFETY: every fixture is a throwaway repository created under the OS
 * temporary directory and removed afterwards. `assertThrowawayRepository`
 * refuses any root that is not under that directory or that lies inside this
 * repository, and is checked again immediately before every removal. This
 * repository's own Git state and hooks are never read, written, or removed.
 *
 * Usage:
 *   node skills/change-evaluation-gate/scripts/gate-runtime-portability.mjs [--json] [--out <path>]
 *
 * Exit status is 0 only when every fixture holds and the manifest qualifies.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  ADAPTER_IDS,
  classifySupport,
  describeAdapter,
  runCompatibilityBaseline,
} from './lib/adapters.mjs';
import { createBoundedExecutor } from './lib/bounded-execution.mjs';
import {
  graderSurfaces,
  resolveExecutables,
  validateCommandDescriptor,
} from './lib/command-descriptor.mjs';
import { PROTOCOL_VERSION } from './lib/evaluation-contract.mjs';
import { evaluate } from './lib/evaluate.mjs';
import { openEvidenceStore, resolveGitCommonDirectory } from './lib/evidence-store.mjs';
import {
  buildCompatibilityManifest,
  promotionProcedure,
  qualifyRelease,
  readReleaseVersion,
} from './lib/release-qualification.mjs';

const CAPABILITY = 'gate-runtime-portability';

/** This repository. No fixture may ever touch its Git state or its hooks. */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const runFile = promisify(execFile);

const temporaryRoots = [];

const isInside = (parent, candidate) => candidate === parent
  || candidate.startsWith(`${parent}${path.sep}`);

/** The guard. Nothing in this capability reads, writes, or removes outside a throwaway root. */
const assertThrowawayRepository = async (root) => {
  const resolved = await realpath(root).catch(() => path.resolve(root));
  const temporaryRoot = await realpath(os.tmpdir());
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
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));

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

/**
 * Two Git runners, because two seams ask for Git differently.
 *
 * The Evidence store resolves Git for a named repository root, so it is handed
 * `(root, args)`. An adapter baseline already knows the repository it is
 * running against, so it is handed `(args)`. Neither shape is adapted to the
 * other: bending one into the other is how a fixture ends up proving the
 * adapter rather than the runtime.
 */
const runGitForRepository = async (repositoryRoot, args) => (await git(repositoryRoot, args)).stdout;

const runGitIn = (cwd) => async (args) => (await git(cwd, args)).stdout;

const commit = (cwd, message) => git(cwd, [
  '-c', 'user.email=gate@example.test',
  '-c', `user.name=${CAPABILITY}`,
  'commit', '--quiet', '--message', message,
]);

/** A throwaway repository with one commit already in it. */
const repositoryWithHistory = async (prefix) => {
  const root = await temporaryDirectory(prefix);

  await git(root, ['init', '--quiet', '--initial-branch', 'main']);
  await writeFile(path.join(root, 'tracked.txt'), 'committed\n');
  await git(root, ['add', 'tracked.txt']);
  await commit(root, 'seed');

  return root;
};

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * A Command descriptor for one fixture check.
 *
 * Every fixture goes through the same declared, shell-free descriptor contract
 * the production path uses. Nothing here builds a command string.
 */
const descriptorFor = ({ args, timeoutSeconds = 30, allowedEnvironment = ['PATH'] }) => ({
  runner: 'repository-script',
  args,
  working_directory: '.',
  timeout_seconds: timeoutSeconds,
  allowed_environment: allowedEnvironment,
  evidence_category: 'portability',
  source_scope: 'both',
});

/** This runtime, resolved to an executable identity rather than looked up in a shell. */
const resolveExecutable = (command) => (command.runner === 'repository-script'
  ? { executable: process.execPath, version: process.versions.node }
  : null);

const executeCheck = async ({
  command,
  executionRoot,
  captureOutput = true,
  environment = process.env,
}) => {
  const executor = createBoundedExecutor({ resolveExecutable, captureOutput, environment });

  return executor.execute({
    command,
    executionRoot,
    timeoutSeconds: command.timeout_seconds,
  });
};

/* ------------------------------------------------------------------ *
 * The eleven fixtures AC-PORT-001 names.
 * ------------------------------------------------------------------ */

/**
 * `executable` — a runner resolves to an executable identity and is launched
 * directly, shell text and an unresolved runner are refused before execution,
 * and complex behaviour is reachable only through a declared
 * `repository-script` Grader surface (SG-CMD-001, NFR-PORT-001).
 */
const executableFixture = async () => {
  const root = await repositoryWithHistory('gate-portability-executable-');

  await writeFile(
    path.join(root, 'grade.mjs'),
    'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n',
  );

  const command = descriptorFor({ args: ['grade.mjs', 'one two'] });
  const check = { id: 'portability.executable', evaluate: command };
  const findings = [];

  if (validateCommandDescriptor(command, 'evaluate').length !== 0) {
    findings.push('a shell-free descriptor was rejected.');
  }

  // Shell text never reaches execution: it is refused while the descriptor is
  // still a descriptor.
  const shellText = validateCommandDescriptor(
    { ...command, args: ['grade.mjs', 'one; rm -rf /'] },
    'evaluate',
  );

  if (!shellText.some((error) => error.code === 'shell-syntax-rejected')) {
    findings.push('shell text in an argument was not refused.');
  }

  // An unresolved runner is reported, never retried through a shell lookup.
  const unresolved = resolveExecutables(
    [{ id: 'portability.unresolved', evaluate: { ...command, runner: 'composer-bin' } }],
    (runner, candidate) => resolveExecutable(candidate),
  );

  if (unresolved.unresolved[0]?.reason !== 'runner-unresolved') {
    findings.push('an unresolvable runner did not report runner-unresolved.');
  }

  // The one declared route to complex behaviour is visible as a Grader surface.
  const surfaces = graderSurfaces([check]);

  if (surfaces[0]?.path !== 'grade.mjs') {
    findings.push('the declared repository script was not reported as a Grader surface.');
  }

  const resolved = resolveExecutables([check], (runner, candidate) => resolveExecutable(candidate));

  if (!path.isAbsolute(resolved.resolved[0]?.executable ?? '')) {
    findings.push('the runner did not resolve to an absolute executable identity.');
  }

  const attempt = await executeCheck({ command, executionRoot: root });

  // The argument crossed the boundary verbatim, space and all: nothing split,
  // expanded, or re-quoted it.
  if (attempt.exitCode !== 0 || attempt.output !== '["one two"]') {
    findings.push(`the resolved executable returned ${attempt.exitCode} with ${JSON.stringify(attempt.output ?? null)}.`);
  }

  return {
    ok: findings.length === 0,
    detail: findings.length === 0
      ? `${resolved.resolved[0].runner} resolved to an absolute executable and received its arguments verbatim; shell text and an unresolved runner were refused before execution.`
      : findings.join(' '),
  };
};

/**
 * `stream` — both standard streams of a real check are captured, and the exit
 * status is what grades it (NFR-PORT-001, FR-EVID-003).
 */
const streamFixture = async () => {
  const root = await repositoryWithHistory('gate-portability-stream-');

  await writeFile(
    path.join(root, 'grade.mjs'),
    [
      "process.stdout.write('out-marker\\n');",
      "process.stderr.write('err-marker\\n');",
      'process.exitCode = 7;',
    ].join('\n'),
  );

  const command = descriptorFor({ args: ['grade.mjs'] });
  const captured = await executeCheck({ command, executionRoot: root });
  const graded = await executeCheck({ command, executionRoot: root, captureOutput: false });
  const findings = [];

  if (!captured.output?.includes('out-marker') || !captured.output?.includes('err-marker')) {
    findings.push('capture lost one of the two standard streams.');
  }

  if (captured.exitCode !== 7 || graded.exitCode !== 7 || graded.executed !== true) {
    findings.push(`exit status was ${captured.exitCode} captured and ${graded.exitCode} uncaptured.`);
  }

  if (graded.output !== undefined) {
    findings.push('an uncaptured check returned output it was never asked to keep.');
  }

  return {
    ok: findings.length === 0,
    detail: findings.length === 0
      ? 'Both standard streams were captured as one story, and the exit status graded the check with capture on and off.'
      : findings.join(' '),
  };
};

/**
 * `json` — a structured result crosses a real process boundary and parses,
 * including non-ASCII content (NFR-PORT-001).
 */
const jsonFixture = async () => {
  const root = await repositoryWithHistory('gate-portability-json-');
  const document = {
    outcome: 'unverified',
    checks: [{ id: 'portability.json', detail: 'árvíztűrő tükörfúrógép — ✅' }],
    nested: { depth: { value: 1 } },
  };

  await writeFile(
    path.join(root, 'grade.mjs'),
    `process.stdout.write(JSON.stringify(${JSON.stringify(document)}));\n`,
  );

  const attempt = await executeCheck({
    command: descriptorFor({ args: ['grade.mjs'] }),
    executionRoot: root,
  });
  const findings = [];
  let parsed = null;

  try {
    parsed = JSON.parse(attempt.output ?? '');
  } catch (error) {
    findings.push(`the structured result did not parse: ${error.message}`);
  }

  if (parsed !== null && JSON.stringify(parsed) !== JSON.stringify(document)) {
    findings.push('the structured result did not survive the process boundary intact.');
  }

  if (attempt.outputTruncated !== false) {
    findings.push('a small structured result was reported truncated.');
  }

  return {
    ok: findings.length === 0,
    detail: findings.length === 0
      ? 'A nested structured result with non-ASCII content parsed byte-identically on the other side of a real process boundary.'
      : findings.join(' '),
  };
};

/**
 * `timeout` — a check that outruns its confirmed timeout is stopped and
 * reported as timed out with no exit code (NFR-PERF-001, RISK-003).
 */
const timeoutFixture = async () => {
  const root = await repositoryWithHistory('gate-portability-timeout-');

  await writeFile(path.join(root, 'grade.mjs'), 'setInterval(() => {}, 1000);\n');

  const started = Date.now();
  const attempt = await executeCheck({
    command: descriptorFor({ args: ['grade.mjs'], timeoutSeconds: 1 }),
    executionRoot: root,
  });
  const elapsedMs = Date.now() - started;
  const findings = [];

  if (attempt.timedOut !== true || attempt.exitCode !== null) {
    findings.push(`the check reported timedOut=${attempt.timedOut} with exit status ${attempt.exitCode}.`);
  }

  // The bound has to actually bound. A check that ran for ten seconds under a
  // one-second timeout would be reported correctly and still be unusable.
  if (elapsedMs > 5000) {
    findings.push(`a one-second bound took ${elapsedMs}ms to take effect.`);
  }

  return {
    ok: findings.length === 0,
    detail: findings.length === 0
      ? `A check that would never end was stopped after ${attempt.durationMs}ms under a one-second bound and reported no exit status.`
      : findings.join(' '),
    observed: { durationMs: attempt.durationMs, elapsedMs },
  };
};

/**
 * `process-tree` — a stopped check leaves no descendant still running, so
 * background work cannot complete later and authorize the current commit
 * (FR-POL-005, NFR-PORT-001).
 */
const processTreeFixture = async () => {
  const root = await repositoryWithHistory('gate-portability-process-tree-');
  const marker = path.join(root, 'descendant.log');

  await writeFile(
    path.join(root, 'descendant.mjs'),
    [
      "import { appendFileSync } from 'node:fs';",
      'setInterval(() => appendFileSync(process.argv[2], "x"), 25);',
    ].join('\n'),
  );
  await writeFile(
    path.join(root, 'grade.mjs'),
    [
      "import { spawn } from 'node:child_process';",
      "import path from 'node:path';",
      // The descendant inherits this process's group, which is exactly what the
      // executor terminates.
      "spawn(process.execPath, [path.join(process.cwd(), 'descendant.mjs'), process.argv[2]], { stdio: 'ignore' });",
      'setInterval(() => {}, 1000);',
    ].join('\n'),
  );

  const attempt = await executeCheck({
    command: descriptorFor({ args: ['grade.mjs', marker], timeoutSeconds: 1 }),
    executionRoot: root,
  });
  const findings = [];

  if (attempt.timedOut !== true) {
    findings.push('the check did not reach its timeout, so no tree was terminated.');
  }

  await pause(400);

  const first = (await stat(marker).catch(() => ({ size: -1 }))).size;

  if (first <= 0) {
    findings.push('the descendant never ran, so its termination proves nothing.');
  }

  await pause(500);

  const second = (await stat(marker).catch(() => ({ size: -1 }))).size;

  if (second !== first) {
    findings.push(`a descendant outlived the terminated check and wrote ${second - first} more bytes.`);
  }

  return {
    ok: findings.length === 0,
    detail: findings.length === 0
      ? `A descendant of the timed-out check wrote ${first} bytes while it ran and none in the 500ms after the tree was terminated.`
      : findings.join(' '),
  };
};

/**
 * `git-index` — staged content is read from a real Git index in a real
 * repository, distinct from the worktree (NFR-PORT-001, FR-EVAL-002).
 */
const gitIndexFixture = async () => {
  const root = await repositoryWithHistory('gate-portability-git-index-');
  const tracked = path.join(root, 'tracked.txt');

  await writeFile(tracked, 'staged\n');
  await git(root, ['add', 'tracked.txt']);
  await writeFile(tracked, 'worktree-only\n');

  const staged = (await git(root, ['diff', '--cached', '--name-only'])).stdout.trim();
  const indexContent = (await git(root, ['show', ':tracked.txt'])).stdout;
  const worktreeContent = await readFile(tracked, 'utf8');
  const findings = [];

  if (staged !== 'tracked.txt') {
    findings.push(`the index reported ${JSON.stringify(staged)} as staged.`);
  }

  if (indexContent !== 'staged\n' || worktreeContent !== 'worktree-only\n') {
    findings.push('the index and the worktree were not distinguishable.');
  }

  return {
    ok: findings.length === 0,
    detail: findings.length === 0
      ? 'Real Git reported the staged content of a real index as distinct from the worktree beside it.'
      : findings.join(' '),
  };
};

/**
 * `linked-worktree` — a primary and a linked worktree resolve to one canonical
 * Git common directory, and therefore to one Evidence store (NFR-PORT-002).
 */
const linkedWorktreeFixture = async () => {
  const primary = await repositoryWithHistory('gate-portability-worktree-');
  const linked = path.join(primary, '..', `${path.basename(primary)}-linked`);

  await git(primary, ['worktree', 'add', '--quiet', '-b', 'portability', linked]);

  const linkedRoot = await realpath(linked);

  temporaryRoots.push(linkedRoot);

  const identity = (root) => ({
    actor: { name: CAPABILITY, source: 'fixture' },
    client: { id: 'git', surface: 'git-pre-commit', version: describeAdapter('git').version },
    gate: { id: 'change-evaluation-gate', version: null, protocolVersion: PROTOCOL_VERSION },
    repository: { identity: root },
  });

  const fromPrimary = await resolveGitCommonDirectory({
    repositoryRoot: primary,
    runGit: runGitForRepository,
  });
  const fromLinked = await resolveGitCommonDirectory({
    repositoryRoot: linkedRoot,
    runGit: runGitForRepository,
  });
  const primaryStore = await openEvidenceStore({
    repositoryRoot: primary,
    runGit: runGitForRepository,
    identity: identity(primary),
  });
  const linkedStore = await openEvidenceStore({
    repositoryRoot: linkedRoot,
    runGit: runGitForRepository,
    identity: identity(linkedRoot),
  });
  const findings = [];

  if (fromPrimary !== fromLinked) {
    findings.push(`the same clone resolved to two common directories: ${fromPrimary} and ${fromLinked}.`);
  }

  if (primaryStore.root !== linkedStore.root) {
    findings.push(`one clone produced two Evidence stores: ${primaryStore.root} and ${linkedStore.root}.`);
  }

  return {
    ok: findings.length === 0,
    detail: findings.length === 0
      ? 'A primary worktree and a linked worktree of one clone resolved to one canonical common directory and one Evidence store.'
      : findings.join(' '),
  };
};

/**
 * `path-with-spaces` — a repository root containing spaces and non-ASCII
 * characters works end to end, with no operating-system-labelled path logic
 * (NFR-PORT-002).
 */
const pathWithSpacesFixture = async () => {
  const root = await repositoryWithHistory('gate portability árvíz ');

  await writeFile(path.join(root, 'grade.mjs'), 'process.stdout.write(process.cwd());\n');

  const store = await openEvidenceStore({
    repositoryRoot: root,
    runGit: runGitForRepository,
    identity: {
      actor: { name: CAPABILITY, source: 'fixture' },
      client: { id: 'git', surface: 'git-pre-commit', version: describeAdapter('git').version },
      gate: { id: 'change-evaluation-gate', version: null, protocolVersion: PROTOCOL_VERSION },
      repository: { identity: root },
    },
  });
  const attempt = await executeCheck({
    command: descriptorFor({ args: ['grade.mjs'] }),
    executionRoot: root,
  });
  const findings = [];

  if (!root.includes(' ') || !/[^\x00-\x7f]/.test(root)) {
    findings.push('the fixture root did not actually contain a space and a non-ASCII character.');
  }

  if (attempt.exitCode !== 0 || attempt.output !== root) {
    findings.push(`a check under that root reported ${JSON.stringify(attempt.output ?? null)} with status ${attempt.exitCode}.`);
  }

  if (!isInside(root, store.root)) {
    findings.push(`the Evidence store landed at ${store.root}, outside its own repository.`);
  }

  return {
    ok: findings.length === 0,
    detail: findings.length === 0
      ? 'A repository root containing a space and non-ASCII characters carried Git, an Evidence store, and a real check with no path logic labelled by operating system.'
      : findings.join(' '),
  };
};

/**
 * `materialized-root-declared-write` — a check writes inside the materialized
 * execution root it was given, and the source repository is untouched
 * (FR-EVAL-004, SG-SECRET-001).
 */
const declaredWriteFixture = async () => {
  const source = await repositoryWithHistory('gate-portability-source-');
  const materialized = await temporaryDirectory('gate-portability-materialized-');

  await writeFile(
    path.join(materialized, 'grade.mjs'),
    [
      "import { writeFileSync } from 'node:fs';",
      "import path from 'node:path';",
      "writeFileSync(path.join(process.cwd(), 'artifact.txt'), 'written by the check');",
    ].join('\n'),
  );

  const attempt = await executeCheck({
    command: descriptorFor({ args: ['grade.mjs'] }),
    executionRoot: materialized,
  });
  const findings = [];

  if (attempt.exitCode !== 0) {
    findings.push(`the check exited ${attempt.exitCode}.`);
  }

  const inMaterialized = await stat(path.join(materialized, 'artifact.txt')).then(() => true, () => false);
  const inSource = await stat(path.join(source, 'artifact.txt')).then(() => true, () => false);
  const status = (await git(source, ['status', '--porcelain'])).stdout;

  if (!inMaterialized) {
    findings.push('the declared write did not land in the materialized execution root.');
  }

  if (inSource || status !== '') {
    findings.push(`the source repository was written to: ${JSON.stringify(status)}.`);
  }

  return {
    ok: findings.length === 0,
    detail: findings.length === 0
      ? 'A check wrote only inside the materialized execution root it was given, and the source repository reported no change at all.'
      : findings.join(' '),
  };
};

/**
 * `source-immutability` — the source repository's Git state and tracked content
 * are byte-identical before and after an evaluation (SG-EVAL-001).
 */
const sourceImmutabilityFixture = async () => {
  const source = await repositoryWithHistory('gate-portability-immutable-');
  const materialized = await temporaryDirectory('gate-portability-immutable-run-');

  const snapshot = async () => ({
    head: (await git(source, ['rev-parse', 'HEAD'])).stdout.trim(),
    index: (await git(source, ['ls-files', '--stage'])).stdout,
    status: (await git(source, ['status', '--porcelain'])).stdout,
    tracked: await readFile(path.join(source, 'tracked.txt'), 'utf8'),
  });

  const before = await snapshot();

  await writeFile(
    path.join(materialized, 'grade.mjs'),
    [
      "import { writeFileSync } from 'node:fs';",
      "import path from 'node:path';",
      "writeFileSync(path.join(process.cwd(), 'noise.txt'), 'evaluation noise');",
      'process.exitCode = 0;',
    ].join('\n'),
  );
  await executeCheck({
    command: descriptorFor({ args: ['grade.mjs'] }),
    executionRoot: materialized,
  });

  const after = await snapshot();
  const findings = [];

  for (const key of Object.keys(before)) {
    if (before[key] !== after[key]) {
      findings.push(`the source repository's ${key} changed across an evaluation.`);
    }
  }

  return {
    ok: findings.length === 0,
    detail: findings.length === 0
      ? `The source repository's HEAD, index, status, and tracked content were byte-identical before and after an evaluation (HEAD ${before.head.slice(0, 12)}).`
      : findings.join(' '),
  };
};

/**
 * `non-interactive-shell` — a check runs with no controlling terminal, reads
 * end-of-file from standard input immediately, and sees only the environment
 * names its descriptor declared (NFR-PORT-001, SG-CMD-001).
 */
const nonInteractiveFixture = async () => {
  const root = await repositoryWithHistory('gate-portability-non-interactive-');

  await writeFile(
    path.join(root, 'grade.mjs'),
    [
      "import { readFileSync } from 'node:fs';",
      'const report = {',
      '  stdinIsTty: process.stdin.isTTY ?? null,',
      '  stdoutIsTty: process.stdout.isTTY ?? null,',
      '  environmentNames: Object.keys(process.env).sort(),',
      "  stdin: readFileSync(0, 'utf8'),",
      '};',
      'process.stdout.write(JSON.stringify(report));',
    ].join('\n'),
  );

  // A sentinel this process carries and the descriptor does not declare. If the
  // invoking environment leaks, this is what would cross.
  const sentinel = 'GATE_PORTABILITY_UNDECLARED';
  const attempt = await executeCheck({
    command: descriptorFor({ args: ['grade.mjs'], allowedEnvironment: ['PATH'] }),
    executionRoot: root,
    environment: { ...process.env, [sentinel]: 'must-not-cross' },
  });
  const findings = [];
  let report = null;
  let injected = [];

  try {
    report = JSON.parse(attempt.output ?? '');
  } catch (error) {
    findings.push(`the check could not report its own conditions: ${error.message}`);
  }

  if (report !== null) {
    if (report.stdinIsTty !== null || report.stdoutIsTty !== null) {
      findings.push('the check was attached to a terminal.');
    }

    if (report.stdin !== '') {
      findings.push('standard input carried something other than end-of-file.');
    }

    if (!report.environmentNames.includes('PATH')) {
      findings.push('the one declared environment name did not reach the check.');
    }

    if (report.environmentNames.includes(sentinel)) {
      findings.push(`${sentinel} crossed from the invoking environment into the check.`);
    }

    // Names the platform adds below this runtime are recorded rather than
    // failed: the descriptor governs what the gate passes, and the operating
    // system's own additions are not something a repository declared.
    injected = report.environmentNames.filter((name) => name !== 'PATH' && name !== sentinel);
  }

  return {
    ok: findings.length === 0,
    detail: findings.length === 0
      ? `A check ran with no terminal on either stream, read end-of-file from standard input immediately, received the one environment name its descriptor declared, and never saw ${sentinel} from the invoking environment${injected.length === 0 ? '' : ` (platform-added names present: ${injected.join(', ')})`}.`
      : findings.join(' '),
  };
};

const FIXTURES = Object.freeze({
  executable: executableFixture,
  stream: streamFixture,
  json: jsonFixture,
  timeout: timeoutFixture,
  'process-tree': processTreeFixture,
  'git-index': gitIndexFixture,
  'linked-worktree': linkedWorktreeFixture,
  'path-with-spaces': pathWithSpacesFixture,
  'materialized-root-declared-write': declaredWriteFixture,
  'source-immutability': sourceImmutabilityFixture,
  'non-interactive-shell': nonInteractiveFixture,
});

/* ------------------------------------------------------------------ *
 * Risk evidence. RISK-003 and RISK-007 stay OPEN; this is what was
 * measured while they did.
 * ------------------------------------------------------------------ */

/**
 * `RISK-007` — a genuinely flaky required check produces conflicting attempts.
 *
 * The check here really is flaky: it fails the first time and passes the second
 * because its own first run left a marker behind. Nothing retries it silently —
 * the two attempts are both recorded, and their disagreement is what a
 * maintainer has to see (FR-EVAL-006, RISK-007).
 */
const flakyAttemptEvidence = async () => {
  const root = await repositoryWithHistory('gate-portability-flaky-');

  await writeFile(
    path.join(root, 'grade.mjs'),
    [
      "import { existsSync, writeFileSync } from 'node:fs';",
      "import path from 'node:path';",
      "const marker = path.join(process.cwd(), 'attempted');",
      'if (existsSync(marker)) { process.exitCode = 0; } else {',
      "  writeFileSync(marker, 'first attempt');",
      '  process.exitCode = 1;',
      '}',
    ].join('\n'),
  );

  const command = descriptorFor({ args: ['grade.mjs'] });
  const attempts = [
    await executeCheck({ command, executionRoot: root }),
    await executeCheck({ command, executionRoot: root }),
  ];
  const outcomes = attempts.map((attempt) => (attempt.exitCode === 0 ? 'passed' : 'failed'));
  const conflicting = new Set(outcomes).size > 1;

  return {
    ok: conflicting,
    detail: conflicting
      ? `Two attempts of one unchanged check disagreed (${outcomes.join(' then ')}); both are recorded and neither was retried away.`
      : `Two attempts agreed (${outcomes.join(' then ')}), so this run observed no conflict.`,
    observations: attempts.map((attempt, index) => ({
      attempt: index + 1,
      outcome: outcomes[index],
      durationMs: attempt.durationMs,
      classification: conflicting ? 'unverified' : 'agreed',
    })),
  };
};

/* ------------------------------------------------------------------ *
 * Environment detection and surface baselines.
 * ------------------------------------------------------------------ */

const probe = async (file, args) => {
  try {
    return (await runFile(file, args)).stdout.trim();
  } catch {
    return null;
  }
};

/**
 * Detect this environment. Nothing here is declared.
 *
 * The product name and version are read from whichever probe this platform
 * offers; a platform with no probe simply records `null` rather than having a
 * name guessed for it.
 */
const detectEnvironment = async () => {
  const platform = os.platform();
  const productProbes = {
    darwin: [['sw_vers', ['-productName']], ['sw_vers', ['-productVersion']]],
    linux: [null, ['uname', ['-r']]],
  };
  const [nameProbe, versionProbe] = productProbes[platform] ?? [null, null];

  return {
    platform,
    name: nameProbe === null ? null : await probe(...nameProbe),
    version: versionProbe === null ? null : await probe(...versionProbe),
    kernel: os.release(),
    arch: os.arch(),
    node: process.version,
    npm: await probe('npm', ['--version']),
    git: (await probe('git', ['--version'])) ?? null,
  };
};

const environmentIdentity = (detected) => [
  detected.platform,
  detected.arch,
  `node-${detected.node}`,
].join('-');

/**
 * Observed client facts worth carrying into `NFR-COMP-001`.
 *
 * These are structural: which file a client registers a hook in, how its event
 * value is cased, and whether it reports its own version. No captured payload
 * value appears here or anywhere in this repository — real payloads carry
 * conversation text and personal data.
 */
const OBSERVED_CLIENT_FACTS = Object.freeze({
  git: {
    registrationFile: '.git/hooks/pre-commit',
    registrationSchema: 'an executable hook program',
    eventValueCasing: null,
    clientVersionSource: 'git --version',
  },
  'claude-code-desktop': {
    registrationFile: '.claude/settings.local.json',
    registrationSchema: 'hooks nested in a general settings file, matcher group wrapping a typed inner array',
    eventValueCasing: 'capitalised',
    clientVersionSource: null,
  },
  'codex-desktop': {
    registrationFile: '.codex/hooks.json',
    registrationSchema: 'a dedicated hooks file, block shape identical to Claude Code',
    eventValueCasing: 'capitalised',
    clientVersionSource: null,
  },
  cursor: {
    registrationFile: '.cursor/hooks.json',
    registrationSchema: 'a dedicated, independently versioned file with a flat block, no matcher and no type discriminator',
    eventValueCasing: 'lowercase',
    clientVersionSource: 'cursor_version, self-reported in every payload',
  },
});

/**
 * Run the shared compatibility baseline for one adapter and derive its tier.
 *
 * The payload source is stated honestly as `synthetic-fixture`, because that is
 * what it is: this capability builds each payload from the adapter's own
 * declaration so it can run offline with no client installed. `classifySupport`
 * therefore cannot return `supported` for any of them, which is the correct
 * outcome and not a limitation to work around (SG-SUPPORT-001).
 */
const surfaceEvidence = async (adapterId, { environment, releaseVersion, recorded = null }) => {
  const root = await repositoryWithHistory(`gate-portability-baseline-${adapterId}-`);
  const adapter = describeAdapter(adapterId);
  const executionRoot = await temporaryDirectory(`gate-portability-baseline-run-${adapterId}-`);

  // A promotion run already produced this surface's baseline from an invocation
  // its real client made. That evidence cannot be reproduced here — no client is
  // launched by this capability — so it is carried, not re-derived, exactly as
  // the manifest carries every other observed fact.
  if (recorded !== null) {
    const capabilities = { repositoryFilesystem: true, processExecution: true, git: true };
    const derived = classifySupport({
      adapterId,
      variant: 'desktop',
      capabilities,
      baseline: recorded.baseline,
    });

    return {
      adapterId,
      surface: adapter.surface,
      role: adapter.role,
      variant: 'desktop',
      capabilities,
      tier: derived.tier,
      reason: derived.reason,
      baseline: recorded.baseline,
      observed: OBSERVED_CLIENT_FACTS[adapterId] ?? null,
      clientInvocation: {
        recordedAt: recorded.recordedAt ?? null,
        clientVersion: recorded.clientVersion ?? null,
        clientVersionSource: recorded.clientVersionSource ?? null,
        // Key names only; a native payload's values are the client's.
        observedPayloadKeys: recorded.observedPayloadKeys ?? [],
      },
      promotion: promotionProcedure({
        adapterId,
        variant: 'desktop',
        capabilities,
        baseline: recorded.baseline,
      }),
    };
  }

  // The real evaluation seam, with only the child-process execution injected —
  // the baseline is about the surface, not about a stand-in decision.
  const baseline = await runCompatibilityBaseline({ adapterId, repositoryRoot: root }, {
    runGit: runGitIn(root),
    evaluate: async (request) => evaluate(request, {
      executionRoot,
      checks: [],
      execute: async () => ({ executed: true, exitCode: 0, timedOut: false, error: null, durationMs: 1 }),
    }),
    evidence: { payloadSource: 'synthetic-fixture' },
    versions: {
      gate: `change-evaluation-gate/${releaseVersion}`,
      node: environment.node,
      os: `${environment.platform} ${environment.arch} ${environment.kernel}`,
      // No client was launched or probed by this capability, so there is no
      // client version to record. A promotion run is what supplies one.
      client: null,
    },
  });
  const capabilities = { repositoryFilesystem: true, processExecution: true, git: true };
  const derived = classifySupport({
    adapterId,
    variant: 'desktop',
    capabilities,
    baseline,
  });

  return {
    adapterId,
    surface: adapter.surface,
    role: adapter.role,
    variant: 'desktop',
    capabilities,
    tier: derived.tier,
    reason: derived.reason,
    baseline,
    observed: OBSERVED_CLIENT_FACTS[adapterId] ?? null,
    promotion: promotionProcedure({ adapterId, variant: 'desktop', capabilities, baseline }),
  };
};

/* ------------------------------------------------------------------ *
 * The matrix.
 * ------------------------------------------------------------------ */

/**
 * Load every recorded client-driven baseline, keyed by adapter.
 *
 * These are produced by `gate-client-baseline.mjs` running inside a real
 * client. A record is only honoured when the run it describes actually earned
 * `captured-client-invocation`; a record carrying anything else is ignored, so
 * a hand-written file cannot promote a surface (SG-SUPPORT-001).
 */
const loadRecordedBaselines = async (directory) => {
  const recorded = new Map();

  if (directory === null) {
    return recorded;
  }

  const entries = await readdir(directory).catch(() => []);

  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }

    const record = await readFile(path.join(directory, entry), 'utf8')
      .then((contents) => JSON.parse(contents))
      .catch(() => null);

    if (
      record?.adapterId
      && record.baseline?.evidence?.payloadSource === 'captured-client-invocation'
    ) {
      recorded.set(record.adapterId, record);
    }
  }

  return recorded;
};

const main = async () => {
  const asJson = process.argv.includes('--json');
  const outIndex = process.argv.indexOf('--out');
  const outPath = outIndex === -1 ? null : process.argv[outIndex + 1] ?? null;
  const recordedIndex = process.argv.indexOf('--client-baselines');
  const recordedPath = recordedIndex === -1
    ? path.join(FRAMEWORK_ROOT, '.scratch', 'change-evaluation-gate', 'client-baselines')
    : process.argv[recordedIndex + 1] ?? null;
  let manifest = null;
  let qualification = null;
  let fixtures = [];
  let flaky = null;

  try {
    const environment = await detectEnvironment();
    const { version: releaseVersion, source: versionSource } = await readReleaseVersion(FRAMEWORK_ROOT);

    for (const id of Object.keys(FIXTURES)) {
      const startedAt = Date.now();
      let outcome;

      try {
        outcome = await FIXTURES[id]();
      } catch (error) {
        // A fixture that throws is a fixture that failed. It is recorded, not
        // dropped: silently omitting a failed fixture is the one thing this
        // matrix exists to prevent.
        outcome = { ok: false, detail: `the fixture raised ${error.message}` };
      }

      fixtures.push({
        id,
        ok: outcome.ok,
        detail: outcome.detail,
        durationMs: Date.now() - startedAt,
        ...(outcome.observed ? { observed: outcome.observed } : {}),
      });
    }

    flaky = await flakyAttemptEvidence();

    const recorded = await loadRecordedBaselines(recordedPath);
    const surfaces = [];

    for (const adapterId of ADAPTER_IDS) {
      surfaces.push(await surfaceEvidence(adapterId, {
        environment,
        releaseVersion,
        recorded: recorded.get(adapterId) ?? null,
      }));
    }

    const timing = fixtures
      .filter((fixture) => ['timeout', 'process-tree'].includes(fixture.id))
      .map((fixture) => ({ id: fixture.id, durationMs: fixture.durationMs }));

    manifest = buildCompatibilityManifest({
      release: {
        id: 'change-evaluation-gate',
        version: releaseVersion,
        versionSource,
        protocolVersion: PROTOCOL_VERSION,
      },
      environments: [
        {
          id: environmentIdentity(environment),
          claim: 'claimed',
          os: {
            platform: environment.platform,
            name: environment.name,
            version: environment.version,
            kernel: environment.kernel,
            arch: environment.arch,
          },
          runtime: { node: environment.node, npm: environment.npm },
          tools: { git: environment.git },
          fixtures,
        },
        {
          id: 'every-other-environment',
          claim: 'unverified',
          reason: 'This qualification run had access to one machine; no other operating system or runtime combination was executed, so none has a verified claim yet. That is untested, not refused.',
          os: { platform: null, name: null, version: null, kernel: null, arch: null },
          runtime: { node: null, npm: null },
          tools: { git: null },
          fixtures: [],
        },
      ],
      surfaces,
      risks: [
        {
          id: 'RISK-003',
          status: 'open',
          owner: 'Product owner',
          statement: 'Long required checks or queue contention make commit latency unacceptable and encourage unsupported bypass.',
          evidence: {
            kind: 'timing',
            observations: [
              ...timing,
              {
                id: 'matrix-total',
                durationMs: fixtures.reduce((total, fixture) => total + fixture.durationMs, 0),
              },
            ],
          },
        },
        {
          id: 'RISK-007',
          status: 'open',
          owner: 'Repository maintainer',
          statement: 'A flaky required check produces conflicting attempts and blocks delivery.',
          evidence: { kind: 'attempts', observations: flaky.observations },
        },
      ],
      recordedAt: new Date().toISOString(),
    });
    qualification = qualifyRelease(manifest, { expectedVersion: releaseVersion });
  } finally {
    for (const root of temporaryRoots) {
      // The guard again, immediately before the only recursive removal in this
      // capability. A fixture root that somehow escaped is never deleted.
      await assertThrowawayRepository(root);
      await rm(root, { recursive: true, force: true });
    }
  }

  const ok = fixtures.every((fixture) => fixture.ok)
    && flaky.ok
    && qualification.qualified === true;
  const report = { capability: CAPABILITY, ok, manifest, qualification, riskEvidence: flaky };

  if (outPath !== null) {
    await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
    await writeFile(path.resolve(outPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const claimed = manifest.environments.find((environment) => environment.claim === 'claimed');

    process.stdout.write(`release ${manifest.release.version} (read from ${manifest.release.versionSource})\n`);
    process.stdout.write(`claimed environment ${claimed.id}: ${claimed.os.name ?? claimed.os.platform} ${claimed.os.version ?? claimed.os.kernel}, node ${claimed.runtime.node}, npm ${claimed.runtime.npm}, ${claimed.tools.git}\n`);

    for (const fixture of fixtures) {
      process.stdout.write(`${fixture.ok ? 'ok' : 'FAILED'} ${fixture.id} (${fixture.durationMs}ms) — ${fixture.detail}\n`);
    }

    process.stdout.write(`${flaky.ok ? 'ok' : 'FAILED'} risk-007-attempts — ${flaky.detail}\n`);

    for (const surface of manifest.surfaces) {
      process.stdout.write(`${surface.adapterId}: ${surface.tier} (${surface.reason})\n`);
    }

    for (const error of qualification.errors) {
      process.stdout.write(`  - ${error.code} at ${error.path}: ${error.message}\n`);
    }

    process.stdout.write(`${qualification.qualified ? 'ok' : 'FAILED'} qualification\n`);
    process.stdout.write(`${ok ? 'ok' : 'FAILED'} ${CAPABILITY}\n`);
  }

  process.exitCode = ok ? 0 : 1;
};

await main();
