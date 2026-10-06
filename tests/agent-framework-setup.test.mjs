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
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { validateGatePolicy } from '../skills/change-evaluation-gate/scripts/lib/policy.mjs';
import { REMEDIES } from '../skills/change-evaluation-gate/scripts/lib/remedies.mjs';
import { runFrameworkCommand } from '../skills/framework-setup/scripts/agent-framework.mjs';
import {
  configureGate,
  configureProject,
  discoverProject,
  previewGateConfiguration,
} from '../skills/framework-setup/scripts/configure.mjs';
import { processTerminal } from '../skills/framework-setup/scripts/lib/terminal.mjs';

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

  return seedRepository(root);
};

/** The throwaway repository's contents, at `root`, which must exist and be empty. */
const seedRepository = async (root) => {
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
const schemaV3Clone = async (t) => seedSchemaV3(await throwawayRepository(t));

const seedSchemaV3 = async (root) => {
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

test('the Framework command entry preserves its public exports', async () => {
  const { runFrameworkCommand: run, ...constants } = await import(pathToFileURL(ENTRY).href);

  assert.equal(run, runFrameworkCommand);
  assert.deepEqual(constants, {
    CONFIG_DOCUMENT_VERSION: 'agent-framework/config-show/1',
    DOCUMENT_VERSION: 'agent-framework/setup/1',
    EXIT_DONE: 0,
    EXIT_STEPS_REMAIN: 1,
    EXIT_UNRUNNABLE: 2,
    GUARDRAIL_DOCUMENT_VERSION: 'agent-framework/guardrail/1',
    GUIDED_DOCUMENT_VERSION: 'agent-framework/setup-guided/1',
    REVISION_DOCUMENT_VERSION: 'agent-framework/config-revision/1',
    SUGGEST_DOCUMENT_VERSION: 'agent-framework/config-suggest/1',
  });
});

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
  // The script path is quoted only when the checkout path needs it (a space),
  // so the text must carry the document's next command exactly, either way.
  assert.equal(text.stdout.split('\n').includes(`next: ${plan.next.command}`), true, text.stdout);
  assert.match(text.stdout, /^next: node .*configure\.mjs'? --project .* --draft-mapping --out /m);

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

  const implementation = path.join(SETUP_SKILL, 'scripts', 'lib', 'agent-framework');
  const implementationModules = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    const modules = await Promise.all(entries.map((entry) => {
      const file = path.join(directory, entry.name);

      return entry.isDirectory()
        ? implementationModules(file)
        : (entry.isFile() && entry.name.endsWith('.mjs') ? [file] : []);
    }));

    return modules.flat();
  };
  const modules = await implementationModules(implementation);

  for (const source of [ENTRY, ...modules, path.join(SETUP_SKILL, 'scripts', 'lib', 'gate-command.mjs')]) {
    const code = (await readFile(source, 'utf8'))
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\/\*\*?|\*)/.test(line))
      .join('\n');

    for (const remedy of remedies) {
      assert.doesNotMatch(code, new RegExp(`['"\`]${remedy}['"\`]`), `${path.basename(source)} names the remedy ${remedy}.`);
    }

    assert.doesNotMatch(code, /\.remedy ===|REMEDY_SUBCOMMANDS/, `${path.basename(source)} decides by remedy.`);
  }

  assert.match(
    await readFile(path.join(implementation, 'setup', 'plan.mjs'), 'utf8'),
    /\.subcommands\b/,
    'setup does not read the subcommands the Gate names.',
  );
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

/* -------------------------------------------------------------------------
 * TB-072: `agent-framework setup` in an interactive terminal.
 *
 * The exported entry driven in-process with a scripted terminal — the
 * interactive flag, the answers typed in order, and everything written to it —
 * while every owning operation runs for real: `framework-setup`'s migration
 * and Gate configuration in-process, the Gate as its own command. Each yes is
 * consent for exactly the preview shown before it, through the owning
 * operation's own token, and the Gate records the channel it came through
 * (`AC-GUIDE-001`, `AC-GUIDE-002`, `NFR-REL-004`, `SG-GUIDE-001`,
 * `SG-CFG-001`, `RISK-011`).
 * ------------------------------------------------------------------------- */

/** The channel guided confirmations declare, in the Gate's own vocabulary. */
const GUIDED_CHANNEL = 'interactive-guided-setup';

/**
 * A scripted terminal. An answer may be a function, run when its question is
 * asked, so a fixture can change the clone between a preview and its answer.
 * A question asked after the last answer reads end of input.
 */
const scriptedTerminal = (answers = [], { interactive = true } = {}) => {
  const queue = [...answers];
  const terminal = {
    interactive,
    output: '',
    questions: [],
    write: (text) => {
      terminal.output += text;
    },
    ask: async (question) => {
      const next = queue.shift();
      const answer = typeof next === 'function' ? await next() : (next ?? null);

      terminal.questions.push(question);
      terminal.output += `${question}${answer ?? ''}\n`;

      return answer;
    },
    unanswered: () => queue.length,
  };

  return terminal;
};

/** `agent-framework <argv>` through the exported entry, on a scripted terminal. */
const guidedSetup = async (root, answers, { env = environment(), interactive = true, argv = ['setup'], run: entry = runFrameworkCommand } = {}) => {
  const terminal = scriptedTerminal(answers, { interactive });
  const result = await entry({ cwd: root, argv, environment: env, terminal });

  return { ...result, terminal };
};

/** Each question asked, by the word it starts with and what it names. */
const askedOf = (terminal) => terminal.questions.map((question) => question.match(/^(\w+) ([^\s(]+(?: [^\s(]+)?)/)?.slice(1).join(' ') ?? question);

/** The schema v3 fixture's open migration decisions, answered. */
const SCHEMA_V3_DECISIONS = Object.freeze(['express-typescript', '60']);

const EVIDENCE = '.git/change-evaluation-gate/evidence';

const eventsOf = async (root) => (await readFile(path.join(root, EVIDENCE, 'events.ndjson'), 'utf8').catch(() => ''))
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const receiptOf = (root) => readFile(path.join(root, EVIDENCE, 'activation', 'receipt.json'), 'utf8').catch(() => null);

/** Gate status says the clone is activated, healthy, and names nothing further. */
const assertHealthy = async (root, env = environment()) => {
  const status = await gateJson(root, ['status'], env);
  const plan = (await agentFramework(root, ['setup', '--json'], { env })).document;

  assert.equal(status.observation.state, 'activated');
  assert.equal(status.observation.health, 'healthy', JSON.stringify(status.observation.next));
  assert.deepEqual(status.observation.next.remedies, []);
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.next, null);
};

/** Every draft path the plan names: guided setup must write none of them. */
const draftPathsOf = async (root) => {
  const planned = (await agentFramework(root, ['setup', '--json'])).document;

  return planned.steps.flatMap((step) => step.commands)
    .filter((entry) => entry.role === 'draft')
    .map((entry) => entry.argv.at(-1));
};

/**
 * THE FIRST RED TEST OF TB-072.
 *
 * A schema v3 clone, answered at every question, ends activated and healthy
 * with nothing further to do, and only the decisions the owning operations
 * cannot derive were asked: the two the migration report leaves open, and the
 * client to activate — each step's consent beside them (`AC-GUIDE-001`).
 */
test('TB-072 AC-GUIDE-001: a schema v3 clone answered yes at every step ends activated, healthy, with nothing further to do', async (t) => {
  const root = await schemaV3Clone(t);
  const agents = await readFile(path.join(root, 'AGENTS.md'));
  const drafts = await draftPathsOf(root);
  const run = await guidedSetup(root, [...SCHEMA_V3_DECISIONS, 'yes', 'yes', '', 'yes']);

  assert.equal(run.exitCode, 0, run.terminal.output);
  assert.equal(run.terminal.unanswered(), 0);
  assert.equal(run.stdout, '');
  assert.deepEqual(askedOf(run.terminal), [
    'decide backend profile',
    'decide verification.commands.test.backend[0] timeout_seconds',
    'confirm migrate-schema-v4 exactly',
    'confirm configure-gate exactly',
    'decide client',
    'confirm gate activate',
  ]);
  // The draft is offered as the default; where it has none, nothing is shown.
  assert.match(run.terminal.questions[4], /^decide client \(the adapter to activate\) \[git\]: $/);
  assert.match(run.terminal.questions[0], /^decide backend profile \("unknown"\): $/);
  await assertHealthy(root);

  assert.equal(run.document.document, 'agent-framework/setup-guided/1');
  assert.deepEqual(run.document.completed.map((step) => step.step), ['migrate-schema-v4', 'configure-gate', 'activate']);
  assert.equal(run.document.stopped, null);
  assert.equal(run.document.plan.state, 'activated');
  assert.match(run.terminal.output, /^where this clone stands now:\nagent-framework setup\n/m);
  assert.match(run.terminal.output, /^next: nothing$/m);
  assert.deepEqual(await readFile(path.join(root, 'AGENTS.md')), agents);

  // A guided run writes and names no draft, and does not claim to have confirmed nothing.
  for (const draft of drafts) {
    await assert.rejects(readFile(draft), { code: 'ENOENT' }, `guided setup wrote the draft ${draft}.`);
    assert.equal(run.terminal.output.includes(draft), false, `guided setup named the draft ${draft}.`);
  }

  assert.equal(run.terminal.output.includes('setup wrote nothing, confirmed nothing'), false);
});

/**
 * `RISK-011`. The Gate records that consent came through an interactive
 * guided run: the Lifecycle event of each confirmation carries the declared
 * channel as self-declared, the receipt is what a direct activation writes,
 * and a direct confirmation records no channel.
 */
test('TB-072 RISK-011: the Gate records the guided consent channel on the confirmation it performed', async (t) => {
  const root = await schemaV4Clone(t);
  const run = await guidedSetup(root, ['', 'yes']);

  assert.equal(run.exitCode, 0, run.terminal.output);

  const events = await eventsOf(root);
  const activation = events.filter((event) => event.type === 'activation');

  assert.equal(activation.length, 1);
  assert.equal(activation[0].outcome, 'succeeded');
  assert.deepEqual(activation[0].consent, { channel: GUIDED_CHANNEL, provenance: 'self-declared' });
  assert.equal(activation[0].actor.authenticated, false);
  assert.match(run.terminal.output, /consent channel: interactive-guided-setup, declared to the Gate, which records it as self-declared\./);
  assert.equal((await receiptOf(root)).includes(GUIDED_CHANNEL), false, 'the receipt carries the channel; only the event records it.');

  const direct = await activatedClone(t);

  assert.equal((await eventsOf(direct)).some((event) => 'consent' in event), false, 'a direct confirmation recorded a channel.');
});

test('TB-072 AC-GUIDE-001: every adoption state reaches Gate status with nothing further to do', async (t) => {
  const cases = [
    ['schema v4 without a Gate section', () => schemaV4Clone(t, { gate: false }), ['yes', '', 'yes'], ['configure-gate', 'activate']],
    ['configured', () => schemaV4Clone(t), ['', 'yes'], ['activate']],
    ['configuration drift', async () => {
      const root = await activatedClone(t);

      await writeFile(path.join(root, '.agent-framework.yaml'), schemaV4Configuration({ totalSeconds: 900 }), 'utf8');

      return root;
    }, ['yes'], ['sync']],
    ['hook drift', async () => {
      const root = await activatedClone(t);
      const receipt = JSON.parse(await receiptOf(root));

      await rm(receipt.hooks[0].path, { force: true });

      return root;
    }, ['yes'], ['repair']],
    ['runtime drift', async () => {
      const root = await activatedClone(t);
      const receiptPath = path.join(root, EVIDENCE, 'activation', 'receipt.json');
      const receipt = JSON.parse(await receiptOf(root));

      await writeFile(
        receiptPath,
        `${JSON.stringify({ ...receipt, runtime: { ...receipt.runtime, gate: { ...receipt.runtime.gate, protocolVersion: '0.9' } } }, null, 2)}\n`,
        'utf8',
      );

      return root;
    }, ['yes', '', 'yes'], ['activation-transaction', 'activate']],
  ];

  for (const [name, fixture, answers, steps] of cases) {
    const root = await fixture();
    const run = await guidedSetup(root, answers);

    assert.equal(run.exitCode, 0, `${name}: ${run.terminal.output}`);
    assert.equal(run.terminal.unanswered(), 0, name);
    assert.deepEqual(run.document.completed.map((step) => step.step), steps, name);
    await assertHealthy(root);

    // Every Gate confirmation recorded the channel it came through.
    const confirmed = (await eventsOf(root)).filter((event) => event.consent !== undefined);

    assert.ok(confirmed.length >= steps.filter((step) => step !== 'configure-gate').length, `${name}: ${JSON.stringify(confirmed)}`);
    assert.ok(confirmed.every((event) => event.consent.channel === GUIDED_CHANNEL && event.outcome === 'succeeded'), name);
  }
});

test('TB-072 AC-GUIDE-001: an activated, healthy clone asks nothing and changes nothing', async (t) => {
  const root = await activatedClone(t);
  const before = await cloneHash(root);
  const run = await guidedSetup(root, ['yes']);
  const again = await guidedSetup(root, ['yes']);

  assert.equal(run.exitCode, 0);
  assert.deepEqual(run.terminal.questions, []);
  assert.deepEqual(run.document.completed, []);
  assert.match(run.terminal.output, /^next: nothing$/m);
  assert.equal(again.terminal.output, run.terminal.output, 'a repeated guided run printed different text.');
  assert.equal(await cloneHash(root), before);
});

test('TB-072 AC-GUIDE-001 / FR-GUIDE-009: without the Gate module a schema v3 clone completes setup and states the Gate steps unavailable', async (t) => {
  const { entry } = await setupOnlyInstall(t);
  const { runFrameworkCommand: installed } = await import(pathToFileURL(entry).href);
  const root = await schemaV3Clone(t);
  const run = await guidedSetup(root, [...SCHEMA_V3_DECISIONS, 'yes', 'yes'], { run: installed });

  assert.equal(run.exitCode, 0, run.terminal.output);
  assert.equal(run.terminal.unanswered(), 1, 'a Gate step was asked for without the Gate module.');
  assert.deepEqual(run.document.completed.map((step) => step.step), ['migrate-schema-v4']);
  assert.equal(run.document.plan.state, 'schema-v4');
  assert.deepEqual(run.document.plan.unavailable, ['configure-gate', 'doctor', 'activate']);
  assert.match(run.terminal.output, /^unavailable: configure-gate, doctor, activate — Gate steps are unavailable because the Gate module is not installed\.$/m);
  assert.match(await configurationOf(root), /^schema_version: 4$/m);
  assert.equal(await receiptOf(root), null);
});

test('TB-072 SG-GUIDE-001: a clone with no configuration stops at base setup, which has no preview, naming its command', async (t) => {
  const root = await noConfigurationClone(t);
  const before = await cloneHash(root);
  const run = await guidedSetup(root, ['yes']);
  const plan = (await agentFramework(root, ['setup', '--json'])).document;

  assert.equal(run.exitCode, 1);
  assert.deepEqual(run.terminal.questions, []);
  assert.equal(run.document.stopped.step, 'configure-project');
  assert.equal(run.document.stopped.reasonCode, 'step-unpreviewed');
  assert.ok(run.document.stopped.detail.endsWith(plan.steps[0].commands[0].run), run.document.stopped.detail);
  assert.equal(await cloneHash(root), before);
});

/**
 * `AC-GUIDE-002`. Only an explicit `yes` confirms. Any other answer, or end of
 * input, confirms nothing, writes nothing further, and stops with the clone at
 * the last completed step; the next run asks again from there.
 */
test('TB-072 AC-GUIDE-002: an answer other than yes confirms nothing and stops at the last completed step', async (t) => {
  for (const answer of ['no', 'y', '', 'YES please', null]) {
    const root = await schemaV3Clone(t);
    const before = await cloneHash(root);
    const run = await guidedSetup(root, [...SCHEMA_V3_DECISIONS, ...(answer === null ? [] : [answer])]);

    assert.equal(run.exitCode, 1, JSON.stringify(answer));
    assert.equal(run.document.stopped.step, 'migrate-schema-v4');
    assert.equal(run.document.stopped.reasonCode, answer === null ? 'input-ended' : 'declined');
    assert.equal(await cloneHash(root), before, `${JSON.stringify(answer)} changed a byte.`);
  }

  // Migrated and configured, then declined at activation: the clone is left configured.
  const root = await schemaV3Clone(t);
  const run = await guidedSetup(root, [...SCHEMA_V3_DECISIONS, 'yes', 'yes', '', 'no']);
  const status = await gateJson(root, ['status']);

  assert.equal(run.exitCode, 1);
  assert.deepEqual(run.document.completed.map((step) => step.step), ['migrate-schema-v4', 'configure-gate']);
  assert.equal(run.document.stopped.step, 'activate');
  assert.equal(status.observation.state, 'configured');
  assert.equal(await receiptOf(root), null);
  assert.deepEqual(await eventsOf(root), []);

  // Consent is never remembered: the next run asks again, and without a yes confirms nothing.
  const again = await guidedSetup(root, ['']);

  assert.deepEqual(askedOf(again.terminal), ['decide client', 'confirm gate activate']);
  assert.equal(again.document.stopped.reasonCode, 'input-ended');
  assert.equal(await receiptOf(root), null);
});

/**
 * `AC-GUIDE-002`, `SG-GUIDE-001`. A yes binds the exact preview it answered:
 * a clone that changed between the preview and the answer is refused by the
 * owning operation, in its own words, and nothing is performed.
 */
test('TB-072 AC-GUIDE-002: a preview that changed before the yes is refused by the owning operation, in its words', async (t) => {
  const migrated = await schemaV3Clone(t);
  const configurationPath = path.join(migrated, '.agent-framework.yaml');
  const edited = async () => {
    await writeFile(configurationPath, `${await readFile(configurationPath, 'utf8')}# edited after the preview\n`, 'utf8');

    return 'yes';
  };
  const migration = await guidedSetup(migrated, [...SCHEMA_V3_DECISIONS, edited]);

  assert.equal(migration.exitCode, 1);
  assert.equal(migration.document.stopped.step, 'migrate-schema-v4');
  assert.equal(migration.document.stopped.detail, 'Migration confirmation does not match the current preview');
  assert.match(await configurationOf(migrated), /^schema_version: 3$/m);

  const activated = await schemaV4Clone(t);
  const moved = async () => {
    await writeFile(path.join(activated, '.agent-framework.yaml'), schemaV4Configuration({ totalSeconds: 900 }), 'utf8');

    return 'yes';
  };
  const activation = await guidedSetup(activated, ['', moved]);
  const refused = (await eventsOf(activated)).filter((event) => event.type === 'activation');

  assert.equal(activation.exitCode, 1);
  assert.equal(activation.document.stopped.step, 'activate');
  assert.equal(activation.document.stopped.reasonCode, 'preview-mismatch');
  assert.match(activation.document.stopped.detail, /^Nothing was activated \(preview-mismatch\): /);
  assert.equal(await receiptOf(activated), null);
  // The owning refusal is recorded, with the channel the refused confirmation came through.
  assert.equal(refused.length, 1);
  assert.equal(refused[0].outcome, 'refused');
  assert.deepEqual(refused[0].consent, { channel: GUIDED_CHANNEL, provenance: 'self-declared' });
});

/**
 * `SG-CFG-001`, `RISK-008`. An activated clone whose policy file was weakened
 * by hand reaches the `gate sync` remedy; the Gate refuses the weaker
 * candidate, and nothing is acknowledged or re-pinned until the weakening it
 * names is typed back — then its acknowledged preview is confirmed on yes.
 */
test('TB-072 SG-CFG-001: a weakening is refused until the maintainer types it back', async (t) => {
  const root = await activatedClone(t, { policy: TWO_CHECK_POLICY });
  const weakened = (await configurationOf(root)).replace(
    sectionLine('checks', TWO_CHECK_POLICY.checks),
    sectionLine('checks', { required: [], advisory: ['configuration.static-analysis.lint', 'configuration.broad-tests.test'] }),
  );
  const named = 'required-check-demoted configuration.broad-tests.test';

  await writeFile(path.join(root, '.agent-framework.yaml'), weakened, 'utf8');

  const receipt = await receiptOf(root);

  for (const answers of [['yes'], ['required-check-demoted'], []]) {
    const run = await guidedSetup(root, answers);

    assert.equal(run.exitCode, 1);
    assert.equal(run.document.stopped.reasonCode, 'weakening-unacknowledged', run.terminal.output);
    assert.deepEqual(askedOf(run.terminal), ['acknowledge the weakening']);
    assert.ok(run.terminal.questions[0].includes(`(${named})`), run.terminal.questions[0]);
    assert.equal(await receiptOf(root), receipt, 'a weakening was re-pinned without its acknowledgement.');
  }

  const run = await guidedSetup(root, [named, 'yes']);

  assert.equal(run.exitCode, 0, run.terminal.output);
  assert.deepEqual(askedOf(run.terminal), ['acknowledge the weakening', 'confirm gate sync']);
  assert.match(run.terminal.output, /"acknowledgedWeakening": true/);
  await assertHealthy(root);

  const synced = (await eventsOf(root)).at(-1);

  assert.equal(synced.outcome, 'succeeded');
  assert.deepEqual(synced.consent, { channel: GUIDED_CHANNEL, provenance: 'self-declared' });
});

test('TB-072: doctor predicting a stop ends the run at that step with its own reason, asking nothing', async (t) => {
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

  const before = await cloneHash(root);
  const doctor = await gateJson(root, ['doctor']);
  const run = await guidedSetup(root, ['', 'yes']);

  assert.equal(run.exitCode, 1);
  assert.deepEqual(run.terminal.questions, []);
  assert.equal(run.document.stopped.step, 'doctor');
  assert.equal(run.document.stopped.reasonCode, doctor.observation.verdict.stop.reasonCode);
  assert.ok(run.document.stopped.detail.endsWith(doctor.observation.verdict.stop.detail), run.document.stopped.detail);
  assert.equal(await cloneHash(root), before);
});

/**
 * `SG-GUIDE-001`, `FR-GUIDE-002`. Without the interactive flag — or with
 * `--json` — the entry prints exactly TB-067's plan, asks nothing, and
 * confirms nothing, whatever answers the terminal holds.
 */
test('TB-072 SG-GUIDE-001: without the interactive flag, or with --json, the plan is printed byte for byte and nothing is asked', async (t) => {
  for (const clone of [() => schemaV3Clone(t), () => schemaV4Clone(t), () => activatedClone(t)]) {
    const root = await clone();
    const before = await cloneHash(root);

    for (const [argv, interactive] of [[['setup'], false], [['setup', '--json'], false], [['setup', '--json'], true]]) {
      const run = await guidedSetup(root, [...SCHEMA_V3_DECISIONS, 'yes', 'yes', '', 'yes'], { argv, interactive });
      const printed = await agentFramework(root, argv);

      assert.equal(run.stdout, printed.stdout, `${argv.join(' ')} (interactive ${interactive}) differs from TB-067's plan.`);
      assert.equal(run.exitCode, printed.status);
      assert.equal(run.terminal.output, '');
      assert.deepEqual(run.terminal.questions, []);
    }

    assert.equal(await cloneHash(root), before);
  }
});

/**
 * `NFR-REL-004`. Twin fixtures — the same schema v3 clone at the same path,
 * one walked by guided setup, one by the direct command sequence a maintainer
 * types — end with byte-identical configuration, the same receipt apart from
 * the instants it records, the random identifiers of its self-test subjects,
 * and the receipt identity that hashes them, and the same Lifecycle events
 * apart from those; the recorded consent channel is the only other
 * difference.
 */
test('TB-072 NFR-REL-004: guided setup and the direct command sequence write the same configuration, receipt, and events', async (t) => {
  const root = await schemaV3Clone(t);
  const guided = await guidedSetup(root, [...SCHEMA_V3_DECISIONS, 'yes', 'yes', '', 'yes']);

  assert.equal(guided.exitCode, 0, guided.terminal.output);

  const throughGuide = { configuration: await configurationOf(root), receipt: await receiptOf(root), events: await eventsOf(root) };

  await rm(root, { recursive: true, force: true });
  await mkdir(root);
  await seedSchemaV3(await seedRepository(root));

  const scratch = await realpath(await mkdtemp(path.join(tmpdir(), 'agent-framework-direct-')));
  const mapping = path.join(scratch, 'mapping.json');
  const policy = path.join(scratch, 'policy.json');
  const configure = async (...argv) => {
    const result = await run(process.execPath, [CONFIGURE, '--project', root, ...argv], { cwd: root });

    assert.equal(result.status, 0, result.stderr);

    return JSON.parse(result.stdout);
  };

  t.after(() => rm(scratch, { recursive: true, force: true }));

  const drafted = await configure('--draft-mapping', '--out', mapping);

  drafted.profiles.backend = 'express-typescript';
  drafted.commands['verification.commands.test.backend[0]'].timeout_seconds = 60;
  await writeFile(mapping, JSON.stringify(drafted), 'utf8');
  await configure('--migrate-v4', '--mapping', mapping, '--confirm', (await configure('--migrate-v4', '--mapping', mapping)).previewHash);
  await configure('--draft-policy', '--out', policy);
  await configure('--configure-gate', '--policy', policy, '--confirm', (await configure('--configure-gate', '--policy', policy)).previewHash);
  assert.equal((await gateJson(root, ['doctor'])).observation.verdict.proceeds, true);

  const preview = await gateJson(root, ['activate']);

  assert.equal((await gateJson(root, ['activate', '--confirm', preview.observation.confirmationToken])).mutation.performed, true);

  const direct = { configuration: await configurationOf(root), receipt: await receiptOf(root), events: await eventsOf(root) };
  const INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
  const SUBJECT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
  const receiptBody = (text) => {
    const { receiptId, ...body } = JSON.parse(text.replace(INSTANT, '<instant>').replace(SUBJECT, '<subject>'));

    assert.match(receiptId, /^sha256:/);

    return body;
  };
  // An event names the receipt it wrote by that receipt's identity.
  const eventsBody = ({ receipt, events }) => events.map(({ eventId, occurredAt, consent, ...body }) => JSON.parse(JSON.stringify(body)
    .replaceAll(JSON.parse(receipt).receiptId, '<receipt>')
    .replace(INSTANT, '<instant>')
    .replace(SUBJECT, '<subject>')));

  assert.equal(throughGuide.configuration, direct.configuration);
  assert.deepEqual(receiptBody(throughGuide.receipt), receiptBody(direct.receipt));
  assert.deepEqual(throughGuide.events.map((event) => event.type), direct.events.map((event) => event.type));
  assert.deepEqual(eventsBody(throughGuide), eventsBody(direct));
  assert.ok(throughGuide.events.every((event) => event.consent?.channel === GUIDED_CHANNEL));
  assert.ok(direct.events.every((event) => event.consent === undefined));
});

test('TB-072 SG-GUIDE-002: no secret canary from the environment or a declared environment file appears in a guided run', async (t) => {
  const env = environment({ DB_PASSWORD: SECRET_CANARY });
  const root = await configuredClone(t, {
    policy: { ...CONFIGURED_POLICY, evidence: { sensitive_inputs: ['DB_PASSWORD'], environment_files: ['.env'] } },
    prepare: async (clone) => {
      await writeFile(path.join(clone, '.gitignore'), '.env\n', 'utf8');
      await writeFile(path.join(clone, '.env'), `DB_PASSWORD=${SECRET_CANARY}\n`, 'utf8');
    },
  });
  const run = await guidedSetup(root, ['', 'yes'], { env });

  assert.equal(run.exitCode, 0, run.terminal.output);
  assert.match(run.terminal.output, /DB_PASSWORD/);
  assert.equal(run.terminal.output.includes(SECRET_CANARY), false, 'the secret canary was printed.');
  assert.equal(JSON.stringify(run.document).includes(SECRET_CANARY), false, 'the secret canary is in the guided record.');
  assert.equal(JSON.stringify(await eventsOf(root)).includes(SECRET_CANARY), false, 'the secret canary was recorded.');
});

/**
 * The real terminal: interactive only when standard input and output are both
 * terminals, reading nothing until it asks, and reading end of input as
 * `null`. A pipe — CI, an agent — is never interactive.
 */
test('TB-072 GAP-004: the process terminal is interactive only on a terminal and reads answers line by line', async () => {
  const piped = processTerminal({ input: new PassThrough(), output: new PassThrough() });

  assert.equal(piped.interactive, false);
  piped.close();

  const input = new PassThrough();
  const output = new PassThrough();

  input.isTTY = true;
  output.isTTY = true;

  const terminal = processTerminal({ input, output });
  const written = [];

  output.on('data', (chunk) => written.push(chunk.toString()));
  assert.equal(terminal.interactive, true);
  input.write('express-typescript\nyes\n');
  assert.equal(await terminal.ask('first? '), 'express-typescript');
  assert.equal(await terminal.ask('second? '), 'yes');

  const third = terminal.ask('third? ');

  input.end();
  assert.equal(await third, null);
  assert.equal(await terminal.ask('fourth? '), null);
  terminal.write('done\n');
  terminal.close();
  assert.equal(written.join(''), 'first? second? third? fourth? done\n');
});

/* -------------------------------------------------------------------------
 * TB-073: `agent-framework report --html`.
 *
 * One static page built from the documents `setup --json` and
 * `config show --json` produce, with the doctor's findings as
 * `gate doctor --json` states them: written to the temporary directory or an
 * explicit path outside the clone, never over an existing file, never inside
 * the clone, and never holding a Sensitive runtime value (`FR-GUIDE-008`,
 * `AC-GUIDE-004`, `SG-GUIDE-001`, `SG-GUIDE-002`, `SG-SECRET-001`,
 * `RISK-006`). Each run gets its own `TMPDIR`, so everything a report writes
 * to the temporary directory can be listed.
 * ------------------------------------------------------------------------- */

/** A fresh, empty directory for the command to use as its temporary directory. */
const reportEnvironment = async (t, overrides = {}) => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'agent-framework-report-tmp-')));

  t.after(() => rm(temporary, { recursive: true, force: true }));

  return { temporary, env: environment({ TMPDIR: temporary, ...overrides }) };
};

/** The path a report run printed, or null. */
const reportedPath = (stdout) => stdout.match(/^report: (.+)$/m)?.[1] ?? null;

const decodeHtml = (text) => text
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text of the one element whose id is `id`, tags stripped and entities decoded; null when absent. */
const textOf = (page, id) => {
  const pattern = new RegExp(`<([a-z0-9]+)[^>]*\\sid="${escapeRegExp(id)}"[^>]*>([\\s\\S]*?)</\\1>`, 'g');
  const matches = [...page.matchAll(pattern)];

  assert.ok(matches.length <= 1, `more than one element has the id ${id}.`);

  return matches.length === 0 ? null : decodeHtml(matches[0][2].replace(/<[^>]*>/g, ''));
};

/** The page with its generation time taken out, which is all two reports of one clone may differ by. */
const withoutGenerationTime = (page) => page.replace(/<time id="generated" datetime="[^"]*">[^<]*<\/time>/, '<time id="generated"></time>');

/**
 * `report --html` in `root`, proving it changed nothing under the clone or
 * `.git`, printed nothing to standard error, and wrote exactly the one file it
 * names; returns the page.
 */
const writeReport = async (root, { env, argv = [], entry } = {}) => {
  const before = await cloneHash(root);
  const result = await agentFramework(root, ['report', '--html', ...argv], { env, entry });
  const written = reportedPath(result.stdout);

  assert.equal(await cloneHash(root), before, 'report changed a byte under the clone or .git.');
  assert.equal(result.stderr, '', result.stderr);
  assert.notEqual(written, null, result.stdout);
  assert.match(result.stdout, /^agent-framework report$/m);
  assert.ok(result.stdout.includes(`project: ${root}\n`), result.stdout);

  return { ...result, written, page: await readFile(written, 'utf8') };
};

/** How the page names a setup document's health and next step. */
const shownHealth = (plan) => plan.health ?? '(not reported)';

const shownNext = (plan) => (plan.next === null ? 'nothing' : (plan.next.command ?? plan.next.instruction));

/** The page shows the setup document's state, health, next step, and every step with its commands. */
const assertPageMatchesSetup = (page, plan) => {
  assert.equal(textOf(page, 'state'), plan.state ?? '(none)');
  assert.equal(textOf(page, 'health'), shownHealth(plan));
  assert.equal(textOf(page, 'next'), shownNext(plan));

  for (const [index, step] of plan.steps.entries()) {
    const shown = textOf(page, `step-${index + 1}`);

    assert.ok(shown.startsWith(`${step.id} (${step.owner})`), shown);

    for (const entry of step.commands) {
      assert.ok(shown.includes(`$ ${entry.run}`), `step ${step.id} does not show ${entry.run}.`);
    }
  }

  assert.equal(textOf(page, `step-${plan.steps.length + 1}`), null);
};

/** The page shows each value of the config show document, and its marking, by subcontract and key. */
const assertPageMatchesConfiguration = (page, shown) => {
  for (const subcontract of shown.subcontracts) {
    for (const value of subcontract.values) {
      const id = `configuration.${subcontract.name}.${value.key}`;

      assert.equal(textOf(page, id), value.declared ? JSON.stringify(value.value) : '(not set)', id);
      assert.ok(textOf(page, `${id}.marking`).startsWith(value.marking ?? 'not compared'), id);
    }
  }

  for (const input of shown.runtimeInputs?.resolved ?? []) {
    assert.equal(textOf(page, `runtime-input.${input.name}`), `${input.name}: from ${input.source}`);
  }

  for (const input of shown.runtimeInputs?.unresolved ?? []) {
    assert.equal(textOf(page, `runtime-input.${input.name}`), `${input.name}: unresolved — no source sets it`);
  }

  assert.equal(textOf(page, 'configuration-failure'), shown.failure === null ? null : `failed: ${shown.failure.reasonCode} — ${shown.failure.detail}`);
};

/**
 * THE FIRST RED TEST OF TB-073.
 *
 * On an activated clone `report --html` prints a path under the temporary
 * directory, the only file written there, and that page holds the clone's
 * health and its next step exactly as `setup --json` names them — where before
 * this slice `report` was refused with the usage (`AC-GUIDE-004`,
 * `FR-GUIDE-008`).
 */
test('TB-073 AC-GUIDE-004: on an activated clone report --html writes one page under the temporary directory with the health and next step', async (t) => {
  const { temporary, env } = await reportEnvironment(t);
  const root = await activatedClone(t);
  const report = await writeReport(root, { env });
  const plan = (await agentFramework(root, ['setup', '--json'], { env })).document;

  assert.equal(report.status, 0, report.stdout);
  assert.equal(path.dirname(report.written), temporary);
  assert.match(path.basename(report.written), /^agent-framework-report-.+\.html$/);
  assert.deepEqual(await readdir(temporary), [path.basename(report.written)]);
  assert.equal(plan.health, 'healthy');
  assert.equal(textOf(report.page, 'health'), 'healthy');
  assert.equal(textOf(report.page, 'next'), 'nothing');
  assertPageMatchesSetup(report.page, plan);
});

test('TB-073 AC-GUIDE-004: the page\'s state, health, steps, and next step equal setup --json for the same clone', async (t) => {
  const { env } = await reportEnvironment(t);
  const drifted = await activatedClone(t);

  await writeFile(path.join(drifted, '.agent-framework.yaml'), schemaV4Configuration({ totalSeconds: 900 }), 'utf8');

  for (const root of [drifted, await schemaV4Clone(t)]) {
    const report = await writeReport(root, { env });
    const plan = (await agentFramework(root, ['setup', '--json'], { env })).document;

    assert.notEqual(plan.next, null);
    assert.equal(report.status, 1, report.stdout);
    assertPageMatchesSetup(report.page, plan);

    if (plan.doctor !== null) {
      assert.equal(textOf(report.page, 'setup-doctor'), plan.doctor.proceeds ? 'activation would proceed' : `activation would stop (${plan.doctor.stop.reasonCode})`);
    }
  }
});

test('TB-073 AC-GUIDE-004: the page\'s configuration equals config show --json, and the doctor\'s findings are the Gate\'s own', async (t) => {
  const { env } = await reportEnvironment(t);
  const root = await activatedClone(t);

  await writeFile(path.join(root, '.agent-framework.yaml'), schemaV4Configuration({ dependencyRoots: ['vendor'] }), 'utf8');

  const report = await writeReport(root, { env });
  const shown = (await agentFramework(root, ['config', 'show', '--json'], { env })).document;
  const doctor = (await gateJson(root, ['doctor'], env)).observation;

  assert.equal(valueAt(shown, 'execution.dependency_roots').marking, 'differs');
  assertPageMatchesConfiguration(report.page, shown);
  assert.match(textOf(report.page, 'configuration.execution.dependency_roots.marking'), /^differs from the pinned value \(not set\); added vendor$/);
  assert.equal(textOf(report.page, 'doctor-verdict'), doctor.verdict.proceeds
    ? 'activation would proceed'
    : `activation would stop at ${doctor.verdict.stop.step} (${doctor.verdict.stop.reasonCode})`);
  assert.equal(textOf(report.page, 'doctor-roots'), 'vendor: link, missing');
});

test('TB-073 AC-GUIDE-004: an explicit --out outside the clone is written exactly there, and an existing target is refused untouched', async (t) => {
  const { temporary, env } = await reportEnvironment(t);
  const root = await schemaV4Clone(t);
  const elsewhere = await realpath(await mkdtemp(path.join(tmpdir(), 'agent-framework-report-out-')));
  const target = path.join(elsewhere, 'gate.html');

  t.after(() => rm(elsewhere, { recursive: true, force: true }));

  const report = await writeReport(root, { env, argv: ['--out', target] });

  assert.equal(report.written, target);
  assert.deepEqual(await readdir(elsewhere), ['gate.html']);
  assert.deepEqual(await readdir(temporary), [], 'a report with --out wrote to the temporary directory.');
  assert.match(report.page, /^<!doctype html>/);

  // Never overwritten: the second run is refused, writes nothing, and the page is the first one.
  const before = await cloneHash(root);
  const again = await agentFramework(root, ['report', '--html', '--out', target], { env });

  assert.equal(again.status, 2);
  assert.match(again.stdout, /^failed: report-target-exists — /m);
  assert.equal(reportedPath(again.stdout), null);
  assert.equal(await readFile(target, 'utf8'), report.page);
  assert.deepEqual(await readdir(elsewhere), ['gate.html']);
  assert.deepEqual(await readdir(temporary), []);
  assert.equal(await cloneHash(root), before);

  // A directory that does not exist is not created.
  const missing = await agentFramework(root, ['report', '--html', '--out', path.join(elsewhere, 'absent', 'gate.html')], { env });

  assert.equal(missing.status, 2);
  assert.match(missing.stdout, /^failed: report-directory-missing — /m);
  assert.deepEqual(await readdir(elsewhere), ['gate.html']);
});

test('TB-073 SG-GUIDE-002: an --out inside the clone is refused, through a symlink and through .., with nothing written anywhere', async (t) => {
  const { temporary, env } = await reportEnvironment(t);
  const root = await schemaV4Clone(t);
  const links = await realpath(await mkdtemp(path.join(tmpdir(), 'agent-framework-report-links-')));

  t.after(() => rm(links, { recursive: true, force: true }));
  await symlink(root, path.join(links, 'clone'));
  await symlink(path.join(root, 'app'), path.join(links, 'app'));

  const before = await cloneHash(root);
  const insides = [
    ['report.html'],
    [path.join(root, 'report.html')],
    [path.join(root, '.git', 'report.html')],
    [`${root}/app/../report.html`],
    [path.join(links, 'clone', 'report.html')],
    // The OS resolves the link before `..`: this is the clone, though the text says `links`.
    [`${links}/app/../report.html`],
    [root],
  ];

  for (const [out] of insides) {
    const refused = await agentFramework(root, ['report', '--html', '--out', out], { env });

    assert.equal(refused.status, 2, `${out}: ${refused.stdout}`);
    assert.match(refused.stdout, /^failed: report-inside-clone — /m, out);
    assert.equal(reportedPath(refused.stdout), null);
  }

  // The temporary directory inside the clone is refused the same way.
  const temporaryInside = await agentFramework(root, ['report', '--html'], { env: environment({ TMPDIR: path.join(root, 'app') }) });

  assert.equal(temporaryInside.status, 2);
  assert.match(temporaryInside.stdout, /^failed: report-inside-clone — /m);
  assert.equal(await cloneHash(root), before);
  assert.deepEqual(await readdir(temporary), []);
  assert.deepEqual((await readdir(links)).sort(), ['app', 'clone']);
});

test('TB-073 AC-GUIDE-004: the page references nothing outside itself and holds no script or control', async (t) => {
  const { env } = await reportEnvironment(t);
  const root = await activatedClone(t);
  const { page } = await writeReport(root, { env });

  assert.match(page, /^<!doctype html>\n<html lang="en">/);
  assert.match(page, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">/);
  assert.doesNotMatch(page, /https?:/i, 'the page names an http or https URL.');
  assert.doesNotMatch(page, /["'(=\s]\/\/[^\s]/, 'the page holds a protocol-relative reference.');
  assert.doesNotMatch(page, /\b(?:src|href|srcset|action|poster|data)\s*=/i, 'the page references a resource.');
  assert.doesNotMatch(page, /url\(|@import|@font-face/i, 'the style references a resource.');
  assert.doesNotMatch(page, /<(?:script|link|img|iframe|object|embed|svg|video|audio|source|form|input|button|select|textarea|details|a)\b/i);
  assert.doesNotMatch(page, /\son[a-z]+\s*=/i, 'the page holds an event handler.');
});

test('TB-073: every interpolated string is escaped, so a path holding <script> and a quote is inert', async (t) => {
  const { env } = await reportEnvironment(t);
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'agent-framework-<script>alert("x")<\\script>-\'-')));

  t.after(() => rm(root, { recursive: true, force: true }));
  await seedRepository(root);
  await writeFile(path.join(root, '.agent-framework.yaml'), schemaV4Configuration(), 'utf8');
  await commit(root);

  const { page } = await writeReport(root, { env });
  const plan = (await agentFramework(root, ['setup', '--json'], { env })).document;

  assert.equal(page.includes('<script'), false, 'a <script> from the path reached the page unescaped.');
  assert.ok(page.includes('&lt;script&gt;alert(&quot;x&quot;)'), 'the path is not shown escaped.');
  assert.equal(textOf(page, 'project'), root);
  assertPageMatchesSetup(page, plan);
});

/**
 * `SG-GUIDE-002`, `SG-SECRET-001`, `RISK-006`. A canary set in the
 * environment and in a declared, git-ignored `.env` appears nowhere in the page
 * or the output, and the inputs are shown by name and source.
 */
test('TB-073 SG-SECRET-001 / RISK-006: no secret canary from the environment or .env appears in the page or the output', async (t) => {
  const { env } = await reportEnvironment(t, { APP_KEY: SECRET_CANARY });
  const root = await activatedClone(t, {
    env,
    evidence: { sensitive_inputs: ['APP_KEY', 'DB_PASSWORD'], environment_files: ['.env'] },
    prepare: async (clone) => {
      await writeFile(path.join(clone, '.gitignore'), '.env\n', 'utf8');
      await writeFile(path.join(clone, '.env'), `APP_KEY=${SECRET_CANARY}-shadowed\nDB_PASSWORD=${SECRET_CANARY}-file\n`, 'utf8');
    },
  });
  const report = await writeReport(root, { env });

  for (const output of [report.page, report.stdout, report.stderr]) {
    assert.equal(output.includes(SECRET_CANARY), false, 'the secret canary was written.');
  }

  assert.equal(textOf(report.page, 'runtime-input.APP_KEY'), 'APP_KEY: from environment');
  assert.equal(textOf(report.page, 'runtime-input.DB_PASSWORD'), 'DB_PASSWORD: from .env');
  assertPageMatchesConfiguration(report.page, (await agentFramework(root, ['config', 'show', '--json'], { env })).document);
});

test('TB-073: apart from its generation time the page is the same on every run, and the output differs only by the path', async (t) => {
  const { env } = await reportEnvironment(t);
  const root = await activatedClone(t);
  const first = await writeReport(root, { env });
  const second = await writeReport(root, { env });

  assert.notEqual(first.written, second.written, 'two reports went to the same file.');
  assert.equal(withoutGenerationTime(second.page), withoutGenerationTime(first.page));
  assert.notEqual(withoutGenerationTime(first.page), first.page);
  assert.equal(second.stdout.replace(second.written, '<path>'), first.stdout.replace(first.written, '<path>'));
  assert.match(textOf(first.page, 'generated'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  // The page says how to regenerate it, and that command writes a fresh page.
  const regenerate = textOf(first.page, 'regenerate');
  const regenerated = await pasteIntoShell(root, regenerate, env);

  assert.equal(regenerated.status, 0, regenerated.stderr);
  assert.equal(withoutGenerationTime(await readFile(reportedPath(regenerated.stdout), 'utf8')), withoutGenerationTime(first.page));
});

test('TB-073 FR-GUIDE-009: a schema v3 clone, an unconfigured clone, and a missing Gate module each get an honest page', async (t) => {
  const { env } = await reportEnvironment(t);

  for (const root of [await schemaV3Clone(t), await schemaV4Clone(t, { gate: false })]) {
    const report = await writeReport(root, { env });
    const plan = (await agentFramework(root, ['setup', '--json'], { env })).document;

    assert.equal(report.status, 1);
    assertPageMatchesSetup(report.page, plan);
    assert.equal(textOf(report.page, 'configuration-none'), 'section: none — .agent-framework.yaml has no Gate configuration section.');
    assert.match(textOf(report.page, 'doctor-unasked'), /^not asked — gate doctor answers for a configured Gate section, and this clone is (schema-v3|gate-unconfigured)\.$/);
  }

  const { entry } = await setupOnlyInstall(t);
  const configured = await schemaV4Clone(t);
  const report = await writeReport(configured, { env, entry });
  const plan = (await agentFramework(configured, ['setup', '--json'], { env, entry })).document;
  const shown = (await agentFramework(configured, ['config', 'show', '--json'], { env, entry })).document;

  assert.equal(report.status, 1);
  assertPageMatchesSetup(report.page, plan);
  assert.equal(plan.gate.available, false);
  assert.match(textOf(report.page, 'gate'), /^unavailable — /);
  assert.equal(textOf(report.page, 'unavailable'), 'unavailable: configure-gate, doctor, activate — Gate steps are unavailable because the Gate module is not installed.');
  assert.equal(shown.failure.reasonCode, 'gate-unavailable');
  assertPageMatchesConfiguration(report.page, shown);
  assert.match(textOf(report.page, 'doctor-unasked'), /^not asked — the Gate module is unavailable: /);
});

test('TB-073: report takes --html, --out, and --project only, and is in the usage', async (t) => {
  const { temporary, env } = await reportEnvironment(t);
  const root = await noConfigurationClone(t);
  const before = await cloneHash(root);

  for (const argv of [['report'], ['report', '--json'], ['report', '--html', '--json'], ['report', '--html', '--out'], ['report', '--out', '/x.html'], ['report', '--html', '--confirm', 'x']]) {
    const result = await run(process.execPath, [ENTRY, ...argv], { cwd: root, env });

    assert.equal(result.status, 2, `${argv.join(' ')} exited ${result.status}.`);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /agent-framework report --html \[--out <path>\] \[--project <directory>\]/);
  }

  assert.equal(await cloneHash(root), before);
  assert.deepEqual(await readdir(temporary), []);
});

/* -------------------------------------------------------------------------
 * FS-005: base setup never rewrites a schema v4 configuration as v3.
 *
 * `configure.mjs --tracker …` writes a schema v3 file from discovery. On a
 * schema v4 file that silently dropped the Command descriptors, the mapped
 * profiles, and the Gate section; it is now refused with its own reason and
 * nothing is written.
 * ---------------------------------------------------------------------- */

const MANAGED_FILES = [
  '.agent-framework.yaml',
  'docs/agents/issue-tracker.md',
  'docs/agents/domain.md',
  'docs/agents/triage-labels.md',
];

const baseSetup = (root) => run(process.execPath, [CONFIGURE, '--project', root, '--tracker', 'local-markdown'], { cwd: root });

/** Each managed file's bytes, `null` when absent. */
const managedBytes = (root) => Promise.all(MANAGED_FILES.map((file) => readFile(path.join(root, file)).catch(() => null)));

/** Every AGENTS.md discovery reports, with its bytes. */
const discoveredAgents = async (root) => {
  const { protectedFiles } = await discoverProject(root);

  return Promise.all(protectedFiles.map(async (file) => [file, await readFile(path.join(root, file))]));
};

/** THE FIRST RED TEST: a schema v4 file with a Gate section is refused and kept byte for byte. */
test('FS-005: base setup on a schema v4 file with a Gate section exits non-zero and leaves its bytes unchanged', async (t) => {
  const root = await configuredClone(t);
  const before = await readFile(path.join(root, '.agent-framework.yaml'));
  const result = await baseSetup(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.deepEqual(await readFile(path.join(root, '.agent-framework.yaml')), before);
});

const SCHEMA_V4_FIXTURES = Object.freeze([
  ['a clone with no Gate section', (t) => schemaV4Clone(t, { gate: false }), 'gate-unconfigured'],
  ['a clone with a configured Gate section', (t) => configuredClone(t), 'configured'],
  ['an activated clone', (t) => activatedClone(t, { policy: CONFIGURED_POLICY }), 'activated'],
]);

for (const [name, fixture, state] of SCHEMA_V4_FIXTURES) {
  test(`FS-005: base setup refuses the schema v4 file of ${name}, writing no managed file and no AGENTS.md`, async (t) => {
    const root = await fixture(t);

    // A nested instruction file, and tracker documents a maintainer already
    // edited, so a write to any of them would show.
    await mkdir(path.join(root, 'packages', 'module'), { recursive: true });
    await writeFile(path.join(root, 'packages', 'module', 'AGENTS.md'), 'module-owned instructions\n', 'utf8');
    await mkdir(path.join(root, 'docs', 'agents'), { recursive: true });

    for (const file of MANAGED_FILES.slice(1)) {
      await writeFile(path.join(root, file), `maintainer-edited ${file}\n`, 'utf8');
    }

    const agents = await discoveredAgents(root);
    const managed = await managedBytes(root);
    const before = await cloneHash(root);

    assert.deepEqual(agents.map(([file]) => file), ['AGENTS.md', 'packages/module/AGENTS.md']);

    const result = await baseSetup(root);
    const refusal = JSON.parse(result.stdout);

    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(Object.keys(refusal), ['status', 'reasonCode', 'detail']);
    assert.equal(refusal.status, 'refused');
    assert.equal(refusal.reasonCode, 'schema-v4-configured');
    assert.match(refusal.detail, /declares schema version 4, and base setup writes schema version 3/);
    assert.match(refusal.detail, /Nothing was written\./);
    assert.match(refusal.detail, /agent-framework config <revision>/);

    await assert.rejects(
      configureProject({ projectRoot: root, selections: { tracker: 'local-markdown' } }),
      (error) => error.reasonCode === 'schema-v4-configured' && error.message === refusal.detail,
    );

    assert.equal(await cloneHash(root), before, 'a refused base setup changed a byte under the clone or .git.');
    assert.deepEqual(await managedBytes(root), managed);
    assert.deepEqual(await discoveredAgents(root), agents);
    assert.equal((await agentFramework(root, ['setup', '--json'])).document.state, state);
  });
}

test('FS-005: base setup refuses a schema version above 4 as unsupported, writing nothing', async (t) => {
  const root = await noConfigurationClone(t);

  for (const version of [5, 12]) {
    await writeFile(
      path.join(root, '.agent-framework.yaml'),
      `schema_version: ${version}\nbackend: laravel\nfrontend: none\ntracker: local-markdown\n`,
      'utf8',
    );

    const before = await cloneHash(root);
    const result = await baseSetup(root);
    const refusal = JSON.parse(result.stdout);

    assert.equal(result.status, 2, result.stderr);
    assert.equal(refusal.status, 'refused');
    assert.equal(refusal.reasonCode, 'schema-unsupported');
    assert.match(refusal.detail, new RegExp(`declares schema version ${version}`));
    assert.match(refusal.detail, /Nothing was written\./);

    await assert.rejects(
      configureProject({ projectRoot: root, selections: { tracker: 'local-markdown' } }),
      (error) => error.reasonCode === 'schema-unsupported' && error.message === refusal.detail,
    );

    assert.equal(await cloneHash(root), before, `a refused base setup on schema ${version} changed a byte.`);
  }
});

test('FS-005 AC: setup --json on a schema v4 clone names no base setup step, with or without the Gate module', async (t) => {
  const { entry } = await setupOnlyInstall(t);
  const clones = [
    ...await Promise.all(SCHEMA_V4_FIXTURES.map(([, fixture]) => fixture(t))).then((roots) => roots.map((root) => [root, {}])),
    [await schemaV4Clone(t, { gate: false }), { entry }],
    [await configuredClone(t), { entry }],
  ];

  for (const [root, options] of clones) {
    const { plan } = await observeSetup(root, options);

    assert.equal(plan.failure ?? null, null);
    assert.equal(commandsOf(plan).includes('configure-project'), false, `${plan.state} names base setup.`);
    assert.equal(
      plan.steps.some((step) => step.commands.some((command) => command.argv.includes('--tracker'))),
      false,
      `${plan.state} names a --tracker command.`,
    );
  }
});

test('FS-005: base setup on no configuration, then on its own schema v3 file, writes as before and repeats byte for byte', async (t) => {
  const root = await noConfigurationClone(t);
  const agents = await discoveredAgents(root);
  const first = await baseSetup(root);

  assert.equal(first.status, 0, first.stderr);
  assert.match(await configurationOf(root), /^schema_version: 3$/m);

  const written = await managedBytes(root);

  assert.equal(written.includes(null), false);

  const repeated = await baseSetup(root);

  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(repeated.stdout, first.stdout);
  assert.deepEqual(await managedBytes(root), written);
  assert.deepEqual(await discoveredAgents(root), agents);

  // Schema v2 is still rewritten as v3 by base setup; its confirmation is the
  // maintainer's, asked by the skill before the command runs.
  await writeFile(path.join(root, '.agent-framework.yaml'), 'schema_version: 2\nbackend: unknown\nfrontend: none\n', 'utf8');

  const fromV2 = await baseSetup(root);

  assert.equal(fromV2.status, 0, fromV2.stderr);
  assert.deepEqual(await managedBytes(root), written);
});
