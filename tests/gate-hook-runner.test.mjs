import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  HOOK_PROGRAM_SELF_TEST_SUBJECT_VERSION,
  configurationIdentity,
} from '../skills/change-evaluation-gate/scripts/lib/activation.mjs';
import { readRepositoryConfiguration } from '../skills/change-evaluation-gate/scripts/lib/configuration.mjs';
import { evaluate as realEvaluate } from '../skills/change-evaluation-gate/scripts/lib/evaluate.mjs';
import {
  contentIdentity,
  openEvidenceStore,
} from '../skills/change-evaluation-gate/scripts/lib/evidence-store.mjs';
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
      ...(overrides.inlineBytes === undefined
        ? ['  evidence: {}']
        : ['  evidence:', `    inline_bytes: ${overrides.inlineBytes}`]),
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

/**
 * The pin a real activation records for the configured check: the exact
 * executable it resolved and proved before it registered anything. The hook
 * runs what this names and never re-resolves it.
 */
const PINNED_RUNNER = Object.freeze({
  check_id: 'configuration.broad-tests.test',
  role: 'evaluate',
  runner: 'repository-script',
  executable: process.execPath,
  version: process.versions.node,
});

/**
 * The Activation receipt a real activation publishes; the runner's input here.
 *
 * TB-031: the pinned identities are COMPUTED the way `activate` computes them —
 * the configuration identity by `configurationIdentity` over the file this
 * clone was configured with, and the receipt id as the content identity of the
 * receipt body. A fixture pinning `sha256:configuration` describes a clone no
 * activation could produce, and now that the runner reconciles what the receipt
 * pinned, such a fixture would report drift on every commit.
 */
const publishReceipt = async (root, { runners = [PINNED_RUNNER], ...overrides } = {}) => {
  const common = (await runFile('git', ['rev-parse', '--git-common-dir'], {
    cwd: root,
    env: isolatedGitEnvironment(),
  })).stdout.trim();
  const directory = path.resolve(
    root,
    common,
    'change-evaluation-gate/evidence/activation',
  );
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
      runners,
    },
    ...overrides,
  };

  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'receipt.json'),
    `${JSON.stringify({ ...body, receiptId: contentIdentity(body) }, null, 2)}\n`,
    'utf8',
  );

  return directory;
};

test('TB-024 AC-EVAL-001: a check the receipt pins no executable for denies rather than resolving one', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  // A receipt that pins nothing describes an activation of different commands.
  // Resolving one here would run a program activation never proved.
  await publishReceipt(root, { runners: [] });

  const result = await runHook({ cwd: root, environment: process.env });

  assert.notEqual(result.exitCode, 0);
  assert.equal(result.reasonCode, 'runner-unpinned');
  assert.match(result.lines.join('\n'), /configuration\.broad-tests\.test/);
  assert.match(result.lines.join('\n'), /gate repair/);
});

test('TB-024 NFR-REL-003: a pinned executable that is gone denies as drift, never re-resolved to another program', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root, {
    runners: [{ ...PINNED_RUNNER, executable: path.join(root, 'vendor/bin/removed') }],
  });
  await stage(root, 'baseline\nrepaired\n');

  const result = await runHook({ cwd: root, environment: process.env });
  const output = result.lines.join('\n');

  assert.notEqual(
    result.exitCode,
    0,
    'a commit graded by a program the receipt never pinned is the defect TB-024 closes.',
  );
  assert.equal(result.reasonCode, 'runner-pin-drift');
  assert.match(output, /vendor\/bin\/removed/, 'the drift names the executable that is gone.');
  assert.match(output, /gate repair/, 'the maintainer is told what to do, and nothing is substituted.');
});

test('TB-024 NFR-REL-003: a pin recorded for a different runner is drift, not a near-enough match', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root, { runners: [{ ...PINNED_RUNNER, runner: 'php-script' }] });

  const result = await runHook({ cwd: root, environment: process.env });

  assert.notEqual(result.exitCode, 0);
  assert.equal(result.reasonCode, 'runner-pin-drift');
  assert.match(result.lines.join('\n'), /gate repair/);
});

test('a descriptor its own runner cannot compose is surfaced by that reason', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);

  const result = await runHook({
    cwd: root,
    environment: {},
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

/**
 * TB-026 — Persist the Evidence the authoritative decision is made from.
 *
 * `runHook` never bound an `evidenceStore`, so a commit-time evaluation
 * appended nothing: no envelope, no log entry, no Lifecycle event, and the
 * failing command's own output was discarded because output capture was off.
 * These fixtures drive the store the runner now opens against the receipt it
 * already reads, using real files under the throwaway clone's own
 * `.git/change-evaluation-gate/evidence`.
 */

/** Read-only access to whatever the packaged runner already wrote for `root`. */
const readStore = async (root) => openEvidenceStore({
  repositoryRoot: root,
  identity: {
    actor: { name: null, source: 'test-reader' },
    client: { id: 'git', surface: 'git-pre-commit', version: '1.0.0' },
    gate: { id: 'change-evaluation-gate', version: '1.0.0', protocolVersion: '1.0' },
    repository: { identity: 'sha256:read' },
  },
});

test('TB-026 AC-EVID-001, AC-EVAL-001: a denied commit persists exactly one Evidence envelope naming the failing check with its bounded output', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await stage(root, 'baseline\nBROKEN\n');

  const result = await runHook({ cwd: root, environment: process.env });

  assert.notEqual(result.exitCode, 0);

  const store = await readStore(root);
  const log = await store.readLog();

  assert.equal(log.length, 1, 'a denied commit must leave exactly one Evidence envelope.');

  const envelope = await store.readEnvelope(log[0].evidenceId);

  assert.notEqual(envelope, null);
  assert.equal(
    envelope.decision.checks.find((check) => check.id === 'configuration.broad-tests.test')?.outcome,
    'failed',
  );

  const attempt = envelope.retention.attempts
    .find((entry) => entry.checkId === 'configuration.broad-tests.test');

  assert.notEqual(attempt, undefined, 'the failing check must leave a retained attempt.');
  assert.match(
    attempt.inline,
    /graded \d+ bytes/,
    "the retained excerpt must carry what the check's own process actually printed.",
  );

  const evaluationEvent = (await store.readEvents()).find((event) => event.type === 'evaluation');

  assert.notEqual(evaluationEvent, undefined, 'AC-EVID-002, FR-EVID-005: the evaluation must leave a Lifecycle event.');
  assert.equal(evaluationEvent.outcome, 'succeeded');
  assert.equal(evaluationEvent.client.id, 'git');
  assert.equal(evaluationEvent.gate.id, 'change-evaluation-gate');
  assert.equal(typeof evaluationEvent.repository.identity, 'string');
  assert.equal(evaluationEvent.actor.authenticated, false, 'NFR-AUD-001: the actor is explicitly unauthenticated.');
});

test('TB-026 AC-EVID-001, AC-EVAL-001: an allowed commit also persists its Evidence envelope and Lifecycle event', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await stage(root, 'baseline\nrepaired\n');

  const result = await runHook({ cwd: root, environment: process.env });

  assert.equal(result.exitCode, 0, `expected an allow, got: ${result.lines.join('\n')}`);

  const store = await readStore(root);
  const log = await store.readLog();

  assert.equal(log.length, 1, 'an allowed commit must also leave exactly one Evidence envelope.');

  const envelope = await store.readEnvelope(log[0].evidenceId);

  assert.equal(envelope.decision.authorization, 'allow');
  assert.notEqual(
    envelope.retention.attempts.find((entry) => entry.checkId === 'configuration.broad-tests.test'),
    undefined,
  );
  assert.equal(
    (await store.readEvents()).filter((event) => event.type === 'evaluation').length,
    1,
    'one governed action, one Lifecycle event.',
  );
});

test('TB-026 SG-SECRET-001: a declared runtime input a check prints is redacted before it is persisted', async (t) => {
  const root = await throwawayRepository(t);
  const SECRET = 'sk-live-canary-4f2b81d0e6a7';

  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(
    path.join(root, 'tools/echo-secret.mjs'),
    "process.stdout.write(`token=${process.env.APP_TOKEN ?? ''}\\n`);\n",
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
      '        - runner: repository-script',
      '          args:',
      '            - tools/echo-secret.mjs',
      '          working_directory: "."',
      '          timeout_seconds: 60',
      '          allowed_environment:',
      '            - PATH',
      '            - APP_TOKEN',
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
  await publishReceipt(root, { runtimeInputs: ['APP_TOKEN'] });
  await stage(root, 'baseline\nrepaired\n');

  const result = await runHook({
    cwd: root,
    environment: { ...process.env, APP_TOKEN: SECRET },
  });

  assert.equal(result.exitCode, 0, `expected an allow, got: ${result.lines.join('\n')}`);

  const store = await readStore(root);
  const log = await store.readLog();
  const envelope = await store.readEnvelope(log[0].evidenceId);
  const serialized = JSON.stringify(envelope);

  assert.doesNotMatch(serialized, new RegExp(SECRET), 'the raw runtime input value must never reach the envelope.');
  assert.match(serialized, /\[redacted]/, 'the redaction placeholder must stand in for it.');

  const declared = envelope.redaction.secrets.find((secret) => secret.name === 'APP_TOKEN');

  assert.notEqual(declared, undefined);
  assert.equal(declared.source, 'approved-environment-file');
  assert.equal('value' in declared, false, 'only the name and source of a Sensitive input may be recorded, never its value.');
});

test("TB-026 FR-EVID-003: the ceilings applied are the clone's own evaluation_gate.evidence limits", async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root, { inlineBytes: 24 });
  await publishReceipt(root);
  await stage(root, 'baseline\nrepaired\n');

  const result = await runHook({ cwd: root, environment: process.env });

  assert.equal(result.exitCode, 0, `expected an allow, got: ${result.lines.join('\n')}`);

  const store = await readStore(root);
  const log = await store.readLog();
  const envelope = await store.readEnvelope(log[0].evidenceId);

  assert.equal(
    envelope.retention.limits.inlineBytes,
    24,
    "the clone's own lower configured ceiling must be the one applied, not the v1 default.",
  );
});

test('TB-026 NFR-REL-003: a store that cannot be opened denies the commit with a distinct stated reason', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await stage(root, 'baseline\nrepaired\n');

  const result = await runHook({
    cwd: root,
    environment: process.env,
    openEvidenceStore: async () => { throw new Error('injected: store cannot be opened'); },
  });

  assert.notEqual(result.exitCode, 0, 'a store that cannot be opened must never allow an unrecorded commit.');
  assert.equal(result.reasonCode, 'evidence-store-unavailable');
  assert.match(result.lines.join('\n'), /injected: store cannot be opened/);
});

test('TB-026 NFR-REL-003: an otherwise-passing commit whose evidence append fails is never allowed unrecorded', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await stage(root, 'baseline\nrepaired\n');

  const result = await runHook({
    cwd: root,
    environment: process.env,
    // The store opens fine; only persistence fails. `evaluate.mjs`'s own
    // `persistEvidence` treats this as a diagnosable local fault and leaves the
    // decision an `allow` (NFR-OPER-001) — the authoritative path's own,
    // stricter contract is what must turn that into a denial here.
    openEvidenceStore: async (options) => {
      const store = await openEvidenceStore(options);

      return { ...store, appendEvidence: async () => { throw new Error('injected: append failed'); } };
    },
  });

  assert.notEqual(
    result.exitCode,
    0,
    'the checks passed, but their evidence could not be recorded; that must never be treated as an allow.',
  );
  assert.equal(result.reasonCode, 'evidence-persistence-failed');
  assert.match(result.lines.join('\n'), /evidence-store-unavailable/);
});

test('TB-032 NFR-REL-001, AC-EVID-001: two commit attempts over identical content append one envelope and two log entries', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await stage(root, 'baseline\nrepaired\n');

  // Two real runs of the authoritative runner over the same staged content.
  // Each materializes its own `mkdtemp` execution root and each measures its
  // own wall-clock durations; neither is a fact about what was evaluated.
  const first = await runHook({ cwd: root, environment: process.env });
  const second = await runHook({ cwd: root, environment: process.env });

  assert.equal(first.exitCode, 0, `expected an allow, got: ${first.lines.join('\n')}`);
  assert.equal(second.exitCode, 0, `expected an allow, got: ${second.lines.join('\n')}`);

  const store = await readStore(root);
  const log = await store.readLog();

  assert.equal(log.length, 2, 'SG-EVID-001: every append is still recorded in the append-only log.');
  assert.equal(
    log[0].evidenceId,
    log[1].evidenceId,
    'NFR-REL-001: two evaluations of identical content must address one envelope.',
  );

  const files = (await readdir(store.paths.envelopes, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile());

  assert.equal(files.length, 1, 'AC-EVID-001: one evaluation, one stored envelope.');

  const envelope = await store.readEnvelope(log[0].evidenceId);

  assert.equal(
    JSON.stringify(envelope).includes('gate-hook-runner-exec-'),
    false,
    'NFR-REL-001: no host-local execution root may reach the stored envelope.',
  );
  assert.equal(
    envelope.decision.evidence.persisted,
    true,
    'NFR-AUD-001: the stored record must not state that it was never recorded.',
  );
  assert.equal(envelope.decision.evidence.reference.evidenceId, envelope.evidenceId);

  // The run-local execution root stays available to a maintainer, on the
  // per-append log entry that is not content-addressed.
  assert.match(log[0].execution.executionRoot, /gate-hook-runner-exec-/);
  assert.notEqual(
    log[0].execution.executionRoot,
    log[1].execution.executionRoot,
    'the two runs really did materialize different execution roots.',
  );
  assert.equal(
    (await store.readEvents()).filter((event) => event.type === 'evaluation').length,
    2,
    'NFR-AUD-001: one governed action, one Lifecycle event — deduplication changes nothing here.',
  );
});

test('TB-026: the activation self-test writes no Evidence and leaves no store entry', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);

  const subjectRoot = await temporaryRoot('gate-hook-runner-subject-');

  t.after(() => rm(subjectRoot, { recursive: true, force: true }));

  const subjectPath = path.join(subjectRoot, 'subject.json');

  await writeFile(subjectPath, `${JSON.stringify(deniableSubject(subjectRoot), null, 2)}\n`, 'utf8');

  const result = await runHook({ cwd: root, environment: { [SELF_TEST_ENV]: subjectPath } });

  assert.notEqual(result.exitCode, 0);
  assert.equal(result.reasonCode, 'self-test-denied');

  const store = await readStore(root);

  assert.deepEqual(await store.readLog(), [], 'the self-test must persist no Evidence envelope.');
  assert.equal(
    (await store.readEvents()).some((event) => event.type === 'evaluation'),
    false,
    'the self-test must leave no evaluation Lifecycle event: it proves the program, never the clone.',
  );
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

/**
 * TB-033 — Fail closed on any decision the runner cannot verify.
 *
 * `report` accepted any decision whose `authorization` and `outcome` were
 * strings, so the minimal shape below — no checks, no evidence, no evaluation
 * identity, no snapshot — exited `0` and the commit proceeded. These fixtures
 * drive the real `runHook` through its injected `evaluate` seam, because the
 * defect is not that the contract cannot describe a complete decision but that
 * the authoritative runner never asked it to.
 */

test('TB-033 NFR-REL-003: a decision that claims allow but proves nothing never exits 0', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await stage(root, 'baseline\nrepaired\n');

  const result = await runHook({
    cwd: root,
    environment: process.env,
    evaluate: async () => ({ authorization: 'allow', outcome: 'passed' }),
  });

  assert.notEqual(
    result.exitCode,
    0,
    'a decision naming no checks, no evidence, no evaluation identity and no snapshot authorizes nothing.',
  );
  assert.equal(result.reasonCode, 'decision-malformed');
});

/**
 * A decision complete enough to be worth altering: the real evaluation is run
 * first, and each fixture below returns that decision with exactly one part
 * removed or corrupted. Building the shape by hand would prove only that the
 * hand-built shape is rejected, and the interesting question is whether a
 * decision that is complete but for one missing part still reaches `exit 0`.
 */
const decisionFromRealEvaluation = async (root) => {
  let captured = null;

  await runHook({
    cwd: root,
    environment: process.env,
    evaluate: async (request, options) => {
      captured = await realEvaluate(request, options);

      return captured;
    },
  });

  return captured;
};

test('TB-033 AC-EVAL-001: a decision missing any one part it is judged by denies with a stated reason', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await stage(root, 'baseline\nrepaired\n');

  const complete = await decisionFromRealEvaluation(root);

  assert.notEqual(complete, null, 'the fixture must start from a decision the runner really allows.');

  const mutilations = {
    checks: (decision) => ({ ...decision, checks: undefined }),
    evaluationId: (decision) => ({ ...decision, evaluationId: undefined }),
    snapshot: (decision) => ({ ...decision, snapshot: undefined }),
    evidence: (decision) => ({ ...decision, evidence: undefined }),
  };

  for (const [part, mutilate] of Object.entries(mutilations)) {
    const result = await runHook({
      cwd: root,
      environment: process.env,
      evaluate: async () => mutilate(complete),
    });

    assert.notEqual(result.exitCode, 0, `a decision missing ${part} must not authorize a commit.`);
    assert.equal(result.reasonCode, 'decision-malformed', `a decision missing ${part} denies.`);
    assert.match(
      result.lines.join('\n'),
      new RegExp(part),
      `the denial must name the ${part} it could not read.`,
    );
  }
});

test('TB-033 NFR-REL-003: an allow whose evidence was not positively persisted denies whatever shape the claim takes', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await stage(root, 'baseline\nrepaired\n');

  const complete = await decisionFromRealEvaluation(root);

  assert.equal(complete?.authorization, 'allow');
  assert.equal(complete?.evidence?.persisted, true);

  // Absent, false, and malformed persistence take one path: an allow is
  // authorized by evidence that was recorded, never by the absence of a
  // statement that it was not.
  const claims = {
    absent: { ...complete.evidence, persisted: undefined },
    stated: { ...complete.evidence, persisted: false },
    unreferenced: { ...complete.evidence, persisted: true, reference: null },
    referenceless: {
      ...complete.evidence,
      persisted: true,
      reference: { ...complete.evidence.reference, evidenceId: null },
    },
  };

  for (const [shape, evidence] of Object.entries(claims)) {
    const result = await runHook({
      cwd: root,
      environment: process.env,
      evaluate: async () => ({ ...complete, evidence }),
    });

    assert.notEqual(result.exitCode, 0, `an allow with ${shape} evidence must not authorize a commit.`);
    assert.match(
      result.lines.join('\n'),
      /evidence/,
      `the denial for ${shape} evidence must say what could not be proved.`,
    );
  }
});

test('TB-033 AC-EVAL-002: the runner keeps no second completeness rule of its own', async () => {
  const source = await readFile(
    path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts/lib/hook-runner.mjs'),
    'utf8',
  );

  assert.match(
    source,
    /validateDecision\(/,
    'completeness is judged by the contract that defines it.',
  );
});
