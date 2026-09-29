import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { REMEDIES } from '../skills/change-evaluation-gate/scripts/lib/remedies.mjs';
import { configureProject } from '../skills/framework-setup/scripts/configure.mjs';

/**
 * `agent-framework setup` without a terminal (`TB-067`).
 *
 * Every run here is the Framework command as a child process with no terminal,
 * against a throwaway clone under the OS temporary directory. The Gate is
 * reached exactly as the command reaches it — as a program — so the fixtures
 * that need an activated clone activate it through the Gate's own two-invocation
 * command, as `gate-operator-surface`'s `commandActivatedClone` does.
 */
const runFile = promisify(execFile);
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETUP_SKILL = path.join(FRAMEWORK_ROOT, 'skills', 'framework-setup');
const ENTRY = path.join(SETUP_SKILL, 'scripts', 'agent-framework.mjs');
const CONFIGURE = path.join(SETUP_SKILL, 'scripts', 'configure.mjs');
const GATE = path.join(FRAMEWORK_ROOT, 'skills', 'change-evaluation-gate', 'scripts', 'gate.mjs');

const isExecutable = (candidate) => {
  try {
    accessSync(candidate, constants.X_OK);

    return true;
  } catch {
    return false;
  }
};

/**
 * PATH without any `change-evaluation-gate` a developer may have linked
 * globally, and with this Node first, so every fixture decides for itself
 * whether the Gate is on the path.
 */
const pathWithoutGate = () => [
  path.dirname(process.execPath),
  ...(process.env.PATH ?? '').split(path.delimiter)
    .filter((directory) => directory && !isExecutable(path.join(directory, 'change-evaluation-gate'))),
].join(path.delimiter);

const environment = (overrides = {}) => ({
  ...process.env,
  PATH: pathWithoutGate(),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  ...overrides,
});

const git = (root, args) => runFile('git', args, { cwd: root, env: environment() });

const commit = async (root, message = 'baseline') => {
  await git(root, ['add', '--all']);
  await git(root, [
    '-c', 'user.email=setup@example.test',
    '-c', 'user.name=Setup',
    'commit', '--quiet', '--allow-empty', '--message', message,
  ]);
};

/** Run a program with no terminal: stdin is closed, stdout and stderr are pipes. */
const run = (program, argv, { cwd, env = environment() }) => new Promise((resolve) => {
  const child = execFile(program, argv, { cwd, env, encoding: 'utf8' }, (error, stdout, stderr) => {
    resolve({ status: error ? (typeof error.code === 'number' ? error.code : 2) : 0, stdout, stderr });
  });

  child.stdin?.end();
});

/** `agent-framework <argv>` in `root`, through `entry`, and its parsed document when it printed JSON. */
const agentFramework = async (root, argv, { entry = ENTRY, env } = {}) => {
  const result = await run(process.execPath, [entry, ...argv], { cwd: root, env });
  let document = null;

  if (argv.includes('--json')) {
    document = JSON.parse(result.stdout);
  }

  return { ...result, document };
};

/** Every file and directory of the clone, `.git` included, as one hash. */
const cloneHash = async (root) => {
  const hash = createHash('sha256');
  const walk = async (directory) => {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);

      hash.update(`${path.relative(root, absolute)}\0`);

      if (entry.isDirectory()) {
        hash.update('<directory>\0');
        await walk(absolute);
      } else if (entry.isFile()) {
        hash.update(await readFile(absolute));
        hash.update('\0');
      }
    }
  };

  await walk(root);

  return hash.digest('hex');
};

/**
 * Run `setup` and `setup --json` twice each against `root`, and prove the four
 * runs changed nothing under the clone or `.git`, printed byte-identical output
 * on repeat, and that the text carries the plan the document carries
 * (`AC-GUIDE-002`, `SG-GUIDE-001`).
 */
const observeSetup = async (root, options = {}) => {
  const before = await cloneHash(root);
  const text = await agentFramework(root, ['setup'], options);
  const json = await agentFramework(root, ['setup', '--json'], options);
  const textAgain = await agentFramework(root, ['setup'], options);
  const jsonAgain = await agentFramework(root, ['setup', '--json'], options);

  assert.equal(await cloneHash(root), before, 'setup changed a byte under the clone or .git.');
  assert.equal(text.stderr, '', text.stderr);
  assert.equal(json.stderr, '', json.stderr);
  assert.equal(textAgain.stdout, text.stdout, 'a repeated setup printed different text.');
  assert.equal(jsonAgain.stdout, json.stdout, 'a repeated setup --json printed a different document.');
  assert.equal(text.status, json.status);
  assert.equal(json.document.exitStatus, json.status);
  assertMirror(text.stdout, json.document);

  return { text, json, plan: json.document };
};

/** The text rendering names the same state, steps, commands, and next command as the document. */
const assertMirror = (stdout, plan) => {
  const lines = stdout.split('\n');

  assert.ok(lines.includes(`state: ${plan.state}`), `text does not name state ${plan.state}.`);
  assert.ok(lines.includes(`steps: ${plan.steps.length}`));

  for (const [index, step] of plan.steps.entries()) {
    assert.ok(
      lines.some((line) => line.startsWith(`  ${index + 1}. ${step.id} (${step.owner})`)),
      `text does not list step ${index + 1} ${step.id}.`,
    );

    for (const command of step.commands) {
      assert.ok(lines.includes(`     $ ${command.run}`), `text does not print ${command.run}.`);
    }
  }

  const next = lines.filter((line) => line.startsWith('next: '));

  assert.equal(next.length, 1);
  assert.equal(next[0], `next: ${plan.next === null ? 'nothing' : (plan.next.command ?? plan.next.instruction)}`);

  for (const unavailable of plan.unavailable) {
    assert.ok(stdout.includes(unavailable), `text does not name unavailable step ${unavailable}.`);
  }
};

/** Paste one printed command into a real POSIX shell in the clone, as a maintainer would. */
const pasteIntoShell = (root, line, env = environment()) => run('sh', ['-c', line], { cwd: root, env });

const throwawayRepository = async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'agent-framework-setup-')));

  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(root.startsWith(FRAMEWORK_ROOT), false);
  await git(root, ['init', '--quiet']);
  await mkdir(path.join(root, 'tools'), { recursive: true });
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, 'tools/check.mjs'), [
    "import { readFile } from 'node:fs/promises';",
    '',
    "const graded = await readFile(process.argv[2], 'utf8').catch(() => '');",
    '',
    'process.stdout.write(`graded ${graded.length} bytes\\n`);',
    "process.exitCode = graded.includes('BROKEN') ? 1 : 0;",
    '',
  ].join('\n'), 'utf8');
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\n', 'utf8');
  // A protected instruction file framework-setup must never change.
  await writeFile(path.join(root, 'AGENTS.md'), 'maintainer-owned instructions\n', 'utf8');
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'setup-fixture',
    private: true,
    scripts: { test: 'node tools/check.mjs app/Order.php' },
  }, null, 2)}\n`, 'utf8');

  return root;
};

/**
 * The schema v4 configuration `gate-operator-surface` activates, with or
 * without its Gate section, and with any dependency roots or evidence policy a
 * fixture declares.
 */
const schemaV4Configuration = ({
  gate = true,
  totalSeconds = 600,
  dependencyRoots = [],
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
  '        - runner: repository-script',
  '          args:',
  '            - tools/check.mjs',
  '            - app/Order.php',
  '          working_directory: .',
  '          timeout_seconds: 60',
  '          allowed_environment:',
  '            - PATH',
  '          evidence_category: test',
  '          source_scope: both',
  ...(gate ? [
    'evaluation_gate:',
    '  checks:',
    '    required:',
    '      - configuration.broad-tests.test',
    '    advisory: []',
    '  budget:',
    `    total_seconds: ${totalSeconds}`,
    '  bypass:',
    '    enabled: false',
    '    marker: null',
    '  execution:',
    '    budget_skippable: []',
    ...(dependencyRoots.length === 0 ? [] : [
      '    dependency_roots:',
      ...dependencyRoots.map((root) => `      - ${root}`),
    ]),
    `  evidence: ${JSON.stringify(evidence)}`,
  ] : []),
  '',
].join('\n');

const noConfigurationClone = async (t) => {
  const root = await throwawayRepository(t);

  await commit(root);

  return root;
};

/** Schema v3, written by framework-setup's own base setup. */
const schemaV3Clone = async (t) => {
  const root = await throwawayRepository(t);

  await configureProject({ projectRoot: root, selections: { tracker: 'local-markdown' } });
  await commit(root);

  return root;
};

const schemaV4Clone = async (t, options) => {
  const root = await throwawayRepository(t);

  await writeFile(path.join(root, '.agent-framework.yaml'), schemaV4Configuration(options), 'utf8');
  await commit(root);

  return root;
};

const gateJson = async (root, argv, env = environment()) => {
  const result = await run(process.execPath, [GATE, ...argv, '--json'], { cwd: root, env });

  return JSON.parse(result.stdout);
};

/**
 * A clone activated through the Gate's own `activate`, previewed and then
 * confirmed. `prepare` runs on the clone before its baseline commit, for a
 * fixture that needs more than the configuration (an ignored environment
 * file, say).
 */
const activatedClone = async (t, { prepare = async () => {}, env, ...options } = {}) => {
  const root = await throwawayRepository(t);

  await writeFile(path.join(root, '.agent-framework.yaml'), schemaV4Configuration(options), 'utf8');
  await prepare(root);
  await commit(root);

  const preview = await gateJson(root, ['activate'], env);
  const confirmed = await gateJson(root, ['activate', '--confirm', preview.observation.confirmationToken], env);

  assert.equal(confirmed.mutation.performed, true, `The fixture failed to activate: ${confirmed.mutation.reasonCode}.`);

  return root;
};

/** `framework-setup` installed on its own, as a client places one skill directory. */
const setupOnlyInstall = async (t) => {
  const installRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'agent-framework-install-')));

  t.after(() => rm(installRoot, { recursive: true, force: true }));
  await cp(SETUP_SKILL, path.join(installRoot, 'skills', 'framework-setup'), { recursive: true });

  return {
    installRoot,
    entry: path.join(installRoot, 'skills', 'framework-setup', 'scripts', 'agent-framework.mjs'),
    configure: path.join(installRoot, 'skills', 'framework-setup', 'scripts', 'configure.mjs'),
  };
};

const commandsOf = (plan) => plan.steps.map((step) => step.id);

/**
 * THE FIRST RED TEST.
 *
 * A schema v3 clone reports its state, the migration as the first step, and an
 * exact next command — where before this slice there was no Framework command
 * at all (`AC-GUIDE-001`, `FR-GUIDE-002`). "Exact" is proved by pasting the
 * printed line into a shell: it produces the draft the next step consumes, and
 * setup then names that consuming command.
 */
test('TB-067 AC-GUIDE-001: a schema v3 clone names the migration first and its exact next command', async (t) => {
  const root = await schemaV3Clone(t);
  const { plan, text } = await observeSetup(root);

  assert.equal(plan.document, 'agent-framework/setup/1');
  assert.equal(plan.command, 'setup');
  assert.equal(plan.project, root);
  assert.equal(plan.state, 'schema-v3');
  assert.equal(plan.exitStatus, 1);
  assert.deepEqual(commandsOf(plan), ['migrate-schema-v4', 'configure-gate', 'doctor', 'activate']);
  assert.equal(plan.steps[0].owner, 'framework-setup');
  assert.deepEqual(plan.unavailable, []);
  assert.equal(plan.gate.available, true);
  assert.equal(plan.gate.located, 'sibling');

  // The ambiguities the owning migration reports are the decisions, verbatim.
  assert.deepEqual(plan.steps[0].decisions, [
    'backend: profile',
    'verification.commands.test.backend[0]: timeout_seconds',
  ]);

  const [draft, preview, confirm] = plan.steps[0].commands;
  const draftPath = draft.argv.at(-1);

  t.after(() => rm(draftPath, { force: true }));
  assert.deepEqual(draft.argv, ['node', CONFIGURE, '--project', root, '--draft-mapping', '--out', draftPath]);
  assert.equal(path.isAbsolute(draftPath), true);
  assert.equal(draftPath.startsWith(`${root}${path.sep}`), false, 'the draft path is inside the clone.');
  assert.deepEqual(preview.argv, ['node', CONFIGURE, '--project', root, '--migrate-v4', '--mapping', draftPath]);
  assert.deepEqual(confirm.argv, [...preview.argv, '--confirm', '<previewHash>']);
  assert.deepEqual(plan.next, { step: 'migrate-schema-v4', command: draft.run, instruction: plan.steps[0].summary });
  assert.match(text.stdout, /^next: node .*configure\.mjs' --project .* --draft-mapping --out /m);

  const pasted = await pasteIntoShell(root, plan.next.command);

  assert.equal(pasted.status, 0, pasted.stderr);
  assert.deepEqual(JSON.parse(await readFile(draftPath, 'utf8')), {
    profiles: { backend: null },
    commands: { 'verification.commands.test.backend[0]': { timeout_seconds: null } },
  });

  // With the draft on disk the draft is no longer a remaining command, and the
  // owning preview's refusal of its unanswered nulls is reported verbatim.
  const drafted = (await observeSetup(root)).plan;

  assert.equal(drafted.next.command, preview.run);
  assert.deepEqual(drafted.steps[0].commands.map((command) => command.role), ['preview', 'confirm']);
  assert.equal(drafted.steps[0].refusal, 'Unsupported backend profile mapping: null');
});

test('TB-067 AC-GUIDE-001: a clone with no configuration names base setup, then every Gate step in order', async (t) => {
  const root = await noConfigurationClone(t);
  const { plan } = await observeSetup(root);

  assert.equal(plan.state, 'no-configuration');
  assert.deepEqual(commandsOf(plan), ['configure-project', 'migrate-schema-v4', 'configure-gate', 'doctor', 'activate']);
  assert.deepEqual(plan.steps[0].commands.map((command) => command.argv), [
    ['node', CONFIGURE, '--project', root, '--tracker', 'local-markdown'],
  ]);
  assert.deepEqual(plan.steps[0].decisions, [
    'tracker: local-markdown (discovered default)',
    'backend: unknown (discovered)',
    'frontend: none (discovered)',
  ]);
  assert.equal(plan.next.step, 'configure-project');

  // Every Gate step names the Gate's own command and nothing else.
  for (const step of plan.steps.filter((entry) => entry.owner === 'change-evaluation-gate')) {
    for (const command of step.commands) {
      assert.deepEqual(command.argv.slice(0, 2), ['node', GATE]);
    }
  }

  assert.deepEqual(plan.steps.at(-1).commands.map((command) => command.argv.slice(2)), [
    ['activate'],
    ['activate', '--confirm', '<token>'],
  ]);
});

test('TB-067 AC-GUIDE-001: a schema v4 clone with no Gate section names Gate configuration from the owning draft', async (t) => {
  const root = await schemaV4Clone(t, { gate: false });
  const { plan } = await observeSetup(root);

  assert.equal(plan.state, 'gate-unconfigured');
  assert.equal(plan.gate.observed.state, 'installed');
  assert.deepEqual(commandsOf(plan), ['configure-gate', 'doctor', 'activate']);

  const [draft, preview] = plan.steps[0].commands;
  const policyPath = draft.argv.at(-1);

  t.after(() => rm(policyPath, { force: true }));
  assert.deepEqual(draft.argv, ['node', CONFIGURE, '--project', root, '--draft-policy', '--out', policyPath]);
  assert.deepEqual(preview.argv, ['node', CONFIGURE, '--project', root, '--configure-gate', '--policy', policyPath]);
  // The owning draft previews cleanly here, so nothing is refused.
  assert.equal(plan.steps[0].refusal, null);
  assert.equal(plan.next.command, draft.run);

  // The next command is exact: pasted, it writes the draft the preview consumes,
  // and that preview accepts it.
  assert.equal((await pasteIntoShell(root, plan.next.command)).status, 0);

  const drafted = (await observeSetup(root)).plan;

  assert.equal(drafted.next.command, preview.run);

  const previewed = await pasteIntoShell(root, drafted.next.command);

  assert.equal(previewed.status, 0, previewed.stderr);
  assert.equal(JSON.parse(previewed.stdout).status, 'ready');
});

test('TB-067 AC-GUIDE-001: a configured clone whose doctor proceeds names activation next', async (t) => {
  const root = await schemaV4Clone(t);
  const { plan } = await observeSetup(root);

  assert.equal(plan.state, 'configured');
  assert.deepEqual(plan.doctor, { proceeds: true, stop: null });
  assert.deepEqual(commandsOf(plan), ['activate']);
  assert.deepEqual(plan.next, {
    step: 'activate',
    command: `${plan.gate.command} activate`,
    instruction: plan.steps[0].summary,
  });

  // Pasted, the next command is the Gate's own activation preview: a token, and
  // nothing written.
  const before = await cloneHash(root);
  const previewed = await pasteIntoShell(root, `${plan.next.command} --json`);

  assert.equal(previewed.status, 0, previewed.stderr);
  assert.match(JSON.parse(previewed.stdout).observation.confirmationToken, /^sha256:[0-9a-f]{64}$/);
  assert.equal(await cloneHash(root), before);
});

test('TB-067: a configured clone whose doctor stops names the doctor\'s own reason before activation', async (t) => {
  const root = await throwawayRepository(t);

  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    schemaV4Configuration().replace(
      '        - runner: repository-script\n          args:\n            - tools/check.mjs\n            - app/Order.php',
      '        - runner: composer-bin\n          args:\n            - phpunit',
    ),
    'utf8',
  );
  await commit(root);

  const { plan } = await observeSetup(root);
  const doctor = await gateJson(root, ['doctor']);

  assert.equal(plan.state, 'configured');
  assert.equal(doctor.observation.verdict.proceeds, false);
  assert.deepEqual(plan.doctor, { proceeds: false, stop: doctor.observation.verdict.stop });
  assert.deepEqual(commandsOf(plan), ['doctor', 'activate']);
  assert.equal(plan.steps[0].refusal, `${doctor.observation.verdict.stop.reasonCode}: ${doctor.observation.verdict.stop.detail}`);
  assert.deepEqual(plan.steps[0].commands.map((command) => command.argv.slice(2)), [['doctor']]);
});

test('TB-067 AC-GUIDE-001: an activated, healthy clone reports nothing to do', async (t) => {
  const root = await activatedClone(t);
  const { plan, text } = await observeSetup(root);

  assert.equal(plan.state, 'activated');
  assert.equal(plan.health, 'healthy');
  assert.equal(plan.exitStatus, 0);
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.next, null);
  assert.match(text.stdout, /^next: nothing$/m);
});

test('TB-067 AC-GUIDE-001: configuration drift names exactly the remedy Gate status names', async (t) => {
  const root = await activatedClone(t);

  await writeFile(path.join(root, '.agent-framework.yaml'), schemaV4Configuration({ totalSeconds: 900 }), 'utf8');

  const { plan } = await observeSetup(root);
  const status = await gateJson(root, ['status']);

  assert.equal(plan.state, 'activated');
  assert.equal(plan.health, 'broken');
  assert.deepEqual(commandsOf(plan), status.observation.next.remedies.map((remedy) => remedy.remedy));
  assert.deepEqual(commandsOf(plan), ['sync']);
  assert.equal(plan.steps[0].summary, status.observation.next.remedies[0].instruction);
  assert.deepEqual(plan.steps[0].commands.map((command) => command.run), ['git gate sync', 'git gate sync --confirm <token>']);
  assert.equal(plan.next.command, 'git gate sync');

  const pasted = await pasteIntoShell(root, `${plan.next.command} --json`);

  assert.equal(JSON.parse(pasted.stdout).command, 'sync');
  assert.match(JSON.parse(pasted.stdout).observation.confirmationToken, /^sha256:/);
});

test('TB-067 AC-GUIDE-001: hook drift names exactly the remedy Gate status names', async (t) => {
  const root = await activatedClone(t);
  const receipt = JSON.parse(await readFile(
    path.join(root, '.git/change-evaluation-gate/evidence/activation/receipt.json'),
    'utf8',
  ));

  await rm(receipt.hooks[0].path, { force: true });

  const { plan } = await observeSetup(root);
  const status = await gateJson(root, ['status']);

  assert.equal(plan.health, 'broken');
  assert.deepEqual(commandsOf(plan), status.observation.next.remedies.map((remedy) => remedy.remedy));
  assert.deepEqual(commandsOf(plan), ['repair']);
  assert.deepEqual(plan.steps[0].commands.map((command) => command.run), ['git gate repair', 'git gate repair --confirm <token>']);
  assert.equal(plan.next.command, 'git gate repair');
});

test('TB-074 AC-GUIDE-001: runtime drift names the new Activation transaction exactly as Gate status names it', async (t) => {
  const root = await activatedClone(t);
  const receiptPath = path.join(root, '.git/change-evaluation-gate/evidence/activation/receipt.json');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));

  // A gate speaking a protocol version this clone never activated against.
  await writeFile(
    receiptPath,
    `${JSON.stringify({ ...receipt, runtime: { ...receipt.runtime, gate: { ...receipt.runtime.gate, protocolVersion: '0.9' } } }, null, 2)}\n`,
    'utf8',
  );

  const { plan } = await observeSetup(root);
  const status = await gateJson(root, ['status']);
  const [remedy] = status.observation.next.remedies;

  assert.equal(plan.health, 'broken');
  assert.deepEqual(commandsOf(plan), ['activation-transaction']);
  assert.deepEqual(remedy.subcommands, ['deactivate', 'activate']);
  // TB-067's rendering, unchanged: the Gate's own instruction, no decision,
  // and each named subcommand previewed and then confirmed, in order.
  assert.equal(plan.steps[0].summary, remedy.instruction);
  assert.deepEqual(plan.steps[0].decisions, []);
  assert.deepEqual(plan.steps[0].commands.map((command) => command.run), [
    'git gate deactivate',
    'git gate deactivate --confirm <token>',
    'git gate activate',
    'git gate activate --confirm <token>',
  ]);
  assert.equal(plan.next.command, 'git gate deactivate');
});

/**
 * `SG-OWNER-001`, ADR 0004. Which remedy applies, in what order, and what
 * performs it are all the Gate's: the Framework command renders the
 * subcommands the Gate's document names and holds no remedy of its own. Read
 * from the Gate's own table, so a remedy added later is covered too.
 * `activate` is the one remedy spelled like a subcommand setup plans by itself
 * — the activation step of a clone configured but not yet activated — so it
 * may appear, as that subcommand.
 */
test('TB-074 SG-OWNER-001: the Framework command holds no remedy-to-command mapping and names no remedy', async () => {
  const remedies = new Set(Object.values(REMEDIES)
    .flatMap((entry) => (typeof entry === 'string' ? [entry] : Object.values(entry)))
    .filter((remedy) => remedy !== 'informational' && remedy !== 'activate'));

  assert.ok(remedies.has('sync') && remedies.has('activation-transaction'));

  for (const source of [ENTRY, path.join(SETUP_SKILL, 'scripts', 'lib', 'gate-command.mjs')]) {
    const code = (await readFile(source, 'utf8'))
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\/\*\*?|\*)/.test(line))
      .join('\n');

    for (const remedy of remedies) {
      assert.doesNotMatch(code, new RegExp(`['"\`]${remedy}['"\`]`), `${path.basename(source)} names the remedy ${remedy}.`);
    }

    assert.doesNotMatch(code, /\.remedy ===|REMEDY_SUBCOMMANDS/, `${path.basename(source)} decides by remedy.`);
  }

  assert.match(await readFile(ENTRY, 'utf8'), /\.subcommands\b/, 'setup does not read the subcommands the Gate names.');
});

/**
 * A Gate installed before `TB-074` names each remedy without its subcommands.
 * Setup states that and stops, naming the installed Gate, rather than guessing
 * which command performs a remedy — exactly as it reports any Gate answer it
 * cannot use (`gate-unreadable`): exit 2, no steps, and nothing written.
 */
/**
 * The real Gate on PATH, answering as a Gate from before a field existed:
 * `strip` is the statement that removes that field from each `document` it
 * prints.
 */
const olderGateOnPath = async (t, strip) => {
  const bin = await realpath(await mkdtemp(path.join(tmpdir(), 'agent-framework-bin-')));
  const olderGate = path.join(bin, 'change-evaluation-gate');

  t.after(() => rm(bin, { recursive: true, force: true }));
  await writeFile(olderGate, [
    '#!/usr/bin/env node',
    "const { spawnSync } = require('node:child_process');",
    `const answered = spawnSync(process.execPath, [${JSON.stringify(GATE)}, ...process.argv.slice(2)], { encoding: 'utf8' });`,
    'let stdout = answered.stdout;',
    'try {',
    '  const document = JSON.parse(stdout);',
    `  ${strip}`,
    '  stdout = `${JSON.stringify(document, null, 2)}\\n`;',
    '} catch {}',
    'process.stdout.write(stdout);',
    'process.stderr.write(answered.stderr);',
    'process.exitCode = answered.status;',
    '',
  ].join('\n'), { mode: 0o755 });

  return { olderGate, env: environment({ PATH: `${bin}${path.delimiter}${pathWithoutGate()}` }) };
};

test('TB-074: setup refuses, naming the installed Gate, when the Gate\'s document names a remedy without its subcommands', async (t) => {
  const { olderGate, env } = await olderGateOnPath(
    t,
    'for (const remedy of document.observation?.next?.remedies ?? []) { delete remedy.subcommands; }',
  );
  const root = await activatedClone(t);

  await writeFile(path.join(root, '.agent-framework.yaml'), schemaV4Configuration({ totalSeconds: 900 }), 'utf8');

  const older = JSON.parse((await run(olderGate, ['status', '--json'], { cwd: root, env })).stdout);

  assert.deepEqual(older.observation.next.remedies.map((remedy) => Object.keys(remedy)), [['remedy', 'instruction', 'findings']]);

  const before = await cloneHash(root);
  const text = await agentFramework(root, ['setup'], { env });
  const json = await agentFramework(root, ['setup', '--json'], { env });
  const { document } = json;

  assert.equal(await cloneHash(root), before, 'a refused setup changed a byte under the clone or .git.');
  assert.equal(json.status, 2, json.stderr);
  assert.equal(text.status, 2, text.stderr);
  assert.equal(document.ok, false);
  assert.equal(document.exitStatus, 2);
  assert.deepEqual(document.steps, []);
  assert.equal(document.next, null);
  assert.equal(document.gate.located, 'path');
  assert.equal(document.failure.reasonCode, 'gate-remedy-subcommands-missing');
  assert.ok(document.failure.detail.includes(olderGate), `the refusal does not name the installed Gate: ${document.failure.detail}`);
  assert.ok(document.failure.detail.includes(older.observation.release.version), document.failure.detail);
  assert.match(document.failure.detail, /names no subcommands for the sync remedy/);
  assert.match(
    text.stdout,
    /^failed: gate-remedy-subcommands-missing — .*names no subcommands for the sync remedy/m,
  );
  assert.doesNotMatch(text.stdout, /^\s+\$ /m, 'a refused setup still printed a command.');
});

test('TB-067 AC-GUIDE-001 / FR-GUIDE-009: without the Gate module only setup steps are named and Gate steps are unavailable', async (t) => {
  const { entry, configure } = await setupOnlyInstall(t);
  const schemaV3 = await schemaV3Clone(t);
  const { plan, text } = await observeSetup(schemaV3, { entry });

  assert.equal(plan.state, 'schema-v3');
  assert.equal(plan.gate.available, false);
  assert.match(plan.gate.detail, /not on PATH and no installed change-evaluation-gate skill sits beside framework-setup/);
  assert.deepEqual(commandsOf(plan), ['migrate-schema-v4']);
  assert.deepEqual(plan.unavailable, ['configure-gate', 'doctor', 'activate']);
  assert.equal(plan.steps[0].commands[0].argv[1], configure);
  assert.match(text.stdout, /^unavailable: configure-gate, doctor, activate — Gate steps are unavailable because the Gate module is not installed\.$/m);

  // Setup complete and the Gate absent: nothing further, Gate steps still stated.
  const schemaV4 = await schemaV4Clone(t, { gate: false });
  const complete = (await observeSetup(schemaV4, { entry })).plan;

  assert.equal(complete.state, 'schema-v4');
  assert.deepEqual(complete.steps, []);
  assert.equal(complete.next, null);
  assert.equal(complete.exitStatus, 0);
  assert.deepEqual(complete.unavailable, ['configure-gate', 'doctor', 'activate']);
});

test('TB-067: the Gate command on PATH is preferred and printed as a maintainer types it', async (t) => {
  const { entry } = await setupOnlyInstall(t);
  const bin = await realpath(await mkdtemp(path.join(tmpdir(), 'agent-framework-bin-')));

  t.after(() => rm(bin, { recursive: true, force: true }));
  await symlink(GATE, path.join(bin, 'change-evaluation-gate'));

  const env = environment({ PATH: `${bin}${path.delimiter}${pathWithoutGate()}` });
  const root = await schemaV4Clone(t);
  const { plan } = await observeSetup(root, { entry, env });

  assert.equal(plan.gate.located, 'path');
  assert.equal(plan.gate.command, 'change-evaluation-gate');
  assert.equal(plan.state, 'configured');
  assert.equal(plan.next.command, 'change-evaluation-gate activate');
  assert.equal((await pasteIntoShell(root, `${plan.next.command} --json`, env)).status, 0);
});

test('TB-067 SG-GUIDE-001: setup leaves every discovered AGENTS.md byte for byte and writes no draft', async (t) => {
  const root = await schemaV3Clone(t);
  const agents = await readFile(path.join(root, 'AGENTS.md'));
  const { plan } = await observeSetup(root);
  const drafts = plan.steps.flatMap((step) => step.commands)
    .filter((command) => command.role === 'draft')
    .map((command) => command.argv.at(-1));

  assert.equal(drafts.length, 2);

  for (const draft of drafts) {
    await assert.rejects(readFile(draft), { code: 'ENOENT' }, `setup wrote the draft ${draft} itself.`);
  }

  assert.deepEqual(await readFile(path.join(root, 'AGENTS.md')), agents);
});

test('TB-067: the agent-framework package bin is the framework-setup entry, runnable as npm links it', async (t) => {
  const manifest = JSON.parse(await readFile(path.join(FRAMEWORK_ROOT, 'package.json'), 'utf8'));

  assert.equal(path.join(FRAMEWORK_ROOT, manifest.bin['agent-framework']), ENTRY);
  assert.match(await readFile(ENTRY, 'utf8'), /^#!\/usr\/bin\/env node\n/);

  // npm links a bin by name; the shebang and the entry guard must survive that.
  const bin = await realpath(await mkdtemp(path.join(tmpdir(), 'agent-framework-bin-')));

  t.after(() => rm(bin, { recursive: true, force: true }));
  await symlink(ENTRY, path.join(bin, 'agent-framework'));

  const root = await schemaV3Clone(t);
  const env = environment({ PATH: `${bin}${path.delimiter}${pathWithoutGate()}` });
  const throughBin = await pasteIntoShell(root, 'agent-framework setup --json', env);
  const direct = await agentFramework(root, ['setup', '--json']);

  assert.equal(throughBin.status, 1, throughBin.stderr);
  assert.equal(throughBin.stdout, direct.stdout);
});

test('TB-067: an unknown subcommand is refused with exit 2 and the usage', async (t) => {
  const root = await noConfigurationClone(t);
  const before = await cloneHash(root);

  for (const argv of [[], ['report'], ['setup', '--confirm', 'x'], ['config'], ['config', 'edit'], ['config', 'show', '--confirm', 'x']]) {
    const result = await agentFramework(root, argv);

    assert.equal(result.status, 2, `${argv.join(' ')} exited ${result.status}.`);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /usage: agent-framework setup \[--json\] \[--project <directory>\]/);
    assert.match(result.stderr, /agent-framework config show \[--json\] \[--project <directory>\]/);
  }

  assert.equal(await cloneHash(root), before);
});

/* -------------------------------------------------------------------------
 * TB-068: `agent-framework config show`.
 *
 * The Gate configuration section, read through the Gate's own `status --json`
 * (`observation.configuration`), shown by subcontract, and on an activated
 * clone marked value by value against the section the Activation receipt
 * pinned (`FR-GUIDE-005`, `AC-GUIDE-003`).
 * ------------------------------------------------------------------------- */

const SUBCONTRACTS = ['checks', 'budget', 'bypass', 'execution', 'evidence'];

/** How one shown value reads in the text rendering, as the document states it. */
const shownValue = (value) => (value.declared ? JSON.stringify(value.value) : '(not set)');

/**
 * The text rendering names the same state, subcontracts, values, markings,
 * runtime inputs, and next step as the document (`--json` mirrors text).
 */
const assertConfigMirror = (stdout, shown) => {
  const lines = stdout.split('\n');

  assert.equal(lines[0], 'agent-framework config show');
  assert.ok(lines.includes(`project: ${shown.project}`));

  if (shown.failure !== null) {
    assert.ok(lines.some((line) => line.startsWith(`failed: ${shown.failure.reasonCode} — `)));

    return;
  }

  assert.ok(lines.includes(`state: ${shown.state}`), `text does not name state ${shown.state}.`);

  for (const subcontract of shown.subcontracts) {
    const heading = lines.indexOf(`${subcontract.name}:`);

    assert.notEqual(heading, -1, `text does not name the ${subcontract.name} subcontract.`);

    for (const value of subcontract.values) {
      const line = lines.slice(heading + 1).find((entry) => entry.startsWith(`  ${value.key}: `));

      assert.ok(line, `text does not show ${subcontract.name}.${value.key}.`);
      assert.ok(line.startsWith(`  ${value.key}: ${shownValue(value)}`), line);

      if (value.marking !== null) {
        assert.match(line, new RegExp(` — ${value.marking}\\b`), line);
      }
    }
  }

  for (const input of shown.runtimeInputs?.resolved ?? []) {
    assert.ok(lines.includes(`  - ${input.name}: from ${input.source}`), `text does not name ${input.name}'s source.`);
  }

  for (const input of shown.runtimeInputs?.unresolved ?? []) {
    assert.ok(lines.some((line) => line.startsWith(`  - ${input.name}: unresolved`)), `text does not name ${input.name}.`);
  }

  for (const file of shown.runtimeInputs?.environmentFiles ?? []) {
    assert.ok(lines.includes(`  environment file ${file.path}: ${file.status}`), `text does not name ${file.path}.`);
  }

  const next = lines.filter((line) => line.startsWith('next: '));

  assert.equal(next.length, 1);
  assert.equal(next[0], `next: ${shown.next === null ? 'nothing' : (shown.next.command ?? shown.next.instruction)}`);
};

/**
 * Run `config show` and `config show --json` twice each against `root`, and
 * prove the four runs changed nothing under the clone or `.git`, printed
 * byte-identical output on repeat, and that the text carries what the document
 * carries (`SG-GUIDE-001`).
 */
const observeConfigShow = async (root, options = {}) => {
  const before = await cloneHash(root);
  const text = await agentFramework(root, ['config', 'show'], options);
  const json = await agentFramework(root, ['config', 'show', '--json'], options);
  const textAgain = await agentFramework(root, ['config', 'show'], options);
  const jsonAgain = await agentFramework(root, ['config', 'show', '--json'], options);

  assert.equal(await cloneHash(root), before, 'config show changed a byte under the clone or .git.');
  assert.equal(text.stderr, '', text.stderr);
  assert.equal(json.stderr, '', json.stderr);
  assert.equal(textAgain.stdout, text.stdout, 'a repeated config show printed different text.');
  assert.equal(jsonAgain.stdout, json.stdout, 'a repeated config show --json printed a different document.');
  assert.equal(text.status, json.status);
  assert.equal(json.document.exitStatus, json.status);
  assert.equal(json.document.document, 'agent-framework/config-show/1');
  assert.equal(json.document.command, 'config show');
  assertConfigMirror(text.stdout, json.document);

  return { text, json, shown: json.document };
};

/** One shown value, by its path in the section. */
const valueAt = (shown, dotted) => {
  const [name, key] = dotted.split('.');

  return shown.subcontracts.find((subcontract) => subcontract.name === name)
    ?.values.find((value) => value.key === key);
};

/**
 * THE FIRST RED TEST OF TB-068.
 *
 * An activated clone whose working configuration adds a dependency root after
 * activation shows that root as differing from what the Activation receipt
 * pinned, and every other value as matching — where before this slice the
 * Gate said only that the configuration's identity moved (`AC-GUIDE-003`,
 * `FR-GUIDE-005`).
 */
test('TB-068 AC-GUIDE-003: an activated clone lists a dependency root added after activation as differing from the pinned value', async (t) => {
  const root = await activatedClone(t);

  await writeFile(path.join(root, '.agent-framework.yaml'), schemaV4Configuration({ dependencyRoots: ['vendor'] }), 'utf8');

  const { shown, text } = await observeConfigShow(root);
  const roots = valueAt(shown, 'execution.dependency_roots');

  assert.equal(shown.state, 'activated');
  assert.equal(shown.exitStatus, 1);
  assert.deepEqual(roots.value, ['vendor']);
  assert.equal(roots.declared, true);
  assert.deepEqual(roots.pinned, { declared: false, value: null });
  assert.equal(roots.marking, 'differs');
  assert.deepEqual(roots.added, ['vendor']);
  assert.deepEqual(roots.removed, []);
  assert.match(text.stdout, /^ {2}dependency_roots: \["vendor"\] — differs from the pinned value \(not set\); added vendor$/m);

  // Every other value is what the receipt pinned.
  const others = shown.subcontracts.flatMap((subcontract) => subcontract.values
    .filter((value) => value !== roots)
    .map((value) => [`${subcontract.name}.${value.key}`, value.marking]));

  assert.ok(others.length > 0);
  assert.deepEqual(others.filter(([, marking]) => marking !== 'matches'), []);

  // The section-level verdict is the Gate's: the identity it pinned moved.
  const status = await gateJson(root, ['status']);

  assert.equal(shown.section.pinned.identity, status.observation.configuration.pinned.identity);
  assert.equal(shown.section.identity, status.observation.configuration.working.identity);
  assert.equal(shown.section.pinned.matches, false);
  assert.equal(shown.section.pinned.source, 'committed-configuration');
  assert.match(text.stdout, /^section: differs from what the Activation receipt pinned/m);
});

test('TB-068 AC-GUIDE-003: an activated, unchanged clone shows every subcontract by name, each value matching the pinned one', async (t) => {
  const root = await activatedClone(t);
  const { shown, text } = await observeConfigShow(root);

  assert.equal(shown.state, 'activated');
  assert.equal(shown.exitStatus, 0);
  assert.deepEqual(shown.subcontracts.map((subcontract) => subcontract.name), SUBCONTRACTS);
  assert.deepEqual(
    shown.subcontracts.map((subcontract) => [subcontract.name, subcontract.values.map((value) => [value.key, value.marking])]),
    [
      ['checks', [['required', 'matches'], ['advisory', 'matches']]],
      ['budget', [['total_seconds', 'matches']]],
      ['bypass', [['enabled', 'matches'], ['marker', 'matches']]],
      ['execution', [['budget_skippable', 'matches']]],
      ['evidence', []],
    ],
  );
  assert.deepEqual(valueAt(shown, 'checks.required').value, ['configuration.broad-tests.test']);
  assert.deepEqual(valueAt(shown, 'budget.total_seconds').pinned, { declared: true, value: 600 });
  assert.equal(shown.section.pinned.matches, true);
  assert.equal(shown.section.pinned.source, 'configuration-file');
  assert.equal(shown.runtimeInputs, null);
  assert.equal(shown.next, null);
  assert.match(text.stdout, /^section: matches what the Activation receipt pinned \(sha256:[0-9a-f]{64}\)$/m);
  assert.match(text.stdout, /^ {2}total_seconds: 600 — matches the pinned value$/m);
});

test('TB-068 AC-GUIDE-003: a removed and an added check name are each named, and the next step is setup\'s', async (t) => {
  const root = await activatedClone(t);

  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    schemaV4Configuration().replace(
      '    required:\n      - configuration.broad-tests.test\n    advisory: []\n',
      '    required: []\n    advisory:\n      - configuration.broad-tests.test\n',
    ),
    'utf8',
  );

  const { shown, text } = await observeConfigShow(root);
  const setup = await agentFramework(root, ['setup', '--json']);

  assert.deepEqual(
    ['checks.required', 'checks.advisory'].map((dotted) => {
      const { marking, added, removed } = valueAt(shown, dotted);

      return { marking, added, removed };
    }),
    [
      { marking: 'differs', added: [], removed: ['configuration.broad-tests.test'] },
      { marking: 'differs', added: ['configuration.broad-tests.test'], removed: [] },
    ],
  );
  assert.match(text.stdout, /^ {2}required: \[\] — differs from the pinned value \["configuration\.broad-tests\.test"\]; removed configuration\.broad-tests\.test$/m);
  assert.deepEqual(shown.next, setup.document.next);
});

test('TB-068: a pinned section no document reproduces marks each value unrecoverable and compares only the section', async (t) => {
  const root = await activatedClone(t);

  await writeFile(path.join(root, '.agent-framework.yaml'), schemaV4Configuration({ totalSeconds: 300 }), 'utf8');
  await git(root, ['add', '--all']);
  await git(root, ['-c', 'user.email=setup@example.test', '-c', 'user.name=Setup', 'commit', '--quiet', '--no-verify', '--message', 'past the gate']);
  await writeFile(path.join(root, '.agent-framework.yaml'), schemaV4Configuration({ totalSeconds: 900 }), 'utf8');

  const { shown, text } = await observeConfigShow(root);

  assert.equal(shown.exitStatus, 1);
  assert.deepEqual(shown.section.pinned, {
    identity: shown.section.pinned.identity,
    source: null,
    recovered: false,
    matches: false,
  });
  assert.deepEqual(
    [...new Set(shown.subcontracts.flatMap((subcontract) => subcontract.values.map((value) => value.marking)))],
    ['unrecoverable'],
  );
  assert.equal(valueAt(shown, 'budget.total_seconds').pinned, null);
  assert.match(text.stdout, /^pinned values: unrecoverable — no document reproduces the pinned identity/m);
});

test('TB-068 AC-GUIDE-003: a configured clone that was never activated shows every subcontract and compares nothing', async (t) => {
  const root = await schemaV4Clone(t);
  const { shown, text } = await observeConfigShow(root);
  const setup = await agentFramework(root, ['setup', '--json']);

  assert.equal(shown.state, 'configured');
  assert.equal(shown.exitStatus, 0);
  assert.deepEqual(shown.subcontracts.map((subcontract) => subcontract.name), SUBCONTRACTS);
  assert.equal(shown.section.pinned, null);
  assert.deepEqual(
    [...new Set(shown.subcontracts.flatMap((subcontract) => subcontract.values.map((value) => value.marking)))],
    [null],
  );
  assert.equal(valueAt(shown, 'budget.total_seconds').value, 600);
  assert.equal(valueAt(shown, 'budget.total_seconds').pinned, null);
  assert.match(text.stdout, /^section: not pinned — this clone has no Activation receipt/m);
  assert.match(text.stdout, /^ {2}total_seconds: 600$/m);
  // The next step is setup's own: activation.
  assert.deepEqual(shown.next, setup.document.next);
  assert.equal(shown.next.step, 'activate');
});

test('TB-068 AC-GUIDE-003: a clone with no Gate section says so and names setup\'s next step', async (t) => {
  for (const clone of [() => schemaV4Clone(t, { gate: false }), () => schemaV3Clone(t), () => noConfigurationClone(t)]) {
    const root = await clone();
    const { shown, text } = await observeConfigShow(root);
    const setup = await agentFramework(root, ['setup', '--json']);

    assert.equal(shown.exitStatus, 1);
    assert.equal(shown.state, setup.document.state);
    assert.equal(shown.section, null);
    assert.deepEqual(shown.subcontracts, []);
    assert.notEqual(shown.next, null);
    assert.deepEqual(shown.next, setup.document.next);
    assert.match(text.stdout, /^section: none — \.agent-framework\.yaml has no Gate configuration section\.$/m);
  }
});

test('TB-068 FR-GUIDE-009: without the Gate module a clone with no section names setup\'s step, and a schema v4 clone is refused', async (t) => {
  const { entry } = await setupOnlyInstall(t);
  const schemaV3 = await schemaV3Clone(t);
  const unconfigured = (await observeConfigShow(schemaV3, { entry })).shown;

  assert.equal(unconfigured.section, null);
  assert.equal(unconfigured.gate.available, false);
  assert.equal(unconfigured.next.step, 'migrate-schema-v4');

  const configured = await schemaV4Clone(t);
  const { shown } = await observeConfigShow(configured, { entry });

  assert.equal(shown.exitStatus, 2);
  assert.equal(shown.failure.reasonCode, 'gate-unavailable');
  assert.match(shown.failure.detail, /read only through the Gate's own command/);
  assert.deepEqual(shown.subcontracts, []);
});

test('TB-068: config show refuses, naming the installed Gate, when the Gate\'s status reports no configuration section', async (t) => {
  const { olderGate, env } = await olderGateOnPath(t, 'if (document.observation) { delete document.observation.configuration; }');
  const root = await activatedClone(t);
  const { shown, text } = await observeConfigShow(root, { env });

  assert.equal(shown.exitStatus, 2);
  assert.equal(shown.ok, false);
  assert.equal(shown.gate.located, 'path');
  assert.equal(shown.failure.reasonCode, 'gate-configuration-unobserved');
  assert.ok(shown.failure.detail.includes(olderGate), shown.failure.detail);
  assert.deepEqual(shown.subcontracts, []);
  assert.match(text.stdout, /^failed: gate-configuration-unobserved — /m);
});

/**
 * `SG-GUIDE-002`, `SG-SECRET-001`, `RISK-006`. A Sensitive input set in the
 * environment and another in a declared environment file are shown by name
 * and the source each resolves from, and neither value appears anywhere in
 * either rendering.
 */
test('TB-068 SG-GUIDE-002: no secret canary from the environment or a declared environment file appears in config show', async (t) => {
  const environmentCanary = `env-canary-${createHash('sha256').update('environment').digest('hex').slice(0, 16)}`;
  const fileCanary = `file-canary-${createHash('sha256').update('file').digest('hex').slice(0, 16)}`;
  const env = environment({ APP_KEY: environmentCanary });
  const root = await activatedClone(t, {
    env,
    evidence: { sensitive_inputs: ['APP_KEY', 'MAIL_PASSWORD', 'NOT_SET_ANYWHERE'], environment_files: ['.env'] },
    prepare: async (clone) => {
      await writeFile(path.join(clone, '.gitignore'), '.env\n', 'utf8');
      await writeFile(path.join(clone, '.env'), `APP_KEY=${fileCanary}-shadowed\nMAIL_PASSWORD=${fileCanary}\n`, 'utf8');
    },
  });
  const { shown, text, json } = await observeConfigShow(root, { env });

  for (const output of [text.stdout, json.stdout]) {
    assert.equal(output.includes(environmentCanary), false, 'the environment canary was printed.');
    assert.equal(output.includes(fileCanary), false, 'the environment-file canary was printed.');
  }

  assert.deepEqual(shown.runtimeInputs.resolved, [
    { name: 'APP_KEY', source: 'environment' },
    { name: 'MAIL_PASSWORD', source: '.env' },
  ]);
  assert.deepEqual(shown.runtimeInputs.unresolved, [{ name: 'NOT_SET_ANYWHERE' }]);
  assert.deepEqual(shown.runtimeInputs.environmentFiles, [{ path: '.env', status: 'read' }]);
  assert.deepEqual(valueAt(shown, 'evidence.sensitive_inputs').value, ['APP_KEY', 'MAIL_PASSWORD', 'NOT_SET_ANYWHERE']);
  assert.equal(valueAt(shown, 'evidence.sensitive_inputs').marking, 'matches');
  assert.match(text.stdout, /^ {2}- APP_KEY: from environment$/m);
  assert.match(text.stdout, /^ {2}- MAIL_PASSWORD: from \.env$/m);
  assert.match(text.stdout, /^ {2}- NOT_SET_ANYWHERE: unresolved — no source sets it$/m);
  assert.match(text.stdout, /^ {2}environment file \.env: read$/m);
});
