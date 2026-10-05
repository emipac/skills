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

import { validateGatePolicy } from '../skills/change-evaluation-gate/scripts/lib/policy.mjs';
import { REMEDIES } from '../skills/change-evaluation-gate/scripts/lib/remedies.mjs';
import {
  configureGate,
  configureProject,
  previewGateConfiguration,
} from '../skills/framework-setup/scripts/configure.mjs';

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
const activatedClone = async (t, { prepare = async () => {}, env, policy = null, ...options } = {}) => {
  const root = await throwawayRepository(t);

  if (policy === null) {
    await writeFile(path.join(root, '.agent-framework.yaml'), schemaV4Configuration(options), 'utf8');
  } else {
    await configuredThroughConfigureGate(root, policy, options);
  }

  await prepare(root);
  await commit(root);

  const preview = await gateJson(root, ['activate'], env);
  const confirmed = await gateJson(root, ['activate', '--confirm', preview.observation.confirmationToken], env);

  assert.equal(confirmed.mutation.performed, true, `The fixture failed to activate: ${confirmed.mutation.reasonCode}.`);

  return root;
};

/**
 * The Gate section exactly as `configure-gate` writes it: the schema v4
 * configuration without its section, then `framework-setup`'s own previewed
 * and confirmed Gate configuration with `policy` (`TB-069`). The hand-written
 * block section `schemaV4Configuration` writes is what a maintainer's edit
 * looks like; this is what the owning writer produces.
 */
const configuredThroughConfigureGate = async (root, policy, { configuration = schemaV4Configuration({ gate: false }) } = {}) => {
  await writeFile(path.join(root, '.agent-framework.yaml'), configuration, 'utf8');

  const preview = await previewGateConfiguration({ projectRoot: root, policy });

  await configureGate({ projectRoot: root, policy, confirmation: preview.previewHash });
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

/* -------------------------------------------------------------------------
 * TB-069: `agent-framework config <revision>` — the execution revisions.
 *
 * `framework-setup`'s previewed, hash-bound revision of the Gate configuration
 * section, driven by the Framework command as a child process: the preview
 * names the exact lines that change and writes nothing, the token of that
 * preview is the only thing that writes, every byte outside the section is
 * kept, and on an activated clone the confirmed revision continues into the
 * Gate's own re-pin preview for exactly that candidate (`FR-GUIDE-006`,
 * `AC-GUIDE-003`, `NFR-REL-004`, `SG-GUIDE-001`, `RISK-012`).
 * ------------------------------------------------------------------------- */

/** The policy the configured fixtures hold, as `configure-gate` wrote it. */
const CONFIGURED_POLICY = Object.freeze({
  checks: { required: ['configuration.broad-tests.test'], advisory: [] },
  budget: { total_seconds: 600 },
  bypass: { enabled: false, marker: null },
  execution: { budget_skippable: [] },
  evidence: {},
});

/** A clone whose Gate section `configure-gate` wrote, committed and never activated. */
const configuredClone = async (t, { policy = CONFIGURED_POLICY, configuration, prepare = async () => {} } = {}) => {
  const root = await throwawayRepository(t);

  await configuredThroughConfigureGate(root, policy, configuration === undefined ? {} : { configuration });
  await prepare(root);
  await commit(root);

  return root;
};

const configurationOf = (root) => readFile(path.join(root, '.agent-framework.yaml'), 'utf8');

/** The `  <subcontract>: <JSON>` line `configure-gate` writes for one value. */
const sectionLine = (subcontract, value) => `  ${subcontract}: ${JSON.stringify(value)}`;

/**
 * THE FIRST RED TEST OF TB-069.
 *
 * Adding `vendor`, copied rather than linked, to a configured clone previews
 * exactly one changed line of the Gate section — the `execution` line, before
 * and after — and offers that preview's token, writing nothing; before this
 * slice no command revised a configured section at all (`AC-GUIDE-003`).
 */
test('TB-069 AC-GUIDE-003: adding vendor with copy previews exactly one changed line of the Gate section and offers a token', async (t) => {
  const root = await configuredClone(t);
  const before = await cloneHash(root);
  const original = await configurationOf(root);
  const argv = ['config', 'add-dependency-root', 'vendor', '--provisioning', 'copy'];
  const text = await agentFramework(root, argv);
  const json = await agentFramework(root, [...argv, '--json']);
  const again = await agentFramework(root, [...argv, '--json']);
  const revision = json.document;
  const lines = original.split('\n');
  const executionLine = lines.indexOf(sectionLine('execution', CONFIGURED_POLICY.execution)) + 1;

  assert.equal(await cloneHash(root), before, 'a revision preview changed a byte under the clone or .git.');
  assert.equal(json.stderr, '', json.stderr);
  assert.equal(again.stdout, json.stdout, 'a repeated preview printed a different document.');
  assert.equal(json.status, 1);
  assert.equal(text.status, 1);
  assert.equal(revision.document, 'agent-framework/config-revision/1');
  assert.equal(revision.command, 'config add-dependency-root');
  assert.equal(revision.applied, false);
  assert.equal(revision.failure, null);
  assert.deepEqual(revision.revision, { operation: 'add-dependency-root', root: 'vendor', provisioning: 'copy' });
  assert.deepEqual(revision.changes, [{
    subcontract: 'execution',
    line: executionLine,
    before: sectionLine('execution', { budget_skippable: [] }),
    after: sectionLine('execution', {
      budget_skippable: [],
      dependency_roots: ['vendor'],
      dependency_provisioning: { vendor: 'copy' },
    }),
  }]);
  assert.match(revision.previewHash, /^[0-9a-f]{64}$/);
  assert.equal(revision.state, 'configured');
  assert.equal(revision.repin, null);
  assert.ok(revision.next.command.endsWith(`--confirm ${revision.previewHash}`), revision.next.command);

  // The text names the same change, line for line, and the same next command.
  assert.ok(text.stdout.includes(`- ${revision.changes[0].before}\n+ ${revision.changes[0].after}\n`), text.stdout);
  assert.ok(text.stdout.split('\n').includes(`next: ${revision.next.command}`), text.stdout);
});

/**
 * Preview one revision through the Framework command, then confirm it with
 * the token that preview printed, each as its own child process. Returns both
 * documents and the configuration before and after.
 */
const reviseThroughFramework = async (root, argv, options = {}) => {
  const original = await configurationOf(root);
  const preview = await agentFramework(root, ['config', ...argv, '--json'], options);

  assert.equal(preview.document.failure, null, JSON.stringify(preview.document.failure));
  assert.equal(await configurationOf(root), original, 'a revision preview wrote the configuration.');

  const confirmed = await agentFramework(root, ['config', ...argv, '--confirm', preview.document.previewHash, '--json'], options);

  assert.equal(confirmed.document.failure, null, JSON.stringify(confirmed.document.failure));

  return { original, preview: preview.document, confirmed: confirmed.document, revised: await configurationOf(root) };
};

/** The single line two texts differ by, as `{ index, before, after }`, asserting there is exactly one. */
const onlyChangedLine = (before, after) => {
  const left = before.split('\n');
  const right = after.split('\n');

  assert.equal(right.length, left.length, 'a revision added or removed lines.');

  const changed = left.flatMap((line, index) => (line === right[index] ? [] : [{ index, before: line, after: right[index] }]));

  assert.equal(changed.length, 1, `expected exactly one changed line, found ${JSON.stringify(changed)}.`);

  return changed[0];
};

test('TB-069 AC-GUIDE-003 / SG-GUIDE-001: only the preview\'s token writes, exactly the previewed line, on a configured clone with nothing to re-pin', async (t) => {
  const root = await configuredClone(t);
  const agents = await readFile(path.join(root, 'AGENTS.md'));
  const argv = ['config', 'add-dependency-root', 'vendor', '--provisioning', 'copy'];
  const preview = await agentFramework(root, [...argv, '--json']);
  const original = await configurationOf(root);

  // The confirming command is the one the preview printed, pasted as is.
  const confirmed = await pasteIntoShell(root, `${preview.document.next.command} --json`);
  const document = JSON.parse(confirmed.stdout);
  const revised = await configurationOf(root);
  const changed = onlyChangedLine(original, revised);

  assert.equal(confirmed.status, 0, confirmed.stderr);
  assert.equal(document.applied, true);
  assert.equal(document.state, 'configured');
  assert.equal(document.repin, null);
  assert.equal(document.next, null);
  assert.deepEqual(document.changes, preview.document.changes);
  assert.equal(changed.index + 1, preview.document.changes[0].line);
  assert.equal(changed.before, preview.document.changes[0].before);
  assert.equal(changed.after, preview.document.changes[0].after);
  assert.deepEqual(await readFile(path.join(root, 'AGENTS.md')), agents, 'a revision changed AGENTS.md.');
  assert.deepEqual(
    (await readdir(root)).filter((entry) => entry.startsWith('.agent-framework.yaml.')),
    [],
    'a revision left a temporary file behind.',
  );

  // The same revision again changes nothing and says so; the file stays put.
  const repeated = await agentFramework(root, [...argv, '--json']);

  assert.equal(repeated.status, 2);
  assert.equal(repeated.document.failure.reasonCode, 'nothing-to-revise');
  assert.match(repeated.document.failure.detail, /dependency root vendor is already declared/);
  assert.equal(await configurationOf(root), revised);
});

test('TB-069 AC-GUIDE-003: add and remove a root, set its provisioning single and per root, and change budget-skippable checks', async (t) => {
  const root = await configuredClone(t, {
    policy: {
      ...CONFIGURED_POLICY,
      checks: { required: ['configuration.broad-tests.test'], advisory: ['configuration.static-analysis.lint'] },
    },
  });
  const steps = [
    [['add-dependency-root', 'vendor'], { budget_skippable: [], dependency_roots: ['vendor'] }],
    [['add-dependency-root', 'node_modules', '--provisioning', 'copy'], {
      budget_skippable: [], dependency_roots: ['vendor', 'node_modules'], dependency_provisioning: { node_modules: 'copy' },
    }],
    [['set-dependency-provisioning', 'copy'], {
      budget_skippable: [], dependency_roots: ['vendor', 'node_modules'], dependency_provisioning: 'copy',
    }],
    // One root moves; every other keeps the single strategy it had.
    [['set-dependency-provisioning', 'link', '--root', 'vendor'], {
      budget_skippable: [], dependency_roots: ['vendor', 'node_modules'], dependency_provisioning: { vendor: 'link', node_modules: 'copy' },
    }],
    [['remove-dependency-root', 'vendor'], {
      budget_skippable: [], dependency_roots: ['node_modules'], dependency_provisioning: { node_modules: 'copy' },
    }],
    // A map that names only the removed root leaves with it.
    [['remove-dependency-root', 'node_modules'], { budget_skippable: [], dependency_roots: [] }],
    [['add-budget-skippable', 'configuration.static-analysis.lint'], {
      budget_skippable: ['configuration.static-analysis.lint'], dependency_roots: [],
    }],
    [['remove-budget-skippable', 'configuration.static-analysis.lint'], { budget_skippable: [], dependency_roots: [] }],
  ];

  for (const [argv, execution] of steps) {
    const { original, preview, confirmed, revised } = await reviseThroughFramework(root, argv);
    const changed = onlyChangedLine(original, revised);

    assert.equal(changed.after, sectionLine('execution', execution), `${argv.join(' ')} wrote ${changed.after}.`);
    assert.deepEqual(preview.changes, [{ subcontract: 'execution', line: changed.index + 1, before: changed.before, after: changed.after }]);
    assert.equal(confirmed.applied, true);
    assert.equal(confirmed.exitStatus, 0);
  }
});

/**
 * The candidate is judged by the Gate policy validator `configure-gate` loads,
 * and only by it: each refusal carries that validator's own path and message,
 * computed here from the same validator over the same candidate.
 */
test('TB-069 AC-GUIDE-003: an invalid candidate is refused with the Gate policy validator\'s own reason and nothing is written', async (t) => {
  const root = await configuredClone(t);
  const before = await cloneHash(root);
  const execution = CONFIGURED_POLICY.execution;
  const cases = [
    [['add-dependency-root', '../outside'], { ...execution, dependency_roots: ['../outside'] }],
    [['add-budget-skippable', 'configuration.broad-tests.test'], { ...execution, budget_skippable: ['configuration.broad-tests.test'] }],
    [['add-dependency-root', 'vendor', '--provisioning', 'symlink'], {
      ...execution, dependency_roots: ['vendor'], dependency_provisioning: { vendor: 'symlink' },
    }],
    [['set-dependency-provisioning', 'copy', '--root', 'undeclared'], { ...execution, dependency_provisioning: { undeclared: 'copy' } }],
  ];

  for (const [argv, candidate] of cases) {
    const issues = validateGatePolicy({ ...CONFIGURED_POLICY, execution: candidate });
    const refused = await agentFramework(root, ['config', ...argv, '--json']);

    assert.ok(issues.length > 0, `the validator accepts ${JSON.stringify(candidate)}.`);
    assert.equal(refused.status, 2, argv.join(' '));
    assert.equal(refused.document.failure.reasonCode, 'candidate-invalid');
    assert.equal(refused.document.applied, false);
    assert.equal(refused.document.next, null);

    for (const issue of issues) {
      assert.ok(refused.document.failure.detail.includes(`${issue.path}: ${issue.message}`), refused.document.failure.detail);
    }
  }

  assert.equal(await cloneHash(root), before);
});

/**
 * `RISK-012`. A configuration a maintainer annotated around the section —
 * above it, between it and the next key, in a key's trailing comment, and at
 * the end of the file — keeps every one of those bytes: the file before the
 * section and the file after it are identical before and after the revision.
 */
test('TB-069 RISK-012: every byte outside the Gate section, maintainer comments included, is identical after a revision', async (t) => {
  const commented = [
    '# Maintainer notes: this file is reviewed with every release.',
    schemaV4Configuration({ gate: false }).trimEnd(),
    '# The Gate section below is written by configure-gate.',
    'history:',
    '  path: docs/history   # where delivered work is recorded',
    '  required: false',
    '# end of configuration',
    '',
  ].join('\n');
  const root = await throwawayRepository(t);

  await configuredThroughConfigureGate(root, CONFIGURED_POLICY, { configuration: commented });
  // A comment between the section and the key after it, as a maintainer adds one.
  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    (await configurationOf(root)).replace('\nhistory:\n', '\n# The Gate section above is ours to revise.\nhistory:\n'),
    'utf8',
  );
  await commit(root);

  const { original, preview, revised } = await reviseThroughFramework(root, ['add-dependency-root', 'vendor', '--provisioning', 'copy']);
  const sectionStart = original.indexOf('evaluation_gate:\n');
  const sectionEnd = original.indexOf('\n# The Gate section above');
  const revisedEnd = revised.indexOf('\n# The Gate section above');

  assert.ok(original.includes('# The Gate section below is written by configure-gate.\nevaluation_gate:\n'), original);
  assert.equal(revised.slice(0, sectionStart), original.slice(0, sectionStart), 'a byte before the Gate section changed.');
  assert.equal(revised.slice(revisedEnd), original.slice(sectionEnd), 'a byte after the Gate section changed.');
  assert.deepEqual(
    original.slice(sectionStart, sectionEnd).split('\n').filter((line, index) => line !== revised.slice(sectionStart, revisedEnd).split('\n')[index]),
    [preview.changes[0].before],
  );
  onlyChangedLine(original, revised);
});

/**
 * A section the writer cannot round-trip is refused by name, with nothing
 * written: the hand-written block section the earlier fixtures use, a comment
 * inside a configure-gate section, flow JSON spelled another way, a section
 * declared twice, and a clone with no section at all.
 */
test('TB-069 RISK-012: a section the writer cannot locate unambiguously or round-trip is refused and nothing is written', async (t) => {
  const blockSection = await schemaV4Clone(t);
  const blockBefore = await cloneHash(blockSection);
  const block = await agentFramework(blockSection, ['config', 'add-dependency-root', 'vendor', '--json']);
  const blockLine = (await configurationOf(blockSection)).split('\n').indexOf('  checks:') + 1;

  assert.equal(block.status, 2);
  assert.equal(block.document.failure.reasonCode, 'section-unrevisable');
  assert.match(block.document.failure.detail, new RegExp(`^\\.agent-framework\\.yaml line ${blockLine} is not the \`  checks: <JSON>\` line\\.`));
  assert.match(block.document.failure.detail, /never changes how a section is written\. Nothing was written; edit the section by hand\.$/);
  assert.deepEqual(block.document.changes, []);
  assert.equal(block.document.previewHash, null);
  assert.equal(await cloneHash(blockSection), blockBefore);

  const edits = [
    ['a comment inside the section', (contents) => contents.replace('\n  budget: ', '\n  # tuned by hand\n  budget: '), 'section-unrevisable'],
    ['flow JSON spelled with spaces', (contents) => contents.replace('{"total_seconds":600}', '{ "total_seconds": 600 }'), 'section-unrevisable'],
    ['a section declared twice', (contents) => `${contents}evaluation_gate:\n  checks: {}\n`, 'section-ambiguous'],
  ];

  for (const [name, edit, reasonCode] of edits) {
    const root = await configuredClone(t);

    await writeFile(path.join(root, '.agent-framework.yaml'), edit(await configurationOf(root)), 'utf8');

    const before = await cloneHash(root);
    const refused = await agentFramework(root, ['config', 'add-dependency-root', 'vendor', '--json']);

    assert.equal(refused.status, 2, name);
    assert.equal(refused.document.failure.reasonCode, reasonCode, `${name}: ${refused.document.failure.detail}`);
    assert.match(refused.document.failure.detail, /Nothing was written/, name);
    assert.equal(await cloneHash(root), before, `${name}: a refused revision changed a byte.`);
  }

  const unconfigured = await schemaV4Clone(t, { gate: false });
  const missing = await agentFramework(unconfigured, ['config', 'add-dependency-root', 'vendor', '--json']);

  assert.equal(missing.document.failure.reasonCode, 'gate-unconfigured');
});

test('TB-069 SG-GUIDE-001: a stale or foreign token writes nothing, and neither does a file changed after its preview', async (t) => {
  const root = await configuredClone(t);
  const argv = ['config', 'add-dependency-root', 'vendor', '--provisioning', 'copy'];
  const preview = await agentFramework(root, [...argv, '--json']);
  const before = await cloneHash(root);
  const foreign = await agentFramework(root, [...argv, '--confirm', 'f'.repeat(64), '--json']);
  const otherRevision = await agentFramework(root, ['config', 'add-dependency-root', 'vendor', '--confirm', preview.document.previewHash, '--json']);

  for (const refused of [foreign, otherRevision]) {
    assert.equal(refused.status, 2);
    assert.equal(refused.document.failure.reasonCode, 'preview-mismatch');
    assert.equal(refused.document.applied, false);
  }

  assert.equal(await cloneHash(root), before);

  // A byte outside the section moves between the preview and its confirmation.
  const edited = `${await configurationOf(root)}# edited after the preview\n`;

  await writeFile(path.join(root, '.agent-framework.yaml'), edited, 'utf8');

  const stale = await agentFramework(root, [...argv, '--confirm', preview.document.previewHash, '--json']);

  assert.equal(stale.status, 2);
  assert.equal(stale.document.failure.reasonCode, 'preview-mismatch');
  assert.equal(await configurationOf(root), edited, 'a stale token wrote the configuration.');
});

/**
 * `AC-GUIDE-003`, `SG-CFG-001`. On an activated clone the confirmed revision
 * continues into the Gate's re-pin preview for exactly the candidate written —
 * the identity the Gate reads from the file — and that preview is the one a
 * direct `gate sync --json` gives, weakenings and token included. Nothing is
 * re-pinned: the receipt pins what it pinned before.
 */
test('TB-069 AC-GUIDE-003: on an activated clone a confirmed revision continues into the Gate\'s re-pin preview for exactly that candidate', async (t) => {
  const root = await activatedClone(t, { policy: CONFIGURED_POLICY });
  const pinnedBefore = (await gateJson(root, ['status'])).observation.configuration.pinned;
  const argv = ['add-dependency-root', 'vendor', '--provisioning', 'copy'];
  const previewText = await agentFramework(root, ['config', ...argv]);

  assert.match(previewText.stdout, /^state: activated — confirming continues into the Gate's preview of the re-pin/m);

  const { preview, confirmed } = await reviseThroughFramework(root, argv);
  const status = await gateJson(root, ['status']);
  const direct = await gateJson(root, ['sync']);
  const confirmedText = await agentFramework(root, ['config', ...argv]);

  assert.equal(preview.state, 'activated');
  assert.equal(preview.repin, null);
  assert.equal(confirmed.applied, true);
  assert.equal(confirmed.exitStatus, 1);
  assert.equal(confirmed.repin.subcommand, 'sync');
  assert.equal(confirmed.repin.candidate.identity, status.observation.configuration.working.identity);
  assert.deepEqual(status.observation.configuration.working.policy.execution, {
    budget_skippable: [], dependency_roots: ['vendor'], dependency_provisioning: { vendor: 'copy' },
  });

  for (const field of ['trusted', 'candidate', 'transition', 'acknowledgedWeakening', 'dependencyRoots', 'dependencyProvisioning', 'refusal', 'confirmationToken']) {
    assert.deepEqual(confirmed.repin[field], direct.observation[field], `the chained preview's ${field} is not the direct gate sync's.`);
  }

  assert.match(confirmed.repin.confirmationToken, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(confirmed.repin.transition.weakenings, []);
  assert.deepEqual(confirmed.repin.dependencyRoots, ['vendor']);
  assert.ok(confirmed.next.command.endsWith(` sync --confirm ${confirmed.repin.confirmationToken}`), confirmed.next.command);
  assert.equal(confirmed.next.command, confirmed.repin.commands[0].run);

  // Nothing was re-pinned: the receipt pins what it pinned before the revision.
  assert.deepEqual(status.observation.configuration.pinned.identity, pinnedBefore.identity);
  assert.notEqual(status.observation.configuration.working.identity, pinnedBefore.identity);

  // Asking again previews the same revision as already made.
  assert.equal(confirmedText.status, 2);
  assert.match(confirmedText.stdout, /^failed: nothing-to-revise — /m);
});

/**
 * `NFR-REL-004`. Twin clones revised the same way — one through the Framework
 * command, one through `configure.mjs --revise-gate`, each previewed and then
 * confirmed with its own token — hold byte-identical files, and that file is
 * the one `configure-gate` writes when given the revised policy directly.
 */
test('TB-069 NFR-REL-004: the Framework command, the direct revision command, and configure-gate write the same file', async (t) => {
  const throughFramework = await configuredClone(t);
  const direct = await configuredClone(t);
  const fresh = await throwawayRepository(t);

  assert.equal(await configurationOf(direct), await configurationOf(throughFramework));

  const { confirmed } = await reviseThroughFramework(throughFramework, ['add-dependency-root', 'vendor', '--provisioning', 'copy']);
  const configureArgv = ['--project', direct, '--revise-gate', 'add-dependency-root', '--root', 'vendor', '--provisioning', 'copy'];
  const directPreview = JSON.parse((await run(process.execPath, [CONFIGURE, ...configureArgv], { cwd: direct })).stdout);
  const directConfirmed = await run(process.execPath, [CONFIGURE, ...configureArgv, '--confirm', directPreview.previewHash], { cwd: direct });

  assert.equal(directConfirmed.status, 0, directConfirmed.stderr);
  assert.equal(JSON.parse(directConfirmed.stdout).status, 'revised');
  assert.equal(directPreview.previewHash, confirmed.previewHash);
  assert.equal(await configurationOf(direct), await configurationOf(throughFramework));

  await configuredThroughConfigureGate(fresh, {
    ...CONFIGURED_POLICY,
    execution: { budget_skippable: [], dependency_roots: ['vendor'], dependency_provisioning: { vendor: 'copy' } },
  });

  assert.equal(await configurationOf(fresh), await configurationOf(throughFramework));
});

test('TB-069: every named revision is in the usage, and a malformed revision is refused with exit 2 and the usage', async (t) => {
  const root = await configuredClone(t);
  const before = await cloneHash(root);

  for (const argv of [
    ['config', 'add-dependency-root'],
    ['config', 'add-dependency-root', 'vendor', 'node_modules'],
    ['config', 'add-dependency-root', 'vendor', '--root', 'x'],
    ['config', 'remove-dependency-root', 'vendor', '--provisioning', 'copy'],
    ['config', 'add-budget-skippable', 'x', '--confirm'],
    ['config', 'set-allowed-environment', 'PATH'],
  ]) {
    const result = await agentFramework(root, argv);

    assert.equal(result.status, 2, `${argv.join(' ')} exited ${result.status}.`);
    assert.equal(result.stdout, '');

    for (const name of ['add-dependency-root', 'remove-dependency-root', 'set-dependency-provisioning', 'add-budget-skippable', 'remove-budget-skippable']) {
      assert.match(result.stderr, new RegExp(`agent-framework config ${name} <`));
    }
  }

  assert.match((await agentFramework(root, ['config', 'bogus'])).stderr, /\[--provisioning <provisioning>\] \[--confirm <token>\]/);
  assert.equal(await cloneHash(root), before);
});

/* -------------------------------------------------------------------------
 * TB-070: `agent-framework config <revision>` — evidence, checks, budget, and
 * bypass.
 *
 * The same revision operation `TB-069` created, with one row per named change
 * in each of the other four subcontracts. A Sensitive runtime input is
 * declared by name and source only — nothing reads, asks for, or prints its
 * value (`SG-GUIDE-002`, `SG-SECRET-001`) — and a weakening is reported only as
 * the Gate's own `gate sync` preview reports it, which the Framework command
 * reaches, acknowledged when the maintainer passes `--acknowledge-weakening`
 * (`SG-CFG-001`, `RISK-008`).
 * ------------------------------------------------------------------------- */

const SECRET_CANARY = `secret-canary-${createHash('sha256').update('TB-070').digest('hex').slice(0, 20)}`;

/** A configured clone holding a git-ignored `.env` whose `DB_PASSWORD` is the canary. */
const secretClone = async (t, { activated = false, env } = {}) => {
  const prepare = async (clone) => {
    await writeFile(path.join(clone, '.gitignore'), '.env\n', 'utf8');
    await writeFile(path.join(clone, '.env'), `DB_PASSWORD=${SECRET_CANARY}\nAPP_KEY=${SECRET_CANARY}-app\n`, 'utf8');
  };

  if (activated) {
    return activatedClone(t, { policy: CONFIGURED_POLICY, env, prepare });
  }

  const root = await throwawayRepository(t);

  await configuredThroughConfigureGate(root, CONFIGURED_POLICY);
  await prepare(root);
  await commit(root);

  return root;
};

/**
 * THE FIRST RED TEST OF TB-070.
 *
 * Declaring `DB_PASSWORD` from `.env` previews exactly one changed line — the
 * `evidence` line — adding the name and the file it is resolved from, and no
 * value: the canary in the environment and in `.env` appears nowhere, and
 * nothing is written (`AC-GUIDE-003`, `SG-GUIDE-002`).
 */
test('TB-070 AC-GUIDE-003 / SG-GUIDE-002: declaring DB_PASSWORD from .env previews one added evidence entry by name and source, and no value', async (t) => {
  const env = environment({ DB_PASSWORD: SECRET_CANARY });
  const root = await secretClone(t);
  const before = await cloneHash(root);
  const argv = ['config', 'add-sensitive-input', 'DB_PASSWORD', '--environment-file', '.env'];
  const text = await agentFramework(root, argv, { env });
  const json = await agentFramework(root, [...argv, '--json'], { env });
  const revision = json.document;
  const evidenceLine = (await configurationOf(root)).split('\n').indexOf(sectionLine('evidence', {})) + 1;

  assert.equal(await cloneHash(root), before, 'a revision preview changed a byte under the clone or .git.');
  assert.equal(json.status, 1, json.stderr);
  assert.equal(revision.failure, null);
  assert.deepEqual(revision.revision, { operation: 'add-sensitive-input', name: 'DB_PASSWORD', 'environment-file': '.env' });
  assert.equal(revision.subcontract, 'evidence');
  assert.deepEqual(revision.changes, [{
    subcontract: 'evidence',
    line: evidenceLine,
    before: sectionLine('evidence', {}),
    after: sectionLine('evidence', { sensitive_inputs: ['DB_PASSWORD'], environment_files: ['.env'] }),
  }]);

  for (const output of [text.stdout, text.stderr, json.stdout, json.stderr]) {
    assert.equal(output.includes(SECRET_CANARY), false, 'the secret canary was printed.');
  }
});

/** The policy the TB-070 fixtures hold: one required and one advisory check. */
const TWO_CHECK_POLICY = Object.freeze({
  ...CONFIGURED_POLICY,
  checks: { required: ['configuration.broad-tests.test'], advisory: ['configuration.static-analysis.lint'] },
});

/** Every TB-070 revision, in an order a configured clone accepts each, with the subcontract it leaves. */
const TB070_STEPS = Object.freeze([
  [['add-sensitive-input', 'DB_PASSWORD', '--environment-file', '.env'], 'evidence', { sensitive_inputs: ['DB_PASSWORD'], environment_files: ['.env'] }],
  [['add-sensitive-input', 'APP_KEY'], 'evidence', { sensitive_inputs: ['DB_PASSWORD', 'APP_KEY'], environment_files: ['.env'] }],
  [['add-environment-file', '.env.local'], 'evidence', { sensitive_inputs: ['DB_PASSWORD', 'APP_KEY'], environment_files: ['.env', '.env.local'] }],
  [['remove-environment-file', '.env'], 'evidence', { sensitive_inputs: ['DB_PASSWORD', 'APP_KEY'], environment_files: ['.env.local'] }],
  [['remove-sensitive-input', 'DB_PASSWORD'], 'evidence', { sensitive_inputs: ['APP_KEY'], environment_files: ['.env.local'] }],
  [['demote-check', 'configuration.broad-tests.test'], 'checks', {
    required: [], advisory: ['configuration.static-analysis.lint', 'configuration.broad-tests.test'],
  }],
  [['promote-check', 'configuration.static-analysis.lint'], 'checks', {
    required: ['configuration.static-analysis.lint'], advisory: ['configuration.broad-tests.test'],
  }],
  [['remove-check', 'configuration.broad-tests.test'], 'checks', { required: ['configuration.static-analysis.lint'], advisory: [] }],
  [['set-budget', '900'], 'budget', { total_seconds: 900 }],
  [['set-bypass', 'true', '--marker', 'Gate-Bypass', '--require-reference', 'true'], 'bypass', {
    enabled: true, marker: 'Gate-Bypass', require_reference: true,
  }],
  [['set-bypass', 'false'], 'bypass', { enabled: false, marker: 'Gate-Bypass', require_reference: true }],
]);

test('TB-070 AC-GUIDE-003 / SG-GUIDE-001: each evidence, checks, budget, and bypass revision previews one line and writes it only with its token', async (t) => {
  const root = await configuredClone(t, { policy: TWO_CHECK_POLICY });
  const agents = await readFile(path.join(root, 'AGENTS.md'));

  for (const [argv, subcontract, value] of TB070_STEPS) {
    const before = await cloneHash(root);
    const preview = await agentFramework(root, ['config', ...argv, '--json']);
    const again = await agentFramework(root, ['config', ...argv, '--json']);

    assert.equal(await cloneHash(root), before, `${argv.join(' ')}: a preview changed a byte.`);
    assert.equal(again.stdout, preview.stdout, `${argv.join(' ')}: a repeated preview printed a different document.`);
    assert.equal(preview.status, 1, `${argv.join(' ')}: ${JSON.stringify(preview.document.failure)}`);

    const refused = await agentFramework(root, ['config', ...argv, '--confirm', 'f'.repeat(64), '--json']);

    assert.equal(refused.document.failure.reasonCode, 'preview-mismatch');
    assert.equal(await cloneHash(root), before, `${argv.join(' ')}: a foreign token wrote.`);

    const { original, confirmed, revised } = await reviseThroughFramework(root, argv);
    const changed = onlyChangedLine(original, revised);

    assert.equal(changed.after, sectionLine(subcontract, value), `${argv.join(' ')} wrote ${changed.after}.`);
    assert.deepEqual(preview.document.changes, [{ subcontract, line: changed.index + 1, before: changed.before, after: changed.after }]);
    assert.equal(confirmed.applied, true);
    assert.equal(confirmed.subcontract, subcontract);
    assert.equal(confirmed.exitStatus, 0);
    assert.equal(confirmed.next, null);
  }

  assert.deepEqual(await readFile(path.join(root, 'AGENTS.md')), agents, 'a revision changed AGENTS.md.');
});

/**
 * Each refusal is decided before anything is written: a revision that changes
 * nothing, a check the policy does not bind, and every candidate the Gate
 * policy validator refuses — an enabled bypass without its marker among them —
 * carrying that validator's own path and message.
 */
test('TB-070 AC-GUIDE-003: an invalid bypass and every other invalid candidate are refused with the validator\'s own reason, writing nothing', async (t) => {
  const policy = { ...TWO_CHECK_POLICY, execution: { budget_skippable: ['configuration.static-analysis.lint'] } };
  const root = await configuredClone(t, { policy });
  const before = await cloneHash(root);
  const invalid = [
    [['set-bypass', 'true'], { bypass: { enabled: true, marker: null } }],
    [['set-bypass', 'maybe', '--marker', 'Gate-Bypass'], { bypass: { enabled: 'maybe', marker: 'Gate-Bypass' } }],
    [['set-bypass', 'true', '--marker', 'Gate-Bypass', '--require-reference', 'sometimes'], {
      bypass: { enabled: true, marker: 'Gate-Bypass', require_reference: 'sometimes' },
    }],
    [['add-sensitive-input', 'db-password'], { evidence: { sensitive_inputs: ['db-password'] } }],
    [['add-environment-file', '../outside/.env'], { evidence: { environment_files: ['../outside/.env'] } }],
    [['add-sensitive-input', 'DB_PASSWORD', '--environment-file', '/etc/environment'], {
      evidence: { sensitive_inputs: ['DB_PASSWORD'], environment_files: ['/etc/environment'] },
    }],
    [['promote-check', 'configuration.static-analysis.lint'], {
      checks: { required: ['configuration.broad-tests.test', 'configuration.static-analysis.lint'], advisory: [] },
    }],
  ];

  for (const [argv, candidate] of invalid) {
    const issues = validateGatePolicy({ ...policy, ...candidate });
    const refused = await agentFramework(root, ['config', ...argv, '--json']);

    assert.ok(issues.length > 0, `the validator accepts ${JSON.stringify(candidate)}.`);
    assert.equal(refused.status, 2, argv.join(' '));
    assert.equal(refused.document.failure.reasonCode, 'candidate-invalid', `${argv.join(' ')}: ${refused.document.failure.detail}`);
    assert.equal(refused.document.applied, false);
    assert.equal(refused.document.previewHash, null);

    for (const issue of issues) {
      assert.ok(refused.document.failure.detail.includes(`${issue.path}: ${issue.message}`), refused.document.failure.detail);
    }
  }

  const budget = await agentFramework(root, ['config', 'set-budget', '0', '--json']);

  assert.equal(budget.document.failure.reasonCode, 'candidate-invalid');
  assert.match(budget.document.failure.detail, /positive total_seconds integer/);

  const refusals = [
    [['set-budget', '600'], 'nothing-to-revise', /the total budget is already 600 seconds/],
    [['set-bypass', 'false'], 'nothing-to-revise', /bypass is already/],
    [['promote-check', 'configuration.broad-tests.test'], 'nothing-to-revise', /already required/],
    [['remove-sensitive-input', 'DB_PASSWORD'], 'nothing-to-revise', /DB_PASSWORD is not declared/],
    [['remove-environment-file', '.env'], 'nothing-to-revise', /environment file \.env is not declared/],
    [['remove-check', 'configuration.unknown.check'], 'nothing-to-revise', /is not bound by the Gate policy/],
    // A severity change never binds a check the policy does not already bind (`SG-OWNER-001`).
    [['demote-check', 'configuration.unknown.check'], 'check-unbound', /never binds a new one or edits a Verification profile command/],
    [['promote-check', 'configuration.unknown.check'], 'check-unbound', /is not bound by the Gate policy/],
  ];

  for (const [argv, reasonCode, message] of refusals) {
    const refused = await agentFramework(root, ['config', ...argv, '--json']);

    assert.equal(refused.status, 2, argv.join(' '));
    assert.equal(refused.document.failure.reasonCode, reasonCode, `${argv.join(' ')}: ${refused.document.failure.detail}`);
    assert.match(refused.document.failure.detail, message);
  }

  assert.equal(await cloneHash(root), before);
});

/** `RISK-012` for every TB-070 revision: one line changes, and every byte before and after the section is kept. */
test('TB-070 RISK-012: every byte outside the Gate section, comments included, is identical after each new revision', async (t) => {
  const commented = [
    '# Maintainer notes: this file is reviewed with every release.',
    schemaV4Configuration({ gate: false }).trimEnd(),
    '# The Gate section below is written by configure-gate.',
    'history:',
    '  path: docs/history   # where delivered work is recorded',
    '  required: false',
    '# end of configuration',
    '',
  ].join('\n');
  const root = await throwawayRepository(t);

  await configuredThroughConfigureGate(root, TWO_CHECK_POLICY, { configuration: commented });
  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    (await configurationOf(root)).replace('\nhistory:\n', '\n# The Gate section above is ours to revise.\nhistory:\n'),
    'utf8',
  );
  await commit(root);

  for (const [argv] of TB070_STEPS) {
    const { original, revised } = await reviseThroughFramework(root, argv);
    const sectionStart = original.indexOf('evaluation_gate:\n');

    assert.ok(sectionStart > 0);
    assert.equal(revised.slice(0, sectionStart), original.slice(0, sectionStart), `${argv.join(' ')}: a byte before the section changed.`);
    assert.equal(
      revised.slice(revised.indexOf('\n# The Gate section above')),
      original.slice(original.indexOf('\n# The Gate section above')),
      `${argv.join(' ')}: a byte after the section changed.`,
    );
    onlyChangedLine(original, revised);
  }
});

/**
 * `SG-GUIDE-002`, `SG-SECRET-001`. On an activated clone, a canary present in
 * the environment and in the declared `.env` never appears in a preview, a
 * confirmation, the chained re-pin preview, the configuration, or any other
 * byte of the clone outside `.env` itself, in text or `--json`.
 */
test('TB-070 SG-GUIDE-002 / SG-SECRET-001: no secret canary from the environment or .env appears in any output or written byte', async (t) => {
  const env = environment({ DB_PASSWORD: SECRET_CANARY, APP_KEY: `${SECRET_CANARY}-environment` });
  const root = await secretClone(t, { activated: true, env });
  const outputs = [];

  for (const argv of [['add-sensitive-input', 'DB_PASSWORD', '--environment-file', '.env'], ['add-sensitive-input', 'APP_KEY'], ['remove-sensitive-input', 'APP_KEY']]) {
    const previewText = await agentFramework(root, ['config', ...argv], { env });
    const { preview, confirmed } = await reviseThroughFramework(root, argv, { env });

    outputs.push(previewText.stdout, previewText.stderr, JSON.stringify(preview), JSON.stringify(confirmed));
    assert.equal(confirmed.applied, true);
    assert.equal(typeof confirmed.repin?.candidate?.identity, 'string', JSON.stringify(confirmed.failure));
  }

  const shown = await agentFramework(root, ['config', 'show'], { env });

  outputs.push(shown.stdout, shown.stderr);

  for (const output of outputs) {
    assert.equal(output.includes(SECRET_CANARY), false, 'the secret canary was printed.');
  }

  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && absolute !== path.join(root, '.env')) {
        assert.equal((await readFile(absolute)).includes(SECRET_CANARY), false, `${path.relative(root, absolute)} holds the canary.`);
      }
    }
  };

  await walk(root);
  assert.match(await configurationOf(root), /^ {2}evidence: \{"sensitive_inputs":\["DB_PASSWORD"\],"environment_files":\[".env"\]\}$/m);
});

/** The chained re-pin preview fields a direct `gate sync --json` gives, compared one by one. */
const REPIN_FIELDS = ['trusted', 'candidate', 'transition', 'acknowledgedWeakening', 'refusal', 'confirmationToken'];

/**
 * `SG-CFG-001`, `RISK-008`. Demoting the one required check of an activated
 * clone is written with the revision's own token, and the chained `gate sync`
 * preview then refuses it as the Gate does — the weakening named, no token —
 * and names the Gate's own acknowledged preview as the next command. Pasting
 * that command offers the token, and the acknowledged confirmation re-pins.
 * The Framework command flags no weakening of its own: what it shows is
 * exactly the direct `gate sync --json` document.
 */
test('TB-070 SG-CFG-001: a demoted required check reaches gate sync\'s weakening refusal, and the acknowledged preview offers the token', async (t) => {
  const root = await activatedClone(t, { policy: TWO_CHECK_POLICY });
  const argv = ['demote-check', 'configuration.broad-tests.test'];
  const previewText = await agentFramework(root, ['config', ...argv]);

  assert.match(previewText.stdout, /^state: activated — .*names any weakening of the trusted policy, and offers no token for one until it is acknowledged \(--acknowledge-weakening\)\.$/m);

  const { preview, confirmed } = await reviseThroughFramework(root, argv);
  const direct = await gateJson(root, ['sync']);

  assert.equal(preview.acknowledgeWeakening, false);
  assert.equal(preview.repin, null, 'the revision preview judged a weakening of its own.');
  assert.equal(confirmed.applied, true);
  assert.equal(confirmed.exitStatus, 1);

  for (const field of REPIN_FIELDS) {
    assert.deepEqual(confirmed.repin[field], direct.observation[field], `the chained preview's ${field} is not the direct gate sync's.`);
  }

  assert.equal(confirmed.repin.refusal.reasonCode, 'weakening-unacknowledged');
  assert.equal(confirmed.repin.confirmationToken, null);
  assert.deepEqual(confirmed.repin.transition.weakenings.map(({ code, checkId }) => ({ code, checkId })), [
    { code: 'required-check-demoted', checkId: 'configuration.broad-tests.test' },
  ]);
  assert.ok(confirmed.next.command.endsWith(' sync --acknowledge-weakening'), confirmed.next.command);

  // The next command, pasted as printed: the Gate's own acknowledged preview, with its token.
  const acknowledged = JSON.parse((await pasteIntoShell(root, `${confirmed.next.command} --json`)).stdout);

  assert.equal(acknowledged.observation.acknowledgedWeakening, true);
  assert.match(acknowledged.observation.confirmationToken, /^sha256:[0-9a-f]{64}$/);

  const pinned = await gateJson(root, ['sync', '--acknowledge-weakening', '--confirm', acknowledged.observation.confirmationToken]);

  assert.equal(pinned.mutation.performed, true, pinned.mutation.summary);
});

/**
 * The pass-through. A maintainer who passes `--acknowledge-weakening` has it
 * printed into the revision's confirming command and passed, on confirmation,
 * to the chained `gate sync` preview, which then offers its token for the
 * weaker candidate; the confirming line it names carries the acknowledgement
 * that token binds, and pasting it re-pins.
 */
test('TB-070 SG-CFG-001: --acknowledge-weakening passes through to the chained gate sync preview, which offers its token', async (t) => {
  const root = await activatedClone(t, { policy: TWO_CHECK_POLICY });
  const argv = ['demote-check', 'configuration.broad-tests.test', '--acknowledge-weakening'];
  const preview = await agentFramework(root, ['config', ...argv, '--json']);

  assert.equal(preview.document.acknowledgeWeakening, true);
  assert.ok(preview.document.next.command.endsWith(`--confirm ${preview.document.previewHash} --acknowledge-weakening`), preview.document.next.command);

  const confirmed = JSON.parse((await pasteIntoShell(root, `${preview.document.next.command} --json`)).stdout);
  const direct = await gateJson(root, ['sync', '--acknowledge-weakening']);

  assert.equal(confirmed.applied, true, JSON.stringify(confirmed.failure));

  for (const field of REPIN_FIELDS) {
    assert.deepEqual(confirmed.repin[field], direct.observation[field], `the chained preview's ${field} is not the direct acknowledged gate sync's.`);
  }

  assert.equal(confirmed.repin.acknowledgedWeakening, true);
  assert.equal(confirmed.repin.refusal, null);
  assert.match(confirmed.repin.confirmationToken, /^sha256:[0-9a-f]{64}$/);
  assert.ok(
    confirmed.next.command.endsWith(` sync --acknowledge-weakening --confirm ${confirmed.repin.confirmationToken}`),
    confirmed.next.command,
  );

  const pinned = JSON.parse((await pasteIntoShell(root, `${confirmed.next.command} --json`)).stdout);

  assert.equal(pinned.mutation.performed, true, pinned.mutation.summary);
  assert.equal((await gateJson(root, ['status'])).observation.health, 'healthy');
});

/**
 * `NFR-REL-004` for the TB-070 revisions: the Framework command and
 * `configure.mjs --revise-gate`, each previewed and confirmed with its own
 * token on twin clones, write byte-identical files, and so does
 * `configure-gate` given the revised policy directly.
 */
test('TB-070 NFR-REL-004: the Framework command, the direct revision command, and configure-gate write the same file', async (t) => {
  const cases = [
    [['add-sensitive-input', 'DB_PASSWORD', '--environment-file', '.env'], ['--name', 'DB_PASSWORD', '--environment-file', '.env'], {
      evidence: { sensitive_inputs: ['DB_PASSWORD'], environment_files: ['.env'] },
    }],
    [['demote-check', 'configuration.broad-tests.test'], ['--check', 'configuration.broad-tests.test'], {
      checks: { required: [], advisory: ['configuration.static-analysis.lint', 'configuration.broad-tests.test'] },
    }],
    [['set-budget', '900'], ['--seconds', '900'], { budget: { total_seconds: 900 } }],
    [['set-bypass', 'true', '--marker', 'Gate-Bypass'], ['--enabled', 'true', '--marker', 'Gate-Bypass'], {
      bypass: { enabled: true, marker: 'Gate-Bypass' },
    }],
  ];

  for (const [frameworkArgv, directOptions, revisedSubcontract] of cases) {
    const throughFramework = await configuredClone(t, { policy: TWO_CHECK_POLICY });
    const direct = await configuredClone(t, { policy: TWO_CHECK_POLICY });
    const fresh = await throwawayRepository(t);
    const { confirmed } = await reviseThroughFramework(throughFramework, frameworkArgv);
    const configureArgv = ['--project', direct, '--revise-gate', frameworkArgv[0], ...directOptions];
    const directPreview = JSON.parse((await run(process.execPath, [CONFIGURE, ...configureArgv], { cwd: direct })).stdout);
    const directConfirmed = await run(process.execPath, [CONFIGURE, ...configureArgv, '--confirm', directPreview.previewHash], { cwd: direct });

    assert.equal(directConfirmed.status, 0, directConfirmed.stderr);
    assert.equal(directPreview.previewHash, confirmed.previewHash, frameworkArgv.join(' '));
    assert.equal(await configurationOf(direct), await configurationOf(throughFramework), frameworkArgv.join(' '));

    await configuredThroughConfigureGate(fresh, { ...TWO_CHECK_POLICY, ...revisedSubcontract });

    assert.equal(await configurationOf(fresh), await configurationOf(throughFramework), frameworkArgv.join(' '));
  }
});

test('TB-070: every new revision is in the usage, and --acknowledge-weakening is a revision flag only', async (t) => {
  const root = await configuredClone(t);
  const before = await cloneHash(root);

  for (const argv of [
    ['config', 'set-bypass'],
    ['config', 'set-budget', '900', '--marker', 'x'],
    ['config', 'add-sensitive-input', 'DB_PASSWORD', '--value', 'secret'],
    ['config', 'show', '--acknowledge-weakening'],
    ['setup', '--acknowledge-weakening'],
  ]) {
    const result = await agentFramework(root, argv);

    assert.equal(result.status, 2, `${argv.join(' ')} exited ${result.status}.`);
    assert.equal(result.stdout, '');

    for (const name of [
      'add-sensitive-input', 'remove-sensitive-input', 'add-environment-file', 'remove-environment-file',
      'promote-check', 'demote-check', 'remove-check', 'set-budget', 'set-bypass',
    ]) {
      assert.match(result.stderr, new RegExp(`agent-framework config ${name} <`));
    }
  }

  const usage = (await agentFramework(root, ['config', 'bogus'])).stderr;

  assert.match(usage, /config add-sensitive-input <name> \[--environment-file <environment-file>\] \[--confirm <token>\] \[--acknowledge-weakening\]/);
  assert.match(usage, /config set-bypass <enabled> \[--marker <marker>\] \[--require-reference <require-reference>\]/);
  assert.equal(await cloneHash(root), before);
});

/**
 * `SG-GUIDE-002`. A value typed where a name, file, or check is expected —
 * `DB_PASSWORD=<value>` as the argument or as an option's value — is refused
 * as `value-supplied`, naming only the part before `=`. The value never
 * reaches the validator and is repeated nowhere: not in a refusal, a usage
 * text, a `--json` document, or an echoed command line, from the Framework
 * command or from `configure.mjs --revise-gate`. Nothing is written.
 */
test('TB-070 SG-GUIDE-002: a value typed as NAME=value is refused as value-supplied and never repeated by either CLI', async (t) => {
  const canary = `typed-canary-${createHash('sha256').update('typed value').digest('hex').slice(0, 20)}`;
  const root = await configuredClone(t);
  const unconfigured = await noConfigurationClone(t);
  const before = await cloneHash(root);
  const unconfiguredBefore = await cloneHash(unconfigured);
  const frameworkCases = [
    [root, ['config', 'add-sensitive-input', `DB_PASSWORD=${canary}`], 'DB_PASSWORD'],
    [root, ['config', 'remove-sensitive-input', `DB_PASSWORD=${canary}`], 'DB_PASSWORD'],
    [root, ['config', 'add-sensitive-input', 'DB_PASSWORD', '--environment-file', `.env=${canary}`], '.env'],
    [root, ['config', 'add-environment-file', `.env=${canary}`], '.env'],
    [root, ['config', 'demote-check', `configuration.broad-tests.test=${canary}`], 'configuration.broad-tests.test'],
    [root, ['config', 'add-sensitive-input', `DB_PASSWORD=${canary}`, '--confirm', 'f'.repeat(64)], 'DB_PASSWORD'],
    [unconfigured, ['config', 'add-sensitive-input', `DB_PASSWORD=${canary}`], 'DB_PASSWORD'],
    [root, ['config', 'add-sensitive-input', '--name', `DB_PASSWORD=${canary}`], null],
  ];

  for (const [clone, argv, named] of frameworkCases) {
    const text = await agentFramework(clone, argv);
    // A malformed invocation prints only the usage, so there is no document to parse.
    const json = named === null
      ? await run(process.execPath, [ENTRY, ...argv, '--json'], { cwd: clone })
      : await agentFramework(clone, [...argv, '--json']);

    for (const result of [text, json]) {
      assert.equal(result.status, 2, `${argv.join(' ')} exited ${result.status}.`);
      assert.equal(`${result.stdout}${result.stderr}`.includes(canary), false, `${argv[1]} repeated the typed value.`);
    }

    if (named !== null) {
      assert.equal(json.document.failure.reasonCode, 'value-supplied', json.stdout);
      assert.ok(json.document.failure.detail.includes(named), json.document.failure.detail);
      assert.match(text.stdout, /^failed: value-supplied — /m);
    }
  }

  const directCases = [
    ['add-sensitive-input', '--name', `DB_PASSWORD=${canary}`],
    ['add-sensitive-input', '--name', 'DB_PASSWORD', '--environment-file', `.env=${canary}`],
    ['remove-sensitive-input', '--name', `DB_PASSWORD=${canary}`],
    ['add-environment-file', '--file', `.env=${canary}`],
    ['add-sensitive-input', '--name', `DB_PASSWORD=${canary}`, '--confirm', 'f'.repeat(64)],
  ];

  for (const argv of directCases) {
    const result = await run(process.execPath, [CONFIGURE, '--project', root, '--revise-gate', ...argv], { cwd: root });

    assert.equal(result.status, 2, `${argv.join(' ')} exited ${result.status}: ${result.stderr}`);
    assert.equal(`${result.stdout}${result.stderr}`.includes(canary), false, `--revise-gate ${argv[0]} repeated the typed value.`);
    assert.equal(JSON.parse(result.stdout).reasonCode, 'value-supplied');
  }

  assert.equal(await cloneHash(root), before);
  assert.equal(await cloneHash(unconfigured), unconfiguredBefore);
});

/* -------------------------------------------------------------------------
 * TB-071: `agent-framework config suggest`.
 *
 * What the repository already implies the Gate configuration section should
 * declare and does not — dependency roots from a manifest or lock file present
 * with the directory it installs into, Sensitive runtime input names from an
 * example environment file, and environment files Git ignores — each with its
 * evidence and the exact `config` command that previews it. Nothing is
 * applied by suggesting (`FR-GUIDE-007`, `AC-GUIDE-003`, `SG-GUIDE-001`,
 * `SG-GUIDE-002`, `SG-OWNER-001`, `RISK-006`).
 * ------------------------------------------------------------------------- */

/** The revisions a proposal may name: never a Verification profile command (`SG-OWNER-001`). */
const PROPOSED_REVISIONS = ['add-dependency-root', 'add-sensitive-input', 'add-environment-file'];

/** The Framework command that previews one revision, as `config suggest` names it. */
const previewArgv = (root, operation, value) => ['node', ENTRY, 'config', operation, value, '--project', root];

/**
 * THE FIRST RED TEST OF TB-071.
 *
 * A configured clone holding `composer.lock` and an installed `vendor/`, with
 * no dependency root declared, is proposed `vendor` with the command that adds
 * it — and pasting that command previews exactly that revision, writing
 * nothing (`AC-GUIDE-003`, `FR-GUIDE-007`).
 */
test('TB-071 AC-GUIDE-003: composer.lock and an installed vendor/ propose vendor with the command that adds it', async (t) => {
  const root = await configuredClone(t, {
    prepare: async (clone) => {
      await writeFile(path.join(clone, '.gitignore'), '/vendor\n', 'utf8');
      await writeFile(path.join(clone, 'composer.lock'), '{}\n', 'utf8');
      await mkdir(path.join(clone, 'vendor'), { recursive: true });
      await writeFile(path.join(clone, 'vendor', 'autoload.php'), '<?php\n', 'utf8');
    },
  });
  const before = await cloneHash(root);
  const json = await agentFramework(root, ['config', 'suggest', '--json']);
  const suggested = json.document;

  assert.equal(json.stderr, '', json.stderr);
  assert.equal(suggested.document, 'agent-framework/config-suggest/1');
  assert.equal(suggested.command, 'config suggest');
  assert.equal(suggested.failure, null);
  assert.equal(suggested.exitStatus, 1);
  assert.equal(json.status, 1);
  assert.deepEqual(suggested.proposals.map((proposal) => proposal.revision), [{ operation: 'add-dependency-root', root: 'vendor' }]);

  const [proposal] = suggested.proposals;

  assert.equal(proposal.kind, 'dependency-root');
  assert.equal(proposal.subcontract, 'execution');
  assert.deepEqual(proposal.evidence, [
    { fact: 'lock-file', path: 'composer.lock' },
    { fact: 'install-directory', path: 'vendor' },
  ]);
  assert.deepEqual(proposal.command.argv, previewArgv(root, 'add-dependency-root', 'vendor'));

  // The command is exact: pasted into a shell it previews that revision, and only previews it.
  const pasted = await pasteIntoShell(root, `${proposal.command.run} --json`);
  const preview = JSON.parse(pasted.stdout);

  assert.equal(pasted.status, 1, pasted.stderr);
  assert.deepEqual(preview.revision, { operation: 'add-dependency-root', root: 'vendor' });
  assert.equal(preview.applied, false);
  assert.equal(preview.changes[0].after, sectionLine('execution', { budget_skippable: [], dependency_roots: ['vendor'] }));
  assert.equal(await cloneHash(root), before, 'config suggest or its proposal wrote a byte under the clone or .git.');
});

/**
 * The text rendering names the same state, proposals, evidence, commands,
 * skipped counts, and next step as the document (`--json` mirrors text).
 */
const assertSuggestMirror = (stdout, suggested) => {
  const lines = stdout.split('\n');

  assert.equal(lines[0], 'agent-framework config suggest');
  assert.ok(lines.includes(`project: ${suggested.project}`));

  if (suggested.failure !== null) {
    assert.ok(lines.some((line) => line.startsWith(`failed: ${suggested.failure.reasonCode} — `)));

    return;
  }

  assert.ok(lines.includes(`state: ${suggested.state}`), `text does not name state ${suggested.state}.`);
  assert.ok(lines.includes(`proposals: ${suggested.proposals.length}`));

  for (const [index, proposal] of suggested.proposals.entries()) {
    const heading = lines.findIndex((line) => line.startsWith(`  ${index + 1}. `));

    assert.notEqual(heading, -1, `text does not list proposal ${index + 1}.`);
    assert.ok(lines[heading].endsWith(` ${proposal.value} (${proposal.subcontract})`), lines[heading]);
    assert.ok(lines[heading + 1].startsWith('     evidence: '), lines[heading + 1]);

    for (const evidence of proposal.evidence) {
      assert.ok(lines[heading + 1].includes(evidence.path), `text does not name ${evidence.path} as evidence.`);
    }

    assert.equal(lines[heading + 2], `     $ ${proposal.command.run}`);
  }

  for (const skipped of suggested.skipped) {
    assert.ok(
      lines.some((line) => line.startsWith(`skipped: ${skipped.count} line`) && line.includes(`of ${skipped.path} `) && line.includes(`(${skipped.reason})`)),
      `text does not count the ${skipped.reason} lines of ${skipped.path}.`,
    );
  }

  const next = lines.filter((line) => line.startsWith('next: '));

  assert.equal(next.length, 1);
  assert.equal(next[0], `next: ${suggested.next === null ? 'nothing' : (suggested.next.command ?? suggested.next.instruction)}`);
};

/**
 * Run `config suggest` and `config suggest --json` twice each against `root`,
 * and prove the four runs changed nothing under the clone or `.git`, printed
 * byte-identical output on repeat, and that the text carries what the
 * document carries (`SG-GUIDE-001`).
 */
const observeSuggest = async (root, options = {}) => {
  const before = await cloneHash(root);
  const text = await agentFramework(root, ['config', 'suggest'], options);
  const json = await agentFramework(root, ['config', 'suggest', '--json'], options);
  const textAgain = await agentFramework(root, ['config', 'suggest'], options);
  const jsonAgain = await agentFramework(root, ['config', 'suggest', '--json'], options);

  assert.equal(await cloneHash(root), before, 'config suggest changed a byte under the clone or .git.');
  assert.equal(text.stderr, '', text.stderr);
  assert.equal(json.stderr, '', json.stderr);
  assert.equal(textAgain.stdout, text.stdout, 'a repeated config suggest printed different text.');
  assert.equal(jsonAgain.stdout, json.stdout, 'a repeated config suggest --json printed a different document.');
  assert.equal(text.status, json.status);
  assert.equal(json.document.exitStatus, json.status);
  assert.equal(json.document.document, 'agent-framework/config-suggest/1');
  assert.equal(json.document.command, 'config suggest');
  assertSuggestMirror(text.stdout, json.document);

  return { text, json, suggested: json.document };
};

const SUGGEST_CANARY = `suggest-canary-${createHash('sha256').update('TB-071').digest('hex').slice(0, 20)}`;

/**
 * A Laravel-like checkout: Composer and npm manifests and lock files with
 * their installed directories, a `.env.example` naming its keys, and a `.env`
 * Git ignores (or tracks). The canary is the value of `APP_KEY` and
 * `DB_PASSWORD` in both environment files, and it also opens one example line
 * that assigns nothing and one whose key the Gate refuses as a name, so a
 * printed skipped line would print it.
 */
const laravelLikeCheckout = ({ trackedEnvironment = false } = {}) => async (clone) => {
  await writeFile(path.join(clone, '.gitignore'), ['/vendor', '/node_modules', ...(trackedEnvironment ? [] : ['.env']), ''].join('\n'), 'utf8');
  await writeFile(path.join(clone, 'composer.json'), `${JSON.stringify({ require: { 'laravel/framework': '^11.0' } })}\n`, 'utf8');
  await writeFile(path.join(clone, 'composer.lock'), '{}\n', 'utf8');
  await mkdir(path.join(clone, 'vendor'), { recursive: true });
  await writeFile(path.join(clone, 'vendor', 'autoload.php'), '<?php\n', 'utf8');
  await writeFile(path.join(clone, 'package-lock.json'), '{}\n', 'utf8');
  await mkdir(path.join(clone, 'node_modules'), { recursive: true });
  await writeFile(path.join(clone, 'node_modules', '.package-lock.json'), '{}\n', 'utf8');
  await writeFile(path.join(clone, '.env.example'), [
    '# Application',
    'APP_NAME=Laravel',
    `APP_KEY=${SUGGEST_CANARY}`,
    '',
    `export DB_PASSWORD=${SUGGEST_CANARY}-db`,
    'app_debug=true',
    'APP_NAME=duplicate',
    `${SUGGEST_CANARY}-unassigned`,
    `${SUGGEST_CANARY} refused-key=${SUGGEST_CANARY}-refused`,
    '',
  ].join('\n'), 'utf8');
  await writeFile(path.join(clone, '.env'), `APP_KEY=${SUGGEST_CANARY}\nDB_PASSWORD=${SUGGEST_CANARY}-db\n`, 'utf8');
};

/** Each proposal as `<operation> <value>`. */
const proposed = (suggested) => suggested.proposals.map((proposal) => `${proposal.revision.operation} ${proposal.value}`);

test('TB-071 AC-GUIDE-003 / FR-GUIDE-007: a Laravel-like clone is proposed its roots, example names, and ignored .env, each with evidence and its command', async (t) => {
  const root = await configuredClone(t, { prepare: laravelLikeCheckout() });
  const agents = await readFile(path.join(root, 'AGENTS.md'));
  const { suggested, text } = await observeSuggest(root);

  assert.equal(suggested.failure, null);
  assert.equal(suggested.exitStatus, 1);
  assert.equal(suggested.state, 'configured');
  assert.deepEqual(proposed(suggested), [
    'add-dependency-root vendor',
    'add-dependency-root node_modules',
    'add-sensitive-input APP_NAME',
    'add-sensitive-input APP_KEY',
    'add-sensitive-input DB_PASSWORD',
    // The Gate policy validator accepts any environment variable name, lowercase included.
    'add-sensitive-input app_debug',
    'add-environment-file .env',
  ]);
  assert.deepEqual(suggested.proposals.map((proposal) => proposal.evidence), [
    [{ fact: 'manifest', path: 'composer.json' }, { fact: 'lock-file', path: 'composer.lock' }, { fact: 'install-directory', path: 'vendor' }],
    [{ fact: 'manifest', path: 'package.json' }, { fact: 'lock-file', path: 'package-lock.json' }, { fact: 'install-directory', path: 'node_modules' }],
    [{ fact: 'example-name', path: '.env.example', line: 2 }],
    [{ fact: 'example-name', path: '.env.example', line: 3 }],
    [{ fact: 'example-name', path: '.env.example', line: 5 }],
    [{ fact: 'example-name', path: '.env.example', line: 6 }],
    [{ fact: 'git-ignored', path: '.env' }],
  ]);
  assert.deepEqual(suggested.skipped, [
    { path: '.env.example', reason: 'not-an-assignment', count: 1 },
    { path: '.env.example', reason: 'name-refused', count: 1 },
  ]);

  // Every proposal names one of the three revisions and previews it: no Verification profile command (`SG-OWNER-001`).
  for (const proposal of suggested.proposals) {
    const argument = { 'add-dependency-root': 'root', 'add-sensitive-input': 'name', 'add-environment-file': 'file' }[proposal.revision.operation];

    assert.ok(PROPOSED_REVISIONS.includes(proposal.revision.operation), proposal.revision.operation);
    assert.deepEqual(proposal.revision, { operation: proposal.revision.operation, [argument]: proposal.value });
    assert.equal(proposal.subcontract, proposal.kind === 'dependency-root' ? 'execution' : 'evidence');
    assert.deepEqual(proposal.command.argv, previewArgv(root, proposal.revision.operation, proposal.value));
    assert.equal(proposal.command.role, 'preview');
  }

  assert.equal(suggested.next.step, 'choose-proposal');
  assert.equal(suggested.next.command, null);
  assert.match(text.stdout, /^ {5}evidence: composer\.json \(manifest\); composer\.lock \(lock file\); vendor\/ \(installed directory\)$/m);
  assert.match(text.stdout, /^ {5}evidence: \.env\.example line 3 names it$/m);
  assert.match(text.stdout, /^ {5}evidence: \.env is present and Git ignores it$/m);
  assert.match(text.stdout, /^skipped: 1 line of \.env\.example that assigns no NAME= \(not-an-assignment\) — not shown/m);
  assert.deepEqual(await readFile(path.join(root, 'AGENTS.md')), agents);
});

/**
 * `SG-GUIDE-002`, `RISK-006`. The canary is the value of `APP_KEY` and
 * `DB_PASSWORD` in `.env.example`, in the git-ignored `.env`, and in the
 * environment, and it opens the two example lines that are skipped. It appears
 * in no output, text or `--json`, on an activated clone.
 */
test('TB-071 SG-GUIDE-002 / RISK-006: no canary value from .env, .env.example, or the environment appears in any output', async (t) => {
  const env = environment({ APP_KEY: SUGGEST_CANARY, DB_PASSWORD: `${SUGGEST_CANARY}-environment` });
  const root = await activatedClone(t, { policy: CONFIGURED_POLICY, env, prepare: laravelLikeCheckout() });
  const { suggested, text, json } = await observeSuggest(root, { env });

  assert.equal(suggested.state, 'activated');
  assert.equal(suggested.failure, null);
  assert.ok(proposed(suggested).includes('add-sensitive-input APP_KEY'));

  for (const output of [text.stdout, text.stderr, json.stdout, json.stderr]) {
    assert.equal(output.includes(SUGGEST_CANARY), false, 'a canary value was printed.');
  }
});

test('TB-071 AC-GUIDE-003: a root, name, or environment file already declared is not proposed', async (t) => {
  const partly = await configuredClone(t, {
    prepare: laravelLikeCheckout(),
    policy: {
      ...CONFIGURED_POLICY,
      execution: { budget_skippable: [], dependency_roots: ['vendor'] },
      evidence: { sensitive_inputs: ['APP_KEY', 'DB_PASSWORD'], environment_files: ['.env'] },
    },
  });

  assert.deepEqual(proposed((await observeSuggest(partly)).suggested), [
    'add-dependency-root node_modules',
    'add-sensitive-input APP_NAME',
    'add-sensitive-input app_debug',
  ]);

  const declared = await configuredClone(t, {
    prepare: laravelLikeCheckout(),
    policy: {
      ...CONFIGURED_POLICY,
      execution: { budget_skippable: [], dependency_roots: ['vendor', 'node_modules'] },
      evidence: { sensitive_inputs: ['APP_NAME', 'APP_KEY', 'DB_PASSWORD', 'app_debug'], environment_files: ['.env'] },
    },
  });
  const { suggested, text } = await observeSuggest(declared);

  assert.deepEqual(suggested.proposals, []);
  assert.equal(suggested.exitStatus, 0);
  assert.equal(suggested.next, null);
  assert.match(text.stdout, /^proposals: 0$/m);
  assert.match(text.stdout, /^next: nothing$/m);
});

test('TB-071: a tracked .env, a directory with no manifest or lock file, and a lock file with no directory propose nothing', async (t) => {
  const root = await configuredClone(t, {
    prepare: async (clone) => {
      await laravelLikeCheckout({ trackedEnvironment: true })(clone);
      await rm(path.join(clone, 'node_modules'), { recursive: true });
      await rm(path.join(clone, 'composer.json'));
      await rm(path.join(clone, 'composer.lock'));
      await rm(path.join(clone, '.env.example'));
    },
  });
  const { suggested } = await observeSuggest(root);

  assert.equal((await git(root, ['ls-files', '.env'])).stdout, '.env\n', 'the fixture does not track .env.');
  assert.deepEqual(suggested.proposals, []);
  assert.deepEqual(suggested.skipped, []);
});

test('TB-071 AC-GUIDE-003: a clone with no Gate section names setup\'s next step and proposes nothing', async (t) => {
  for (const clone of [() => schemaV4Clone(t, { gate: false }), () => schemaV3Clone(t), () => noConfigurationClone(t)]) {
    const root = await clone();

    await laravelLikeCheckout()(root);

    const { suggested, text } = await observeSuggest(root);
    const setup = await agentFramework(root, ['setup', '--json']);

    assert.equal(suggested.exitStatus, 1);
    assert.equal(suggested.failure, null);
    assert.equal(suggested.state, setup.document.state);
    assert.equal(suggested.section, null);
    assert.deepEqual(suggested.proposals, []);
    assert.notEqual(suggested.next, null);
    assert.deepEqual(suggested.next, setup.document.next);
    assert.match(text.stdout, /^section: none — \.agent-framework\.yaml has no Gate configuration section, so nothing is proposed\.$/m);
  }
});

test('TB-071 FR-GUIDE-009: without the Gate module a clone with no section names setup\'s step, and a configured clone is refused', async (t) => {
  const { entry } = await setupOnlyInstall(t);
  const schemaV3 = await schemaV3Clone(t);
  const unconfigured = (await observeSuggest(schemaV3, { entry })).suggested;

  assert.equal(unconfigured.gate.available, false);
  assert.equal(unconfigured.next.step, 'migrate-schema-v4');
  assert.deepEqual(unconfigured.proposals, []);

  const configured = await configuredClone(t, { prepare: laravelLikeCheckout() });
  const { suggested } = await observeSuggest(configured, { entry });

  assert.equal(suggested.exitStatus, 2);
  assert.equal(suggested.failure.reasonCode, 'gate-unavailable');
  assert.deepEqual(suggested.proposals, []);
});

test('TB-071 RISK-012: a hand-written section no revision can apply to is refused with the owning operation\'s reason', async (t) => {
  const root = await schemaV4Clone(t);

  await laravelLikeCheckout()(root);

  const { suggested, text } = await observeSuggest(root);

  assert.equal(suggested.exitStatus, 2);
  assert.equal(suggested.failure.reasonCode, 'section-unrevisable');
  assert.deepEqual(suggested.proposals, []);
  assert.match(text.stdout, /^failed: section-unrevisable — \.agent-framework\.yaml line \d+ /m);
  assert.equal(text.stdout.includes(SUGGEST_CANARY), false);
});

test('TB-071: config suggest is in the usage and takes no value', async (t) => {
  const root = await configuredClone(t);
  const refused = await agentFramework(root, ['config', 'suggest', 'vendor']);

  assert.equal(refused.status, 2);
  assert.equal(refused.stdout, '');
  assert.match(refused.stderr, /^ {7}agent-framework config suggest \[--json\] \[--project <directory>\]$/m);
});
