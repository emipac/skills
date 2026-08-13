import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  HOOK_PROGRAM_SELF_TEST_SUBJECT_VERSION,
} from '../skills/change-evaluation-gate/scripts/lib/activation.mjs';
import {
  SELF_TEST_ENV,
  runHook,
} from '../skills/change-evaluation-gate/scripts/lib/hook-runner.mjs';

const runFile = promisify(execFile);

/**
 * This suite drives the authoritative runner. Every fixture must be a throwaway
 * repository under the OS temporary directory and never this repository, so no
 * fixture can ever reach the framework clone's own Git state.
 */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const isInside = (parent, candidate) => candidate === parent
  || candidate.startsWith(`${parent}${path.sep}`);

const assertThrowawayRepository = async (root) => {
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

const isolatedGitEnvironment = () => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

const temporaryRoot = async (prefix) => mkdtemp(path.join(tmpdir(), prefix));

/** A throwaway clone with one baseline commit and an isolated Git configuration. */
const throwawayRepository = async (t) => {
  const root = await realpath(await temporaryRoot('gate-hook-runner-repo-'));

  t.after(() => rm(root, { recursive: true, force: true }));
  await assertThrowawayRepository(root);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\n', 'utf8');
  await runFile('git', ['init', '--quiet'], { cwd: root, env: isolatedGitEnvironment() });
  await runFile('git', ['add', '--all'], { cwd: root, env: isolatedGitEnvironment() });
  await runFile('git', [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Hook Runner',
    'commit', '--quiet', '--message', 'baseline',
  ], { cwd: root, env: isolatedGitEnvironment() });

  return root;
};

const deniableSubject = (root, overrides = {}) => ({
  subjectVersion: HOOK_PROGRAM_SELF_TEST_SUBJECT_VERSION,
  selfTestId: 'self-test-0001',
  expect: 'denied',
  change: { kind: 'self-test', root },
  checks: [{
    id: 'hook-program-self-test',
    required: true,
    outcome: 'failed',
    detail: 'A required check that fails.',
  }],
  ...overrides,
});

const withSubject = async (subject, run) => {
  const root = await temporaryRoot('gate-hook-runner-subject-');

  try {
    const subjectPath = path.join(root, 'subject.json');

    await writeFile(subjectPath, `${JSON.stringify(subject(root), null, 2)}\n`, 'utf8');

    return await run({ root, subjectPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test('the runner denies the activation self-test subject deliberately', async () => {
  const result = await withSubject(deniableSubject, ({ root, subjectPath }) => runHook({
    cwd: root,
    environment: { [SELF_TEST_ENV]: subjectPath },
  }));

  assert.notEqual(result.exitCode, 0, 'a proved runner exits non-zero for a subject it must deny.');
  assert.equal(result.reasonCode, 'self-test-denied');
  assert.match(result.lines.join('\n'), /change-evaluation-gate/);
  assert.match(result.lines.join('\n'), /denied/);
  // The denial names the run it answered, so a passing exit code can never be
  // mistaken for the proof of a different one.
  assert.match(result.lines.join('\n'), /self-test-0001/);
});

test('a self-test subject the runner cannot read is refused by its own reason, not by a crash', async () => {
  const root = await temporaryRoot('gate-hook-runner-subject-');

  try {
    const subjectPath = path.join(root, 'subject.json');

    await writeFile(subjectPath, 'not json at all', 'utf8');

    const result = await runHook({ cwd: root, environment: { [SELF_TEST_ENV]: subjectPath } });

    assert.notEqual(result.exitCode, 0);
    assert.equal(result.reasonCode, 'self-test-subject-unreadable');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a self-test subject of an unsupported version is refused rather than assumed deniable', async () => {
  const result = await withSubject(
    (root) => deniableSubject(root, { subjectVersion: 'change-evaluation-gate/self-test-subject/v99' }),
    ({ root, subjectPath }) => runHook({ cwd: root, environment: { [SELF_TEST_ENV]: subjectPath } }),
  );

  assert.notEqual(result.exitCode, 0);
  assert.equal(result.reasonCode, 'self-test-subject-unsupported');
});

test('a self-test subject with nothing deniable in it is refused, never denied on faith', async () => {
  const result = await withSubject(
    (root) => deniableSubject(root, {
      checks: [{ id: 'passing', required: true, outcome: 'passed', detail: 'nothing to deny' }],
    }),
    ({ root, subjectPath }) => runHook({ cwd: root, environment: { [SELF_TEST_ENV]: subjectPath } }),
  );

  assert.notEqual(result.exitCode, 0);
  assert.equal(
    result.reasonCode,
    'self-test-subject-not-deniable',
    'denying a subject that carries no failing required check would prove nothing about enforcement.',
  );
});

test('a clone with no configuration is refused; the runner never defaults one', async (t) => {
  const root = await throwawayRepository(t);

  const result = await runHook({ cwd: root, environment: {} });

  assert.notEqual(result.exitCode, 0, 'a runner that cannot read its configuration must not allow a commit.');
  assert.equal(result.reasonCode, 'configuration-missing');
  assert.match(result.lines.join('\n'), /change-evaluation-gate/);
});

test('a configuration the reader cannot read denies the commit with that reason', async (t) => {
  const root = await throwawayRepository(t);

  await writeFile(path.join(root, '.agent-framework.yaml'), 'schema_version: 4\n\tbackend: unknown\n', 'utf8');

  const result = await runHook({ cwd: root, environment: {} });

  assert.notEqual(result.exitCode, 0);
  assert.equal(result.reasonCode, 'configuration-unreadable');
});

test('a configuration with no Gate policy section is refused rather than invented', async (t) => {
  const root = await throwawayRepository(t);

  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    ['schema_version: 4', 'backend: unknown', ''].join('\n'),
    'utf8',
  );

  const result = await runHook({ cwd: root, environment: {} });

  assert.notEqual(result.exitCode, 0);
  assert.equal(result.reasonCode, 'gate-policy-missing');
});

test('a Gate policy the policy contract rejects denies rather than binding an evaluation', async (t) => {
  const root = await throwawayRepository(t);

  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    [
      'schema_version: 4',
      'evaluation_gate:',
      '  checks:',
      '    required:',
      '      - broad-tests.test',
      '    advisory: []',
      '  budget:',
      '    total_seconds: 0',
      '  bypass: {}',
      '  execution: {}',
      '  evidence: {}',
      '',
    ].join('\n'),
    'utf8',
  );

  const result = await runHook({ cwd: root, environment: {} });

  assert.notEqual(result.exitCode, 0);
  assert.equal(result.reasonCode, 'gate-policy-invalid');
});

/** A configured clone: schema v4, one required broad test, one Gate policy. */
const configureClone = async (root, overrides = {}) => {
  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(
    path.join(root, 'tools/check.mjs'),
    [
      "import { readFile } from 'node:fs/promises';",
      '',
      "const graded = await readFile(process.argv[2], 'utf8').catch(() => '');",
      '',
      'process.stdout.write(`graded ${graded.length} bytes\\n`);',
      "process.exitCode = graded.includes('BROKEN') ? 1 : 0;",
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
      '  profile: gate-hook-runner',
      '  capabilities: []',
      '  commands:',
      '    test:',
      '      backend: []',
      '      frontend: []',
      '      both:',
      `        - runner: ${overrides.runner ?? 'repository-script'}`,
      '          args:',
      `            - ${overrides.firstArgument ?? 'tools/check.mjs'}`,
      ...(overrides.firstArgument === undefined ? ['            - app/Order.php'] : []),
      '          working_directory: "."',
      '          timeout_seconds: 60',
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

test('a configured clone with no Activation receipt is refused; enforcement it never activated is not enforcement', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);

  const result = await runHook({ cwd: root, environment: {} });

  assert.notEqual(result.exitCode, 0, 'a runner that cannot find its receipt must not allow a commit.');
  assert.equal(result.reasonCode, 'activation-receipt-missing');
  assert.match(result.lines.join('\n'), /receipt/i);
});

/** The Activation receipt a real activation publishes; the runner's input here. */
const publishReceipt = async (root, overrides = {}) => {
  const common = (await runFile('git', ['rev-parse', '--git-common-dir'], {
    cwd: root,
    env: isolatedGitEnvironment(),
  })).stdout.trim();
  const directory = path.resolve(
    root,
    common,
    'change-evaluation-gate/evidence/activation',
  );

  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'receipt.json'),
    `${JSON.stringify({
      receiptVersion: 'change-evaluation-gate/activation-receipt/v1',
      receiptId: 'sha256:receipt',
      previewId: 'sha256:preview',
      repository: { root },
      configuration: { identity: 'sha256:configuration', schemaVersion: 4 },
      runtime: { gate: 'change-evaluation-gate', runnerVersion: 'fixture/1.0.0', runners: [] },
      ...overrides,
    }, null, 2)}\n`,
    'utf8',
  );

  return directory;
};

test('a logical runner that resolves to no platform executable denies rather than reaching for a shell', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root, { runner: 'php-script', firstArgument: 'tools/check.php' });
  await publishReceipt(root);

  const result = await runHook({
    cwd: root,
    environment: {},
    // Nothing resolves. An unresolved runner never falls back to a shell.
    resolveExecutable: () => null,
  });

  assert.notEqual(result.exitCode, 0);
  assert.equal(result.reasonCode, 'runner-unresolved');
  assert.match(result.lines.join('\n'), /configuration\.broad-tests\.test/);
});

test('a descriptor its own runner cannot compose is surfaced by that reason', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);

  const result = await runHook({
    cwd: root,
    environment: {},
    resolveExecutable: () => ({ executable: process.execPath, version: process.versions.node }),
    // The shared composition rule is the single place composition is decided;
    // a refusal from it is reported, never worked around here.
    composeArguments: () => ({
      args: null,
      error: { code: 'command-args-uncomposable', message: 'fixture refusal' },
    }),
  });

  assert.notEqual(result.exitCode, 0);
  assert.equal(result.reasonCode, 'command-args-uncomposable');
});

const stage = async (root, contents) => {
  await writeFile(path.join(root, 'app/Order.php'), contents, 'utf8');
  await runFile('git', ['add', '--all'], { cwd: root, env: isolatedGitEnvironment() });
};

test('a staged change whose required check fails is denied with a stated reason', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await stage(root, 'baseline\nBROKEN\n');

  const result = await runHook({ cwd: root, environment: process.env });
  const output = result.lines.join('\n');

  assert.notEqual(result.exitCode, 0, `expected a denial, got: ${output}`);
  assert.equal(result.reasonCode, 'denied');
  assert.match(output, /change-evaluation-gate/);
  assert.match(output, /failed/, 'the maintainer reading git commit output is told what failed.');
  assert.match(output, /configuration\.broad-tests\.test/);
});

test('a staged change whose required checks pass is allowed', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await stage(root, 'baseline\nrepaired\n');

  const result = await runHook({ cwd: root, environment: process.env });

  assert.equal(result.exitCode, 0, `expected an allow, got: ${result.lines.join('\n')}`);
  assert.equal(result.reasonCode, null);
});

test('the authoritative decision grades the proposed snapshot, not the mutable worktree', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await stage(root, 'baseline\nBROKEN\n');
  // The worktree is repaired after staging. The staged snapshot is still
  // broken, and that snapshot is what a commit would create (SG-EVAL-001).
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nrepaired\n', 'utf8');

  const result = await runHook({ cwd: root, environment: process.env });

  assert.notEqual(
    result.exitCode,
    0,
    'repairing the worktree after staging must not authorize the staged change.',
  );
  assert.equal(result.reasonCode, 'denied');
});

test('an evaluation that fails internally denies rather than exiting 0', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await stage(root, 'baseline\nrepaired\n');

  const result = await runHook({
    cwd: root,
    environment: process.env,
    evaluate: async () => { throw new Error('injected internal failure'); },
  });

  assert.notEqual(result.exitCode, 0);
  assert.equal(result.reasonCode, 'runner-failed');
  assert.match(result.lines.join('\n'), /injected internal failure/);
});

test('a decision that is not an allow authorization never exits 0', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await stage(root, 'baseline\nrepaired\n');

  const result = await runHook({
    cwd: root,
    environment: process.env,
    // A malformed decision proves nothing; absence of a denial is not an allow.
    evaluate: async () => ({ outcome: 'passed' }),
  });

  assert.notEqual(result.exitCode, 0);
  assert.equal(result.reasonCode, 'decision-malformed');
});

const PACKAGED_RUNNER = path.join(
  FRAMEWORK_ROOT,
  'skills/change-evaluation-gate/scripts/gate-precommit.mjs',
);

const runPackaged = async (cwd, environment = {}) => runFile(
  process.execPath,
  [PACKAGED_RUNNER],
  { cwd, env: { ...isolatedGitEnvironment(), ...environment } },
).then(
  ({ stdout, stderr }) => ({ exitCode: 0, output: `${stdout}${stderr}` }),
  (error) => ({ exitCode: error.code ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }),
);

test('the packaged runner is a program, not a library that exits 0 for anything', async (t) => {
  const root = await throwawayRepository(t);

  // The library that a real activation attempt pointed its hook at prints
  // nothing and exits 0. That is the defect this entry point exists to end.
  const library = await runFile(process.execPath, [
    path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts/lib/evaluate.mjs'),
  ], { cwd: root }).then(() => 0, (error) => error.code ?? 1);

  assert.equal(library, 0, 'the library entry point still exits 0; the regression this guards is real.');

  const packaged = await runPackaged(root);

  assert.notEqual(packaged.exitCode, 0, 'an unconfigured clone must not be allowed to commit.');
  assert.match(packaged.output, /change-evaluation-gate/);
  assert.match(packaged.output, /\.agent-framework\.yaml/);
});

test('the packaged runner answers the activation self-test by denying its subject', async (t) => {
  const root = await throwawayRepository(t);
  const subjectRoot = await temporaryRoot('gate-hook-runner-subject-');

  t.after(() => rm(subjectRoot, { recursive: true, force: true }));

  const subjectPath = path.join(subjectRoot, 'subject.json');

  await writeFile(subjectPath, `${JSON.stringify(deniableSubject(subjectRoot), null, 2)}\n`, 'utf8');

  const proved = await runPackaged(subjectRoot, { [SELF_TEST_ENV]: subjectPath });

  assert.notEqual(proved.exitCode, 0, 'activation refuses a program that allows a change it must deny.');
  assert.match(proved.output, /self-test-0001/);
  assert.equal(root.length > 0, true);
});

test('the packaged runner allows a passing staged change and denies a failing one', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await stage(root, 'baseline\nrepaired\n');

  const allowed = await runPackaged(root, { PATH: process.env.PATH });

  assert.equal(allowed.exitCode, 0, `expected an allow, got: ${allowed.output}`);

  await stage(root, 'baseline\nBROKEN\n');

  const refused = await runPackaged(root, { PATH: process.env.PATH });

  assert.notEqual(refused.exitCode, 0, `expected a denial, got: ${refused.output}`);
  assert.match(refused.output, /configuration\.broad-tests\.test/);
});
