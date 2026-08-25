import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { configurationIdentity } from '../skills/change-evaluation-gate/scripts/lib/activation.mjs';
import { readRepositoryConfiguration } from '../skills/change-evaluation-gate/scripts/lib/configuration.mjs';
import { contentIdentity } from '../skills/change-evaluation-gate/scripts/lib/evidence-store.mjs';
import {
  EXECUTION_ROOT_PREFIXES,
  EXECUTION_ROOT_RETENTION_MS,
  createExecutionRoot,
  releaseExecutionRoot,
  runHook,
  sweepOrphanedExecutionRoots,
} from '../skills/change-evaluation-gate/scripts/lib/hook-runner.mjs';
import { captureSnapshot } from '../skills/change-evaluation-gate/scripts/lib/snapshot.mjs';

const runFile = promisify(execFile);

/**
 * TB-038. This suite owns the execution-root lifecycle for both runners: the
 * root a run materializes into, its removal when the run is interrupted rather
 * than finished, and the reclamation of roots an earlier run abandoned.
 *
 * Every fixture is a throwaway directory under the OS temporary directory and
 * never this repository. The interruption fixtures give the runner under test
 * its own `TMPDIR`, so what a child process leaves behind is observable in
 * isolation and can never be confused with a concurrently running test's own
 * live execution root.
 */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HOOK_RUNNER = path.join(
  FRAMEWORK_ROOT,
  'skills/change-evaluation-gate/scripts/lib/hook-runner.mjs',
);

const PACKAGED_PREFLIGHT = path.join(
  FRAMEWORK_ROOT,
  'skills/change-evaluation-gate/scripts/gate-preflight.mjs',
);

const isInside = (parent, candidate) => candidate === parent
  || candidate.startsWith(`${parent}${path.sep}`);

const assertThrowaway = async (root) => {
  const resolved = await realpath(root).catch(() => path.resolve(root));
  const temporaryRoot = await realpath(tmpdir());
  const frameworkRoot = await realpath(FRAMEWORK_ROOT).catch(() => FRAMEWORK_ROOT);

  assert.equal(
    isInside(temporaryRoot, resolved),
    true,
    `Refusing to operate outside the OS temporary directory: ${resolved}.`,
  );
  assert.equal(
    isInside(frameworkRoot, resolved),
    false,
    `Refusing to operate inside this repository: ${resolved}.`,
  );

  return resolved;
};

const throwawayDirectory = async (t, prefix) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));

  t.after(() => rm(root, { recursive: true, force: true }).catch(() => {}));
  await assertThrowaway(root);

  return root;
};

const isolatedGitEnvironment = () => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

const throwawayRepository = async (t) => {
  const root = await throwawayDirectory(t, 'gate-exec-root-repo-');

  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\n', 'utf8');
  await runFile('git', ['init', '--quiet'], { cwd: root, env: isolatedGitEnvironment() });
  await runFile('git', ['add', '--all'], { cwd: root, env: isolatedGitEnvironment() });
  await runFile('git', [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Execution Root',
    'commit', '--quiet', '--message', 'baseline',
  ], { cwd: root, env: isolatedGitEnvironment() });

  return root;
};

/** The graded check: reads what it was pointed at and fails on a broken subject. */
const GRADING_CHECK = [
  "import { readFile } from 'node:fs/promises';",
  '',
  "const graded = await readFile(process.argv[2], 'utf8').catch(() => '');",
  '',
  'process.stdout.write(`graded ${graded.length} bytes\\n`);',
  "process.exitCode = graded.includes('BROKEN') ? 1 : 0;",
  '',
].join('\n');

/** A check that announces it started and then refuses to finish. */
const blockingCheck = (blockUntil) => [
  "import { writeFileSync } from 'node:fs';",
  '',
  `writeFileSync(${JSON.stringify(blockUntil)}, 'started\\n');`,
  '// A backstop only: the test kills this process group long before it',
  '// elapses, and nothing may be left running if the kill never lands.',
  'setTimeout(() => process.exit(0), 30_000);',
  '',
].join('\n');

/**
 * TB-043. A check that reports the directory it is actually running in, and
 * fails the way the preserved `0.11.2` run failed if the path it resolves is
 * not the path it was handed. `report` is outside the execution root, so what
 * the check observed survives the root's removal.
 */
const observingCheck = (report) => [
  "import { realpathSync, writeFileSync } from 'node:fs';",
  '',
  'const observed = process.cwd();',
  'const resolved = realpathSync(observed);',
  '',
  `writeFileSync(${JSON.stringify(report)}, JSON.stringify({ observed, resolved }));`,
  '',
  'if (observed !== resolved) {',
  '  process.stdout.write(`FAILED ${resolved} is not ${observed}\\n`);',
  '  process.exit(1);',
  '}',
  '',
  'process.stdout.write(`observed ${observed}\\n`);',
  '',
].join('\n');

/**
 * A clone configured with one required check. `blockUntil` makes that check
 * announce that it started and then refuse to finish, which is the only way to
 * hold a runner inside its evaluation long enough to interrupt it from outside.
 * `report` makes it record the directory it ran in instead of grading.
 */
const configureClone = async (root, { blockUntil = null, report = null } = {}) => {
  await mkdir(path.join(root, 'tools'), { recursive: true });

  const check = blockUntil !== null
    ? blockingCheck(blockUntil)
    : (report !== null ? observingCheck(report) : GRADING_CHECK);

  await writeFile(path.join(root, 'tools/check.mjs'), check, 'utf8');
  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    [
      'schema_version: 4',
      'backend: unknown',
      'frontend: none',
      'verification:',
      '  profile: gate-execution-root',
      '  capabilities: []',
      '  commands:',
      '    test:',
      '      backend: []',
      '      frontend: []',
      '      both:',
      '        - runner: repository-script',
      '          args:',
      '            - tools/check.mjs',
      '            - app/Order.php',
      '          working_directory: "."',
      '          timeout_seconds: 120',
      '          allowed_environment:',
      '            - PATH',
      '          evidence_category: test',
      '          source_scope: both',
      'evaluation_gate:',
      '  checks:',
      '    required:',
      '      - configuration.broad-tests.test',
      '    advisory: []',
      '  budget:',
      '    total_seconds: 600',
      '  bypass:',
      '    enabled: false',
      '  execution: {}',
      '  evidence: {}',
      '',
    ].join('\n'),
    'utf8',
  );
};

const PINNED_RUNNER = Object.freeze({
  check_id: 'configuration.broad-tests.test',
  role: 'evaluate',
  runner: 'repository-script',
  executable: process.execPath,
  version: process.versions.node,
});

const publishReceipt = async (root) => {
  const common = (await runFile('git', ['rev-parse', '--git-common-dir'], {
    cwd: root,
    env: isolatedGitEnvironment(),
  })).stdout.trim();
  const directory = path.resolve(root, common, 'change-evaluation-gate/evidence/activation');
  const read = await readRepositoryConfiguration({ repositoryRoot: root });
  const body = {
    receiptVersion: 'change-evaluation-gate/activation-receipt/v1',
    previewId: 'sha256:preview',
    repository: { root },
    configuration: {
      identity: configurationIdentity({
        schemaVersion: read.configuration?.schema_version ?? null,
        policy: read.configuration?.evaluation_gate ?? null,
      }),
      schemaVersion: read.configuration?.schema_version ?? null,
    },
    runtime: {
      gate: { id: 'change-evaluation-gate', version: '1.0.0', protocolVersion: '1.0' },
      runnerVersion: 'fixture/1.0.0',
      runners: [PINNED_RUNNER],
    },
  };

  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'receipt.json'),
    `${JSON.stringify({ ...body, receiptId: contentIdentity(body) }, null, 2)}\n`,
    'utf8',
  );
};

const stage = async (root, contents) => {
  await writeFile(path.join(root, 'app/Order.php'), contents, 'utf8');
  await runFile('git', ['add', '--all'], { cwd: root, env: isolatedGitEnvironment() });
};

const sleep = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

const rootsUnder = async (directory) => (await readdir(directory).catch(() => []))
  .filter((entry) => EXECUTION_ROOT_PREFIXES.some((prefix) => entry.startsWith(prefix)));

const waitFor = async (predicate, { label, timeoutMs = 25_000 }) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    if (await predicate()) {
      return true;
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(25);
  }

  assert.fail(`timed out waiting for ${label}.`);

  return false;
};

/**
 * Run a program in its own process group so the test can interrupt the whole
 * group the way a terminal does when the maintainer presses Ctrl-C: the runner
 * and the check it launched both receive the signal.
 */
const interruptible = ({ command, args, cwd, temporaryRoot, stdin = null }) => {
  const child = spawn(command, args, {
    cwd,
    detached: true,
    env: { ...isolatedGitEnvironment(), TMPDIR: temporaryRoot },
    stdio: [stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  const ended = new Promise((resolve) => {
    child.on('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });

  child.stdout.resume();
  child.stderr.resume();

  if (stdin !== null) {
    child.stdin.end(stdin);
  }

  return { child, ended };
};

const HOOK_RUNNER_DRIVER = [
  `import { runHook } from ${JSON.stringify(HOOK_RUNNER)};`,
  '',
  'const result = await runHook({ cwd: process.cwd(), environment: process.env });',
  '',
  'process.exitCode = result.exitCode;',
].join('\n');

/** The `stop` payload a real Cursor client sends; the preflight's own input shape. */
const cursorStopPayload = (root) => ({
  hook_event_name: 'stop',
  session_id: 'execution-root-session',
  workspace_roots: [root],
  cursor_version: '3.15.6',
  status: 'completed',
  loop_count: 0,
});

const interruptRunnerMidEvaluation = async (t, { signal, program }) => {
  const repository = await throwawayRepository(t);
  const temporaryRoot = await throwawayDirectory(t, 'gate-exec-root-tmp-');
  const started = path.join(temporaryRoot, 'check-started');

  await configureClone(repository, { blockUntil: started });
  await publishReceipt(repository);
  await stage(repository, 'baseline\nunder evaluation\n');

  const { child, ended } = program({ cwd: repository, temporaryRoot });

  t.after(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Already gone, which is the expected case.
    }
  });

  await waitFor(
    async () => await stat(started).then(() => true).catch(() => false),
    { label: 'the evaluation to reach the check it is grading with' },
  );

  const live = await rootsUnder(temporaryRoot);

  assert.equal(
    live.length,
    1,
    `the interrupted run must have exactly one live execution root to observe, saw: ${JSON.stringify(live)}`,
  );

  process.kill(-child.pid, signal);

  const outcome = await ended;

  assert.equal(
    outcome.signal,
    signal,
    `${signal} must be honored, not swallowed: the runner has to terminate under the signal's own disposition, got ${JSON.stringify(outcome)}.`,
  );

  assert.deepEqual(
    await rootsUnder(temporaryRoot),
    [],
    `a runner terminated by ${signal} must leave no directory matching its prefix behind.`,
  );
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`TB-038 AC-CFG-004, SG-SECRET-001: the authoritative runner interrupted by ${signal} mid-evaluation leaves no execution root and still terminates`, async (t) => {
    await interruptRunnerMidEvaluation(t, {
      signal,
      program: ({ cwd, temporaryRoot }) => interruptible({
        command: process.execPath,
        args: ['--input-type=module', '--eval', HOOK_RUNNER_DRIVER],
        cwd,
        temporaryRoot,
      }),
    });
  });

  test(`TB-038 AC-CFG-004, SG-SECRET-001: the packaged preflight runner interrupted by ${signal} mid-evaluation leaves no execution root and still terminates`, async (t) => {
    await interruptRunnerMidEvaluation(t, {
      signal,
      program: ({ cwd, temporaryRoot }) => interruptible({
        command: process.execPath,
        args: [PACKAGED_PREFLIGHT, '--adapter', 'cursor'],
        cwd,
        temporaryRoot,
        stdin: `${JSON.stringify(cursorStopPayload(cwd))}\n`,
      }),
    });
  });
}

const age = async (directory, milliseconds) => {
  const when = new Date(Date.now() - milliseconds);

  await utimes(directory, when, when);
};

test('TB-038 NFR-REL-001, SG-LIFE-001: the sweep reclaims stale roots, spares live and concurrent ones, and never reaches outside its own prefix', async (t) => {
  const sweepRoot = await throwawayDirectory(t, 'gate-exec-root-sweep-');
  const outside = await throwawayDirectory(t, 'gate-exec-root-outside-');

  await mkdir(path.join(outside, 'precious'), { recursive: true });
  await writeFile(path.join(outside, 'precious/keep.txt'), 'keep\n', 'utf8');

  const reclaimable = [
    'gate-hook-runner-exec-stale',
    'gate-preflight-exec-stale',
  ];
  // Every one of these is a decoy: a near-miss prefix, a name our prefix is a
  // suffix of, an unrelated gate directory, a file rather than a directory, and
  // a symlink pointing at content outside the sweep's reach entirely.
  const spared = [
    'gate-hook-runner-exec-live',
    'gate-hook-runner-exe-old',
    'gate-preflight-exe-old',
    'not-gate-hook-runner-exec-old',
    'gate-adapter-hook-old',
    'gate-hook-program-self-test-old',
  ];

  for (const name of [...reclaimable, ...spared]) {
    // eslint-disable-next-line no-await-in-loop
    await mkdir(path.join(sweepRoot, name, 'snapshot'), { recursive: true });
    // eslint-disable-next-line no-await-in-loop
    await writeFile(path.join(sweepRoot, name, 'snapshot/Order.php'), 'content\n', 'utf8');
  }

  const decoyFile = path.join(sweepRoot, 'gate-hook-runner-exec-file');
  const decoyLink = path.join(sweepRoot, 'gate-hook-runner-exec-link');

  await writeFile(decoyFile, 'not a root\n', 'utf8');
  await symlink(path.join(outside, 'precious'), decoyLink);

  const stale = EXECUTION_ROOT_RETENTION_MS + 60_000;

  for (const name of [...reclaimable, ...spared, 'gate-hook-runner-exec-file']) {
    if (name === 'gate-hook-runner-exec-live') {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await age(path.join(sweepRoot, name), stale);
  }

  await utimes(decoyLink, new Date(Date.now() - stale), new Date(Date.now() - stale));

  const result = await sweepOrphanedExecutionRoots({ temporaryRoot: sweepRoot });

  assert.deepEqual(
    [...result.removed].map((entry) => path.basename(entry)).sort(),
    [...reclaimable].sort(),
    'only roots under the gate\'s own prefix and older than the ceiling are reclaimed.',
  );

  for (const name of reclaimable) {
    // eslint-disable-next-line no-await-in-loop
    const present = await stat(path.join(sweepRoot, name)).then(() => true).catch(() => false);

    assert.equal(present, false, `${name} is older than the ceiling and must be reclaimed.`);
  }

  for (const name of spared) {
    // eslint-disable-next-line no-await-in-loop
    const present = await stat(path.join(sweepRoot, name, 'snapshot/Order.php'))
      .then(() => true)
      .catch(() => false);

    assert.equal(present, true, `${name} must be left alone with its content intact.`);
  }

  assert.equal(
    await readFile(decoyFile, 'utf8'),
    'not a root\n',
    'a file bearing the prefix is not an execution root and is not removed.',
  );
  assert.equal(
    (await lstat(decoyLink)).isSymbolicLink(),
    true,
    'a symlink bearing the prefix is not followed and not removed.',
  );
  assert.equal(
    await readFile(path.join(outside, 'precious/keep.txt'), 'utf8'),
    'keep\n',
    'SG-LIFE-001: nothing outside the swept directory is ever touched.',
  );
});

test('TB-038 NFR-REL-001: a root younger than the ceiling is left alone while a sweep runs beside it', async (t) => {
  const sweepRoot = await throwawayDirectory(t, 'gate-exec-root-concurrent-');
  const concurrent = path.join(sweepRoot, 'gate-preflight-exec-inflight');

  await mkdir(path.join(concurrent, 'snapshot'), { recursive: true });
  await writeFile(path.join(concurrent, 'snapshot/Order.php'), 'in flight\n', 'utf8');
  // Old enough that any ceiling shorter than the stated one would take it.
  await age(concurrent, EXECUTION_ROOT_RETENTION_MS - 60_000);

  const result = await sweepOrphanedExecutionRoots({ temporaryRoot: sweepRoot });

  assert.deepEqual(result.removed, [], 'a live root belonging to a concurrent evaluation is never removed.');
  assert.equal(
    await readFile(path.join(concurrent, 'snapshot/Order.php'), 'utf8'),
    'in flight\n',
  );
});

test('TB-038 SG-LIFE-001: the sweep refuses a directory outside the system temporary directory', async (t) => {
  const outside = path.join(FRAMEWORK_ROOT, '.scratch');
  const result = await sweepOrphanedExecutionRoots({ temporaryRoot: outside });

  assert.deepEqual(result.removed, [], 'the sweep removes nothing outside the system temporary directory.');
  assert.equal(result.considered, 0, 'a directory outside the system temporary directory is never even read.');
  assert.equal(
    await stat(outside).then((entry) => entry.isDirectory()).catch(() => false),
    true,
    `${outside} must still exist untouched.`,
  );
  void t;
});

test('TB-038: a sweep that cannot remove a root is silent and throws nothing', async (t) => {
  const sweepRoot = await throwawayDirectory(t, 'gate-exec-root-hostile-');
  const blocked = path.join(sweepRoot, 'gate-hook-runner-exec-blocked');

  await mkdir(blocked, { recursive: true });
  await age(blocked, EXECUTION_ROOT_RETENTION_MS + 60_000);
  // A readable but unwritable parent: the sweep can see the root and cannot
  // remove it, which is the failure this criterion is about.
  await chmod(sweepRoot, 0o500);
  t.after(() => chmod(sweepRoot, 0o700).catch(() => {}));

  const result = await sweepOrphanedExecutionRoots({ temporaryRoot: sweepRoot });

  assert.deepEqual(result.removed, [], 'a root that cannot be removed is not reported as removed.');
  assert.equal(
    await stat(blocked).then(() => true).catch(() => false),
    true,
    'the unreclaimable root is still there, and the sweep said nothing about it.',
  );
});

test('TB-038 AC-EVAL-004: an evaluation whose sweep cannot reclaim anything decides, reports, and exits exactly as it would have', async (t) => {
  const repository = await throwawayRepository(t);

  await configureClone(repository);
  await publishReceipt(repository);
  await stage(repository, 'baseline\nBROKEN\n');

  const denied = await runHook({ cwd: repository, environment: process.env });

  await stage(repository, 'baseline\nrepaired\n');

  const allowed = await runHook({ cwd: repository, environment: process.env });

  assert.equal(denied.exitCode !== 0, true, `expected a denial, got: ${denied.lines.join('\n')}`);
  assert.equal(denied.reasonCode, 'denied');
  assert.equal(allowed.exitCode, 0, `expected an allow, got: ${allowed.lines.join('\n')}`);
  assert.equal(allowed.reasonCode, null);
});

test('TB-038: a run of either runner reclaims what a previous run abandoned', async (t) => {
  const repository = await throwawayRepository(t);
  const temporaryRoot = await throwawayDirectory(t, 'gate-exec-root-reclaim-');
  const abandoned = {
    hook: path.join(temporaryRoot, 'gate-hook-runner-exec-abandoned'),
    preflight: path.join(temporaryRoot, 'gate-preflight-exec-abandoned'),
  };

  await configureClone(repository);
  await publishReceipt(repository);
  await stage(repository, 'baseline\nrepaired\n');

  for (const root of Object.values(abandoned)) {
    // eslint-disable-next-line no-await-in-loop
    await mkdir(path.join(root, 'snapshot'), { recursive: true });
    // eslint-disable-next-line no-await-in-loop
    await age(root, EXECUTION_ROOT_RETENTION_MS + 60_000);
  }

  const finished = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', HOOK_RUNNER_DRIVER], {
      cwd: repository,
      env: { ...isolatedGitEnvironment(), TMPDIR: temporaryRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.resume();
    child.stderr.resume();
    child.on('close', (exitCode) => resolve(exitCode));
  });

  assert.equal(finished, 0, 'the reclaiming run still decides the commit on its own terms.');
  assert.deepEqual(
    await rootsUnder(temporaryRoot),
    [],
    'both abandoned roots are reclaimed by the next run, and the run removed its own.',
  );
});

test('TB-038 FR-LIFE-019: the sweep is not a maintainer-facing recovery action', async (t) => {
  const sources = await Promise.all([
    readFile(HOOK_RUNNER, 'utf8'),
    readFile(
      path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts/lib/preflight-runner.mjs'),
      'utf8',
    ),
  ]);

  for (const source of sources) {
    assert.doesNotMatch(
      source,
      /sweep[^\n]*(console|process\.stdout|process\.stderr)/,
      'a sweep never reports itself to the maintainer.',
    );
  }

  assert.match(
    sources[1],
    /sweepOrphanedExecutionRoots/,
    'the preflight runner reclaims abandoned roots too.',
  );
  void t;
});

/**
 * TB-043. The execution root has one name.
 *
 * A temporary directory reached through a symbolic link is what the reporting
 * machine had, and it is what every fixture below builds explicitly: the runner
 * under test is handed a `TMPDIR` that is a link to a real directory, so the
 * split between the name the gate holds and the name the operating system
 * considers canonical is reproduced on any filesystem rather than only on one.
 * That makes these fixtures free of operating-system-labelled logic and red on
 * every platform before the fix, not only on macOS (`NFR-PORT-002`).
 */
const linkedTemporaryRoot = async (t) => {
  const canonical = await throwawayDirectory(t, 'gate-exec-root-canonical-');
  const link = path.join(await throwawayDirectory(t, 'gate-exec-root-link-'), 'temporary');

  await symlink(canonical, link, 'dir');

  assert.notEqual(link, canonical, 'the fixture is only meaningful if the two spellings differ.');

  return { canonical, link };
};

/** Run `work` with the process's temporary directory pointed somewhere else. */
const withTemporaryRoot = async (temporaryRoot, work) => {
  const previous = process.env.TMPDIR;

  process.env.TMPDIR = temporaryRoot;

  try {
    return await work();
  } finally {
    if (previous === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = previous;
    }
  }
};

const evidenceLogEntries = async (repository) => {
  const common = (await runFile('git', ['rev-parse', '--git-common-dir'], {
    cwd: repository,
    env: isolatedGitEnvironment(),
  })).stdout.trim();
  const log = path.resolve(repository, common, 'change-evaluation-gate/evidence/log.ndjson');
  const contents = await readFile(log, 'utf8').catch(() => '');

  return contents.split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line));
};

test('TB-043 AC-EVAL-006: a program executing inside the execution root resolves the path the gate created', async (t) => {
  const { link } = await linkedTemporaryRoot(t);
  const root = await withTemporaryRoot(
    link,
    () => createExecutionRoot('gate-hook-runner-exec-'),
  );

  t.after(() => releaseExecutionRoot(root).catch(() => {}));

  // The comparison the preserved test runner made: resolve the path you were
  // handed, compare it against the path you were handed.
  const resolvedByTool = (await runFile(
    process.execPath,
    ['-e', 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))', root],
    { cwd: root },
  )).stdout;

  assert.equal(
    resolvedByTool,
    root,
    `a check that resolves the execution root it was given must reach the name the gate holds, got ${resolvedByTool}.`,
  );

  // And the same directory read from the inside: a process's working directory
  // is reported canonically, which is the spelling the gate has to be holding.
  const observedInside = (await runFile(
    process.execPath,
    ['-e', 'process.stdout.write(process.cwd())'],
    { cwd: root },
  )).stdout;

  assert.equal(
    observedInside,
    root,
    `a program executing inside the execution root must observe the name the gate holds, got ${observedInside}.`,
  );
});

test('TB-043 AC-EVAL-004: a check executing inside the execution root observes the path the decision records', async (t) => {
  const repository = await throwawayRepository(t);
  const { canonical, link } = await linkedTemporaryRoot(t);
  const report = path.join(await throwawayDirectory(t, 'gate-exec-root-report-'), 'observed.json');

  await configureClone(repository, { report });
  await publishReceipt(repository);
  await stage(repository, 'baseline\nunder evaluation\n');

  const finished = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', HOOK_RUNNER_DRIVER], {
      cwd: repository,
      env: { ...isolatedGitEnvironment(), TMPDIR: link },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';

    child.stdout.resume();
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (exitCode) => resolve({ exitCode, stderr }));
  });

  const observation = JSON.parse(await readFile(report, 'utf8'));
  const entries = await evidenceLogEntries(repository);
  const recorded = entries.at(-1)?.execution?.executionRoot ?? null;

  assert.equal(
    observation.observed,
    recorded,
    `the directory the check ran in and the directory the decision records must be one name: ran in ${observation.observed}, recorded ${recorded}.`,
  );
  assert.equal(
    observation.observed,
    observation.resolved,
    'a check that resolves where it is running must reach where it was put.',
  );
  assert.equal(
    finished.exitCode,
    0,
    `a check that compares the two spellings must pass, got exit ${finished.exitCode}: ${finished.stderr}`,
  );

  // FR-EVAL-005: the root is still removed, under its own prefix, and the sweep
  // still looks in the place the run actually created it.
  assert.deepEqual(await rootsUnder(canonical), [], 'the run removes its own execution root.');
  assert.deepEqual(await rootsUnder(link), [], 'and nothing is left under the linked spelling.');
});

test('TB-043 SG-EVAL-001, NFR-REL-001: the root\'s spelling moves no snapshot identity and no dependency root', async (t) => {
  const repository = await throwawayRepository(t);
  const { canonical, link } = await linkedTemporaryRoot(t);

  await stage(repository, 'baseline\nidentified\n');
  // Installed after staging, so the dependency root is what it is in a real
  // clone: present on disk, untracked, and never part of what is graded.
  await mkdir(path.join(repository, 'vendor/library'), { recursive: true });
  await writeFile(path.join(repository, 'vendor/library/installed.txt'), 'installed\n', 'utf8');

  const capture = async (executionRoot) => captureSnapshot({
    repositoryRoot: repository,
    kind: 'git-index',
    executionRoot,
    dependencyRoots: ['vendor'],
  });

  const underLink = await capture(path.join(link, 'gate-identity-linked'));
  const underCanonical = await capture(path.join(canonical, 'gate-identity-canonical'));

  assert.equal(underLink.captured, true, JSON.stringify(underLink));
  assert.equal(underCanonical.captured, true, JSON.stringify(underCanonical));
  assert.equal(
    underLink.snapshot.id,
    underCanonical.snapshot.id,
    'SG-EVAL-001: an identity is derived over repository-relative paths, so the execution root\'s spelling cannot move it.',
  );
  assert.equal(
    underCanonical.snapshot.paths.some((relative) => relative.startsWith('vendor/')),
    false,
    'NFR-REL-001: a provided dependency root stays outside the snapshot\'s path list.',
  );
  assert.deepEqual(underCanonical.dependencies.provided, ['vendor']);
  assert.equal(
    await realpath(path.join(canonical, 'gate-identity-canonical/vendor')),
    await realpath(path.join(repository, 'vendor')),
    'NFR-REL-001: the linked dependency root still resolves to the installed directory it names.',
  );
  void t;
});
