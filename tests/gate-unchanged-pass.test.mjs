import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { configurationIdentity } from '../skills/change-evaluation-gate/scripts/lib/activation.mjs';
import { readRepositoryConfiguration } from '../skills/change-evaluation-gate/scripts/lib/configuration.mjs';
import { contentIdentity } from '../skills/change-evaluation-gate/scripts/lib/evidence-store.mjs';
import { captureSnapshot } from '../skills/change-evaluation-gate/scripts/lib/snapshot.mjs';
import { worktreeSnapshotIdentity } from '../skills/change-evaluation-gate/scripts/lib/unchanged-evaluation.mjs';

const runFile = promisify(execFile);

/**
 * A preflight is registered on the end of every turn. When the worktree is
 * byte-identical to one this clone already passed, under the same
 * configuration, repeating the checks proves nothing new. Every fixture is a
 * throwaway repository under the OS temporary directory.
 */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGED_RUNNER = path.join(
  FRAMEWORK_ROOT,
  'skills/change-evaluation-gate/scripts/gate-preflight.mjs',
);

const gitEnvironment = () => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

const git = (cwd, args) => runFile('git', args, { cwd, env: gitEnvironment() });

const commitAll = async (root, message) => {
  await git(root, ['add', '--all']);
  await git(root, [
    '-c', 'user.email=gate@example.test', '-c', 'user.name=Unchanged Pass',
    'commit', '--quiet', '--message', message,
  ]);
};

/**
 * A clone whose one check appends a line to a file outside the repository each
 * time it actually runs, so a test can count executions rather than infer them.
 */
const clone = async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-unchanged-repo-')));
  const ledger = path.join(root, '..', `${path.basename(root)}-runs.log`);

  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(ledger, { force: true }),
  ]));

  await mkdir(path.join(root, 'app'), { recursive: true });
  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\n', 'utf8');
  await writeFile(path.join(root, 'tools/check.mjs'), [
    "import { appendFileSync, readFileSync } from 'node:fs';",
    `appendFileSync(${JSON.stringify(ledger)}, 'ran\\n');`,
    "process.exitCode = readFileSync(process.argv[2], 'utf8').includes('BROKEN') ? 1 : 0;",
    '',
  ].join('\n'), 'utf8');
  await writeFile(path.join(root, '.agent-framework.yaml'), [
    'schema_version: 4',
    'backend: unknown',
    'frontend: none',
    'verification:',
    '  profile: gate-unchanged-pass',
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
  ].join('\n'), 'utf8');
  await git(root, ['init', '--quiet']);
  await commitAll(root, 'baseline');

  const common = path.resolve(
    root,
    (await git(root, ['rev-parse', '--git-common-dir'])).stdout.trim(),
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
      runners: [{
        check_id: 'configuration.broad-tests.test',
        role: 'evaluate',
        runner: 'repository-script',
        executable: process.execPath,
        version: process.versions.node,
      }],
    },
  };

  await mkdir(common, { recursive: true });
  await writeFile(
    path.join(common, 'receipt.json'),
    `${JSON.stringify({ ...body, receiptId: contentIdentity(body) }, null, 2)}\n`,
    'utf8',
  );

  const runs = async () => (await readFile(ledger, 'utf8').catch(() => '')).split('\n').filter(Boolean).length;

  return { root, runs };
};

const preflight = (root) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [PACKAGED_RUNNER, '--adapter', 'cursor'], {
    cwd: root,
    env: gitEnvironment(),
  });
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  child.stdin.end(`${JSON.stringify({
    hook_event_name: 'stop',
    session_id: 'unchanged-pass-session',
    workspace_roots: [root],
    cursor_version: '3.15.6',
    status: 'completed',
    loop_count: 0,
  })}\n`);
});

test('a worktree that passed before and has not changed is not evaluated again', async (t) => {
  const { root, runs } = await clone(t);

  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nrepaired\n', 'utf8');

  const first = await preflight(root);

  assert.equal(first.exitCode, 0, first.stderr);
  assert.equal(await runs(), 1, 'the first turn over a changed tree runs the check.');

  const again = await preflight(root);

  assert.equal(again.exitCode, 0, again.stderr);
  assert.equal(await runs(), 1, 'an identical tree that already passed must not run its checks again.');
  assert.equal(again.stdout, first.stdout, 'the agent is answered exactly as before.');
});

test('any change to the tree is evaluated again', async (t) => {
  const { root, runs } = await clone(t);

  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nrepaired\n', 'utf8');
  await preflight(root);
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nrepaired again\n', 'utf8');
  await preflight(root);
  assert.equal(await runs(), 2, 'a changed file is a new tree.');

  await writeFile(path.join(root, 'app/Invoice.php'), 'new\n', 'utf8');
  await preflight(root);
  assert.equal(await runs(), 3, 'a new untracked file is a new tree.');
});

test('a tree that did not pass is evaluated again, never reused', async (t) => {
  const { root, runs } = await clone(t);

  await writeFile(path.join(root, 'app/Order.php'), 'BROKEN\n', 'utf8');

  const failed = await preflight(root);

  assert.match(JSON.parse(failed.stdout).followup_message, /fail/i);
  assert.equal(await runs(), 1);

  await preflight(root);
  assert.equal(await runs(), 2, 'a failed verdict is not evidence that a later identical tree passes.');
});

test('a changed configuration is evaluated again even over an identical tree', async (t) => {
  const { root, runs } = await clone(t);

  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nrepaired\n', 'utf8');
  await preflight(root);
  assert.equal(await runs(), 1);

  const configuration = path.join(root, '.agent-framework.yaml');

  await writeFile(
    configuration,
    (await readFile(configuration, 'utf8')).replace('total_seconds: 600', 'total_seconds: 601'),
    'utf8',
  );
  await preflight(root);
  assert.equal(
    await runs(),
    2,
    'the configuration identity covers the policy, so a policy edit is never covered by an earlier pass.',
  );
});

test('the fingerprint names a worktree exactly as a materialized snapshot does', async (t) => {
  const { root } = await clone(t);

  await writeFile(path.join(root, 'app/Order.php'), 'edited\n', 'utf8');
  await writeFile(path.join(root, 'app/Untracked.php'), 'untracked\n', 'utf8');

  const executionRoot = await mkdtemp(path.join(tmpdir(), 'gate-unchanged-exec-'));

  t.after(() => rm(executionRoot, { recursive: true, force: true }));

  const capture = await captureSnapshot({
    repositoryRoot: root, kind: 'worktree', executionRoot,
  });

  assert.equal(capture.captured, true);
  assert.equal(await worktreeSnapshotIdentity(root), capture.snapshot.id);
});
