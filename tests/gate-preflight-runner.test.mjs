import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
import { evaluate } from '../skills/change-evaluation-gate/scripts/lib/evaluate.mjs';
import { contentIdentity } from '../skills/change-evaluation-gate/scripts/lib/evidence-store.mjs';
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

const configureClone = async (root) => {
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

const runPackaged = ({ cwd, payload, args = ['--adapter', 'cursor'] }) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [PACKAGED_RUNNER, ...args], {
    cwd,
    env: isolatedGitEnvironment(),
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

test('AC-ADAPT-001: a passing Cursor stop payload produces no follow-up, so a clean turn is never interrupted', async (t) => {
  const root = await throwawayRepository(t);

  await configureClone(root);
  await publishReceipt(root);

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

  const declarations = await readFile(path.join(libraryRoot, 'adapters.mjs'), 'utf8');

  assert.match(declarations, nativeFields);
  assert.match(declarations, /\bcursor\b/i);
});

