import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { configurationIdentity } from '../skills/change-evaluation-gate/scripts/lib/activation.mjs';
import { describeAdapter } from '../skills/change-evaluation-gate/scripts/lib/adapters.mjs';
import { readRepositoryConfiguration } from '../skills/change-evaluation-gate/scripts/lib/configuration.mjs';
import { contentIdentity, openEvidenceStore } from '../skills/change-evaluation-gate/scripts/lib/evidence-store.mjs';
import { runHook } from '../skills/change-evaluation-gate/scripts/lib/hook-runner.mjs';
import {
  COMMANDS,
  CONFIRMABLE_COMMANDS,
  EXIT_OBSERVED,
  EXIT_UNHEALTHY,
  EXIT_UNRUNNABLE,
  renderDocument,
  runOperatorCommand,
} from '../skills/change-evaluation-gate/scripts/lib/operator-surface.mjs';
import { evaluateActivatedTree, runPreflight } from '../skills/change-evaluation-gate/scripts/lib/preflight-runner.mjs';

const runFile = promisify(execFile);

/**
 * TB-061 — `gate check`: ask the Gate what the working tree or the staged index
 * would evaluate to, from a terminal, and read the decision a hook would
 * produce, without forging a client payload and without committing.
 *
 * Every fixture is a throwaway repository under the OS temporary directory and
 * never this repository: an escaped activation would register an authoritative
 * hook into the framework clone.
 */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGED_COMMAND = path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts/gate.mjs');

const LIFECYCLE_CONTRACT = path.join(
  FRAMEWORK_ROOT,
  'skills/change-evaluation-gate/references/lifecycle-command-contract.md',
);

const isInside = (parent, candidate) => candidate === parent
  || candidate.startsWith(`${parent}${path.sep}`);

const assertThrowawayRepository = async (root) => {
  const resolved = await realpath(root).catch(() => path.resolve(root));
  const temporaryRoot = await realpath(tmpdir());
  const frameworkRoot = await realpath(FRAMEWORK_ROOT).catch(() => FRAMEWORK_ROOT);

  assert.equal(isInside(temporaryRoot, resolved), true, `Refusing to operate outside the OS temporary directory: ${resolved}.`);
  assert.equal(isInside(frameworkRoot, resolved), false, `Refusing to operate inside this repository: ${resolved}.`);

  return resolved;
};

const isolatedGitEnvironment = () => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

const git = (root, args) => runFile('git', args, { cwd: root, env: isolatedGitEnvironment() });

const commitAll = async (root, message) => {
  await git(root, ['add', '--all']);
  await git(root, [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Check',
    'commit', '--quiet', '--message', message,
  ]);
};

/** One check script, two checks: each grades `app/Order.php` for its own marker. */
const CHECK_SCRIPT = [
  "import { appendFileSync } from 'node:fs';",
  "import { readFile } from 'node:fs/promises';",
  '',
  "if (process.env.GATE_CHECK_MARKER) { appendFileSync(process.env.GATE_CHECK_MARKER, 'ran\\n'); }",
  "const graded = await readFile(process.argv[2], 'utf8').catch(() => '');",
  '',
  "if (graded.includes('CRASH')) { process.kill(process.pid, 'SIGKILL'); }",
  'process.stdout.write(`graded ${graded.length} bytes\\n`);',
  'process.exitCode = graded.includes(process.argv[3]) ? 1 : 0;',
  '',
].join('\n');

const STATIC_CHECK = 'configuration.static-analysis.static-analysis';

const TEST_CHECK = 'configuration.broad-tests.test';

const commandBlock = ({ marker, category, prerequisites = [] }) => [
  '      backend: []',
  '      frontend: []',
  '      both:',
  '        - runner: repository-script',
  '          args:',
  '            - tools/check.mjs',
  '            - app/Order.php',
  `            - ${marker}`,
  '          working_directory: "."',
  '          timeout_seconds: 60',
  '          allowed_environment:',
  '            - PATH',
  '            - GATE_CHECK_MARKER',
  `          evidence_category: ${category}`,
  '          source_scope: both',
  ...(prerequisites.length === 0
    ? []
    : [
      '          prerequisites:',
      ...prerequisites.flatMap((prerequisite) => [
        `            - kind: ${prerequisite.kind}`,
        `              name: ${prerequisite.name}`,
      ]),
    ]),
];

const configuration = ({ prerequisites = [] } = {}) => [
  'schema_version: 4',
  'backend: laravel',
  'frontend: none',
  'verification:',
  '  commands:',
  '    static_analysis:',
  ...commandBlock({ marker: 'UNTYPED', category: 'static-analysis' }),
  '    test:',
  ...commandBlock({ marker: 'BROKEN', category: 'test', prerequisites }),
  'evaluation_gate:',
  '  checks:',
  '    required:',
  `      - ${STATIC_CHECK}`,
  `      - ${TEST_CHECK}`,
  '    advisory: []',
  '  budget:',
  '    total_seconds: 600',
  '  bypass:',
  '    enabled: false',
  '    marker: null',
  '  execution:',
  '    budget_skippable: []',
  '  evidence: {}',
  '',
].join('\n');

/** A configured clone whose Gate files are committed, so an ordinary edit is the only change. */
const configuredClone = async (t, options = {}) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-check-repo-')));

  t.after(() => rm(root, { recursive: true, force: true }));
  await assertThrowawayRepository(root);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\n', 'utf8');
  await writeFile(path.join(root, 'tools/check.mjs'), CHECK_SCRIPT, 'utf8');
  await writeFile(path.join(root, '.agent-framework.yaml'), configuration(options), 'utf8');
  await git(root, ['init', '--quiet']);
  await commitAll(root, 'baseline');

  return root;
};

/**
 * The receipt both runners resolve this clone against, pinned the way
 * `activate` pins it so neither runner observes drift.
 */
const publishReceipt = async (root) => {
  const common = (await git(root, ['rev-parse', '--git-common-dir'])).stdout.trim();
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
      runners: [STATIC_CHECK, TEST_CHECK].map((checkId) => ({
        check_id: checkId,
        role: 'evaluate',
        runner: 'repository-script',
        executable: process.execPath,
        version: process.versions.node,
      })),
    },
  };

  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'receipt.json'),
    `${JSON.stringify({ ...body, receiptId: contentIdentity(body) }, null, 2)}\n`,
    'utf8',
  );
};

const activatedClone = async (t, options = {}) => {
  const root = await configuredClone(t, options);

  await publishReceipt(root);

  return root;
};

const check = (root, argv = [], environment = {}) => runOperatorCommand({
  cwd: root,
  argv: ['check', ...argv],
  environment: { ...isolatedGitEnvironment(), ...environment },
});

const cursorPreflight = (root, environment = {}) => runPreflight({
  cwd: root,
  stdin: `${JSON.stringify({
    hook_event_name: 'stop',
    session_id: 'gate-check-session',
    workspace_roots: [root],
    cursor_version: '3.15.6',
    status: 'completed',
    loop_count: 0,
  })}\n`,
  argv: ['--adapter', 'cursor'],
  environment: { ...isolatedGitEnvironment(), ...environment },
});

const storeOf = (root) => openEvidenceStore({ repositoryRoot: root });

/** The decision the last Evidence append recorded, as a hook left it. */
const lastRecordedDecision = async (root) => {
  const store = await storeOf(root);
  const log = await store.readLog();
  const envelope = await store.readEnvelope(log.at(-1).evidenceId);

  return envelope.decision;
};

const outcomesOf = (checks) => checks.map((entry) => [entry.id, entry.outcome, entry.reasonCode]);

const logLength = async (root) => (await (await storeOf(root)).readLog()).length;

const eventCount = async (root) => (await (await storeOf(root)).readEvents()).length;

/**
 * THE FIRST RED TEST OF TB-061.
 *
 * `AC-EVAL-001`, `FR-EVAL-003`, `NFR-REL-001`. On an activated clone, `gate
 * check` prints every check's outcome and reason, the outcome, and
 * `authorization: not-authoritative`, and they are exactly the outcomes and the
 * snapshot identity the preflight recorded for the same working tree — where
 * before this slice no such command existed and the maintainer forged a client
 * payload to ask.
 */
test('TB-061 AC-EVAL-001 / NFR-REL-001: gate check prints the check outcomes the preflight recorded for the same tree, not-authoritative, with the exit status carrying the outcome', async (t) => {
  const root = await activatedClone(t);

  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nBROKEN\n', 'utf8');
  await cursorPreflight(root);

  const preflight = await lastRecordedDecision(root);
  const result = await check(root);
  const { observation } = result.document;

  assert.equal(result.document.failure, null, result.stderr);
  assert.equal(result.exitCode, EXIT_UNHEALTHY, 'a failing tree exits 1.');
  assert.equal(observation.outcome, 'failed');
  assert.equal(observation.authorization, 'not-authoritative');
  assert.deepEqual(outcomesOf(observation.checks), outcomesOf(preflight.checks));
  assert.deepEqual(outcomesOf(observation.checks), [
    [STATIC_CHECK, 'passed', 'grader-positive'],
    [TEST_CHECK, 'failed', 'grader-negative'],
  ]);
  assert.equal(observation.snapshot.id, preflight.snapshot.id, 'the same tree is the same snapshot.');
  assert.equal(observation.snapshot.kind, 'worktree');

  assert.match(result.stdout, /^gate check$/m);
  assert.match(result.stdout, /^scope: worktree/m);
  assert.match(result.stdout, /^outcome: failed$/m);
  assert.match(result.stdout, /^authorization: not-authoritative$/m);

  for (const entry of preflight.checks) {
    assert.ok(result.stdout.includes(entry.summary), `the rendering does not state ${entry.id}: ${result.stdout}`);
  }

  // SG-TRUST-001, FR-EVAL-001: the limit statement stays on the output.
  assert.match(result.stdout, /authorizes nothing/);
  assert.ok(result.stdout.includes(result.document.trustBoundary.statement));

  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nrepaired\n', 'utf8');

  const passing = await check(root);

  assert.equal(passing.exitCode, EXIT_OBSERVED, passing.stdout);
  assert.equal(passing.document.observation.outcome, 'passed');
});

/** `AC-EVAL-006`: two scopes, explicit, never inferred from one another. */
test('TB-061 AC-EVAL-006: --staged evaluates the index, is distinguishable, and never shares a snapshot identity with a differing worktree', async (t) => {
  const root = await activatedClone(t);

  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nBROKEN\n', 'utf8');
  await git(root, ['add', 'app/Order.php']);
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nrepaired\n', 'utf8');

  const worktree = await check(root);
  const staged = await check(root, ['--staged']);

  assert.equal(worktree.exitCode, EXIT_OBSERVED, worktree.stdout);
  assert.equal(staged.exitCode, EXIT_UNHEALTHY, staged.stdout);
  assert.equal(worktree.document.observation.scope, 'worktree');
  assert.equal(staged.document.observation.scope, 'staged');
  assert.equal(staged.document.observation.snapshot.kind, 'git-index');
  assert.match(staged.stdout, /^scope: staged/m);
  assert.notEqual(worktree.document.observation.snapshot.id, staged.document.observation.snapshot.id);

  // The staged answer is the commit runner's: the same snapshot it grades, and
  // the same check summaries it prints.
  const hook = await runHook({ cwd: root, environment: isolatedGitEnvironment() });
  const committed = await lastRecordedDecision(root);

  assert.equal(hook.reasonCode, 'denied');
  assert.equal(staged.document.observation.snapshot.id, committed.snapshot.id);
  assert.deepEqual(outcomesOf(staged.document.observation.checks), outcomesOf(committed.checks));

  for (const line of hook.lines.filter((entry) => entry.includes(TEST_CHECK))) {
    assert.ok(
      staged.stdout.includes(line.replace(/^change-evaluation-gate: {3}/, '')),
      `the staged check does not say what the hook said: ${line}`,
    );
  }
});

test('TB-061 AC-EVAL-006: a missing prerequisite renders unverified with its reason code exactly as the hook prints it', async (t) => {
  const root = await activatedClone(t, {
    prerequisites: [{ kind: 'environment', name: 'source-control-history' }],
  });

  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nchanged\n', 'utf8');
  await git(root, ['add', 'app/Order.php']);

  const staged = await check(root, ['--staged']);
  const hook = await runHook({ cwd: root, environment: isolatedGitEnvironment() });
  const unverified = staged.document.observation.checks.find((entry) => entry.id === TEST_CHECK);

  assert.equal(staged.exitCode, EXIT_UNHEALTHY);
  assert.equal(staged.document.observation.outcome, 'unverified');
  assert.equal(unverified.outcome, 'unverified');
  assert.equal(unverified.reasonCode, 'prerequisite-missing');

  const hookLine = hook.lines.find((entry) => entry.includes('prerequisite-missing'));

  assert.ok(hookLine, `the hook did not name the missing prerequisite: ${hook.lines.join('\n')}`);
  assert.ok(staged.stdout.includes(hookLine.replace(/^change-evaluation-gate: {3}/, '')), staged.stdout);
  assert.match(staged.stdout, /source-control-history/);
});

test('TB-061 AC-EVAL-006: a crashed check renders unverified with its reason code exactly as the hook prints it', async (t) => {
  const root = await activatedClone(t);

  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nCRASH\n', 'utf8');
  await git(root, ['add', 'app/Order.php']);

  const staged = await check(root, ['--staged']);
  const hook = await runHook({ cwd: root, environment: isolatedGitEnvironment() });
  const crashed = staged.document.observation.checks.filter((entry) => entry.outcome === 'unverified');

  assert.equal(staged.exitCode, EXIT_UNHEALTHY);
  assert.equal(staged.document.observation.outcome, 'unverified');
  assert.equal(crashed.length, 2, JSON.stringify(staged.document.observation.checks));

  for (const entry of crashed) {
    const hookLine = hook.lines.find((line) => line.includes(`${entry.id}:`));

    assert.ok(hookLine, `the hook did not report ${entry.id}: ${hook.lines.join('\n')}`);
    assert.ok(hookLine.includes(entry.reasonCode), `the hook named another reason: ${hookLine}`);
    assert.ok(staged.stdout.includes(hookLine.replace(/^change-evaluation-gate: {3}/, '')), staged.stdout);
  }
});

/**
 * `FR-ADAPT-005`. No adapter is invoked, no loop guard is consulted, and no
 * feedback channel is used: three runs on an unchanged failing tree are three
 * full answers, and the preflight's own budget for that tree is untouched.
 */
test('TB-061 FR-ADAPT-005: three checks of an unchanged tree are three full answers, and the preflight loop budget is untouched', async (t) => {
  const root = await activatedClone(t);

  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nBROKEN\n', 'utf8');

  const answers = [];

  for (let run = 0; run < 3; run += 1) {
    // eslint-disable-next-line no-await-in-loop
    answers.push(await check(root));
  }

  for (const answer of answers) {
    assert.equal(answer.exitCode, EXIT_UNHEALTHY);
    assert.equal(answer.stderr, '');
    assert.deepEqual(outcomesOf(answer.document.observation.checks), outcomesOf(answers[0].document.observation.checks));
    assert.equal(answer.document.observation.evaluationId, answers[0].document.observation.evaluationId);
    assert.match(answer.stdout, /grader-negative/);
    // Not a client's channel: a person's document, not a feedback payload.
    assert.throws(() => JSON.parse(answer.stdout));
  }

  // The identity it evaluates under is no declared adapter's.
  assert.equal(describeAdapter(answers[0].document.observation.invocation.adapter), null);

  // A client's loop guard counts its own evaluation identity; three failing
  // checks spent none of it, so the preflight still answers in full.
  const { maxIterations } = describeAdapter('cursor').capabilities.feedback;

  for (let turn = 0; turn < maxIterations; turn += 1) {
    // eslint-disable-next-line no-await-in-loop
    const preflight = await cursorPreflight(root);

    assert.match(preflight.stdout, /grader-negative/, `preflight turn ${turn + 1} was silenced by gate check.`);
  }
});

/** `RISK-010`: a passing check appends nothing; a failing one persists its decision and says where. */
test('TB-061 RISK-010: a passing check appends nothing, a failing one persists its decision, and the output says which and where', async (t) => {
  const root = await activatedClone(t);

  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nrepaired\n', 'utf8');

  const beforeLog = await logLength(root);
  const beforeEvents = await eventCount(root);
  const passing = await check(root);

  assert.equal(passing.exitCode, EXIT_OBSERVED);
  assert.equal(await logLength(root), beforeLog, 'a passing check appended Evidence.');
  assert.equal(await eventCount(root), beforeEvents, 'a passing check recorded a Lifecycle event.');
  assert.equal(passing.document.observation.evidence.appended, false);
  assert.equal(passing.document.observation.evidence.notRecorded, 'passing-not-recorded');
  assert.match(passing.stdout, /^evidence: not appended/m);

  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nBROKEN\n', 'utf8');

  const failing = await check(root);
  const store = await storeOf(root);
  const log = await store.readLog();
  const { evidence } = failing.document.observation;

  assert.equal(log.length, beforeLog + 1, 'a failing check persists exactly its decision.');
  assert.equal(evidence.appended, true);
  assert.equal(evidence.evidenceId, log.at(-1).evidenceId);
  assert.equal(evidence.storeRoot, store.root);
  assert.ok(failing.stdout.includes(`evidence: appended ${evidence.evidenceId} to ${store.root}`), failing.stdout);
  assert.equal((await store.readEnvelope(evidence.evidenceId)).decision.outcome, 'failed');

  // A clean tree has nothing to record and says so, as the preflight does.
  await git(root, ['checkout', '--', 'app/Order.php']);

  const settled = await check(root);

  assert.equal(settled.exitCode, EXIT_OBSERVED);
  assert.equal(settled.document.observation.snapshot.id, null);
  assert.equal(settled.document.observation.evidence.notRecorded, 'no-change-to-record');
  assert.equal(await logLength(root), beforeLog + 1);
});

test('TB-061: gate check could not run on a clone that was never activated, and says why', async (t) => {
  const root = await configuredClone(t);
  const result = await check(root);

  assert.equal(result.exitCode, EXIT_UNRUNNABLE);
  assert.equal(result.document.failure.reasonCode, 'activation-receipt-missing');
  assert.match(result.stderr, /not activated/);

  const refused = await check(root, ['--confirm', `sha256:${'1'.repeat(64)}`]);

  assert.equal(refused.exitCode, EXIT_UNRUNNABLE);
  assert.equal(refused.document.failure.reasonCode, 'unknown-selector');
});

test('TB-061: --json mirrors the rendered document, and --help and the command contract list the command', async (t) => {
  const root = await activatedClone(t);

  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nBROKEN\nUNTYPED\n', 'utf8');

  const human = await check(root);
  const machine = await check(root, ['--json']);
  const parsed = JSON.parse(machine.stdout);

  assert.deepEqual(parsed, machine.document);
  assert.equal(human.stdout, renderDocument(human.document));
  assert.equal(renderDocument(parsed), renderDocument(machine.document));
  assert.equal(human.exitCode, machine.exitCode);

  for (const entry of parsed.observation.checks) {
    assert.ok(human.stdout.includes(entry.id));
    assert.ok(human.stdout.includes(entry.reasonCode));
  }

  const help = await runFile(process.execPath, [PACKAGED_COMMAND, '--help'], { cwd: root, env: isolatedGitEnvironment() });

  assert.match(help.stdout, /gate check/);
  assert.ok(COMMANDS.includes('check'));
  assert.equal(CONFIRMABLE_COMMANDS.check, undefined, 'a command that mutates nothing has no confirmation.');
  assert.match(await readFile(LIFECYCLE_CONTRACT, 'utf8'), /\| `gate check` \|/);
});

/** The shared seam: the preflight and `gate check` call one evaluation, and it takes a request. */
test('TB-061 NFR-REL-001: the shared evaluation answers a request with the decision, or a stated reason it could not', async (t) => {
  const root = await configuredClone(t);
  const refused = await evaluateActivatedTree({ repository: { root } }, {
    environment: isolatedGitEnvironment(),
    client: { id: 'gate-check', surface: 'operator-terminal' },
  });

  assert.equal(refused.ok, false);
  assert.equal(refused.reasonCode, 'activation-receipt-missing');
});

/**
 * `FR-EVAL-001`. A commit after a passing `gate check` still runs the hook and
 * is still evaluated: nothing the check produced is consulted, and nothing a
 * hook reads was written.
 */
test('TB-061 FR-EVAL-001: a commit after a passing check still runs the hook, and the check wrote nothing a hook reads', async (t) => {
  const root = await configuredClone(t);
  const marker = path.join(await realpath(await mkdtemp(path.join(tmpdir(), 'gate-check-marker-'))), 'ran');

  t.after(() => rm(path.dirname(marker), { recursive: true, force: true }));

  const preview = await runOperatorCommand({ cwd: root, argv: ['activate', '--json'], environment: isolatedGitEnvironment() });
  const confirmed = await runOperatorCommand({
    cwd: root,
    argv: ['activate', '--confirm', preview.document.observation.confirmationToken],
    environment: isolatedGitEnvironment(),
  });

  assert.equal(confirmed.document.mutation.performed, true, `the fixture failed to activate: ${confirmed.document.mutation.reasonCode}`);

  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nrepaired\n', 'utf8');
  await git(root, ['add', 'app/Order.php']);

  const runs = async () => (await readFile(marker, 'utf8').catch(() => '')).split('\n').filter(Boolean).length;
  const common = path.join(root, '.git/change-evaluation-gate/evidence');
  const bypassGrant = path.join(common, 'bypass/grant.json');
  const logBefore = await logLength(root);
  const passing = await check(root, ['--staged'], { GATE_CHECK_MARKER: marker });

  assert.equal(passing.exitCode, EXIT_OBSERVED, passing.stdout);
  assert.equal(await runs(), 2, 'both checks ran once for gate check.');
  assert.equal(await logLength(root), logBefore);
  assert.equal(await access(bypassGrant).then(() => true, () => false), false);
  assert.deepEqual(
    (await readdir(common)).filter((entry) => /check/i.test(entry)),
    [],
    'gate check left a record of its own for a hook to find.',
  );

  await git(root, [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Check',
    'commit', '--quiet', '--message', 'after a passing check',
  ]).catch(() => null);

  // The commit's hook ran the checks again and recorded its own decision.
  const committed = await lastRecordedDecision(root);

  assert.equal(await logLength(root), logBefore + 1, 'the commit was not evaluated by the hook.');
  assert.equal(committed.authorization, 'allow');
  assert.equal(committed.snapshot.id, passing.document.observation.snapshot.id);
});
