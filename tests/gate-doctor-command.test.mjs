import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  ACTIVATION_STEPS,
  OBSERVABLE_ACTIVATION_STEPS,
  STEPS_ANSWERED_BY_ACTIVATION,
} from '../skills/change-evaluation-gate/scripts/lib/activation.mjs';
import { canonicalTemporaryPath } from '../skills/change-evaluation-gate/scripts/lib/hook-runner.mjs';
import {
  COMMANDS,
  CONFIRMABLE_COMMANDS,
  EXIT_OBSERVED,
  EXIT_UNHEALTHY,
  USAGE,
  renderDocument,
  runOperatorCommand,
} from '../skills/change-evaluation-gate/scripts/lib/operator-surface.mjs';
import {
  COPY_MECHANISMS,
  captureSnapshot,
  probeDependencyProvisioning,
} from '../skills/change-evaluation-gate/scripts/lib/snapshot.mjs';

const runFile = promisify(execFile);

/**
 * TB-063 — `gate doctor`: tell a maintainer, before activating anything,
 * whether this machine can run the Gate this clone configured.
 *
 * Every fixture is a throwaway repository under the OS temporary directory and
 * never this repository: some of these tests activate, and an escaped
 * activation would register an authoritative hook into the framework clone.
 */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LIBRARY_ROOT = path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts/lib');

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

const TEST_CHECK = 'configuration.broad-tests.test';

/** One configured command, as `framework-setup` writes a schema v4 descriptor. */
const commandLines = ({ runner, args }) => [
  `        - runner: ${runner}`,
  '          args:',
  ...args.map((argument) => `            - ${argument}`),
  '          working_directory: .',
  '          timeout_seconds: 60',
  '          allowed_environment:',
  '            - PATH',
  '          evidence_category: test',
  '          source_scope: both',
];

const configuration = ({
  runner = 'php-script',
  args = ['artisan', 'test'],
  execution = { budget_skippable: [] },
  evidence = {},
} = {}) => [
  'schema_version: 4',
  'backend: laravel',
  'frontend: none',
  'verification:',
  '  commands:',
  '    test:',
  '      backend: []',
  '      frontend: []',
  '      both:',
  ...commandLines({ runner, args }),
  'evaluation_gate:',
  '  checks:',
  '    required:',
  `      - ${TEST_CHECK}`,
  '    advisory: []',
  '  budget:',
  '    total_seconds: 600',
  '  bypass:',
  '    enabled: false',
  '    marker: null',
  `  execution: ${JSON.stringify(execution)}`,
  `  evidence: ${JSON.stringify(evidence)}`,
  '',
].join('\n');

const temporary = async (t, prefix) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));

  t.after(() => rm(directory, { recursive: true, force: true }));

  return directory;
};

/** A throwaway clone that is configured and deliberately NOT activated. */
const configuredClone = async (t, { document = configuration(), files = {}, ignored = [] } = {}) => {
  const root = await temporary(t, 'gate-doctor-');

  await assertThrowawayRepository(root);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\n', 'utf8');
  await writeFile(path.join(root, '.agent-framework.yaml'), document, 'utf8');

  if (ignored.length > 0) {
    await writeFile(path.join(root, '.gitignore'), `${ignored.join('\n')}\n`, 'utf8');
  }

  for (const [relative, file] of Object.entries(files)) {
    const target = path.join(root, relative);

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.contents, { encoding: 'utf8', mode: file.mode ?? 0o644 });
  }

  await git(root, ['init', '--quiet']);
  await git(root, ['add', '--all']);
  await git(root, [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Doctor',
    'commit', '--quiet', '--message', 'baseline',
  ]);

  return root;
};

/**
 * A search path holding a `php` this test wrote, and nothing else. It is a
 * real executable with an absolute interpreter, so resolution pins it and
 * needs nothing further found.
 */
const phpOnPath = async (t) => {
  const bin = await temporary(t, 'gate-doctor-bin-');

  await writeFile(path.join(bin, 'php'), '#!/bin/sh\nexit 0\n', { encoding: 'utf8', mode: 0o755 });

  return bin;
};

/** A search path on which no `php` can be found. */
const emptyPath = (t) => temporary(t, 'gate-doctor-empty-');

/**
 * The surface, in-process. Only the tests about clone capability and the
 * probe's footprint run the real clone probe (`probe: true`): it writes 8 MiB
 * and measures the volume's free space, and every other doctor here would add
 * that write to what concurrently running suites measure. Everywhere else the
 * probe is told there is no copy program, and measures nothing.
 */
const gate = (root, argv, { PATH }, { probe = false } = {}) => runOperatorCommand({
  cwd: root,
  argv,
  environment: { ...isolatedGitEnvironment(), PATH },
  ...(probe ? {} : { copyProgram: null }),
});

/**
 * Every byte under a directory — file contents, link targets, and the path of
 * every entry — as one digest per path. `.git` included: that is where the
 * hooks, the local configuration, the receipt, and the Evidence store live.
 */
const treeDigest = async (root) => {
  const entries = {};
  const walk = async (directory) => {
    for (const name of (await readdir(directory)).sort()) {
      const absolute = path.join(directory, name);
      const relative = path.relative(root, absolute);
      // eslint-disable-next-line no-await-in-loop
      const entry = await lstat(absolute);

      if (entry.isSymbolicLink()) {
        // eslint-disable-next-line no-await-in-loop
        entries[relative] = `link:${await readlink(absolute)}`;
      } else if (entry.isDirectory()) {
        entries[relative] = 'directory';
        // eslint-disable-next-line no-await-in-loop
        await walk(absolute);
      } else {
        // eslint-disable-next-line no-await-in-loop
        entries[relative] = createHash('sha256').update(await readFile(absolute)).digest('hex');
      }
    }
  };

  await walk(root);

  return entries;
};

const doctorProbesUnder = async (directory) => (await readdir(directory).catch(() => []))
  .filter((entry) => entry.startsWith('gate-doctor-probe-'));

const doctorProbesUnderTemporary = async () => doctorProbesUnder(await canonicalTemporaryPath());

/**
 * What a concurrently running suite's doctor does to the shared temporary
 * directory: a separate process creates a `gate-doctor-probe-*` directory there
 * and removes it when told to (`TB-075`).
 */
const FOREIGN_PROBE_DRIVER = [
  "import { mkdtemp, rm } from 'node:fs/promises';",
  "import { tmpdir } from 'node:os';",
  "import path from 'node:path';",
  "const directory = await mkdtemp(path.join(tmpdir(), 'gate-doctor-probe-'));",
  "process.stdout.write(`${directory}\\n`);",
  "process.stdin.on('end', () => rm(directory, { recursive: true, force: true }));",
  'process.stdin.resume();',
].join('\n');

/** Start another process's probe and wait until it exists; `release` removes it and waits for that process to end. */
const foreignProbe = async (t) => {
  const child = spawn(process.execPath, ['--input-type=module', '--eval', FOREIGN_PROBE_DRIVER], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const ended = once(child, 'close');
  const [directory] = await once(createInterface({ input: child.stdout }), 'line');
  const release = async () => {
    child.stdin.end();
    await ended;
  };

  t.after(release);

  return { directory, release };
};

/**
 * Run `operate` with a temporary directory of this test's own, and list the
 * `gate-doctor-probe-*` entries left in it afterwards (`TB-075`).
 *
 * The probe is created under `os.tmpdir()`, read at call time, so pointing
 * `TMPDIR` at a fresh directory puts every probe this test's doctors make, and
 * any they leave unreported, where no other suite writes: test files run in
 * separate processes, and the tests within this file run one at a time.
 */
const probesLeftInPrivateTemporary = async (t, operate) => {
  const privateTemporary = await temporary(t, 'gate-doctor-tmp-');
  const sharedTemporary = process.env.TMPDIR;

  process.env.TMPDIR = privateTemporary;

  try {
    await operate();
  } finally {
    if (sharedTemporary === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = sharedTemporary;
    }
  }

  return doctorProbesUnder(privateTemporary);
};

const assertDoctorLeftNoProbe = (probesLeft) => assert.deepEqual(
  probesLeft,
  [],
  'doctor left a probe directory behind.',
);

/** Preview and confirm an activation through the same surface, as a maintainer would. */
const activateThroughSurface = async (root, environment) => {
  const preview = await gate(root, ['activate'], environment);
  const token = preview.document.observation.confirmationToken;
  const confirmed = await gate(root, ['activate', '--confirm', token], environment);

  return { preview, confirmed, token };
};

/**
 * THE FIRST RED TEST.
 *
 * On a clone whose configured PHP runner does not resolve, `gate doctor`
 * names the runner and the descriptor before anything is activated — where
 * until now the first signal was a failed activation. And the activation that
 * follows stops at exactly the step, for exactly the reason, doctor named.
 */
test('TB-063 FR-CFG-004: an unresolved PHP runner is named, with its descriptor, before anything is activated', async (t) => {
  const root = await configuredClone(t);
  const environment = { PATH: await emptyPath(t) };
  const doctor = await gate(root, ['doctor'], environment);

  assert.equal(doctor.exitCode, EXIT_UNHEALTHY, doctor.stderr);
  assert.equal(doctor.document.command, 'doctor');

  const { runners, verdict } = doctor.document.observation;

  assert.deepEqual(runners.resolved, []);
  assert.equal(runners.unresolved.length, 1);
  assert.deepEqual(
    {
      checkId: runners.unresolved[0].checkId,
      role: runners.unresolved[0].role,
      runner: runners.unresolved[0].runner,
      args: runners.unresolved[0].args,
      reason: runners.unresolved[0].reason,
    },
    {
      checkId: TEST_CHECK, role: 'evaluate', runner: 'php-script', args: ['artisan', 'test'], reason: 'runner-unresolved',
    },
  );
  assert.match(doctor.stdout, /configuration\.broad-tests\.test \(evaluate\): php-script artisan test — unresolved \(runner-unresolved\)/);
  assert.equal(verdict.proceeds, false);
  assert.equal(verdict.stop.step, 'runner-resolution');
  assert.equal(verdict.stop.reasonCode, 'runner-unresolved');
  assert.match(doctor.stdout, /^verdict: activation would stop at runner-resolution \(runner-unresolved\)/m);

  // Nothing was activated by asking.
  const status = await gate(root, ['status'], environment);

  assert.equal(status.document.observation.state, 'configured');

  // The activation that follows stops where doctor said it would, for the same reason.
  const { confirmed } = await activateThroughSurface(root, environment);

  assert.equal(confirmed.document.mutation.performed, false);
  assert.equal(confirmed.document.mutation.step, verdict.stop.step);
  assert.equal(confirmed.document.mutation.reasonCode, verdict.stop.reasonCode);
});

test('TB-063 FR-CFG-004, FR-LIFE-004: a resolved runner is reported at the path activation then pins, and the verdict is activation\'s own', async (t) => {
  const root = await configuredClone(t);
  const bin = await phpOnPath(t);
  const environment = { PATH: bin };
  const doctor = await gate(root, ['doctor'], environment);

  assert.equal(doctor.exitCode, EXIT_OBSERVED, doctor.stdout);

  const { runners, verdict, identities } = doctor.document.observation;

  assert.equal(runners.unresolved.length, 0);
  assert.deepEqual(runners.resolved.map((entry) => [entry.checkId, entry.runner, entry.executable]), [
    [TEST_CHECK, 'php-script', path.join(bin, 'php')],
  ]);
  assert.equal(verdict.proceeds, true);
  assert.equal(verdict.stop, null);
  assert.deepEqual(verdict.reached, [...OBSERVABLE_ACTIVATION_STEPS]);
  assert.equal(verdict.preview, 'reached');
  assert.match(doctor.stdout, /^verdict: activation would proceed past every step doctor can see/m);

  const { preview, confirmed, token } = await activateThroughSurface(root, environment);

  // Doctor never hands out the token that would confirm an activation.
  assert.equal(doctor.stdout.includes(token), false);
  assert.equal(JSON.stringify(doctor.document).includes(token), false);
  // It was computed against the identities the receipt then pins.
  assert.equal(identities.repository, preview.document.observation.repositoryIdentity);
  assert.equal(identities.configuration, preview.document.observation.configurationIdentity);
  assert.equal(confirmed.document.mutation.performed, true, JSON.stringify(confirmed.document.mutation));

  const receipt = JSON.parse(await readFile(
    path.join(root, '.git', 'change-evaluation-gate', 'evidence', 'activation', 'receipt.json'),
    'utf8',
  ));

  assert.deepEqual(
    receipt.runtime.runners.map((entry) => [entry.check_id, entry.runner, entry.executable, entry.interpreter]),
    runners.resolved.map((entry) => [entry.checkId, entry.runner, entry.executable, entry.interpreter]),
  );
  assert.equal(receipt.repository.identity, identities.repository);
  assert.equal(receipt.configuration.identity, identities.configuration);
});

test('TB-063 AC-PORT-001, NFR-PORT-002: clone capability, same volume, and directory-link capability are probed under the temporary directory and agree with a capture', async (t) => {
  const execution = {
    budget_skippable: [],
    dependency_roots: ['vendor', 'node_modules', 'missing_root'],
    dependency_provisioning: { vendor: 'copy' },
  };
  const root = await configuredClone(t, {
    document: configuration({ execution }),
    ignored: ['vendor/', 'node_modules/'],
    files: {
      'vendor/autoload.php': { contents: '<?php // installed\n' },
      'node_modules/pkg/index.js': { contents: 'module.exports = 1;\n' },
    },
  });
  const doctor = await gate(root, ['doctor'], { PATH: await phpOnPath(t) }, { probe: true });
  const { dependencies } = doctor.document.observation;
  const temporaryRoot = await canonicalTemporaryPath();

  assert.equal(isInside(temporaryRoot, dependencies.probe.directory), true);
  assert.equal(typeof dependencies.directoryLink.created, 'boolean');
  assert.equal(typeof dependencies.repositorySharesVolume, 'boolean');
  assert.ok(dependencies.clone === null || typeof dependencies.clone.program === 'string');
  assert.deepEqual(
    dependencies.roots.map(({ root: declared, strategy, status }) => [declared, strategy, status]),
    [['vendor', 'copy', 'available'], ['node_modules', 'link', 'available'], ['missing_root', 'link', 'missing']],
  );

  // Doctor's prediction for the copied root is the `copy` rule applied to the
  // probe result doctor itself reported: a clone only where the program
  // clones here and the root shares the temporary directory's volume.
  assert.ok(COPY_MECHANISMS.includes(dependencies.roots[0].mechanism));
  assert.equal(
    dependencies.roots[0].mechanism,
    dependencies.clone !== null && dependencies.roots[0].sharesVolume === true ? 'clone' : 'byte-copy',
  );

  // And the rule doctor asks is the rule a capture applies. Two clone probes
  // are two measurements of free space, and concurrent disk activity can make
  // either under-report a clone, so they are not compared with each other.
  // Given the same probe input — here, no copy program, which measures
  // nothing — the prediction and the capture agree exactly.
  const temporaryProbe = await mkdtemp(path.join(temporaryRoot, 'gate-doctor-predict-'));
  const executionRoot = await mkdtemp(path.join(temporaryRoot, 'gate-doctor-capture-'));

  t.after(() => rm(temporaryProbe, { recursive: true, force: true }));
  t.after(() => rm(executionRoot, { recursive: true, force: true }));

  const predicted = await probeDependencyProvisioning({
    repositoryRoot: root,
    dependencyRoots: execution.dependency_roots,
    provisioning: execution.dependency_provisioning,
    probeRoot: temporaryProbe,
    copyProgram: null,
  });
  const captured = await captureSnapshot({
    repositoryRoot: root,
    kind: 'git-index',
    executionRoot,
    dependencyRoots: execution.dependency_roots,
    dependencyProvisioning: execution.dependency_provisioning,
    copyProgram: null,
  });

  assert.equal(captured.captured, true, captured.detail);
  assert.equal(predicted.clone, null);
  assert.equal(predicted.roots[0].mechanism, 'byte-copy');
  assert.equal(predicted.roots[0].mechanism, captured.dependencies.mechanisms.vendor.mechanism);
  // A link is attempted, not measured, so doctor's own answer is compared.
  assert.equal(
    dependencies.roots[1].mechanism === 'link',
    captured.dependencies.provided.includes('node_modules'),
  );
  assert.deepEqual(captured.dependencies.missing, ['missing_root']);
  assert.match(doctor.stdout, /^ {2}directory link: /m);
  assert.match(doctor.stdout, /^ {2}- vendor \(copy\): available, /m);

  // No operating-system branch reaches the answer: capabilities are probed.
  const operatorModules = (await readdir(path.join(LIBRARY_ROOT, 'operator-surface'), { recursive: true }))
    .filter((entry) => entry.endsWith('.mjs'))
    .map((entry) => path.join('operator-surface', entry));

  for (const file of ['operator-surface.mjs', ...operatorModules, 'snapshot.mjs']) {
    // eslint-disable-next-line no-await-in-loop
    const source = await readFile(path.join(LIBRARY_ROOT, file), 'utf8');

    for (const detection of [/process\.platform/, /os\.platform/, /\bwin32\b/, /\bdarwin\b/, /os\.release/, /os\.type/]) {
      assert.doesNotMatch(source, detection, `${file} branches on the operating system.`);
    }
  }
});

test('TB-063 FR-CFG-006, SG-SECRET-001: each declared Sensitive input is reported by name and source, each environment file by status, and no value reaches any output', async (t) => {
  const canary = 'doctor-canary-5f1c9e2a7b';
  const shellCanary = 'doctor-shell-canary-0d3b8a';
  const root = await configuredClone(t, {
    document: configuration({
      evidence: {
        sensitive_inputs: ['APP_KEY', 'FROM_SHELL', 'NOWHERE'],
        environment_files: ['.env', '.env.local'],
      },
    }),
    ignored: ['.env'],
    files: { '.env': { contents: `APP_KEY=${canary}\nOTHER=unrelated\n` } },
  });
  const environment = { PATH: await phpOnPath(t), FROM_SHELL: shellCanary };
  const rendered = await runOperatorCommand({
    cwd: root, argv: ['doctor'], environment: { ...isolatedGitEnvironment(), ...environment }, copyProgram: null,
  });
  const json = await runOperatorCommand({
    cwd: root, argv: ['doctor', '--json'], environment: { ...isolatedGitEnvironment(), ...environment }, copyProgram: null,
  });
  const { runtimeInputs } = json.document.observation;

  assert.deepEqual(runtimeInputs.resolved, [
    { name: 'APP_KEY', source: '.env' },
    { name: 'FROM_SHELL', source: 'environment' },
  ]);
  assert.deepEqual(runtimeInputs.unresolved, [{ name: 'NOWHERE', source: 'environment' }]);
  assert.deepEqual(runtimeInputs.environmentFiles, [
    { path: '.env', status: 'read' },
    { path: '.env.local', status: 'missing' },
  ]);

  for (const output of [rendered.stdout, rendered.stderr, json.stdout, json.stderr]) {
    assert.equal(output.includes(canary), false, 'a Sensitive value from a declared file reached the output.');
    assert.equal(output.includes(shellCanary), false, 'a Sensitive value from the environment reached the output.');
    assert.equal(output.includes('unrelated'), false, 'an undeclared value from a declared file reached the output.');
  }

  assert.match(rendered.stdout, /APP_KEY \(\.env\) resolved/);
  assert.match(rendered.stdout, /NOWHERE \(environment\) unresolved/);
  assert.match(rendered.stdout, /\.env \(read\), \.env\.local \(missing\)/);
});

test('TB-063 FR-LIFE-004, AC-LIFE-008: hook-chain validity is reported through activation\'s own validation, and a refusing chain is named exactly as activation names it', async (t) => {
  const root = await configuredClone(t);
  const environment = { PATH: await phpOnPath(t) };
  const valid = await gate(root, ['doctor'], environment);

  assert.equal(valid.document.observation.hooks.valid, true);
  assert.equal(valid.document.observation.hooks.action, 'create-owned-shim');
  assert.equal(valid.document.observation.hooks.reasonCode, null);

  await writeFile(
    path.join(root, '.git', 'hooks', 'pre-commit'),
    '#!/usr/bin/env python3\nimport sys\nsys.exit(0)\n',
    { encoding: 'utf8', mode: 0o755 },
  );

  const refused = await gate(root, ['doctor'], environment);
  const { hooks, verdict } = refused.document.observation;

  assert.equal(refused.exitCode, EXIT_UNHEALTHY);
  assert.equal(hooks.valid, false);
  assert.equal(hooks.reasonCode, 'hook-exists');
  assert.equal(verdict.stop.step, 'hook-chain-validation');
  assert.equal(verdict.stop.reasonCode, 'hook-exists');
  assert.match(refused.stdout, /^hooks: pre-commit .* refused at hook-chain-validation \(hook-exists\)/m);

  const { confirmed } = await activateThroughSurface(root, environment);

  assert.equal(confirmed.document.mutation.performed, false);
  assert.equal(confirmed.document.mutation.step, 'hook-chain-validation');
  assert.equal(confirmed.document.mutation.reasonCode, 'hook-exists');
});

test('TB-063 SG-LIFE-001, FR-LIFE-009: doctor writes nothing under the clone or its store, and the one probe it makes under the temporary directory is gone', async (t) => {
  const root = await configuredClone(t, {
    document: configuration({
      execution: { budget_skippable: [], dependency_roots: ['vendor'], dependency_provisioning: 'copy' },
      evidence: { sensitive_inputs: ['APP_KEY'], environment_files: ['.env'] },
    }),
    ignored: ['vendor/', '.env'],
    files: {
      'vendor/autoload.php': { contents: '<?php\n' },
      '.env': { contents: 'APP_KEY=writes-nothing\n' },
    },
  });
  const environment = { PATH: await phpOnPath(t) };
  const probesLeft = await probesLeftInPrivateTemporary(t, async () => {
    for (const phase of ['configured', 'activated']) {
      if (phase === 'activated') {
        // eslint-disable-next-line no-await-in-loop
        const { confirmed } = await activateThroughSurface(root, environment);

        assert.equal(confirmed.document.mutation.performed, true, JSON.stringify(confirmed.document.mutation));
      }

      // eslint-disable-next-line no-await-in-loop
      const before = await treeDigest(root);
      // eslint-disable-next-line no-await-in-loop
      const doctor = await gate(root, ['doctor', '--json'], environment, { probe: true });
      // eslint-disable-next-line no-await-in-loop
      const after = await treeDigest(root);

      assert.deepEqual(after, before, `doctor changed the ${phase} clone.`);
      assert.equal(doctor.document.observation.state, phase);
      assert.equal(doctor.document.mutation, null);

      const { probe } = doctor.document.observation.dependencies;

      assert.equal(isInside(await canonicalTemporaryPath(), probe.directory), true);
      // eslint-disable-next-line no-await-in-loop
      assert.equal(await lstat(probe.directory).then(() => true, () => false), false, 'the probe directory was left behind.');
      assert.equal(probe.removed, true);
    }
  });

  // An activated clone is not something activation would take over again.
  assertDoctorLeftNoProbe(probesLeft);
});

test('TB-075 SG-LIFE-001: another process\'s probe in the shared temporary directory, made while doctor runs, does not decide whether doctor left one', async (t) => {
  const root = await configuredClone(t);
  const environment = { PATH: await phpOnPath(t) };
  const sharedBefore = await doctorProbesUnderTemporary();
  const foreign = await foreignProbe(t);
  const probesLeft = await probesLeftInPrivateTemporary(t, async () => {
    const doctor = await gate(root, ['doctor', '--json'], environment);

    assert.equal(doctor.document.observation.dependencies.probe.removed, true);
  });
  const sharedAfter = await doctorProbesUnderTemporary();

  await foreign.release();

  // The shared listing the footprint test once compared changed under it.
  assert.equal(sharedAfter.includes(path.basename(foreign.directory)), true);
  assert.notDeepEqual(sharedAfter, sharedBefore);
  assertDoctorLeftNoProbe(probesLeft);
});

test('TB-075 SG-LIFE-001: a probe directory left behind without being reported still fails the footprint assertion', async (t) => {
  const root = await configuredClone(t);
  const environment = { PATH: await phpOnPath(t) };
  const probesLeft = await probesLeftInPrivateTemporary(t, async () => {
    const doctor = await gate(root, ['doctor', '--json'], environment);
    const { probe } = doctor.document.observation.dependencies;

    // A second probe, made where doctor makes its own and reported nowhere:
    // the reported probe's own assertions cannot see it.
    await mkdtemp(path.join(await canonicalTemporaryPath(), 'gate-doctor-probe-'));

    assert.equal(probe.removed, true);
    assert.equal(await lstat(probe.directory).then(() => true, () => false), false);
  });

  assert.equal(probesLeft.length, 1);
  assert.throws(() => assertDoctorLeftNoProbe(probesLeft), /doctor left a probe directory behind/);
});

test('TB-063: the questions doctor cannot answer are listed as answered by activation, with the step named, and every activation step is accounted for once', async (t) => {
  assert.deepEqual(
    ACTIVATION_STEPS.filter((step) => OBSERVABLE_ACTIVATION_STEPS.includes(step)
      || STEPS_ANSWERED_BY_ACTIVATION.some((entry) => entry.step === step)),
    [...ACTIVATION_STEPS],
  );
  assert.equal(
    OBSERVABLE_ACTIVATION_STEPS.filter((step) => STEPS_ANSWERED_BY_ACTIVATION.some((entry) => entry.step === step)).length,
    0,
  );

  const root = await configuredClone(t);
  const doctor = await gate(root, ['doctor'], { PATH: await phpOnPath(t) });
  const { answeredByActivation } = doctor.document.observation;

  assert.deepEqual(answeredByActivation.map((entry) => entry.step), STEPS_ANSWERED_BY_ACTIVATION.map((entry) => entry.step));

  for (const { step } of STEPS_ANSWERED_BY_ACTIVATION) {
    assert.match(doctor.stdout, new RegExp(`^ {2}- ${step}: `, 'm'));
  }
});

test('TB-063: an unconfigured clone is told activation would not start, and nothing is written', async (t) => {
  const root = await temporary(t, 'gate-doctor-bare-');

  await assertThrowawayRepository(root);
  await git(root, ['init', '--quiet']);

  const before = await treeDigest(root);
  const doctor = await gate(root, ['doctor'], { PATH: await emptyPath(t) });

  assert.equal(doctor.exitCode, EXIT_UNHEALTHY, doctor.stderr);
  assert.equal(doctor.document.observation.configuration.resolved, false);
  assert.equal(doctor.document.observation.configuration.reasonCode, 'configuration-missing');
  assert.equal(doctor.document.observation.verdict.proceeds, false);
  assert.equal(doctor.document.observation.verdict.stop.step, null);
  assert.equal(doctor.document.observation.verdict.stop.reasonCode, 'configuration-missing');
  assert.match(doctor.stdout, /^verdict: activation would not start \(configuration-missing\)/m);
  assert.deepEqual(await treeDigest(root), before);
});

test('TB-063 NFR-OPER-001: --json is the rendered document, doctor takes no --confirm, and --help and the command contract list it', async (t) => {
  const root = await configuredClone(t);
  const environment = { PATH: await emptyPath(t) };
  const rendered = await gate(root, ['doctor'], environment);
  const json = await gate(root, ['doctor', '--json'], environment);
  const parsed = JSON.parse(json.stdout);

  assert.equal(json.exitCode, rendered.exitCode);
  // Two runs differ only where the machine was observed twice: the probe path.
  parsed.observation.dependencies.probe.directory = rendered.document.observation.dependencies.probe.directory;
  assert.equal(renderDocument(parsed), rendered.stdout);

  assert.ok(COMMANDS.includes('doctor'));
  assert.equal(CONFIRMABLE_COMMANDS.doctor, undefined);

  const confirm = await gate(root, ['doctor', '--confirm', `sha256:${'a'.repeat(64)}`], environment);

  assert.notEqual(confirm.document.failure, null);

  assert.match(USAGE, /^ {2}gate doctor {5}\[--json\]/m);

  const help = await gate(root, ['--help'], environment);

  assert.match(help.stdout, /gate doctor/);

  const contract = await readFile(LIFECYCLE_CONTRACT, 'utf8');

  assert.match(contract, /^## `gate doctor` \(`TB-063`\)$/m);
  assert.match(contract, /^gate doctor {5}\[--json\]$/m);
});
