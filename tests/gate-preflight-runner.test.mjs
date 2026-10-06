import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import {
  chmod,
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
import {
  describeAdapter,
  normalizeTurn,
} from '../skills/change-evaluation-gate/scripts/lib/adapters.mjs';
import { readRepositoryConfiguration } from '../skills/change-evaluation-gate/scripts/lib/configuration.mjs';
import {
  evaluate,
  evaluateWithoutSubject,
} from '../skills/change-evaluation-gate/scripts/lib/evaluate.mjs';
import {
  OPERATION,
  PROTOCOL_VERSION,
  validateDecision,
  validateEvaluationRequest,
} from '../skills/change-evaluation-gate/scripts/lib/evaluation-contract.mjs';
import { contentIdentity } from '../skills/change-evaluation-gate/scripts/lib/evidence-store.mjs';
import { EXECUTION_ROOT_PREFIXES } from '../skills/change-evaluation-gate/scripts/lib/hook-runner.mjs';
import { runPreflight } from '../skills/change-evaluation-gate/scripts/lib/preflight-runner.mjs';

const runFile = promisify(execFile);

/**
 * This suite drives the packaged desktop preflight runner. Every fixture must
 * be a throwaway repository under the OS temporary directory and never this
 * repository, so no fixture can ever reach the framework clone's own Git state.
 */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGED_RUNNER = path.join(
  FRAMEWORK_ROOT,
  'skills/change-evaluation-gate/scripts/gate-preflight.mjs',
);

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

const throwawayRepository = async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-preflight-repo-')));

  t.after(() => rm(root, { recursive: true, force: true }));
  await assertThrowawayRepository(root);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\n', 'utf8');
  await runFile('git', ['init', '--quiet'], { cwd: root, env: isolatedGitEnvironment() });
  await runFile('git', ['add', '--all'], { cwd: root, env: isolatedGitEnvironment() });
  await runFile('git', [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Preflight Runner',
    'commit', '--quiet', '--message', 'baseline',
  ], { cwd: root, env: isolatedGitEnvironment() });

  return root;
};

const configureClone = async (root, { dependencyRoots = [], prerequisites = [] } = {}) => {
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
      '  profile: gate-preflight-runner',
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
      '          timeout_seconds: 60',
      '          allowed_environment:',
      '            - PATH',
      '          evidence_category: test',
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
      'evaluation_gate:',
      '  checks:',
      '    required:',
      '      - configuration.broad-tests.test',
      '    advisory: []',
      '  budget:',
      '    total_seconds: 600',
      '  bypass:',
      '    enabled: false',
      ...(dependencyRoots.length === 0
        ? ['  execution: {}']
        : [
          '  execution:',
          '    dependency_roots:',
          ...dependencyRoots.map((declared) => `      - ${declared}`),
        ]),
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

/**
 * TB-031: the pinned identities are computed the way `activate` computes them,
 * because the preflight runner now reconciles them against this machine. A
 * receipt pinning `sha256:configuration` describes a clone no activation could
 * produce and would report drift on every turn.
 */
const publishReceipt = async (root) => {
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

/**
 * The payload shape a real client sends, taken from the capture preserved in
 * `real-project-evidence/`: a `stop` event carries the status of the turn that
 * ended and the client's own auto-follow-up counter.
 */
const cursorStopPayload = (root, overrides = {}) => ({
  hook_event_name: 'stop',
  session_id: 'preflight-session',
  workspace_roots: [root],
  cursor_version: '3.15.6',
  status: 'completed',
  loop_count: 0,
  ...overrides,
});

const runPackaged = ({
  cwd,
  payload,
  args = ['--adapter', 'cursor'],
  environment = {},
}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [PACKAGED_RUNNER, ...args], {
    cwd,
    env: { ...isolatedGitEnvironment(), ...environment },
  });
  let stdout = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.on('error', reject);
  child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  child.stdin.end(payload === null ? '' : `${JSON.stringify(payload)}\n`);
});

test('AC-ADAPT-001: a failing Cursor stop payload produces stdout JSON whose declared feedback field names the failing check', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nBROKEN\n', 'utf8');

  const result = await runPackaged({ cwd: root, payload: cursorStopPayload(root) });
  const body = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0, `expected exit 0, got ${result.exitCode}: ${result.stderr}`);
  assert.match(body.followup_message, /configuration\.broad-tests\.test/);
  assert.doesNotMatch(
    body.followup_message,
    /this commit was not authorized|authorized the commit/i,
    'a worktree preflight must never describe itself as the decision a commit would receive.',
  );
});

test('TB-044 NFR-OPER-001: a check whose declared prerequisite is not proved names it on the desktop feedback channel, instead of a verdict about the code', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root, {
    prerequisites: [{ kind: 'environment', name: 'source-control-history' }],
  });
  await publishReceipt(root);
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nBROKEN\n', 'utf8');

  const result = await runPackaged({ cwd: root, payload: cursorStopPayload(root) });
  const body = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0, `expected exit 0, got ${result.exitCode}: ${result.stderr}`);
  assert.match(body.followup_message, /configuration\.broad-tests\.test/);
  assert.match(body.followup_message, /prerequisite-missing/);
  assert.match(
    body.followup_message,
    /source-control-history/,
    'the channel that pointed an agent at the project must say what the check never got.',
  );
  assert.doesNotMatch(
    body.followup_message,
    /grader-negative/,
    'a check that never ran says nothing about the code.',
  );
});

test('AC-ADAPT-001: a passing Cursor stop payload produces no follow-up, so a clean turn is never interrupted', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  // TB-064: an uncommitted configuration and check script are changed Grader
  // surfaces, which the channel always states. A clean turn is one whose change
  // passes and edits nothing that grades it, so the Gate's own files are
  // committed and the turn's change is an ordinary passing edit.
  await runFile('git', ['add', '--all'], { cwd: root, env: isolatedGitEnvironment() });
  await runFile('git', [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Preflight Runner',
    'commit', '--quiet', '--message', 'configured',
  ], { cwd: root, env: isolatedGitEnvironment() });
  await publishReceipt(root);
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nrepaired\n', 'utf8');

  const result = await runPackaged({ cwd: root, payload: cursorStopPayload(root) });

  assert.equal(result.exitCode, 0, `expected exit 0, got ${result.exitCode}: ${result.stderr}`);
  assert.equal(result.stdout, '', `a passing preflight must not write follow-up, got: ${result.stdout}`);
});

test('AC-ADAPT-002 / NFR-REL-003: an unreadable payload, an unmatched event, and an unresolvable repository root each present as unverified through the declared channel', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);

  const unreadable = await runPackaged({ cwd: root, payload: null, args: ['--adapter', 'cursor'] });
  const unreadableBody = JSON.parse(unreadable.stdout);

  assert.equal(unreadable.exitCode, 0);
  assert.match(unreadableBody.followup_message, /unverified/i);

  const unmatched = await runPackaged({
    cwd: root,
    payload: { ...cursorStopPayload(root), hook_event_name: 'beforeSubmitPrompt' },
  });
  const unmatchedBody = JSON.parse(unmatched.stdout);

  assert.equal(unmatched.exitCode, 0);
  assert.match(unmatchedBody.followup_message, /unverified/i);

  const missingRoot = await runPackaged({
    cwd: root,
    payload: {
      ...cursorStopPayload(root),
      workspace_roots: [],
    },
  });
  const missingRootBody = JSON.parse(missingRoot.stdout);

  assert.equal(missingRoot.exitCode, 0);
  assert.match(missingRootBody.followup_message, /unverified/i);
});

test('AC-ADAPT-002 / NFR-REL-003: an internal evaluation failure presents as unverified through the declared channel, never as a clean preflight', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);

  const result = await runPreflight({
    cwd: root,
    stdin: `${JSON.stringify(cursorStopPayload(root))}\n`,
    argv: ['--adapter', 'cursor'],
    environment: isolatedGitEnvironment(),
    evaluate: async () => {
      throw new Error('injected evaluation crash');
    },
  });
  const body = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.view.outcome, 'unverified');
  assert.equal(result.view.authorization, 'not-authoritative');
  assert.match(body.followup_message, /unverified/i);
  assert.match(body.followup_message, /injected evaluation crash/);
});

test('FR-ADAPT-002 / SG-SUPPORT-001: preflight evaluates the working tree as work-complete, is not-authoritative, and never claims a commit decision', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nBROKEN\n', 'utf8');

  let seen = null;
  const result = await runPreflight({
    cwd: root,
    stdin: `${JSON.stringify(cursorStopPayload(root))}\n`,
    argv: ['--adapter', 'cursor'],
    environment: isolatedGitEnvironment(),
    evaluate: async (request, dependencies) => {
      seen = request;

      return evaluate(request, dependencies);
    },
  });

  assert.notEqual(seen, null, 'the preflight runner must invoke evaluate.');
  assert.equal(seen.change.kind, 'worktree');
  assert.equal(seen.invocation.role, 'preflight');
  assert.equal(seen.invocation.trigger, 'work-complete');
  assert.equal(result.exitCode, 0);
  assert.equal(result.view.authorization, 'not-authoritative');
  assert.equal(result.view.blocking, false);
  assert.doesNotMatch(result.stdout, /this commit was not authorized/i);
});

/**
 * TB-027 — Never restart work the operator stopped.
 *
 * The runner read neither the turn status nor the iteration counter, so a turn
 * the operator aborted was graded and answered exactly like one that completed
 * — and the client submitted that answer as the next user message, restarting
 * the work that had just been stopped. Five identical evaluations in
 * `real-project-evidence/` are what that produced.
 */

test('TB-027 SG-TRUST-001: a turn the operator aborted produces no feedback at all, in a clone whose required check fails', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nBROKEN\n', 'utf8');

  const aborted = await runPackaged({
    cwd: root,
    payload: cursorStopPayload(root, { status: 'aborted' }),
  });

  assert.equal(aborted.exitCode, 0);
  assert.equal(
    aborted.stdout,
    '',
    `a stopped turn must never be answered on the agent's channel, got: ${aborted.stdout}`,
  );
  assert.match(
    aborted.stderr,
    /change-evaluation-gate/,
    'deliberate silence must still be legible to a human reading the hook panel.',
  );

  // The same clone, same failing check, a completed turn: the feedback returns.
  const completed = await runPackaged({ cwd: root, payload: cursorStopPayload(root) });

  assert.match(
    JSON.parse(completed.stdout).followup_message,
    /configuration\.broad-tests\.test/,
    'narrowing when preflight speaks must not change what it says when it does.',
  );
});

test('TB-027 SG-TRUST-001: a turn that ended in error is likewise not an invitation to re-prompt', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nBROKEN\n', 'utf8');

  const result = await runPackaged({
    cwd: root,
    payload: cursorStopPayload(root, { status: 'error' }),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '');
});

test('TB-027 NFR-REL-003: an undeclared status value is unverified, never assumed to mean completed', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);

  for (const status of ['finished', '', null]) {
    const result = await runPackaged({
      cwd: root,
      payload: cursorStopPayload(root, { status }),
    });

    assert.equal(result.exitCode, 0);
    assert.match(
      JSON.parse(result.stdout).followup_message,
      /unverified/i,
      `a status of ${JSON.stringify(status)} is neither completed nor interrupted and must not be guessed.`,
    );
  }
});

test('TB-027 NFR-REL-003: a payload missing the declared status field is unverified rather than assumed complete', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);

  const { status, ...withoutStatus } = cursorStopPayload(root);
  const result = await runPackaged({ cwd: root, payload: withoutStatus });

  assert.equal(result.exitCode, 0);
  assert.match(JSON.parse(result.stdout).followup_message, /unverified/i);
});

test('TB-027 FR-ADAPT-002: a client that advances its own iteration counter past the declared maximum is answered no further', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nBROKEN\n', 'utf8');

  const { maxIterations } = describeAdapter('cursor').capabilities.feedback;

  assert.equal(Number.isInteger(maxIterations), true, 'the surface must declare its own bound.');

  const exhausted = await runPackaged({
    cwd: root,
    payload: cursorStopPayload(root, { loop_count: maxIterations }),
  });

  assert.equal(exhausted.exitCode, 0);
  assert.equal(exhausted.stdout, '');
  assert.match(exhausted.stderr, /change-evaluation-gate/);
});

test('TB-027 FR-ADAPT-002: a client whose counter never advances is still bounded, by the gate’s own record', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nBROKEN\n', 'utf8');

  const { maxIterations } = describeAdapter('cursor').capabilities.feedback;
  const answered = [];

  // Every payload reports `loop_count: 0`, exactly as the real client did. The
  // content never changes, so every evaluation is the same evaluation, and the
  // gate counts its own appended evidence rather than trusting the counter.
  for (let attempt = 0; attempt < maxIterations + 2; attempt += 1) {
    const result = await runPackaged({ cwd: root, payload: cursorStopPayload(root) });

    answered.push(result.stdout !== '');
  }

  assert.equal(
    answered.slice(0, maxIterations).every((spoke) => spoke === true),
    true,
    `the first ${maxIterations} unchanged verdicts are worth saying: ${JSON.stringify(answered)}.`,
  );
  assert.equal(
    answered.slice(maxIterations).some((spoke) => spoke === true),
    false,
    `an unchanged verdict repeated past the declared bound must go quiet: ${JSON.stringify(answered)}.`,
  );
});

test('TB-027 FR-ADAPT-004: a surface that declares no turn keeps its behaviour exactly', async () => {
  for (const adapterId of ['git', 'claude-code-desktop', 'codex-desktop']) {
    const adapter = describeAdapter(adapterId);

    assert.equal(
      adapter.nativeIdentity.turn,
      null,
      `${adapterId} has never sent a turn status and must not start declaring one.`,
    );
    assert.equal(
      normalizeTurn({ adapterId, native: { anything: true } }).state,
      'completed',
      `${adapterId} declares no status, so every event it sends is a completed turn.`,
    );
  }
});

test('TB-027 SG-OWNER-001: an unresolvable adapter is reported, never silently indistinguishable from a clean turn', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);

  // A hook wired without `--adapter` is exactly how this was found: the runner
  // returned in 73ms having read nothing, and looked identical to success.
  const unnamed = await runPackaged({ cwd: root, payload: cursorStopPayload(root), args: [] });

  assert.equal(unnamed.exitCode, 0);
  assert.equal(unnamed.stdout, '');
  assert.match(
    unnamed.stderr,
    /change-evaluation-gate/,
    'a misconfigured hook must say so where a maintainer can read it.',
  );
});

test('SG-OWNER-001: no client name and no native feedback field lives outside the adapter declarations', async () => {
  const libraryRoot = path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts/lib');
  const scriptsRoot = path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts');
  const clientNames = /\b(cursor|codex|claude|copilot|vscode|jetbrains|intellij|windsurf|zed)\b/i;
  const nativeFields = /\bfollowup_message\b|\bloop_count\b|\bhook_event_name\b/;
  const scanned = [
    path.join(libraryRoot, 'preflight-runner.mjs'),
    path.join(scriptsRoot, 'gate-preflight.mjs'),
    path.join(scriptsRoot, 'gate-precommit.mjs'),
    path.join(libraryRoot, 'hook-runner.mjs'),
  ];

  for (const file of scanned) {
    const source = await readFile(file, 'utf8');

    assert.doesNotMatch(source, clientNames, `${path.basename(file)} names a client.`);
    assert.doesNotMatch(source, nativeFields, `${path.basename(file)} names a native feedback field.`);
  }

  const declarations = await readFile(path.join(libraryRoot, 'adapters/declarations/registry.mjs'), 'utf8');

  assert.match(declarations, nativeFields);
  assert.match(declarations, /\bcursor\b/i);
});

/**
 * TB-037 — Do not present a decision the gate itself would refuse.
 *
 * `TB-033` made the authoritative runner judge every decision with
 * `validateDecision` before it may exit `0`. The preflight must reach the same
 * verdict about the same decision, so these fixtures drive the real
 * `runPreflight` and hand it, through its injected `evaluate` seam, decisions
 * the contract rejects.
 */

const evidenceLogPath = (root) => path.join(
  root,
  '.git',
  'change-evaluation-gate/evidence/log.ndjson',
);

test('TB-037 AC-ADAPT-002 / NFR-REL-003: a decision the contract rejects presents as unverified through the declared channel', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);

  for (const decision of [
    { authorization: 'allow', outcome: 'passed' },
    null,
    'passed',
    { protocolVersion: '9.9', authorization: 'allow' },
  ]) {
    const result = await runPreflight({
      cwd: root,
      stdin: `${JSON.stringify(cursorStopPayload(root))}\n`,
      argv: ['--adapter', 'cursor'],
      environment: isolatedGitEnvironment(),
      evaluate: async () => decision,
    });

    assert.equal(result.exitCode, 0, `a preflight always exits 0: ${JSON.stringify(decision)}.`);
    assert.equal(result.view.outcome, 'unverified', JSON.stringify(decision));
    assert.equal(result.view.authorization, 'not-authoritative', JSON.stringify(decision));
    assert.equal(result.view.blocking, false, JSON.stringify(decision));

    const body = JSON.parse(result.stdout);

    assert.match(body.followup_message, /unverified/i, JSON.stringify(decision));
    assert.match(
      body.followup_message,
      /could not be read/i,
      `the message must say the decision could not be read: ${body.followup_message}`,
    );
    assert.match(
      body.followup_message,
      /\d+ contract finding/i,
      `the message must count the findings rather than reproduce them: ${body.followup_message}`,
    );
    assert.equal(
      /decision\.(checks|diagnostics|evaluationId)/.test(body.followup_message),
      false,
      `a message an agent is prompted with must not dump contract findings: ${body.followup_message}`,
    );
  }
});

test('TB-037 FR-EVID-001: a decision the contract rejects leaves no Evidence envelope', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);

  const result = await runPreflight({
    cwd: root,
    stdin: `${JSON.stringify(cursorStopPayload(root))}\n`,
    argv: ['--adapter', 'cursor'],
    environment: isolatedGitEnvironment(),
    evaluate: async () => ({ authorization: 'allow', outcome: 'passed' }),
  });

  assert.equal(result.view.outcome, 'unverified');

  const log = await readFile(evidenceLogPath(root), 'utf8').catch(() => '');

  assert.equal(
    log.trim(),
    '',
    `a decision the contract rejects is not a record of an evaluation: ${log}`,
  );
});

test('TB-037 AC-EVAL-002: the preflight judges completeness with the contract, and carries no second rule', async () => {
  const source = await readFile(
    path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts/lib/preflight-runner.mjs'),
    'utf8',
  );

  const authoritative = await readFile(
    path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts/lib/hook-runner.mjs'),
    'utf8',
  );

  assert.match(
    source,
    /contractFindings\(/,
    'the preflight must judge completeness with the contract, not with a field check.',
  );
  assert.match(
    authoritative,
    /export const contractFindings = \(decision\) => \{\s*try \{\s*return validateDecision\(decision\);/,
    'the wrapper both runners share must be the one that calls validateDecision.',
  );
  assert.equal(
    /decision\.(checks|outcome|authorization|evaluationId)\s*(===|!==|==|!=|\?\?|\|\|)/.test(source),
    false,
    'a second completeness rule in the preflight is the divergence TB-037 removes.',
  );
});

/**
 * TB-039 — Do no work for a turn that changed nothing.
 *
 * The preflight is registered on the end of every turn, so it runs when the
 * maintainer only asked a question and nothing in the worktree moved. For that
 * turn it used to materialize the whole clone, hash it, remove it, and append
 * an Evidence envelope, in order to reach the silence that was already
 * determined before any of it began.
 *
 * Applicability is a function of the changed paths alone: with none, every
 * configured check is `not-applicable` whether or not a copy exists. These
 * fixtures observe the copy directly, through a temporary directory the runner
 * cannot create anything in — a run that tries to materialize a root there
 * fails and says so, and a run that never tries is silent.
 */

/**
 * TB-048 — `FR-ADAPT-005`, `SG-SUPPORT-001`.
 *
 * A preflight surface whose feedback channel has not been observed is never
 * registered, but a hook written before that rule, or by hand, can still start
 * this runner. It does no work it could not report: no execution root is
 * materialized, no check is spawned, the Evidence store is never opened, and
 * nothing it would have said is assumed. The reason reaches the person on
 * stderr. The same clone, the same change, answered for a surface WITH a
 * channel, is evaluated exactly as before.
 */
test('TB-048 FR-ADAPT-005: a preflight surface that cannot answer does no work — no snapshot, no check, no Evidence — and says why', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);
  // A change whose required check fails: a surface that evaluated it would
  // have spawned the check and appended the decision.
  await writeFile(path.join(root, 'app/Order.php'), 'BROKEN\n', 'utf8');

  for (const adapterId of ['claude-code-desktop', 'codex-desktop']) {
    assert.equal(describeAdapter(adapterId).capabilities.feedback.absence, 'not-observed');

    const payload = { hook_event_name: 'Stop', session_id: 'preflight-session', cwd: root };
    const seams = [];
    const result = await runPreflight({
      cwd: root,
      stdin: `${JSON.stringify(payload)}\n`,
      argv: ['--adapter', adapterId],
      environment: isolatedGitEnvironment(),
      evaluate: async () => {
        seams.push('evaluate');

        throw new Error('nothing may be evaluated for a surface that cannot answer');
      },
      openEvidenceStore: async () => {
        seams.push('openEvidenceStore');

        throw new Error('no Evidence store may be opened for a surface that cannot answer');
      },
    });

    assert.deepEqual(seams, [], `${adapterId} reached an evaluation seam.`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.view, null);
    assert.match(result.stderr, new RegExp(`${adapterId} declares no feedback channel`));
    assert.match(result.stderr, /not been observed/);
    assert.match(result.stderr, /Nothing was evaluated/);

    // The packaged program, as a client would start it, under a temporary
    // directory nothing can be materialized in.
    const temporaryRoot = await unwritableTemporaryRoot(t);
    const packaged = await runPackaged({
      cwd: root,
      payload,
      args: ['--adapter', adapterId],
      environment: { TMPDIR: temporaryRoot },
    });

    assert.equal(packaged.exitCode, 0);
    assert.equal(packaged.stdout, '');
    assert.match(packaged.stderr, /declares no feedback channel/);
    assert.deepEqual(await rootsUnder(temporaryRoot), []);
    assert.equal((await readFile(evidenceLogPath(root), 'utf8').catch(() => '')).trim(), '');
  }

  // A surface with a channel is unchanged: the same change is evaluated and
  // answered through its declared field.
  const answered = await runPackaged({ cwd: root, payload: cursorStopPayload(root) });

  assert.match(JSON.parse(answered.stdout).followup_message, /failed/i);
  assert.notEqual((await readFile(evidenceLogPath(root), 'utf8')).trim(), '');
});

const commitWorktree = async (root, message) => {
  await runFile('git', ['add', '--all'], { cwd: root, env: isolatedGitEnvironment() });
  await runFile('git', [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Preflight Runner',
    'commit', '--quiet', '--message', message,
  ], { cwd: root, env: isolatedGitEnvironment() });
};

/** A clone whose worktree has nothing in it Git does not already have. */
const settledClone = async (t, options = {}) => {
  const root = await throwawayRepository(t);

  await configureClone(root, options);
  await commitWorktree(root, 'configured');
  await publishReceipt(root);

  const status = await runFile('git', ['status', '--porcelain'], {
    cwd: root,
    env: isolatedGitEnvironment(),
  });

  assert.equal(status.stdout, '', 'the fixture must start with nothing changed at all.');

  return root;
};

/**
 * A readable, unwritable temporary directory for one child runner.
 *
 * `mkdtemp` cannot create a directory here, so materializing an execution root
 * is impossible rather than merely unobserved. This is the whole observation:
 * the roots a run leaves behind are removed in a `finally`, so counting them
 * afterwards can never tell a run that copied the tree from one that did not.
 */
const unwritableTemporaryRoot = async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-preflight-tmp-')));

  t.after(async () => {
    await chmod(root, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });
  await chmod(root, 0o500);

  return root;
};

const rootsUnder = async (directory) => (await readdir(directory).catch(() => []))
  .filter((entry) => EXECUTION_ROOT_PREFIXES.some((prefix) => entry.startsWith(prefix)));

test('TB-039 AC-EVAL-004 / NFR-PERF-001: a preflight turn against a clean worktree materializes no execution root', async (t) => {
  const root = await settledClone(t);
  const temporaryRoot = await unwritableTemporaryRoot(t);

  const settled = await runPackaged({
    cwd: root,
    payload: cursorStopPayload(root),
    environment: { TMPDIR: temporaryRoot },
  });

  assert.equal(settled.exitCode, 0, `expected exit 0, got ${settled.exitCode}: ${settled.stderr}`);
  assert.equal(
    settled.stdout,
    '',
    `a turn that changed nothing must reach silence without materializing anything: ${settled.stdout}`,
  );
  assert.deepEqual(await rootsUnder(temporaryRoot), []);

  // The same clone, the same unwritable directory, one untracked file: the
  // skip must trigger on an empty change set and on nothing else, so this turn
  // still tries to materialize and reports that it could not.
  await writeFile(path.join(root, 'app/Invoice.php'), 'new\n', 'utf8');

  const changed = await runPackaged({
    cwd: root,
    payload: cursorStopPayload(root),
    environment: { TMPDIR: temporaryRoot },
  });

  assert.match(
    JSON.parse(changed.stdout).followup_message,
    /unverified/i,
    'an untracked file is a change, and a change is still captured before it is graded.',
  );
  assert.deepEqual(await rootsUnder(temporaryRoot), []);
});

test('TB-039 FR-ADAPT-005: a settled turn answers with exactly the silence the surface declares', async (t) => {
  const root = await settledClone(t);
  const result = await runPackaged({ cwd: root, payload: cursorStopPayload(root) });

  assert.equal(result.exitCode, 0);
  assert.equal(
    result.stdout,
    describeAdapter('cursor').capabilities.feedback.none,
    `the agent's channel must carry the declared silence form and nothing else: ${result.stdout}`,
  );
  assert.equal(
    result.stderr,
    '',
    `a settled turn is not a deliberate silence a maintainer needs explained: ${result.stderr}`,
  );
});

test('TB-039 AC-EVAL-004: a settled turn still grades every configured check as not-applicable', async (t) => {
  const root = await settledClone(t);
  const result = await runPreflight({
    cwd: root,
    stdin: `${JSON.stringify(cursorStopPayload(root))}\n`,
    argv: ['--adapter', 'cursor'],
    environment: isolatedGitEnvironment(),
  });

  assert.equal(result.view.outcome, 'passed');
  assert.equal(result.view.authorization, 'not-authoritative');
  assert.equal(result.view.blocking, false);
  assert.deepEqual(
    result.view.presentation.checks.map((check) => [check.id, check.outcome]),
    [['configuration.broad-tests.test', 'not-applicable']],
    'the configured checks are still reported, and still reported as not applicable.',
  );
});

test('TB-039 RISK-010 / FR-EVID-001: a settled turn appends no Evidence envelope', async (t) => {
  const root = await settledClone(t);

  await runPackaged({ cwd: root, payload: cursorStopPayload(root) });
  await runPackaged({ cwd: root, payload: cursorStopPayload(root) });

  const log = await readFile(evidenceLogPath(root), 'utf8').catch(() => '');

  assert.equal(
    log.trim(),
    '',
    `a turn that carried no verdict about any change is not a record worth keeping: ${log}`,
  );
});

/** The request shape the preflight normalizes one settled turn into. */
const settledRequest = (root) => {
  const adapter = describeAdapter('cursor');

  return {
    protocolVersion: PROTOCOL_VERSION,
    operation: OPERATION,
    repository: { root },
    change: { kind: 'worktree', baseRevision: 'HEAD' },
    evaluation: { purpose: 'regression-only', contractRef: null },
    invocation: {
      role: adapter.role,
      trigger: 'work-complete',
      adapter: {
        id: adapter.id,
        surface: adapter.surface,
        version: adapter.version,
        capabilities: { nativeBlocking: adapter.capabilities.blocking.native },
      },
      sessionId: 'preflight-session',
    },
  };
};

test('TB-039 AC-EVID-002: the decision says an unrecorded settled turn was never recorded, so a reader cannot mistake it for a lost one', async (t) => {
  const root = await settledClone(t);
  const request = settledRequest(root);

  assert.deepEqual(validateEvaluationRequest(request), []);

  const appended = [];
  const store = {
    root: path.join(root, '.git/change-evaluation-gate/evidence'),
    appendEvidence: async (entry) => {
      appended.push(entry);

      return { appended: true, evidenceId: `sha256:${'1'.repeat(64)}`, entry: {} };
    },
  };
  const decision = await evaluateWithoutSubject(request, {
    runnerVersion: 'fixture/1.0.0',
    providerVersions: { configuration: '1.0.0' },
    checks: [],
    policy: null,
    evidenceStore: store,
  });

  assert.deepEqual(validateDecision(decision), [], 'the no-subject decision must satisfy the contract.');
  assert.equal(decision.outcome, 'passed');
  assert.equal(decision.snapshot.id, null);
  assert.equal(decision.snapshot.executionRoot, null);
  assert.deepEqual(appended, [], 'a settled turn appends nothing.');
  assert.equal(decision.evidence.persisted, false);
  assert.equal(
    decision.evidence.reference.notRecorded,
    'no-change-to-record',
    `the decision must state that nothing was recorded and why: ${JSON.stringify(decision.evidence.reference)}`,
  );
  assert.equal(
    decision.evidence.reference.reasonCode,
    null,
    'a turn deliberately not recorded carries no store failure.',
  );
});

test('TB-039 AC-EVID-002 / FR-EVID-001: a settled turn that has something to say is recorded, because the record is what bounds repeating it', async (t) => {
  const root = await settledClone(t);
  const request = settledRequest(root);
  const appended = [];
  const store = {
    root: path.join(root, '.git/change-evaluation-gate/evidence'),
    appendEvidence: async (entry) => {
      appended.push(entry);

      return { appended: true, evidenceId: `sha256:${'2'.repeat(64)}`, entry: {} };
    },
  };
  const decision = await evaluateWithoutSubject(request, {
    runnerVersion: 'fixture/1.0.0',
    providerVersions: { configuration: '1.0.0' },
    checks: [],
    // A declared dependency root this clone never installed: nothing changed,
    // and the evaluation still has a diagnostic to report.
    policy: { execution: { dependency_roots: ['vendor'] } },
    evidenceStore: store,
  });

  assert.deepEqual(validateDecision(decision), []);
  assert.equal(decision.outcome, 'unverified');
  assert.equal(appended.length, 1, 'a verdict that will be repeated must be counted.');
  assert.equal(decision.evidence.persisted, true);
});

test('TB-039 AC-EVID-002: the repetition budget still bounds the follow-up loop when nothing in the worktree ever changes', async (t) => {
  // A settled worktree whose evaluation is still unverified, because a declared
  // dependency root is not installed. This is the shape that could loop: the
  // preflight speaks, the client re-prompts, the worktree stays exactly as it
  // was, and the same verdict comes back. The bound is the gate's own appended
  // record, so this proves the record is still made where it is load-bearing.
  const root = await settledClone(t, { dependencyRoots: ['vendor'] });
  const { maxIterations } = describeAdapter('cursor').capabilities.feedback;
  const answered = [];

  for (let attempt = 0; attempt < maxIterations + 2; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runPackaged({ cwd: root, payload: cursorStopPayload(root) });

    answered.push(result.stdout !== '');
  }

  assert.equal(
    answered.slice(0, maxIterations).every((spoke) => spoke === true),
    true,
    `the first ${maxIterations} unverified verdicts are worth saying: ${JSON.stringify(answered)}.`,
  );
  assert.equal(
    answered.slice(maxIterations).some((spoke) => spoke === true),
    false,
    `an unchanged verdict repeated past the declared bound must go quiet: ${JSON.stringify(answered)}.`,
  );
});

test('TB-039 NFR-REL-001: the authoritative runner asks no question before it captures', async () => {
  const authoritative = await readFile(
    path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts/lib/hook-runner.mjs'),
    'utf8',
  );

  assert.doesNotMatch(
    authoritative,
    /listChangedPaths|evaluateWithoutSubject/,
    'on a commit the snapshot is what the checks run against, so that runner always captures.',
  );
});

/**
 * TB-064 — the incident's shape, on a real clone through the real packaged
 * program: every check passes, the clone's configuration moved away from what
 * it was activated with, and a declared dependency root is absent. The channel
 * used to say `unverified.` and nothing else.
 */
test('TB-064 AC-SEC-001 / NFR-OPER-001 / FR-EVAL-009: a drifted clone whose checks all pass is told the drift, the missing root, and the changed Grader surface — the same reason codes its evidence records', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  // TB-066: committed, so the edit below is a change to a tracked Grader
  // surface. Left untracked it would be unversioned, which is a different fact.
  await commitWorktree(root, 'configured');
  await publishReceipt(root);
  // Pinned above; changed below, and never re-pinned. `vendor` is declared and
  // does not exist, exactly as the incident's three roots did not.
  await configureClone(root, { dependencyRoots: ['vendor'] });

  const result = await runPackaged({ cwd: root, payload: cursorStopPayload(root) });
  const message = JSON.parse(result.stdout).followup_message;

  assert.equal(result.exitCode, 0, `a preflight never blocks: ${result.stderr}`);
  assert.match(message, /^Preflight \(not a commit decision\): unverified\./);
  assert.doesNotMatch(message, /configuration\.broad-tests\.test/, `every check passed, so none is listed: ${message}`);
  assert.match(message, /integrity-drift/, message);
  assert.match(message, /trusted-configuration/, `the drifted surface is named: ${message}`);
  // TB-065: and so is what recovers it — a sync, carried verbatim through the
  // channel, never `gate repair`, which cannot re-pin a configuration.
  assert.match(message, /Next: gate sync — a new Activation transaction/, `the channel names the recovery: ${message}`);
  assert.doesNotMatch(message, /gate repair/, message);
  assert.match(message, /dependency-root-unavailable/, message);
  assert.match(message, /"vendor"/, message);
  assert.match(message, /gate-configuration \.agent-framework\.yaml/, `the changed Grader surface is named: ${message}`);

  const [entry] = (await readFile(evidenceLogPath(root), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const envelope = JSON.parse(await readFile(
    path.join(root, '.git/change-evaluation-gate/evidence', entry.envelopePath),
    'utf8',
  ));
  const recorded = envelope.decision.diagnostics.map((diagnostic) => diagnostic.reasonCode);

  assert.deepEqual(
    [...new Set(recorded)].sort(),
    ['dependency-root-unavailable', 'integrity-drift'],
    'the evidence records the reasons the incident\'s decision carried.',
  );

  for (const reasonCode of recorded) {
    assert.match(message, new RegExp(reasonCode), `the channel and the evidence disagree about ${reasonCode}: ${message}`);
  }

  assert.ok(envelope.decision.integrity.changedGraderSurfaces.length > 0, 'the edited configuration is recorded as changed.');

  for (const surface of envelope.decision.integrity.changedGraderSurfaces) {
    assert.ok(message.includes(`${surface.kind} ${surface.path}`), `the evidence records ${surface.path} and the channel does not: ${message}`);
  }
});

/**
 * TB-066 — say a Gate configuration is unversioned, once.
 *
 * Every Grader surface fixture above commits its configuration before it edits
 * it. A real project starts, and usually stays, with `.agent-framework.yaml`
 * untracked: `framework-setup` never commits it. On such a clone `git status`
 * reports the file untracked on every turn, and the channel used to call it a
 * changed Grader surface on every one of them, though nobody edited it.
 */

/** Every file under `root` but `.git`, with its content digest, in path order. */
const worktreeDigest = async (root) => {
  const entries = [];
  const walk = async (directory) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => (left.name < right.name ? -1 : 1),
    )) {
      const absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (absolute !== path.join(root, '.git')) {
          await walk(absolute);
        }

        continue;
      }

      entries.push({ path: path.relative(root, absolute), contentDigest: (await readFile(absolute)).toString('base64') });
    }
  };

  await walk(root);

  return contentIdentity(entries);
};

/** Every decision this clone's Evidence store recorded, in log order. */
const recordedDecisions = async (root) => {
  const log = (await readFile(evidenceLogPath(root), 'utf8').catch(() => ''))
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));

  return Promise.all(log.map(async (entry) => JSON.parse(await readFile(
    path.join(root, '.git/change-evaluation-gate/evidence', entry.envelopePath),
    'utf8',
  )).decision));
};

const git = (root, args) => runFile('git', args, { cwd: root, env: isolatedGitEnvironment() });

const followupOf = (result) => (result.stdout === '' ? null : JSON.parse(result.stdout).followup_message);

/** A clone whose configuration and check script were written and never committed. */
const unversionedClone = async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);

  const untracked = (await git(root, ['status', '--porcelain', '--untracked-files=all'])).stdout;

  assert.match(untracked, /^\?\? \.agent-framework\.yaml$/m, 'the fixture must leave the configuration untracked.');
  assert.match(untracked, /^\?\? tools\/check\.mjs$/m, 'the fixture must leave the check script untracked.');

  return root;
};

test('TB-066 FR-EVAL-009: two consecutive preflights over an untracked, untouched configuration report no changed Grader surface, and only the first says it is unversioned', async (t) => {
  const root = await unversionedClone(t);
  const before = await worktreeDigest(root);

  const first = await runPackaged({ cwd: root, payload: cursorStopPayload(root) });
  const second = await runPackaged({ cwd: root, payload: cursorStopPayload(root) });

  assert.equal(first.exitCode, 0, first.stderr);
  assert.equal(second.exitCode, 0, second.stderr);

  const message = followupOf(first);

  assert.ok(message !== null, 'the first turn states the unversioned surfaces once.');
  assert.match(message, /^Preflight \(not a commit decision\): passed\./);
  assert.doesNotMatch(message, /Changed Grader surfaces/, `nobody edited anything that grades this change: ${message}`);
  assert.match(message, /Unversioned Grader surfaces/, message);
  // NFR-OPER-001: each surface is named, and so is the remedy, which is the
  // maintainer's to perform.
  assert.match(message, /- gate-configuration \.agent-framework\.yaml/, message);
  assert.match(message, /- verification-script tools\/check\.mjs/, message);
  assert.match(message, /maintainer/i, message);
  assert.match(message, /commit/i, message);
  // AC-SEC-001: a fact about the clone, implying nothing about anybody.
  assert.doesNotMatch(message, /tamper|malicious|suspicious|hostile|attack|cheat|weaken|sabotag|evad|circumvent/i, message);
  assert.equal(
    second.stdout,
    describeAdapter('cursor').capabilities.feedback.none,
    `an unchanged passing turn does not repeat the statement, and so does not re-prompt: ${second.stdout}`,
  );

  // The decision and its evidence record the fact every time, whatever the
  // channel said (FR-EVAL-009).
  const decisions = await recordedDecisions(root);

  assert.equal(decisions.length, 2, 'both turns are recorded.');

  for (const decision of decisions) {
    assert.deepEqual(decision.integrity.changedGraderSurfaces, []);
    assert.equal(decision.integrity.controlSurfaceChanged, false);
    assert.deepEqual(
      decision.integrity.unversionedGraderSurfaces.map((surface) => [surface.kind, surface.path]),
      [['gate-configuration', '.agent-framework.yaml'], ['verification-script', 'tools/check.mjs']],
    );
  }

  // FR-LIFE-009: nothing was staged, committed, or written to the worktree.
  assert.equal(await worktreeDigest(root), before);
  assert.match((await git(root, ['status', '--porcelain', '--untracked-files=all'])).stdout, /^\?\? \.agent-framework\.yaml$/m);
  assert.equal((await git(root, ['rev-list', '--count', 'HEAD'])).stdout.trim(), '1');
});

test('TB-066 RISK-008 / SG-CFG-001: a tracked configuration edited by the change is reported as changed on every evaluation, with no once-only rule', async (t) => {
  const root = await settledClone(t);

  // A comment moves the file's content and not the policy it pins, so the
  // edit is visible as a change without also drifting the control surface.
  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    `# edited by this change\n${await readFile(path.join(root, '.agent-framework.yaml'), 'utf8')}`,
    'utf8',
  );

  const { maxIterations } = describeAdapter('cursor').capabilities.feedback;
  const messages = [];

  for (let attempt = 0; attempt < maxIterations; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    messages.push(followupOf(await runPackaged({ cwd: root, payload: cursorStopPayload(root) })));
  }

  for (const message of messages) {
    assert.ok(message !== null, `every evaluation within the loop bound states the change: ${JSON.stringify(messages)}`);
    assert.match(message, /Changed Grader surfaces[^\n]*\n- gate-configuration \.agent-framework\.yaml/, message);
    assert.doesNotMatch(message, /Unversioned/, message);
  }

  for (const decision of await recordedDecisions(root)) {
    assert.deepEqual(
      decision.integrity.changedGraderSurfaces.map((surface) => [surface.kind, surface.path]),
      [['gate-configuration', '.agent-framework.yaml']],
    );
    assert.equal(decision.integrity.controlSurfaceChanged, true, 'a tracked control surface moved.');
    assert.deepEqual(decision.integrity.unversionedGraderSurfaces, []);
  }
});

test('TB-066: committing an unversioned configuration and then editing it reports a change on the next evaluation', async (t) => {
  const root = await unversionedClone(t);

  assert.match(followupOf(await runPackaged({ cwd: root, payload: cursorStopPayload(root) })), /Unversioned Grader surfaces/);

  await commitWorktree(root, 'versioned by the maintainer');
  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    `# edited after it was versioned\n${await readFile(path.join(root, '.agent-framework.yaml'), 'utf8')}`,
    'utf8',
  );

  const message = followupOf(await runPackaged({ cwd: root, payload: cursorStopPayload(root) }));

  assert.ok(message !== null);
  assert.match(message, /Changed Grader surfaces[^\n]*\n- gate-configuration \.agent-framework\.yaml/, message);
  assert.doesNotMatch(message, /Unversioned/, message);

  const decisions = await recordedDecisions(root);

  assert.equal(decisions.at(-1).integrity.controlSurfaceChanged, true);
  assert.deepEqual(decisions.at(-1).integrity.unversionedGraderSurfaces, []);
});

test('TB-066: the statement is not repeated on a turn that changes other work, and is made again when the unversioned set changes', async (t) => {
  const root = await unversionedClone(t);

  assert.match(followupOf(await runPackaged({ cwd: root, payload: cursorStopPayload(root) })), /Unversioned Grader surfaces/);

  // The agent's next turn edits ordinary work: a new evaluation, the same
  // unversioned set, and so nothing to say about it.
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nsecond turn\n', 'utf8');
  assert.equal(followupOf(await runPackaged({ cwd: root, payload: cursorStopPayload(root) })), null);

  // The maintainer versions the check script and leaves the configuration, and
  // the agent's next turn edits ordinary work again.
  await git(root, ['add', 'tools/check.mjs']);
  await git(root, ['-c', 'user.email=gate@example.test', '-c', 'user.name=Gate Preflight Runner', 'commit', '--quiet', '--message', 'script']);
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nthird turn\n', 'utf8');

  const message = followupOf(await runPackaged({ cwd: root, payload: cursorStopPayload(root) }));

  assert.ok(message !== null, 'a different set is a different fact, and it is stated.');
  assert.match(message, /- gate-configuration \.agent-framework\.yaml/, message);
  assert.doesNotMatch(message, /tools\/check\.mjs/, message);
  assert.equal(followupOf(await runPackaged({ cwd: root, payload: cursorStopPayload(root) })), null);
});

test('TB-066: an untracked file that is not a declared Grader surface is reported by neither word', async (t) => {
  const root = await settledClone(t);

  // The observed project's shape: a tool's own configuration a check may read,
  // untracked and declared as nothing.
  await writeFile(path.join(root, 'phpstan.neon'), 'parameters:\n  level: 5\n', 'utf8');

  const result = await runPackaged({ cwd: root, payload: cursorStopPayload(root) });

  assert.equal(result.stdout, describeAdapter('cursor').capabilities.feedback.none, result.stdout);

  const [decision] = await recordedDecisions(root);

  assert.deepEqual(decision.integrity.changedGraderSurfaces, []);
  assert.deepEqual(decision.integrity.unversionedGraderSurfaces, []);
  assert.equal(decision.integrity.controlSurfaceChanged, false);
});

test('TB-066 SG-CFG-001: a configuration staged for the first time is tracked, and is reported as changed', async (t) => {
  const root = await unversionedClone(t);

  await git(root, ['add', '.agent-framework.yaml']);

  const message = followupOf(await runPackaged({ cwd: root, payload: cursorStopPayload(root) }));

  assert.ok(message !== null);
  assert.match(message, /Changed Grader surfaces[^\n]*\n- gate-configuration \.agent-framework\.yaml/, message);
  assert.match(message, /Unversioned Grader surfaces[^\n]*\n- verification-script tools\/check\.mjs\n/, message);

  const [decision] = await recordedDecisions(root);

  assert.equal(decision.integrity.controlSurfaceChanged, true);
  assert.deepEqual(decision.integrity.unversionedGraderSurfaces.map((surface) => surface.path), ['tools/check.mjs']);
});
