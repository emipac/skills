import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { evaluate } from '../skills/change-evaluation-gate/scripts/lib/evaluate.mjs';
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

  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'receipt.json'),
    `${JSON.stringify({
      receiptVersion: 'change-evaluation-gate/activation-receipt/v1',
      receiptId: 'sha256:receipt',
      previewId: 'sha256:preview',
      repository: { root },
      configuration: { identity: 'sha256:configuration', schemaVersion: 4 },
      runtime: {
        gate: { id: 'change-evaluation-gate', version: '1.0.0', protocolVersion: '1.0' },
        runnerVersion: 'fixture/1.0.0',
        runners: [PINNED_RUNNER],
      },
    }, null, 2)}\n`,
    'utf8',
  );
};

const cursorStopPayload = (root) => ({
  hook_event_name: 'stop',
  session_id: 'preflight-session',
  workspace_roots: [root],
  cursor_version: '3.15.6',
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

test('SG-OWNER-001: no client name and no native feedback field lives outside the adapter declarations', async () => {
  const libraryRoot = path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts/lib');
  const scriptsRoot = path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts');
  const clientNames = /\b(cursor|codex|claude|copilot|vscode|jetbrains|intellij|windsurf|zed)\b/i;
  const nativeFields = /\bfollowup_message\b/;
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

