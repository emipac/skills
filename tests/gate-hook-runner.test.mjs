import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  access, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile,
} from 'node:fs/promises';
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
import { BYPASS_GRANT_VERSION } from '../skills/change-evaluation-gate/scripts/lib/policy.mjs';
import { captureSnapshot } from '../skills/change-evaluation-gate/scripts/lib/snapshot.mjs';

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
      // `null` declares literally nothing ambient (`TB-059`); a list adds to `PATH`.
      ...(overrides.allowedEnvironment === null
        ? ['          allowed_environment: []']
        : [
          '          allowed_environment:',
          '            - PATH',
          ...(overrides.allowedEnvironment ?? []).map((name) => `            - ${name}`),
        ]),
      '          evidence_category: test',
      '          source_scope: both',
      ...((overrides.prerequisites ?? []).length === 0
        ? []
        : [
          '          prerequisites:',
          ...overrides.prerequisites.flatMap((prerequisite) => [
            `            - kind: ${prerequisite.kind}`,
            `              name: ${prerequisite.name}`,
          ]),
        ]),
      'evaluation_gate:',
      '  checks:',
      '    required:',
      '      - configuration.broad-tests.test',
      '    advisory: []',
      '  budget:',
      '    total_seconds: 600',
      '  bypass:',
      ...(overrides.bypass === undefined
        ? ['    enabled: false']
        : [
          `    enabled: ${overrides.bypass.enabled}`,
          `    marker: ${JSON.stringify(overrides.bypass.marker ?? null)}`,
          ...(overrides.bypass.require_reference === undefined
            ? []
            : [`    require_reference: ${overrides.bypass.require_reference}`]),
        ]),
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
  // The receipt pins names only; the source recorded is where the runner
  // actually read the value: its own environment (TB-045).
  assert.equal(declared.source, 'environment');
  assert.equal('value' in declared, false, 'only the name and source of a Sensitive input may be recorded, never its value.');
});

/**
 * A synthetic canary in a shape NO built-in pattern matches: a bare value in a
 * stack trace, with no variable name, no `=`, no scheme, no URL. Only a rule
 * armed from the declared value can catch it; a canary printed as `TOKEN=…`
 * would pass on the pattern layer alone and prove nothing about `TB-045`.
 */
const PATTERN_INVISIBLE_CANARY = 'qz7v3m9k2p5w8r4t1y6u0n';

const configureSensitiveClone = async (root, {
  declared = [], allowedEnvironment = ['APP_KEY'], environmentFiles = [],
} = {}) => {
  await configureClone(root, { allowedEnvironment });
  await writeFile(
    path.join(root, 'tools/check.mjs'),
    [
      "import { readFile } from 'node:fs/promises';",
      '',
      "const graded = await readFile(process.argv[2], 'utf8').catch(() => '');",
      "const key = process.env.APP_KEY ?? '';",
      '',
      "process.stdout.write('Error: could not connect\\n');",
      // The bare value, alone on a line, and again inside a stack frame.
      "process.stdout.write(`    at connect (${key})\\n`);",
      "process.stdout.write(`${key}\\n`);",
      'process.stdout.write(`graded ${graded.length} bytes\\n`);',
      "process.exitCode = graded.includes('BROKEN') ? 1 : 0;",
      '',
    ].join('\n'),
    'utf8',
  );

  if (declared.length > 0) {
    const document = await readFile(path.join(root, '.agent-framework.yaml'), 'utf8');
    const evidence = {
      sensitive_inputs: declared,
      ...(environmentFiles.length > 0 ? { environment_files: environmentFiles } : {}),
    };

    await writeFile(
      path.join(root, '.agent-framework.yaml'),
      document.replace('  evidence: {}', `  evidence: ${JSON.stringify(evidence)}`),
      'utf8',
    );
  }
};

/** Every byte the store holds, so a value cannot hide in one file. */
const storedBytes = async (root) => {
  const store = await readStore(root);
  const entries = await readdir(store.root, { recursive: true, withFileTypes: true });
  const contents = [];

  for (const entry of entries) {
    if (entry.isFile()) {
      contents.push(await readFile(path.join(entry.parentPath ?? entry.path, entry.name), 'utf8'));
    }
  }

  return contents.join('\n');
};

test('TB-045 AC-CFG-004, NFR-SEC-003: a declared value printed in a shape no built-in pattern matches is absent from every stored byte', async (t) => {
  const root = await throwawayRepository(t);

  await configureSensitiveClone(root, { declared: ['APP_KEY'] });
  await publishReceipt(root, { runtimeInputs: ['APP_KEY'] });
  await stage(root, 'baseline\nrepaired\n');

  const result = await runHook({
    cwd: root,
    environment: { ...process.env, APP_KEY: PATTERN_INVISIBLE_CANARY },
  });

  assert.equal(result.exitCode, 0, `expected an allow, got: ${result.lines.join('\n')}`);

  const retained = [
    await storedBytes(root),
    await readFile(path.join(root, '.agent-framework.yaml'), 'utf8'),
    result.lines.join('\n'),
  ].join('\n');

  assert.equal(retained.includes(PATTERN_INVISIBLE_CANARY), false, 'the raw value survived in stored bytes.');
  assert.equal(
    retained.includes(Buffer.from(PATTERN_INVISIBLE_CANARY).toString('base64')),
    false,
    'an encoded form of the value survived in stored bytes.',
  );

  const store = await readStore(root);
  const log = await store.readLog();
  const envelope = await store.readEnvelope(log[0].evidenceId);

  assert.deepEqual(envelope.redaction.secrets, [{ name: 'APP_KEY', source: 'environment' }]);
  assert.equal('unresolved' in envelope.redaction, false);
  assert.ok(
    envelope.redaction.rules.some((rule) => rule.rule === 'declared:APP_KEY' && rule.count >= 2),
    `the declared rule must be the one that caught it: ${JSON.stringify(envelope.redaction.rules)}`,
  );

  const blobs = await store.listBlobs();

  assert.ok(blobs.length > 0, 'the check output must have been retained as a blob to scan.');
});

test('TB-045 AC-EVID-001: two runs printing the same declared value address one envelope, derived over redacted bytes', async (t) => {
  const root = await throwawayRepository(t);

  await configureSensitiveClone(root, { declared: ['APP_KEY'] });
  await publishReceipt(root, { runtimeInputs: ['APP_KEY'] });
  await stage(root, 'baseline\nrepaired\n');

  const environment = { ...process.env, APP_KEY: PATTERN_INVISIBLE_CANARY };
  const first = await runHook({ cwd: root, environment });
  const second = await runHook({ cwd: root, environment });

  assert.equal(first.exitCode, 0);
  assert.equal(second.exitCode, 0);

  const store = await readStore(root);
  const log = await store.readLog();

  assert.equal(log.length, 2, 'each attempt is logged.');
  assert.equal(log[0].evidenceId, log[1].evidenceId, 'identical redacted content is one envelope.');
  assert.equal((await store.readEnvelope(log[0].evidenceId)).redaction.applied > 0, true);
});

test('TB-045: a declared name this environment does not set is recorded as unresolved, not an error and not silence', async (t) => {
  const root = await throwawayRepository(t);

  await configureSensitiveClone(root, { declared: ['APP_KEY'] });
  await publishReceipt(root, { runtimeInputs: ['APP_KEY'] });
  await stage(root, 'baseline\nrepaired\n');

  const environment = { ...process.env };

  delete environment.APP_KEY;

  const result = await runHook({ cwd: root, environment });

  assert.equal(result.exitCode, 0, `an absent declared input is not an error: ${result.lines.join('\n')}`);

  const store = await readStore(root);
  const log = await store.readLog();
  const envelope = await store.readEnvelope(log[0].evidenceId);

  // Nothing could be armed for it, and the envelope says exactly that.
  assert.deepEqual(envelope.redaction.secrets, []);
  assert.deepEqual(envelope.redaction.unresolved, [{ name: 'APP_KEY', source: 'environment' }]);
  assert.equal(JSON.stringify(envelope).includes('"value"'), false);
});

test('TB-045: a clone declaring nothing writes the envelope it always did; the pattern layer alone applies', async (t) => {
  const root = await throwawayRepository(t);

  await configureSensitiveClone(root);
  await publishReceipt(root);
  await stage(root, 'baseline\nrepaired\n');

  const result = await runHook({
    cwd: root,
    environment: { ...process.env, APP_KEY: PATTERN_INVISIBLE_CANARY },
  });

  assert.equal(result.exitCode, 0);

  const store = await readStore(root);
  const log = await store.readLog();
  const envelope = await store.readEnvelope(log[0].evidenceId);

  assert.deepEqual(envelope.redaction.secrets, []);
  assert.equal('unresolved' in envelope.redaction, false, 'an undeclared clone gains no new envelope field.');
  assert.deepEqual(
    Object.keys(envelope.redaction),
    ['version', 'secrets', 'rules', 'applied', 'redactedBytes'],
  );
  // And, stated so nobody overclaims: with nothing declared, a pattern-invisible
  // value is retained. This is today's behaviour, unchanged.
  assert.equal((await storedBytes(root)).includes(PATTERN_INVISIBLE_CANARY), true);
});

/**
 * `TB-059` — `FR-CFG-006`, `AC-EVAL-001`, `AC-CFG-004`, `SG-SECRET-001`,
 * `NFR-SEC-003`, `SG-EVAL-001`, `AC-EVID-001`.
 *
 * A stack-shaped fixture: the check needs a key the project keeps ONLY in a
 * git-ignored environment file, beside a second value nobody declared. Before
 * this slice the check failed inside the snapshot with the key absent; after
 * it, the approved name is resolved from the declared file, handed to the
 * check through its environment regardless of `allowed_environment`, scrubbed
 * from every stored byte, and gone with the execution root.
 *
 * Every value here is a synthetic literal invented for the fixture.
 */
const FILE_CANARY = 'k8r2w9m4x7c1v5b3n6q0zj';

const DECOY_CANARY = 'decoy-h4j7l2p9s5d8f1g6a3';

/** A check that boots only with the key, prints it bare, and reports what else it saw. */
const configureKeyedClone = async (root, {
  environmentFiles = ['.env'], declared = ['APP_KEY'], allowedEnvironment = null, envFile = null,
} = {}) => {
  await configureSensitiveClone(root, { declared, environmentFiles, allowedEnvironment });
  await writeFile(
    path.join(root, 'tools/check.mjs'),
    [
      "import { readFile } from 'node:fs/promises';",
      '',
      "const graded = await readFile(process.argv[2], 'utf8').catch(() => '');",
      "const key = process.env.APP_KEY ?? '';",
      '',
      "if (key === '') {",
      "  process.stdout.write('No application encryption key has been specified.\\n');",
      '  process.exit(1);',
      '}',
      '',
      // The bare value inside a stack frame, matching no built-in pattern.
      "process.stdout.write(`    at boot (${key})\\n`);",
      'process.stdout.write(`key length ${key.length}\\n`);',
      "process.stdout.write(`decoy ${process.env.OTHER_SECRET ?? 'absent'}\\n`);",
      "process.stdout.write(`home ${process.env.HOME ?? 'absent'}\\n`);",
      'process.stdout.write(`graded ${graded.length} bytes\\n`);',
      "process.exitCode = graded.includes('BROKEN') ? 1 : 0;",
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(path.join(root, '.gitignore'), '.env\n', 'utf8');
  await runFile('git', ['add', '--all'], { cwd: root, env: isolatedGitEnvironment() });
  await runFile('git', [
    '-c', 'user.email=gate@example.test', '-c', 'user.name=Gate Hook Runner',
    'commit', '--quiet', '--message', 'configure',
  ], { cwd: root, env: isolatedGitEnvironment() });

  if (envFile !== null) {
    await writeFile(path.join(root, '.env'), envFile, 'utf8');
  }
};

/** The runner's environment with nothing of the fixture in it. */
const bareEnvironment = () => {
  const environment = { ...process.env };

  delete environment.APP_KEY;
  delete environment.OTHER_SECRET;

  return environment;
};

const inlineOutputOf = (envelope) => envelope.retention.attempts
  .map((attempt) => attempt.inline ?? '')
  .join('\n');

test('TB-059 FR-CFG-006 / AC-EVAL-001: a key kept only in a git-ignored environment file reaches the check, and no stored byte keeps it', async (t) => {
  const root = await throwawayRepository(t);

  await configureKeyedClone(root, { envFile: `APP_KEY=${FILE_CANARY}\nOTHER_SECRET=${DECOY_CANARY}\n` });
  await publishReceipt(root, { runtimeInputs: ['APP_KEY'] });
  await stage(root, 'baseline\nrepaired\n');

  // The store elides every host path, so the real root is observed through
  // the evaluate seam, and the owner-only file through the executor, while
  // the check is about to run.
  const observed = { executionRoot: null, inputFile: null, mode: null, contents: null };
  const allowed = await runHook({
    cwd: root,
    environment: bareEnvironment(),
    evaluate: async (request, dependencies) => {
      observed.executionRoot = dependencies.executionRoot;

      return realEvaluate(request, {
        ...dependencies,
        execute: async (options) => {
          const { stat } = await import('node:fs/promises');

          observed.inputFile = path.join(options.executionRoot, '.change-evaluation-gate-runtime-inputs', 'APP_KEY');
          observed.mode = (await stat(observed.inputFile)).mode & 0o777;
          observed.contents = await readFile(observed.inputFile, 'utf8');

          return dependencies.execute(options);
        },
      });
    },
  });

  assert.equal(allowed.exitCode, 0, `the check must boot with the resolved key: ${allowed.lines.join('\n')}`);
  assert.equal(observed.mode, 0o600, 'the materialized value is owner-only while the check runs.');
  assert.equal(observed.contents, FILE_CANARY);
  assert.equal(
    observed.executionRoot.startsWith(await realpath(tmpdir())),
    true,
    'the transient lives under the OS temporary directory, and nowhere else.',
  );

  // The same commit with a required failure still blocks: nothing about
  // handing the key over changed what is graded.
  await stage(root, 'baseline\nBROKEN\n');

  const denied = await runHook({ cwd: root, environment: bareEnvironment() });

  assert.notEqual(denied.exitCode, 0);
  assert.equal(denied.reasonCode, 'denied');

  const store = await readStore(root);
  const log = await store.readLog();

  assert.equal(log.length, 2);

  const envelope = await store.readEnvelope(log[0].evidenceId);
  const inline = inlineOutputOf(envelope);

  // What the check saw: the key (redacted here), no decoy, no ambient variable
  // its descriptor did not list — it listed none.
  assert.match(inline, /at boot \(\[redacted]\)/, `the check must have printed the redacted key: ${inline}`);
  assert.match(inline, new RegExp(`key length ${FILE_CANARY.length}`));
  assert.match(inline, /decoy absent/, 'the undeclared name in the file reached the check.');
  assert.match(inline, /home absent/, 'an ambient variable the descriptor did not list reached the check.');

  // Names and sources only, and the file's own status.
  assert.deepEqual(envelope.redaction.secrets, [{ name: 'APP_KEY', source: '.env' }]);
  assert.equal('unresolved' in envelope.redaction, false);
  assert.deepEqual(envelope.redaction.environmentFiles, [{ path: '.env', status: 'read' }]);
  assert.ok(envelope.redaction.rules.some((rule) => rule.rule === 'declared:APP_KEY' && rule.count >= 1));
  assert.ok((await store.listBlobs()).length > 0, 'the check output must be retained as a blob to scan.');

  // Every stored byte, every recognized form, both values.
  const retained = [
    await storedBytes(root),
    await readFile(path.join(root, '.agent-framework.yaml'), 'utf8'),
    allowed.lines.join('\n'),
    denied.lines.join('\n'),
  ].join('\n');

  for (const canary of [FILE_CANARY, DECOY_CANARY]) {
    for (const form of [
      canary,
      Buffer.from(canary).toString('base64'),
      Buffer.from(canary).toString('base64url'),
      Buffer.from(canary).toString('hex'),
      encodeURIComponent(canary),
    ]) {
      assert.equal(retained.includes(form), false, `a form of ${canary === FILE_CANARY ? 'the key' : 'the decoy'} survived in stored bytes.`);
    }
  }

  assert.equal(retained.includes('OTHER_SECRET'), false, 'the undeclared name was never read, so it is nowhere.');

  // The execution root, and the owner-only file beneath it, are gone. (The
  // log entry keeps the root's path for diagnosis, as it always has; host-path
  // redaction is its own gap and not this slice's.)
  assert.equal(log[0].execution.executionRoot, observed.executionRoot, 'the log names the root the check ran in.');
  assert.equal(
    await readdir(observed.executionRoot).then(() => true, () => false),
    false,
    'the execution root must be removed with the evaluation.',
  );
  assert.equal(await readFile(observed.inputFile, 'utf8').then(() => true, () => false), false);
});

test('TB-059: the runner environment beats the declared file, which is then not consulted', async (t) => {
  const root = await throwawayRepository(t);
  const fromEnvironment = 'env-first-a1b2c3d4e5f6g7h8';

  await configureKeyedClone(root, { envFile: `APP_KEY=${FILE_CANARY}\n` });
  await publishReceipt(root, { runtimeInputs: ['APP_KEY'] });
  await stage(root, 'baseline\nrepaired\n');

  const result = await runHook({ cwd: root, environment: { ...bareEnvironment(), APP_KEY: fromEnvironment } });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));

  const store = await readStore(root);
  const envelope = await store.readEnvelope((await store.readLog())[0].evidenceId);

  assert.match(inlineOutputOf(envelope), new RegExp(`key length ${fromEnvironment.length}`), 'the environment value is the one handed over.');
  assert.deepEqual(envelope.redaction.secrets, [{ name: 'APP_KEY', source: 'environment' }]);
  assert.deepEqual(envelope.redaction.environmentFiles, [{ path: '.env', status: 'not-consulted' }]);
  assert.equal((await storedBytes(root)).includes(FILE_CANARY), false, 'the file value was read although the environment set the name.');
});

test('TB-059: a declared name in neither the environment nor the file is unresolved, with where it was looked for; the decoy is still never read', async (t) => {
  const root = await throwawayRepository(t);

  // The TB-045 check, which does not need the key, so the commit is graded.
  await configureSensitiveClone(root, { declared: ['APP_KEY'], environmentFiles: ['.env'] });
  await writeFile(path.join(root, '.gitignore'), '.env\n', 'utf8');
  await writeFile(path.join(root, '.env'), `OTHER_SECRET=${DECOY_CANARY}\n`, 'utf8');
  await publishReceipt(root, { runtimeInputs: ['APP_KEY'] });
  await stage(root, 'baseline\nrepaired\n');

  const result = await runHook({ cwd: root, environment: bareEnvironment() });

  assert.equal(result.exitCode, 0, `an unresolved input is not an error: ${result.lines.join('\n')}`);

  const store = await readStore(root);
  const envelope = await store.readEnvelope((await store.readLog())[0].evidenceId);

  assert.deepEqual(envelope.redaction.secrets, []);
  assert.deepEqual(envelope.redaction.unresolved, [{ name: 'APP_KEY', source: 'environment', searched: ['environment', '.env'] }]);
  assert.deepEqual(envelope.redaction.environmentFiles, [{ path: '.env', status: 'read' }]);
  assert.equal((await storedBytes(root)).includes(DECOY_CANARY), false);
});

test('TB-059 FR-CFG-006: a declared file that is tracked is refused, never read, and the name stays unresolved', async (t) => {
  const root = await throwawayRepository(t);

  await configureKeyedClone(root);
  // Tracked: the file is in the snapshot already, so it is a second source.
  await writeFile(path.join(root, '.gitignore'), '', 'utf8');
  await writeFile(path.join(root, '.env'), `APP_KEY=${FILE_CANARY}\n`, 'utf8');
  await runFile('git', ['add', '--all'], { cwd: root, env: isolatedGitEnvironment() });
  await runFile('git', [
    '-c', 'user.email=gate@example.test', '-c', 'user.name=Gate Hook Runner',
    'commit', '--quiet', '--message', 'track the file',
  ], { cwd: root, env: isolatedGitEnvironment() });
  await publishReceipt(root, { runtimeInputs: ['APP_KEY'] });
  await stage(root, 'baseline\nrepaired\n');

  const result = await runHook({ cwd: root, environment: bareEnvironment() });

  // The check needs the key and did not get it: a real required failure.
  assert.equal(result.reasonCode, 'denied', result.lines.join('\n'));

  const store = await readStore(root);
  const envelope = await store.readEnvelope((await store.readLog())[0].evidenceId);

  assert.match(inlineOutputOf(envelope), /No application encryption key/);
  assert.deepEqual(envelope.redaction.environmentFiles, [{ path: '.env', status: 'tracked' }]);
  assert.deepEqual(envelope.redaction.unresolved, [{ name: 'APP_KEY', source: 'environment', searched: ['environment'] }]);
});

test('TB-059 SG-EVAL-001 / NFR-REL-001: the materialized input moves neither the snapshot identity nor its immutability re-check', async (t) => {
  const root = await throwawayRepository(t);

  await configureKeyedClone(root, { envFile: `APP_KEY=${FILE_CANARY}\n` });
  await publishReceipt(root, { runtimeInputs: ['APP_KEY'] });
  await stage(root, 'baseline\nrepaired\n');

  const withInput = await runHook({ cwd: root, environment: bareEnvironment() });

  assert.equal(withInput.exitCode, 0, withInput.lines.join('\n'));

  // Same tracked content, nothing to materialize: the file is gone, so the
  // check fails, but the identity of what was graded is the same identity.
  await rm(path.join(root, '.env'));

  const withoutInput = await runHook({ cwd: root, environment: bareEnvironment() });

  assert.equal(withoutInput.reasonCode, 'denied');

  const store = await readStore(root);
  const log = await store.readLog();
  const first = await store.readEnvelope(log[0].evidenceId);
  const second = await store.readEnvelope(log[1].evidenceId);

  assert.equal(first.decision.snapshot.id, second.decision.snapshot.id, 'the runtime-input directory is outside the identity.');
  assert.equal(
    first.decision.diagnostics.some((diagnostic) => diagnostic.reasonCode === 'snapshot-mismatch'),
    false,
    'the immutability re-check must not see the runtime-input directory.',
  );
  assert.equal(first.decision.outcome, 'passed');
});

test('TB-059 AC-EVID-001: two runs printing a value resolved from the file address one envelope', async (t) => {
  const root = await throwawayRepository(t);

  await configureKeyedClone(root, { envFile: `APP_KEY=${FILE_CANARY}\n` });
  await publishReceipt(root, { runtimeInputs: ['APP_KEY'] });
  await stage(root, 'baseline\nrepaired\n');

  const first = await runHook({ cwd: root, environment: bareEnvironment() });
  const second = await runHook({ cwd: root, environment: bareEnvironment() });

  assert.equal(first.exitCode, 0);
  assert.equal(second.exitCode, 0);

  const log = await (await readStore(root)).readLog();

  assert.equal(log.length, 2);
  assert.equal(log[0].evidenceId, log[1].evidenceId, 'redaction preceded persistence on both runs.');
});

test('TB-059 FR-CFG-006: an interrupted run leaves the owner-only file to the sweep, which removes it with the root', async (t) => {
  const { materializeRuntimeInputs, RUNTIME_INPUT_DIRECTORY } = await import(
    '../skills/change-evaluation-gate/scripts/lib/security-control.mjs'
  );
  const { sweepOrphanedExecutionRoots, EXECUTION_ROOT_RETENTION_MS } = await import(
    '../skills/change-evaluation-gate/scripts/lib/hook-runner.mjs'
  );
  const { utimes, stat } = await import('node:fs/promises');
  const sweepRoot = await realpath(await temporaryRoot('gate-hook-runner-sweep-'));

  t.after(() => rm(sweepRoot, { recursive: true, force: true }));

  // What a run interrupted by SIGKILL leaves: a root under the gate's prefix
  // holding the materialized input, and no `finally` that ever ran.
  const abandoned = path.join(sweepRoot, 'gate-hook-runner-exec-interrupted');

  await mkdir(abandoned, { recursive: true });

  const materialized = await materializeRuntimeInputs({
    approved: ['APP_KEY'],
    inputs: [{ name: 'APP_KEY', source: '.env', value: FILE_CANARY }],
    executionRoot: abandoned,
  });
  const inputFile = path.join(abandoned, RUNTIME_INPUT_DIRECTORY, 'APP_KEY');

  assert.equal((await stat(inputFile)).mode & 0o777, 0o600);

  const stale = new Date(Date.now() - EXECUTION_ROOT_RETENTION_MS - 60_000);

  await utimes(abandoned, stale, stale);

  const swept = await sweepOrphanedExecutionRoots({ temporaryRoot: sweepRoot });

  assert.deepEqual(swept.removed, [abandoned]);
  assert.equal(await stat(inputFile).then(() => true, () => false), false, 'the owner-only file must be gone with the root.');
  assert.equal(await stat(materialized.directory).then(() => true, () => false), false);
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

/**
 * TB-044: the three faults a real `gms` run at 0.11.2 reported as defects in
 * the project, each expressed as the requirement its check never got.
 *
 * The fixtures state the requirement, never the tool: a command whose
 * arguments only work where source-control history is present, a check whose
 * limits are delivered through a named environment variable, and a check that
 * reads paths a build step generates and the snapshot therefore never holds.
 * Gate core learns none of those names — the clone's configuration declares
 * them, exactly as the configuration declares the commands themselves
 * (`SG-OWNER-001`).
 */
const ENVIRONMENT_FAULTS = Object.freeze([
  {
    label: 'arguments that only work inside a repository',
    prerequisites: [{ kind: 'environment', name: 'source-control-history' }],
    named: /source-control-history/,
  },
  {
    label: 'limits delivered through an environment name the runtime does not carry',
    prerequisites: [{ kind: 'environment', name: 'ANALYZER_MEMORY_LIMIT' }],
    named: /ANALYZER_MEMORY_LIMIT/,
  },
  {
    label: 'generated paths the snapshot never holds',
    prerequisites: [{ kind: 'configuration', name: 'app/generated' }],
    named: /app\/generated/,
  },
]);

test('TB-044 AC-EVAL-003: a check whose declared prerequisite this environment does not satisfy is unverified and never runs, where it reported a verdict about the code before', async (t) => {
  for (const fault of ENVIRONMENT_FAULTS) {
    const root = await throwawayRepository(t);

    await configureClone(root, { prerequisites: fault.prerequisites });
    await publishReceipt(root);
    // Content the check itself would reject. Before this slice the check ran
    // in an environment it could not work in and its failure was reported as
    // `grader-negative` — a finding about the maintainer's code.
    await stage(root, 'baseline\nBROKEN\n');

    const decision = await decisionFromRealEvaluation(root);
    const [check] = decision?.checks ?? [];

    assert.equal(check?.outcome, 'unverified', `${fault.label}: a check that could not run says so.`);
    assert.equal(check?.reasonCode, 'prerequisite-missing', fault.label);
    assert.equal(
      check?.attempts?.[0]?.exitCode,
      null,
      `${fault.label}: an unproved prerequisite must never reach the command.`,
    );
    assert.match(
      check?.summary ?? '',
      fault.named,
      `${fault.label}: NFR-OPER-001 requires the decision name what was not proved.`,
    );

    const result = await runHook({ cwd: root, environment: process.env });
    const output = result.lines.join('\n');

    assert.notEqual(result.exitCode, 0, `${fault.label}: a required unverified check still denies.`);
    assert.equal(result.reasonCode, 'denied', fault.label);
    assert.match(output, /prerequisite-missing/, fault.label);
    assert.match(output, fault.named, `${fault.label}: the maintainer reads what was missing.`);
    assert.doesNotMatch(
      output,
      /grader-negative/,
      `${fault.label}: an environment fault is never reported as a verdict about the code.`,
    );
  }
});

test('TB-044 AC-EVAL-003: a declared prerequisite this environment does satisfy is proved, and its check runs exactly as it does with none declared', async (t) => {
  const proved = [
    { label: 'an executable the checks run with', prerequisites: [{ kind: 'executable', name: path.basename(process.execPath) }] },
    { label: 'a path the snapshot holds', prerequisites: [{ kind: 'configuration', name: 'app' }] },
    {
      label: 'an environment name the check is given',
      prerequisites: [{ kind: 'environment', name: 'ANALYZER_MEMORY_LIMIT' }],
      allowedEnvironment: ['ANALYZER_MEMORY_LIMIT'],
      environment: { ANALYZER_MEMORY_LIMIT: '512M' },
    },
  ];

  for (const scenario of proved) {
    const root = await throwawayRepository(t);

    await configureClone(root, {
      prerequisites: scenario.prerequisites,
      allowedEnvironment: scenario.allowedEnvironment ?? [],
    });
    await publishReceipt(root);
    await stage(root, 'baseline\nrepaired\n');

    const result = await runHook({
      cwd: root,
      environment: { ...process.env, ...(scenario.environment ?? {}) },
    });

    assert.equal(
      result.exitCode,
      0,
      `${scenario.label}: a proved prerequisite must leave the check running as before, got: ${result.lines.join('\n')}`,
    );
  }
});

test('TB-044 SG-OWNER-001: Gate core proves prerequisites without naming a tool, a flag, or a stack', async () => {
  const core = [
    'skills/change-evaluation-gate/scripts/lib/prerequisites.mjs',
    'skills/change-evaluation-gate/scripts/lib/evaluate.mjs',
  ];

  for (const relative of core) {
    const source = await readFile(path.join(FRAMEWORK_ROOT, relative), 'utf8');

    assert.doesNotMatch(
      source,
      /\b(phpstan|pint|composer|laravel|eslint|prettier|--dirty|memory_limit)\b/i,
      `${relative} must learn no tool, flag, or stack (SG-OWNER-001).`,
    );
  }
});

/*
 * TB-052 — the bypass switch means something.
 *
 * Until this slice `resolveBypass` refused without a grant and no production
 * runner ever supplied one, so `bypass: { enabled: true }` changed nothing and
 * said nothing. A grant now enters from outside — a confirmed `gate bypass`
 * writes it under the clone-local store — and the authoritative runner reads
 * it once, hands it and the durable ledger to `evaluate`, and spends it. These
 * fixtures drive the runner with a grant written the way that command writes
 * one; the command itself is proved in the operator-surface suite.
 */

const ENABLED_BYPASS = Object.freeze({ enabled: true, marker: 'Gate-Bypass' });

/** The identity a commit of the current index would carry, read the way the hook reads it. */
const stagedSnapshotId = async (root) => {
  const executionRoot = await realpath(await temporaryRoot('gate-hook-runner-snapshot-'));

  try {
    const captured = await captureSnapshot({ repositoryRoot: root, kind: 'git-index', executionRoot });

    assert.equal(captured.captured, true, captured.detail);

    return captured.snapshot.id;
  } finally {
    await rm(executionRoot, { recursive: true, force: true });
  }
};

/** A grant in the shape a confirmed `gate bypass` writes. */
const writeGrant = async (root, { snapshotId, reason = 'hotfix under incident', reference = null, requestedAt = '2026-09-17T00:00:00.000Z' }) => {
  const store = await readStore(root);

  await store.bypassGrant().write({
    grantVersion: BYPASS_GRANT_VERSION,
    grantId: null,
    snapshotId,
    actor: null,
    reason,
    reference,
    requestedAt,
    marker: ENABLED_BYPASS.marker,
  });

  return store;
};

const latestEnvelope = async (store) => {
  const log = await store.readLog();

  return store.readEnvelope(log.at(-1).evidenceId);
};

/**
 * THE FIRST RED TEST for TB-052: a clone whose policy enables bypass is
 * observably different from one whose policy disables it. Before this slice
 * the two denials were byte-identical and neither mentioned the switch.
 */
test('TB-052 FR-POL-008 / AC-CFG-001: an enabled bypass policy is told to a denied maintainer; a disabled one prints what it always printed', async (t) => {
  const enabled = await throwawayRepository(t);
  const disabled = await throwawayRepository(t);

  await configureClone(enabled, { bypass: ENABLED_BYPASS });
  await configureClone(disabled);
  await publishReceipt(enabled);
  await publishReceipt(disabled);
  await stage(enabled, 'baseline\nBROKEN\n');
  await stage(disabled, 'baseline\nBROKEN\n');

  const enabledResult = await runHook({ cwd: enabled, environment: process.env });
  const disabledResult = await runHook({ cwd: disabled, environment: process.env });

  // Both deny: an enabled switch with no grant in front of it authorizes nothing.
  assert.equal(enabledResult.reasonCode, 'denied');
  assert.equal(disabledResult.reasonCode, 'denied');
  assert.match(enabledResult.lines.join('\n'), /bypass available: .*gate bypass --reason/);
  assert.doesNotMatch(disabledResult.lines.join('\n'), /bypass available|gate bypass/, 'a disabled policy says nothing new (FR-POL-008).');
  // Byte for byte what a denied commit printed before this slice.
  assert.deepEqual(disabledResult.lines, [
    'change-evaluation-gate: failed / deny',
    'change-evaluation-gate:   configuration.broad-tests.test: failed (grader-negative)',
    'change-evaluation-gate: this commit was not authorized. Fix the reported evidence and commit again.',
    'change-evaluation-gate: local enforcement only; it can be removed or bypassed by whoever owns this machine.',
  ]);

  // Neither evaluation saw a grant, so neither decision carries a bypass
  // record, and no ledger, no grant, and no bypass event exists in either
  // store. The disabled clone's evidence is what it was before this slice.
  for (const root of [enabled, disabled]) {
    const store = await readStore(root);
    const envelope = await latestEnvelope(store);

    assert.equal(envelope.decision.bypass, null, 'no grant was supplied, so no bypass was resolved.');
    assert.equal(envelope.decision.outcome, 'failed');
    assert.deepEqual(await store.readBypassLedger(), []);
    assert.equal(await store.bypassGrant().read(), null);
    assert.equal((await store.readEvents()).some((event) => event.type === 'bypass'), false);
    await assert.rejects(access(path.join(store.root, 'bypass')), 'nothing on the evaluation path creates the grant directory.');
  }
});

test('TB-052 FR-POL-006 / FR-POL-007 / SG-BYP-001: a grant bound to the staged snapshot bypasses one denied commit as bypassed, never passed, with every failure preserved', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root, { bypass: ENABLED_BYPASS });
  await publishReceipt(root);
  await stage(root, 'baseline\nBROKEN\n');

  const snapshotId = await stagedSnapshotId(root);
  const store = await writeGrant(root, { snapshotId });

  const result = await runHook({ cwd: root, environment: process.env });
  const output = result.lines.join('\n');

  assert.equal(result.exitCode, 0, `expected the bypassed commit to proceed, got: ${output}`);
  assert.match(output, /bypassed \/ allow/);
  assert.match(output, /configuration\.broad-tests\.test: failed/, 'the failure is still reported, not hidden.');
  assert.match(output, /bypass applied: one-shot grant sha256:[0-9a-f]{64} consumed for snapshot /);
  assert.match(output, /bypass marker: Gate-Bypass/, 'FR-POL-007: the configured marker is emitted where the maintainer reads it.');

  const envelope = await latestEnvelope(store);
  const { decision } = envelope;

  assert.equal(decision.outcome, 'bypassed');
  assert.equal(decision.authorization, 'allow');
  assert.equal(decision.bypass.applied, true);
  assert.equal(decision.bypass.snapshotId, snapshotId);
  assert.equal(decision.bypass.marker, 'Gate-Bypass');
  assert.equal(decision.bypass.oneShot, true);
  assert.equal(decision.bypass.tamperEvident, false);
  assert.deepEqual(decision.bypass.preservedFailures, ['configuration.broad-tests.test']);
  assert.equal(
    decision.checks.find((check) => check.id === 'configuration.broad-tests.test').outcome,
    'failed',
    'SG-BYP-001: a bypass never rewrites a check as passed.',
  );

  // Consumed into the durable ledger, recorded as a Lifecycle event, and the
  // grant file spent — all through the paths that already existed.
  const ledger = await store.readBypassLedger();

  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].bypassId, decision.bypass.id);
  assert.equal(ledger[0].snapshotId, snapshotId);
  assert.deepEqual(ledger[0].preservedFailures, ['configuration.broad-tests.test']);

  const events = (await store.readEvents()).filter((event) => event.type === 'bypass');

  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, 'succeeded');
  assert.equal(events[0].after, decision.bypass.id);
  assert.equal(await store.bypassGrant().read(), null, 'the grant is spent by the commit attempt that read it.');
});

test('TB-052 FR-POL-006: a grant is one-shot; the same grant presented again is refused as consumed and the commit stays denied', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root, { bypass: ENABLED_BYPASS });
  await publishReceipt(root);
  await stage(root, 'baseline\nBROKEN\n');

  const snapshotId = await stagedSnapshotId(root);
  const grant = { snapshotId, requestedAt: '2026-09-17T01:02:03.000Z' };

  await writeGrant(root, grant);

  const first = await runHook({ cwd: root, environment: process.env });

  assert.equal(first.exitCode, 0, first.lines.join('\n'));

  // The same snapshot is still staged (the hook commits nothing), and the
  // identical grant is put back by hand — which is exactly what the ledger
  // exists to refuse.
  const store = await writeGrant(root, grant);
  const second = await runHook({ cwd: root, environment: process.env });
  const output = second.lines.join('\n');

  assert.equal(second.reasonCode, 'denied', `a consumed grant must not authorize: ${output}`);
  assert.match(output, /failed \/ deny/);
  assert.match(output, /bypass refused \(bypass-already-consumed\)/);

  const envelope = await latestEnvelope(store);

  assert.equal(envelope.decision.outcome, 'failed');
  assert.equal(envelope.decision.bypass.applied, false);
  assert.equal(envelope.decision.bypass.rejectionCode, 'bypass-already-consumed');
  assert.equal((await store.readBypassLedger()).length, 1, 'a refused grant is not consumed again.');
  assert.equal(await store.bypassGrant().read(), null, 'a refused grant is still spent.');
});

test('TB-052 FR-POL-006: a grant names the exact snapshot; staging anything after the grant refuses it as snapshot-mismatch', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root, { bypass: ENABLED_BYPASS });
  await publishReceipt(root);
  await stage(root, 'baseline\nBROKEN\n');

  const grantedSnapshot = await stagedSnapshotId(root);

  await writeGrant(root, { snapshotId: grantedSnapshot });
  // One more staged byte: a different snapshot from the one the grant names.
  await stage(root, 'baseline\nBROKEN\nand more\n');

  const store = await readStore(root);
  const result = await runHook({ cwd: root, environment: process.env });
  const output = result.lines.join('\n');

  assert.equal(result.reasonCode, 'denied', `a grant for another snapshot must not authorize: ${output}`);
  assert.match(output, /bypass refused \(snapshot-mismatch\)/);

  const envelope = await latestEnvelope(store);

  assert.equal(envelope.decision.bypass.rejectionCode, 'snapshot-mismatch');
  assert.equal(envelope.decision.bypass.snapshotId, grantedSnapshot);
  assert.notEqual(envelope.decision.snapshot.id, grantedSnapshot);
  assert.deepEqual(await store.readBypassLedger(), [], 'nothing was consumed.');
  assert.equal(await store.bypassGrant().read(), null, 'the mismatched grant is spent, not left to refuse every later commit.');
});

test('TB-052 FR-POL-008 / SG-BYP-001: a grant against a disabled policy is refused, recorded, and the commit stays denied', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await stage(root, 'baseline\nBROKEN\n');

  const store = await writeGrant(root, { snapshotId: await stagedSnapshotId(root) });
  const result = await runHook({ cwd: root, environment: process.env });
  const output = result.lines.join('\n');

  assert.equal(result.reasonCode, 'denied');
  assert.match(output, /bypass refused \(bypass-disabled\)/);
  assert.doesNotMatch(output, /bypass available/);
  assert.equal((await latestEnvelope(store)).decision.bypass.rejectionCode, 'bypass-disabled');
  assert.deepEqual(await store.readBypassLedger(), []);
});

test('TB-052 SG-BYP-001: a grant does not touch a commit that passes on its own; nothing is consumed and the outcome is passed', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root, { bypass: ENABLED_BYPASS });
  await publishReceipt(root);
  await stage(root, 'baseline\nrepaired\n');

  const store = await writeGrant(root, { snapshotId: await stagedSnapshotId(root) });
  const result = await runHook({ cwd: root, environment: process.env });

  assert.equal(result.exitCode, 0);
  assert.match(result.lines.join('\n'), /passed \/ allow/);
  assert.match(result.lines.join('\n'), /bypass refused \(nothing-to-bypass\)/);

  const envelope = await latestEnvelope(store);

  assert.equal(envelope.decision.outcome, 'passed', 'an honest pass is never misrepresented as an escape hatch.');
  assert.equal(envelope.decision.bypass.rejectionCode, 'nothing-to-bypass');
  assert.deepEqual(await store.readBypassLedger(), []);
  assert.equal(await store.bypassGrant().read(), null);
});

test('TB-052 SG-BYP-001 / SG-CFG-001: only a grant of the published shape is a grant; a hand-written file of another shape supplies none', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root, { bypass: ENABLED_BYPASS });
  await publishReceipt(root);
  await stage(root, 'baseline\nBROKEN\n');

  const store = await readStore(root);
  const snapshotId = await stagedSnapshotId(root);

  // Every field `resolveBypass` reads, and no version: not a grant.
  await store.bypassGrant().write({ snapshotId, actor: null, reason: 'unversioned', reference: null, requestedAt: '2026-09-17T00:00:00.000Z' });

  const result = await runHook({ cwd: root, environment: process.env });

  assert.equal(result.reasonCode, 'denied');
  assert.equal((await latestEnvelope(store)).decision.bypass, null, 'a file that is not a grant resolves no bypass at all.');
  assert.deepEqual(await store.readBypassLedger(), []);
  assert.equal(await store.bypassGrant().read(), null, 'the file is spent regardless, so it cannot sit in front of a later commit.');
});

test('TB-052 FR-POL-006: a policy-required reference is refused when the grant carries none', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root, { bypass: { ...ENABLED_BYPASS, require_reference: true } });
  await publishReceipt(root);
  await stage(root, 'baseline\nBROKEN\n');

  const store = await writeGrant(root, { snapshotId: await stagedSnapshotId(root), reference: null });
  const result = await runHook({ cwd: root, environment: process.env });

  assert.equal(result.reasonCode, 'denied');
  assert.match(result.lines.join('\n'), /bypass refused \(reference-missing\)/);
  assert.equal((await latestEnvelope(store)).decision.bypass.rejectionCode, 'reference-missing');
});
