/**
 * TB-028 — Run every check in an environment it can actually start in.
 *
 * Checks executed with the environment their descriptor declared and nothing
 * else, built from `{}`, so a descriptor declaring `[]` — the shape migration
 * writes by default — ran with no PATH at all. That is survivable for a
 * directly-spawned absolute path and fatal for an executable that is a script:
 * the kernel reads its `#!/usr/bin/env …` shebang and resolves the interpreter
 * through a PATH that does not exist.
 *
 * Five of six required checks in the preserved evidence under
 * `real-project-evidence/` died that way, in one to five milliseconds, with
 * exit `127`, and every one of them was reported to the maintainer as their own
 * code failing.
 */

import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createBoundedExecutor } from '../skills/change-evaluation-gate/scripts/lib/bounded-execution.mjs';
import {
  createRunnerResolver,
  resolveExecutables,
  runtimeSearchPath,
} from '../skills/change-evaluation-gate/scripts/lib/command-descriptor.mjs';
import {
  UNVERIFIED_REASONS,
  classifyAttempt,
} from '../skills/change-evaluation-gate/scripts/lib/evaluation-contract.mjs';

/** Wrap a stored runner/args pair in the rest of the schema v4 command shape. */
const stored = (runner, args, overrides = {}) => ({
  runner,
  args,
  working_directory: '.',
  timeout_seconds: 60,
  // The default a real migration writes. A descriptor that declares nothing is
  // the ordinary case, not an exotic one.
  allowed_environment: [],
  evidence_category: 'format',
  source_scope: 'backend',
  ...overrides,
});

const writeExecutable = async (file, contents) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents, 'utf8');
  await chmod(file, 0o755);
};

/**
 * A clone whose vendor binary is a script, exactly like `vendor/bin/pint` and
 * `vendor/bin/phpstan`: the kernel must find its interpreter on PATH before a
 * single byte of the tool runs.
 *
 * The interpreter lives outside the clone, as a real toolchain does, and is
 * named by nothing in the descriptor — it is discoverable only by reading the
 * executable the receipt pinned.
 */
const clone = async (t, { interpreterName = 'gradelang', shebang = null } = {}) => {
  const root = await mkdtemp(path.join(tmpdir(), 'gate-execution-environment-'));
  const toolchain = await mkdtemp(path.join(tmpdir(), 'gate-execution-toolchain-'));

  t.after(() => import('node:fs/promises').then(({ rm }) => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(toolchain, { recursive: true, force: true }),
  ])));

  // The interpreter itself starts from an absolute shebang, so the kernel needs
  // no search path to run it once it has been found.
  await writeExecutable(path.join(toolchain, interpreterName), '#!/bin/sh\nexec /bin/sh "$@"\n');
  await writeExecutable(
    path.join(root, 'vendor/bin/grade'),
    [
      shebang ?? `#!/usr/bin/env ${interpreterName}`,
      'printf "graded by %s\\n" "$0"',
      'grep -q BROKEN "$1" && exit 1',
      'exit 0',
      '',
    ].join('\n'),
  );
  await writeFile(path.join(root, 'subject.txt'), 'clean\n', 'utf8');

  return { root, toolchain, interpreter: path.join(toolchain, interpreterName) };
};

test('TB-028 FR-PROF-010: resolution pins the interpreter a shebang executable needs, not only the executable', async (t) => {
  const { root, toolchain, interpreter } = await clone(t);
  const resolve = createRunnerResolver({
    repositoryRoot: root,
    environment: { PATH: toolchain },
  });
  const resolution = resolve('composer-bin', stored('composer-bin', ['grade', 'subject.txt']));

  assert.equal(resolution?.executable, path.join(root, 'vendor/bin/grade'));
  assert.equal(
    resolution?.interpreter,
    interpreter,
    'an executable that cannot start without its interpreter has not been fully resolved by naming only itself.',
  );
});

test('TB-028 SG-CMD-001: a shebang executable declaring no environment still starts, and reports its own outcome', async (t) => {
  const { root, toolchain } = await clone(t);
  const command = stored('composer-bin', ['grade', 'subject.txt']);
  const resolve = createRunnerResolver({ repositoryRoot: root, environment: { PATH: toolchain } });
  const resolution = resolve('composer-bin', command);
  const executor = createBoundedExecutor({
    resolveExecutable: () => resolution,
    runtimePath: runtimeSearchPath([resolution]),
    captureOutput: true,
    // Nothing of this process's environment is offered to the child.
    environment: {},
  });

  const passing = await executor.execute({
    command,
    executionRoot: root,
    timeoutSeconds: 60,
  });

  assert.notEqual(
    passing.exitCode,
    127,
    `the tool never started: ${passing.output}`,
  );
  assert.equal(passing.exitCode, 0, `expected the tool's own verdict, got: ${passing.output}`);
  assert.match(passing.output, /graded by/);

  await writeFile(path.join(root, 'subject.txt'), 'BROKEN\n', 'utf8');

  const failing = await executor.execute({ command, executionRoot: root, timeoutSeconds: 60 });

  assert.equal(failing.exitCode, 1, "the tool's own negative verdict must survive too.");
});

test('TB-028 NFR-REL-003: an executable whose interpreter cannot be resolved is unresolved, never left to fail as a verdict', async (t) => {
  const { root } = await clone(t, { interpreterName: 'gradelang' });
  const command = stored('composer-bin', ['grade', 'subject.txt']);
  // The toolchain is not on the resolution path, so the interpreter this
  // executable names cannot be found on this machine.
  const resolve = createRunnerResolver({ repositoryRoot: root, environment: { PATH: '' } });

  assert.equal(resolve('composer-bin', command), null);

  const activation = resolveExecutables([{ id: 'format.backend', evaluate: command }], resolve);

  assert.deepEqual(activation.resolved, []);
  assert.deepEqual(activation.unresolved, [{
    check_id: 'format.backend',
    role: 'evaluate',
    runner: 'composer-bin',
    reason: 'runner-unresolved',
  }]);
});

test('TB-028 FR-PROF-010: an executable whose shebang names an absolute interpreter needs no search path', async (t) => {
  const { root } = await clone(t, { shebang: '#!/bin/sh' });
  const resolve = createRunnerResolver({ repositoryRoot: root, environment: { PATH: '' } });
  const resolution = resolve('composer-bin', stored('composer-bin', ['grade', 'subject.txt']));

  assert.equal(resolution?.executable, path.join(root, 'vendor/bin/grade'));
  assert.equal(
    resolution?.interpreter,
    null,
    'the kernel resolves an absolute interpreter without help, so there is nothing to pin.',
  );
});

test('TB-028 SG-CMD-001: the child sees the runtime search path and its declared names, and nothing else', async (t) => {
  const { root, toolchain } = await clone(t);
  const command = stored('composer-bin', ['grade', 'subject.txt'], {
    allowed_environment: ['DECLARED_NAME'],
  });
  const resolve = createRunnerResolver({ repositoryRoot: root, environment: { PATH: toolchain } });
  const resolution = resolve('composer-bin', command);

  await writeExecutable(
    path.join(root, 'vendor/bin/grade'),
    [
      '#!/usr/bin/env gradelang',
      'env | sort',
      'exit 0',
      '',
    ].join('\n'),
  );

  const executor = createBoundedExecutor({
    resolveExecutable: () => resolution,
    runtimePath: runtimeSearchPath([resolution]),
    captureOutput: true,
    environment: {
      DECLARED_NAME: 'crosses',
      UNDECLARED_NAME: 'must-not-cross',
      PATH: '/a/leaked/shell/path',
    },
  });
  const attempt = await executor.execute({ command, executionRoot: root, timeoutSeconds: 60 });
  const names = attempt.output.split('\n')
    .map((line) => line.split('=')[0])
    .filter((name) => name.length > 0);

  assert.equal(names.includes('DECLARED_NAME'), true, 'a declared name must reach the check.');
  assert.equal(
    names.includes('UNDECLARED_NAME'),
    false,
    'an undeclared name must never cross from the invoking environment.',
  );
  assert.match(attempt.output, /^PATH=.*/m, 'the child needs a search path to start its own interpreter.');
  assert.doesNotMatch(
    attempt.output,
    /\/a\/leaked\/shell\/path/,
    "the runtime search path is derived from the pins, never inherited from the maintainer's shell.",
  );
});

test('TB-028 NFR-REL-001: the runtime search path is the pins first, then the platform, and nothing of the invoking shell', async (t) => {
  const { root, toolchain } = await clone(t);
  const resolve = createRunnerResolver({ repositoryRoot: root, environment: { PATH: toolchain } });
  const resolution = resolve('composer-bin', stored('composer-bin', ['grade', 'subject.txt']));
  const entries = runtimeSearchPath([resolution]).split(path.delimiter).filter(Boolean);
  const platform = runtimeSearchPath([]).split(path.delimiter).filter(Boolean);

  assert.deepEqual(
    entries.slice(0, 2),
    [path.join(root, 'vendor/bin'), toolchain],
    'a pinned program must find its own interpreter before anything the platform offers.',
  );
  assert.deepEqual(
    entries.slice(2),
    platform,
    'everything after the pins is the platform’s own utility directories.',
  );

  // The platform base is the operating system's, never this process's. A
  // version manager or package-manager prefix on the invoking PATH could change
  // which program a tool reaches, so none of it may appear here.
  for (const entry of platform) {
    assert.match(entry, /^\/(?:usr\/)?s?bin$/, `${entry} is not a platform utility directory.`);
  }

  assert.equal(
    runtimeSearchPath([resolution, resolution]).split(path.delimiter).filter(Boolean).length,
    entries.length,
    'a repeated pin contributes its directory once.',
  );
});

/**
 * TB-033 — an attempt whose program never started has not failed.
 *
 * In the preserved evidence five checks exited `127` in one to five
 * milliseconds and were every one classified `failed` / `grader-negative`,
 * which states that the grader ran and returned a verdict. Nothing ran.
 * `TB-028` removed the cause; what remains is a pinned program whose
 * interpreter chain breaks after activation, and the rule that a launch
 * failure is a harness failure holds whether or not it has a live cause.
 *
 * The signal is bounded execution's because bounded execution is the only
 * participant that knows whether the process it spawned became the program it
 * named. It is never derived from the exit status: a project's own tool may
 * legitimately exit `127`, and a descriptor may declare its own success codes.
 */

test('TB-033 AC-EVAL-006: a pinned interpreter that disappeared after activation is a launch failure, not a verdict', async (t) => {
  const { root, toolchain, interpreter } = await clone(t);
  const command = stored('composer-bin', ['grade', 'subject.txt']);
  const resolve = createRunnerResolver({ repositoryRoot: root, environment: { PATH: toolchain } });
  const resolution = resolve('composer-bin', command);

  assert.equal(resolution?.interpreter, interpreter);

  // Activation proved the chain; the machine changed afterwards.
  await rm(interpreter, { force: true });

  const executor = createBoundedExecutor({
    resolveExecutable: () => resolution,
    runtimePath: runtimeSearchPath([resolution]),
    captureOutput: true,
    environment: {},
  });
  const attempt = await executor.execute({ command, executionRoot: root, timeoutSeconds: 60 });

  assert.equal(attempt.executed, false, 'a program that could not start did not run.');
  assert.equal(attempt.reasonCode, 'launch-failed');
  assert.deepEqual(
    classifyAttempt(attempt),
    { outcome: 'unverified', reasonCode: 'launch-failed' },
    'a maintainer is never told their code was rejected by a tool that never saw it.',
  );
  assert.equal(UNVERIFIED_REASONS.includes('launch-failed'), true);
});

test('TB-033 NFR-REL-003: an executable that is gone is a launch failure rather than a crash of the checked code', async (t) => {
  const { root, toolchain } = await clone(t);
  const command = stored('composer-bin', ['grade', 'subject.txt']);
  const resolve = createRunnerResolver({ repositoryRoot: root, environment: { PATH: toolchain } });
  const resolution = resolve('composer-bin', command);

  await rm(path.join(root, 'vendor/bin/grade'), { force: true });

  const executor = createBoundedExecutor({
    resolveExecutable: () => resolution,
    runtimePath: runtimeSearchPath([resolution]),
    environment: {},
  });
  const attempt = await executor.execute({ command, executionRoot: root, timeoutSeconds: 60 });

  assert.equal(attempt.executed, false);
  assert.equal(attempt.reasonCode, 'launch-failed');
  assert.equal(classifyAttempt(attempt).outcome, 'unverified');
});

test('TB-033 AC-EVAL-006: a tool that really runs is classified by its own verdict, whatever number it exits with', async (t) => {
  const { root, toolchain } = await clone(t);
  const command = stored('composer-bin', ['grade', 'subject.txt']);
  const resolve = createRunnerResolver({ repositoryRoot: root, environment: { PATH: toolchain } });
  const resolution = resolve('composer-bin', command);
  const executor = createBoundedExecutor({
    resolveExecutable: () => resolution,
    runtimePath: runtimeSearchPath([resolution]),
    captureOutput: true,
    environment: {},
  });

  await writeFile(path.join(root, 'subject.txt'), 'BROKEN\n', 'utf8');

  const negative = await executor.execute({ command, executionRoot: root, timeoutSeconds: 60 });

  assert.equal(negative.executed, true);
  assert.equal(negative.reasonCode, undefined, 'a tool that ran carries no harness reason.');
  assert.deepEqual(
    classifyAttempt(negative),
    { outcome: 'failed', reasonCode: 'grader-negative' },
  );

  // A tool that genuinely exits 127 as its own verdict, under a descriptor that
  // declares that code a success, is still read as the verdict it is.
  await writeExecutable(
    path.join(root, 'vendor/bin/grade'),
    ['#!/usr/bin/env gradelang', 'exit 127', ''].join('\n'),
  );

  const conventional = await executor.execute({ command, executionRoot: root, timeoutSeconds: 60 });

  assert.equal(conventional.exitCode, 127);
  assert.equal(conventional.reasonCode, undefined);
  assert.deepEqual(
    classifyAttempt(conventional, { successExitCodes: [127] }),
    { outcome: 'passed', reasonCode: 'grader-positive' },
  );
});
