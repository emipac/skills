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
  runHook,
  sweepOrphanedExecutionRoots,
} from '../skills/change-evaluation-gate/scripts/lib/hook-runner.mjs';

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

/**
 * A clone configured with one required check. `blockUntil` makes that check
 * announce that it started and then refuse to finish, which is the only way to
 * hold a runner inside its evaluation long enough to interrupt it from outside.
 */
const configureClone = async (root, { blockUntil = null } = {}) => {
  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(
    path.join(root, 'tools/check.mjs'),
    blockUntil === null
      ? [
        "import { readFile } from 'node:fs/promises';",
        '',
        "const graded = await readFile(process.argv[2], 'utf8').catch(() => '');",
        '',
        'process.stdout.write(`graded ${graded.length} bytes\\n`);',
        "process.exitCode = graded.includes('BROKEN') ? 1 : 0;",
        '',
      ].join('\n')
      : [
        "import { writeFileSync } from 'node:fs';",
        '',
        `writeFileSync(${JSON.stringify(blockUntil)}, 'started\\n');`,
        '// A backstop only: the test kills this process group long before it',
        '// elapses, and nothing may be left running if the kill never lands.',
        'setTimeout(() => process.exit(0), 30_000);',
        '',
      ].join('\n'),
    'utf8',
  );
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
