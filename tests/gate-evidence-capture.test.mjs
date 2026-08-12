import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createBoundedExecutor } from '../skills/change-evaluation-gate/scripts/lib/bounded-execution.mjs';

const SCRIPT = [
  "process.stdout.write('stdout line\\n');",
  "process.stderr.write('stderr line\\n');",
  'process.exit(3);',
  '',
].join('\n');

const executionRoot = async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'gate-capture-'));

  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'emit.mjs'), SCRIPT, 'utf8');

  return root;
};

const command = () => ({
  runner: 'repository-script',
  args: ['emit.mjs'],
  working_directory: '.',
  timeout_seconds: 30,
  allowed_environment: ['PATH'],
  evidence_category: 'test',
  source_scope: 'both',
});

test('the bounded executor captures nothing unless capture is asked for', async (t) => {
  const root = await executionRoot(t);
  const executor = createBoundedExecutor({
    resolveExecutable: () => ({ executable: process.execPath }),
  });

  const attempt = await executor.execute({
    command: command(),
    executionRoot: root,
    timeoutSeconds: 30,
  });

  assert.equal(attempt.exitCode, 3);
  assert.equal(attempt.output, undefined);
});

test('opt-in capture returns bounded combined output for evidence', async (t) => {
  const root = await executionRoot(t);
  const executor = createBoundedExecutor({
    resolveExecutable: () => ({ executable: process.execPath }),
    captureOutput: true,
  });

  const attempt = await executor.execute({
    command: command(),
    executionRoot: root,
    timeoutSeconds: 30,
  });

  assert.equal(attempt.exitCode, 3);
  assert.match(attempt.output, /stdout line/);
  assert.match(attempt.output, /stderr line/);
  assert.equal(attempt.outputTruncated, false);

  // Capture is itself bounded: a runaway writer can never exhaust memory.
  const bounded = createBoundedExecutor({
    resolveExecutable: () => ({ executable: process.execPath }),
    captureOutput: true,
    captureLimitBytes: 8,
  });
  const clipped = await bounded.execute({
    command: command(),
    executionRoot: root,
    timeoutSeconds: 30,
  });

  assert.equal(Buffer.byteLength(clipped.output, 'utf8') <= 8, true);
  assert.equal(clipped.outputTruncated, true);
});
