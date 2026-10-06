import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runOperatorCommand } from '../skills/change-evaluation-gate/scripts/lib/operator-surface.mjs';

/**
 * Registering the destructive-command guardrail with Cursor (FS-007).
 *
 * Every run is `agent-framework guardrail … cursor` or `configure.mjs
 * --guardrail … --client cursor` as a child process, from a copy of the
 * `framework-setup` skill installed inside a throwaway repository, as a
 * teammate's clone would hold it. The Gate's own entry in `.cursor/hooks.json`
 * is the neighbour every test keeps byte for byte.
 */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETUP_SKILL = path.join(FRAMEWORK_ROOT, 'skills', 'framework-setup');
const SOURCE_ENTRY = path.join(SETUP_SKILL, 'scripts', 'agent-framework.mjs');
const INSTALLED = '.claude/skills/framework-setup';
const SCRIPT = `${INSTALLED}/scripts/guardrail.mjs`;
const HOOKS_FILE = '.cursor/hooks.json';

/** The entry `guardrail add cursor` writes: Cursor's flat `{command}`, run from the project root Cursor runs hooks in. */
const entry = (script = SCRIPT) => ({ command: `node ${script} --client cursor` });

/** A Gate entry as the Gate's Cursor adapter registers one. */
const GATE_ENTRY = { command: '"/usr/local/bin/node" "/opt/gate/scripts/gate-precommit.mjs" "--adapter" "cursor"' };

const environment = {
  ...process.env,
  PATH: [path.dirname(process.execPath), ...(process.env.PATH ?? '').split(path.delimiter)].join(path.delimiter),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

const run = (program, argv, { cwd, input = '', env = environment }) => new Promise((resolve) => {
  const child = execFile(program, argv, { cwd, env, encoding: 'utf8' }, (error, stdout, stderr) => {
    resolve({ status: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout, stderr });
  });

  child.stdin.end(input);
});

const git = (root, args) => run('git', args, { cwd: root });

/** A throwaway Git repository holding `framework-setup` at `installed`, and an `AGENTS.md`. */
const repository = async (t, { installed = INSTALLED, prefix = 'guardrail-cursor-' } = {}) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));

  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ['init', '--quiet']);
  await writeFile(path.join(root, 'AGENTS.md'), '# Agents\n\nKeep this byte for byte.\n');

  if (installed !== null) {
    await cp(SETUP_SKILL, path.join(root, installed), { recursive: true });
  }

  return root;
};

const entryIn = (root, installed = INSTALLED) => path.join(root, installed, 'scripts', 'agent-framework.mjs');

const configureIn = (root, installed = INSTALLED) => path.join(root, installed, 'scripts', 'configure.mjs');

/** `agent-framework guardrail <argv>` in `root`, with its parsed `--json` document. */
const guardrail = async (root, argv, { entry: script = entryIn(root) } = {}) => {
  const result = await run(process.execPath, [script, 'guardrail', ...argv, '--json'], { cwd: root });

  return { ...result, document: JSON.parse(result.stdout) };
};

/** Every file and directory of the clone, `.git` included, as one hash. */
const cloneHash = async (root) => {
  const hash = createHash('sha256');
  const walk = async (directory) => {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const found of entries) {
      const absolute = path.join(directory, found.name);

      hash.update(`${path.relative(root, absolute)}\0`);

      if (found.isDirectory()) {
        hash.update('<directory>\0');
        await walk(absolute);
      } else if (found.isFile()) {
        hash.update(await readFile(absolute));
        hash.update('\0');
      }
    }
  };

  await walk(root);

  return hash.digest('hex');
};

const hooksPath = (root) => path.join(root, HOOKS_FILE);

const readHooks = (root) => readFile(hooksPath(root), 'utf8');

const writeHooks = async (root, contents) => {
  await mkdir(path.dirname(hooksPath(root)), { recursive: true });
  await writeFile(hooksPath(root), contents);
};

const json = (value, indent = 2) => `${JSON.stringify(value, null, indent)}\n`;

/** Preview, then confirm with the preview's own token. */
const confirmed = async (root, operation, options = {}) => {
  const preview = await guardrail(root, [operation, 'cursor'], options);

  assert.equal(preview.status, 1, preview.stdout);

  const applied = await guardrail(root, [operation, 'cursor', '--confirm', preview.document.previewHash], options);

  assert.equal(applied.status, 0, applied.stdout);

  return { preview, applied };
};

/**
 * Run the registered entry as the observation saw Cursor run one: its command
 * string, in the project root, with `CURSOR_PROJECT_DIR` set and the payload on
 * standard input.
 */
const runRegisteredEntry = async (root, command) => {
  const registered = JSON.parse(await readHooks(root)).hooks.beforeShellExecution.at(-1);

  return run('sh', ['-c', registered.command], {
    cwd: root,
    env: { ...environment, CURSOR_PROJECT_DIR: root },
    input: JSON.stringify({ command, cwd: '', hook_event_name: 'beforeShellExecution', workspace_roots: [root], user_email: 'someone@example.test' }),
  });
};

test('FS-007: guardrail add cursor previews a new .cursor/hooks.json with "version": 1, writes nothing, and creates it only with the token', async (t) => {
  const root = await repository(t);
  const before = await cloneHash(root);
  const preview = await guardrail(root, ['add', 'cursor']);
  const again = await guardrail(root, ['add', 'cursor']);

  assert.equal(await cloneHash(root), before, 'a preview wrote to the clone.');
  assert.equal(again.stdout, preview.stdout, 'a repeated preview printed something else.');
  assert.equal(preview.status, 1);
  assert.equal(preview.document.client, 'cursor');
  assert.equal(preview.document.created, true);
  assert.equal(preview.document.file, HOOKS_FILE);
  assert.equal(preview.document.event, 'beforeShellExecution');
  assert.equal(preview.document.script, SCRIPT);
  assert.deepEqual(preview.document.entry, entry());
  assert.match(preview.document.next.command, /guardrail add cursor .*--confirm [0-9a-f]{64}$/);

  const { applied } = await confirmed(root, 'add');
  const written = await readHooks(root);

  assert.equal(applied.document.applied, true);
  assert.equal(written, json({ version: 1, hooks: { beforeShellExecution: [entry()] } }));
  assert.equal(written, preview.document.proposedSettings);
  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), '# Agents\n\nKeep this byte for byte.\n');

  const blocked = await runRegisteredEntry(root, 'git reset --hard');
  const message = "BLOCKED: 'git reset --hard' matches dangerous pattern 'git reset --hard'. The user has prevented you from doing this.";

  assert.deepEqual(blocked, {
    status: 0,
    stdout: `${JSON.stringify({ permission: 'deny', userMessage: message, agentMessage: message })}\n`,
    stderr: '',
  });
  assert.deepEqual(await runRegisteredEntry(root, 'echo hello'), { status: 0, stdout: '{"permission":"allow"}\n', stderr: '' });

  // Removing it leaves the file Cursor reads, with its version and no hook.
  await confirmed(root, 'remove');
  assert.equal(await readHooks(root), json({ version: 1, hooks: {} }));
});

test('FS-007: add sits beside the Gate\'s entry without changing a byte of it, and remove restores the file exactly', async (t) => {
  for (const indent of [2, 4, '\t']) {
    const root = await repository(t);
    const original = json({ version: 1, hooks: { stop: [GATE_ENTRY] } }, indent);
    const gateEntryText = JSON.stringify(GATE_ENTRY, null, indent).split('\n').map((line) => `${typeof indent === 'number' ? ' '.repeat(indent * 3) : '\t\t\t'}${line}`).join('\n').trimStart();

    await writeHooks(root, original);

    const { preview } = await confirmed(root, 'add');
    const added = await readHooks(root);

    assert.equal(preview.document.created, false);
    assert.deepEqual(preview.document.changes.removed, [], `${indent}: the preview removes a line.`);
    assert.deepEqual(JSON.parse(added), { version: 1, hooks: { stop: [GATE_ENTRY], beforeShellExecution: [entry()] } });
    assert.equal(added, json(JSON.parse(added), indent), `${indent}: the file's own indentation was not kept.`);
    assert.ok(added.includes(gateEntryText), `${indent}: the Gate's entry is not byte for byte as it was.`);

    await confirmed(root, 'remove');

    assert.equal(await readHooks(root), original, `${indent}: remove did not restore the file.`);
  }
});

test('FS-007: the seeded file the skill documents round-trips through add and remove, and a file without a version keeps none', async (t) => {
  const seeded = await repository(t);
  const seed = '{\n  "version": 1,\n  "hooks": {}\n}\n';

  await writeHooks(seeded, seed);
  await confirmed(seeded, 'add');
  assert.deepEqual(JSON.parse(await readHooks(seeded)), { version: 1, hooks: { beforeShellExecution: [entry()] } });
  await confirmed(seeded, 'remove');
  assert.equal(await readHooks(seeded), seed);

  const unversioned = await repository(t);

  await writeHooks(unversioned, '{\n  "hooks": {\n    "stop": []\n  }\n}');
  await confirmed(unversioned, 'add');
  assert.equal(await readHooks(unversioned), `${JSON.stringify({ hooks: { stop: [], beforeShellExecution: [entry()] } }, null, 2)}`);
});

test('FS-007: every refusal states its reason, exits 2, and leaves the clone byte for byte', async (t) => {
  const registered = await repository(t);

  await confirmed(registered, 'add');

  const gateFile = json({ version: 1, hooks: { stop: [GATE_ENTRY] } });
  const cases = [
    ['duplicate add', registered, ['add', 'cursor'], 'guardrail-registered'],
    ['remove with nothing registered', await repository(t), ['remove', 'cursor'], 'guardrail-not-registered', gateFile],
    ['remove with no file', await repository(t), ['remove', 'cursor'], 'guardrail-not-registered'],
    ['an entry registered twice', await repository(t), ['remove', 'cursor'], 'guardrail-ambiguous', json({ version: 1, hooks: { beforeShellExecution: [entry(), entry()] } })],
    ['unparseable file', await repository(t), ['add', 'cursor'], 'settings-unparseable', '{ "version": 1, "hooks": '],
    ['compact JSON', await repository(t), ['add', 'cursor'], 'settings-unrevisable', '{"version":1,"hooks":{}}'],
    ['a key declared twice', await repository(t), ['add', 'cursor'], 'settings-unrevisable', '{\n  "version": 1,\n  "version": 1\n}\n'],
    ['mixed indentation', await repository(t), ['add', 'cursor'], 'settings-unrevisable', '{\n  "version": 1,\n    "hooks": {}\n}\n'],
    ['hooks that are not an object', await repository(t), ['add', 'cursor'], 'settings-unrevisable', json({ version: 1, hooks: [] })],
    ['beforeShellExecution that is not a list', await repository(t), ['add', 'cursor'], 'settings-unrevisable', json({ version: 1, hooks: { beforeShellExecution: {} } })],
    ['a top level that is not an object', await repository(t), ['add', 'cursor'], 'settings-unrevisable', '[]\n'],
    ['a stale token', await repository(t), ['add', 'cursor', '--confirm', '0'.repeat(64)], 'preview-mismatch', gateFile],
    ['a client not supported yet', await repository(t), ['add', 'codex'], 'client-unsupported'],
  ];

  for (const [name, root, argv, reasonCode, contents] of cases) {
    if (contents !== undefined) {
      await writeHooks(root, contents);
    }

    const before = await cloneHash(root);
    const refused = await guardrail(root, argv);

    assert.equal(refused.status, 2, `${name}: ${refused.stdout}`);
    assert.equal(refused.document.failure.reasonCode, reasonCode, name);
    assert.equal(refused.document.applied, false, name);
    assert.equal(await cloneHash(root), before, `${name} changed the clone.`);
  }
});

test('FS-007: a skill outside the repository, one Git ignores, or one at a path Cursor\'s command string cannot name bare, is refused', async (t) => {
  const outside = await repository(t, { installed: null });
  const outsideBefore = await cloneHash(outside);
  const refusedOutside = await guardrail(outside, ['add', 'cursor', '--project', outside], { entry: SOURCE_ENTRY });

  assert.equal(refusedOutside.status, 2);
  assert.equal(refusedOutside.document.failure.reasonCode, 'guardrail-outside-project');
  assert.equal(await cloneHash(outside), outsideBefore);

  const ignored = await repository(t);

  await writeFile(path.join(ignored, '.gitignore'), '.claude/skills/\n');

  const ignoredBefore = await cloneHash(ignored);
  const refusedIgnored = await guardrail(ignored, ['add', 'cursor']);

  assert.equal(refusedIgnored.status, 2);
  assert.equal(refusedIgnored.document.failure.reasonCode, 'guardrail-ignored');
  assert.equal(await cloneHash(ignored), ignoredBefore);

  const spaced = await repository(t, { installed: 'tools/agent skills/framework-setup' });
  const spacedBefore = await cloneHash(spaced);
  const refusedSpaced = await guardrail(spaced, ['add', 'cursor'], { entry: entryIn(spaced, 'tools/agent skills/framework-setup') });

  assert.equal(refusedSpaced.status, 2);
  assert.equal(refusedSpaced.document.failure.reasonCode, 'guardrail-path-unsafe');
  assert.match(refusedSpaced.document.failure.detail, /tools\/agent skills\/framework-setup\/scripts\/guardrail\.mjs/);
  assert.equal(await cloneHash(spaced), spacedBefore);
});

test('FS-007: a project whose own path holds a space registers the same project-relative command, and it runs', async (t) => {
  const root = await repository(t, { prefix: 'guardrail cursor with spaces-' });

  await confirmed(root, 'add');

  assert.deepEqual(JSON.parse(await readHooks(root)).hooks.beforeShellExecution, [entry()]);
  assert.match((await runRegisteredEntry(root, 'git clean -fd')).stdout, /^\{"permission":"deny",/);
});

test('FS-007: configure.mjs --guardrail --client cursor is the same operation', async (t) => {
  const throughFramework = await repository(t);
  const direct = await repository(t);
  const argv = ['--project', direct, '--guardrail', 'add', '--client', 'cursor'];
  const before = await cloneHash(direct);
  const preview = await run(process.execPath, [configureIn(direct), ...argv], { cwd: direct });
  const previewed = JSON.parse(preview.stdout);

  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(previewed.status, 'ready');
  assert.equal(await cloneHash(direct), before);

  const applied = await run(process.execPath, [configureIn(direct), ...argv, '--confirm', previewed.previewHash], { cwd: direct });

  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).status, 'registered');

  const { preview: frameworkPreview } = await confirmed(throughFramework, 'add');

  assert.equal(frameworkPreview.document.previewHash, previewed.previewHash);
  assert.equal(await readHooks(direct), await readHooks(throughFramework));
});

test('FS-007: the text preview names one beforeShellExecution entry and shows the exact line', async (t) => {
  const root = await repository(t);
  const preview = await run(process.execPath, [entryIn(root), 'guardrail', 'add', 'cursor'], { cwd: root });
  const { document } = await guardrail(root, ['add', 'cursor']);

  assert.equal(preview.status, 1);
  assert.match(preview.stdout, /^preview: \.cursor\/hooks\.json \(created\) — would add one beforeShellExecution entry; every other key and hook is kept:$/m);
  assert.ok(preview.stdout.split('\n').includes(`+         "command": ${JSON.stringify(entry().command)}`));
  assert.ok(preview.stdout.includes(`token: ${document.previewHash}`));
});

/** A schema v4 configuration whose one required check grades one file. */
const CONFIGURATION = [
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
  'evaluation_gate:',
  '  checks:',
  '    required:',
  '      - configuration.broad-tests.test',
  '    advisory: []',
  '  budget:',
  '    total_seconds: 600',
  '  bypass:',
  '    enabled: false',
  '    marker: null',
  '  execution:',
  '    budget_skippable: []',
  '  evidence: {}',
  '',
].join('\n');

const gate = (root, argv) => runOperatorCommand({
  cwd: root,
  argv,
  environment: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
});

test('FS-007: on a clone the Gate activated for Cursor, adding and removing the guardrail keeps the Gate\'s entry and gate status healthy', async (t) => {
  const root = await repository(t);

  await mkdir(path.join(root, 'tools'));
  await mkdir(path.join(root, 'app'));
  await writeFile(path.join(root, 'tools/check.mjs'), "process.exitCode = 0;\n");
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\n');
  await writeFile(path.join(root, '.agent-framework.yaml'), CONFIGURATION);
  await writeHooks(root, '{\n  "version": 1,\n  "hooks": {}\n}\n');
  await git(root, ['add', '--all']);
  await git(root, ['-c', 'user.email=guardrail@example.test', '-c', 'user.name=Guardrail', 'commit', '--quiet', '--message', 'baseline']);

  const preview = await gate(root, ['activate', '--client', 'cursor']);
  const activated = await gate(root, ['activate', '--client', 'cursor', '--confirm', preview.document.observation.confirmationToken]);

  assert.equal(activated.document.mutation.state, 'activated', activated.document.mutation.summary);

  const healthy = async (moment) => {
    const status = await gate(root, ['status']);

    assert.equal(status.document.observation.state, 'activated', moment);
    assert.equal(status.document.observation.health, 'healthy', `${moment}: ${JSON.stringify(status.document.observation.next)}`);
  };
  const activatedFile = await readHooks(root);
  const [gateEntry] = JSON.parse(activatedFile).hooks.stop;
  const gateEntryText = `{\n        "command": ${JSON.stringify(gateEntry.command)}\n      }`;

  assert.ok(activatedFile.includes(gateEntryText), 'the fixture does not hold the Gate entry as expected.');
  await healthy('activated');
  await confirmed(root, 'add');

  const withGuardrail = JSON.parse(await readHooks(root));

  assert.deepEqual(withGuardrail.hooks.stop, [gateEntry]);
  assert.deepEqual(withGuardrail.hooks.beforeShellExecution, [entry()]);
  assert.ok((await readHooks(root)).includes(gateEntryText), 'add changed the bytes of the Gate entry.');
  await healthy('after guardrail add');

  await confirmed(root, 'remove');
  assert.equal(await readHooks(root), activatedFile);
  await healthy('after guardrail remove');
});
