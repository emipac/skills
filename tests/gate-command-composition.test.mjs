/**
 * TB-019 — Bind runner arguments to their resolved executable.
 *
 * Every logical runner names an executable and every descriptor carries an
 * argument array, but only the runner knows how the two combine. These fixtures
 * drive that rule with the exact descriptors a real migration produced, and
 * assert that the previewed invocation is byte-identical to the one execution
 * runs (`AC-CFG-002`, `SG-CMD-001`).
 */

import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createBoundedExecutor } from '../skills/change-evaluation-gate/scripts/lib/bounded-execution.mjs';
import {
  resolveExecutables,
} from '../skills/change-evaluation-gate/scripts/lib/command-descriptor.mjs';

/** Wrap a stored runner/args pair in the rest of the schema v4 command shape. */
const stored = (runner, args, overrides = {}) => ({
  runner,
  args,
  working_directory: '.',
  timeout_seconds: 300,
  allowed_environment: ['PATH'],
  evidence_category: 'format',
  source_scope: 'backend',
  ...overrides,
});

/**
 * The descriptors `skills/framework-setup/scripts/configure.mjs` writes for a
 * real Laravel + npm clone. These are stored shapes, not synthetic ones: the
 * migration puts the binary name inside `args` for `composer-bin` and stores
 * only the script name for `package-script`.
 */
const MIGRATED = Object.freeze({
  // `vendor/bin/pint --dirty --format agent`
  formatBackend: stored('composer-bin', ['pint', '--dirty', '--format', 'agent']),
  // `npm run format:check`
  formatFrontend: stored('package-script', ['format:check'], { source_scope: 'frontend' }),
  // `php artisan test --compact`
  tests: stored('php-script', ['artisan', 'test', '--compact'], { evidence_category: 'test' }),
});

/**
 * All four declared runners. `php-script` and `repository-script` pass their
 * arguments through unchanged — `artisan` genuinely is an argument to `php` —
 * and this proves correcting the other two left them alone.
 */
const EVERY_RUNNER = Object.freeze({
  ...MIGRATED,
  graderSurface: stored('repository-script', ['scripts/smoke.mjs', '--json'], {
    evidence_category: 'smoke',
  }),
});

const previewOf = (command, executable) => {
  const activation = resolveExecutables(
    [{ id: 'migrated.check', evaluate: command }],
    () => ({ executable, version: '1.0.0' }),
  );

  assert.deepEqual(activation.unresolved, [], 'the fixture runner should resolve');

  return activation.resolved[0].preview;
};

test('AC-CFG-002: a migrated composer-bin descriptor previews the command the maintainer wrote', () => {
  // Resolution consumes `args[0]` to find the binary under the vendor
  // directory, so the executable already carries that name. Repeating it as an
  // argument would run `pint pint ...`.
  assert.equal(
    previewOf(MIGRATED.formatBackend, 'vendor/bin/pint'),
    'vendor/bin/pint --dirty --format agent',
  );
});

test('AC-CFG-002: a migrated package-script descriptor previews through its run subcommand', () => {
  // The descriptor stores only the script name; the package manager reaches a
  // script through `run`, so composition supplies that subcommand.
  assert.equal(
    previewOf(MIGRATED.formatFrontend, 'npm'),
    'npm run format:check',
  );
});

/**
 * A real executable that reports the argument vector it was launched with.
 *
 * Execution is proved against a launched process rather than a stubbed spawn,
 * so nothing can agree with the preview merely because both read the same
 * stored array.
 */
const argumentReporter = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gate-composition-'));
  const executable = path.join(directory, 'report-argv');

  await writeFile(
    executable,
    '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n',
    'utf8',
  );
  await chmod(executable, 0o755);

  return { directory, executable };
};

test('AC-CFG-002: the previewed invocation is byte-identical to the one execution runs', async () => {
  const { directory, executable } = await argumentReporter();
  const executor = createBoundedExecutor({
    resolveExecutable: () => ({ executable, version: '1.0.0' }),
    captureOutput: true,
  });

  for (const [label, command] of Object.entries(EVERY_RUNNER)) {
    const attempt = await executor.execute({
      command,
      executionRoot: directory,
      timeoutSeconds: command.timeout_seconds,
    });

    assert.equal(attempt.exitCode, 0, `${label} did not execute`);

    const executed = [executable, ...JSON.parse(attempt.output)].join(' ');

    assert.equal(executed, previewOf(command, executable), `${label} drifted from its preview`);
  }
});

test('AC-CFG-002: a descriptor whose arguments cannot be composed is reported, not adjusted', async () => {
  // A composer-bin descriptor with no arguments has no binary name for
  // resolution to consume. There is nothing to run and nothing to infer.
  const uncomposable = stored('composer-bin', []);

  const activation = resolveExecutables(
    [{ id: 'uncomposable.check', evaluate: uncomposable }],
    () => ({ executable: 'vendor/bin', version: '1.0.0' }),
  );

  assert.deepEqual(activation.resolved, [], 'an uncomposable descriptor must not be previewed');
  assert.deepEqual(activation.unresolved, [{
    check_id: 'uncomposable.check',
    role: 'evaluate',
    runner: 'composer-bin',
    reason: 'command-args-uncomposable',
  }]);

  const { directory, executable } = await argumentReporter();
  const executor = createBoundedExecutor({
    resolveExecutable: () => ({ executable, version: '1.0.0' }),
    captureOutput: true,
  });

  const attempt = await executor.execute({
    command: uncomposable,
    executionRoot: directory,
    timeoutSeconds: 30,
  });

  assert.deepEqual(attempt, {
    executed: false,
    exitCode: null,
    durationMs: 0,
    reasonCode: 'configuration-invalid',
  });
});
