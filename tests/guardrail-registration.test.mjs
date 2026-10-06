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
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Registering the destructive-command guardrail with Claude Code (FS-006).
 *
 * Every run is `agent-framework guardrail …` or `configure.mjs --guardrail …`
 * as a child process, from a copy of the `framework-setup` skill installed
 * inside a throwaway repository, as a teammate's clone would hold it.
 */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETUP_SKILL = path.join(FRAMEWORK_ROOT, 'skills', 'framework-setup');
const SOURCE_ENTRY = path.join(SETUP_SKILL, 'scripts', 'agent-framework.mjs');
const INSTALLED = '.claude/skills/framework-setup';
const SCRIPT = `${INSTALLED}/scripts/guardrail.mjs`;

const environment = {
  ...process.env,
  PATH: [path.dirname(process.execPath), ...(process.env.PATH ?? '').split(path.delimiter)].join(path.delimiter),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

const run = (program, argv, { cwd, input = '' }) => new Promise((resolve) => {
  const child = execFile(program, argv, { cwd, env: environment, encoding: 'utf8' }, (error, stdout, stderr) => {
    resolve({ status: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout, stderr });
  });

  child.stdin.end(input);
});

/** A throwaway Git repository holding `framework-setup` at `installed`, and an `AGENTS.md`. */
const repository = async (t, { installed = INSTALLED } = {}) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'guardrail-registration-')));

  t.after(() => rm(root, { recursive: true, force: true }));
  await run('git', ['init', '--quiet'], { cwd: root });
  await writeFile(path.join(root, 'AGENTS.md'), '# Agents\n\nKeep this byte for byte.\n');

  if (installed !== null) {
    await cp(SETUP_SKILL, path.join(root, installed), { recursive: true });
  }

  return root;
};

const entryIn = (root, installed = INSTALLED) => path.join(root, installed, 'scripts', 'agent-framework.mjs');

const configureIn = (root, installed = INSTALLED) => path.join(root, installed, 'scripts', 'configure.mjs');

/** `agent-framework guardrail <argv>` in `root`, with its parsed `--json` document. */
const guardrail = async (root, argv, { entry = entryIn(root) } = {}) => {
  const result = await run(process.execPath, [entry, 'guardrail', ...argv, '--json'], { cwd: root });

  return { ...result, document: JSON.parse(result.stdout) };
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

const settingsPath = (root) => path.join(root, '.claude', 'settings.json');

const readSettings = (root) => readFile(settingsPath(root), 'utf8');

const writeSettings = async (root, contents) => {
  await mkdir(path.dirname(settingsPath(root)), { recursive: true });
  await writeFile(settingsPath(root), contents);
};

const group = (script = SCRIPT) => ({
  matcher: 'Bash',
  hooks: [{ type: 'command', command: 'node', args: [`\${CLAUDE_PROJECT_DIR}/${script}`] }],
});

/** Preview, then confirm with the preview's own token. */
const confirmed = async (root, operation, options = {}) => {
  const preview = await guardrail(root, [operation, 'claude-code'], options);

  assert.equal(preview.status, 1, preview.stdout);

  const applied = await guardrail(root, [operation, 'claude-code', '--confirm', preview.document.previewHash], options);

  assert.equal(applied.status, 0, applied.stdout);

  return { preview, applied };
};

/** Run the registered hook exactly as Claude Code's exec form does: `${CLAUDE_PROJECT_DIR}` substituted into each argument. */
const runRegisteredHook = async (root, command) => {
  const [registered] = JSON.parse(await readSettings(root)).hooks.PreToolUse.slice(-1);
  const [hook] = registered.hooks;
  const args = hook.args.map((argument) => argument.replaceAll('${CLAUDE_PROJECT_DIR}', root));

  return run(hook.command, args, {
    cwd: root,
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }),
  });
};

test('FS-006: guardrail add previews the new .claude/settings.json, writes nothing, and creates it only with the token', async (t) => {
  const root = await repository(t);
  const before = await cloneHash(root);
  const preview = await guardrail(root, ['add', 'claude-code']);
  const again = await guardrail(root, ['add', 'claude-code']);

  assert.equal(await cloneHash(root), before, 'a preview wrote to the clone.');
  assert.equal(again.stdout, preview.stdout, 'a repeated preview printed something else.');
  assert.equal(preview.status, 1);
  assert.equal(preview.document.document, 'agent-framework/guardrail/1');
  assert.equal(preview.document.applied, false);
  assert.equal(preview.document.created, true);
  assert.equal(preview.document.file, '.claude/settings.json');
  assert.equal(preview.document.script, SCRIPT);
  assert.deepEqual(preview.document.entry, group());
  assert.match(preview.document.previewHash, /^[0-9a-f]{64}$/);
  assert.match(preview.document.next.command, /guardrail add claude-code .*--confirm [0-9a-f]{64}$/);

  const { applied } = await confirmed(root, 'add');
  const written = await readSettings(root);

  assert.equal(applied.document.applied, true);
  assert.equal(applied.document.next, null);
  assert.equal(written, `${JSON.stringify({ hooks: { PreToolUse: [group()] } }, null, 2)}\n`);
  assert.equal(written, preview.document.proposedSettings);
  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), '# Agents\n\nKeep this byte for byte.\n');

  const blocked = await runRegisteredHook(root, 'git reset --hard');

  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /^BLOCKED: 'git reset --hard' matches dangerous pattern 'git reset --hard'\./);
  assert.deepEqual(await runRegisteredHook(root, 'git status'), { status: 0, stdout: '', stderr: '' });
});

test('FS-006: add keeps every other key and hook, and remove reverses exactly that entry', async (t) => {
  const root = await repository(t);
  const original = {
    permissions: { allow: ['Bash(npm run test:*)'], deny: ['Read(./.env)'] },
    hooks: {
      PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'echo edit' }] }],
      PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo done' }] }],
    },
    env: { FOO: 'bar' },
  };
  const originalText = `${JSON.stringify(original, null, 2)}\n`;

  await writeSettings(root, originalText);

  const { preview } = await confirmed(root, 'add');

  assert.equal(preview.document.created, false);
  assert.deepEqual(JSON.parse(await readSettings(root)), {
    ...original,
    hooks: { ...original.hooks, PreToolUse: [...original.hooks.PreToolUse, group()] },
  });
  assert.ok(preview.document.changes.added.some((line) => line.includes('"${CLAUDE_PROJECT_DIR}/.claude/skills/framework-setup/scripts/guardrail.mjs"')));
  // The new group is inserted after the group before it; no existing line is removed.
  assert.deepEqual(preview.document.changes.removed, []);
  assert.equal(preview.document.changes.added[0], '      },');

  await confirmed(root, 'remove');

  assert.equal(await readSettings(root), originalText);
});

test('FS-006: a file without hooks gains them, and removing the guardrail takes away only what adding it put there', async (t) => {
  const root = await repository(t);
  const originalText = '{\n  "permissions": {\n    "allow": []\n  }\n}';

  await writeSettings(root, originalText);
  await confirmed(root, 'add');

  const added = await readSettings(root);

  assert.equal(added, `${JSON.stringify({ permissions: { allow: [] }, hooks: { PreToolUse: [group()] } }, null, 2)}`);

  await confirmed(root, 'remove');

  assert.equal(await readSettings(root), originalText);
});

test('FS-006: every refusal states its reason, exits 2, and leaves the clone byte for byte', async (t) => {
  const registered = await repository(t);

  await confirmed(registered, 'add');

  const cases = [
    ['duplicate add', registered, ['add', 'claude-code'], 'guardrail-registered'],
    ['remove with nothing registered', await repository(t), ['remove', 'claude-code'], 'guardrail-not-registered'],
    ['unparseable file', await repository(t), ['add', 'claude-code'], 'settings-unparseable', '{ "hooks": '],
    ['four-space JSON', await repository(t), ['add', 'claude-code'], 'settings-unrevisable', '{\n    "env": {}\n}\n'],
    ['compact JSON', await repository(t), ['add', 'claude-code'], 'settings-unrevisable', '{"env":{}}'],
    ['a key declared twice', await repository(t), ['add', 'claude-code'], 'settings-unrevisable', '{\n  "env": {},\n  "env": {}\n}\n'],
    ['hooks that are not an object', await repository(t), ['add', 'claude-code'], 'settings-unrevisable', '{\n  "hooks": []\n}\n'],
    ['a top level that is not an object', await repository(t), ['add', 'claude-code'], 'settings-unrevisable', '[]\n'],
    ['a stale token', await repository(t), ['add', 'claude-code', '--confirm', '0'.repeat(64)], 'preview-mismatch'],
    ['a client not supported yet', await repository(t), ['add', 'codex'], 'client-unsupported'],
  ];

  for (const [name, root, argv, reasonCode, settings] of cases) {
    if (settings !== undefined) {
      await writeSettings(root, settings);
    }

    const before = await cloneHash(root);
    const refused = await guardrail(root, argv);

    assert.equal(refused.status, 2, `${name}: ${refused.stdout}`);
    assert.equal(refused.document.failure.reasonCode, reasonCode, name);
    assert.equal(refused.document.applied, false, name);
    assert.equal(await cloneHash(root), before, `${name} changed the clone.`);
  }
});

test('FS-006: a token from before the file changed writes nothing', async (t) => {
  const root = await repository(t);
  const preview = await guardrail(root, ['add', 'claude-code']);

  await writeSettings(root, '{\n  "env": {}\n}\n');

  const before = await cloneHash(root);
  const refused = await guardrail(root, ['add', 'claude-code', '--confirm', preview.document.previewHash]);

  assert.equal(refused.status, 2);
  assert.equal(refused.document.failure.reasonCode, 'preview-mismatch');
  assert.equal(await cloneHash(root), before);
});

test('FS-006: a skill installed outside the repository, or one Git ignores, is refused because a teammate\'s clone would not have it', async (t) => {
  const outside = await repository(t, { installed: null });
  const outsideBefore = await cloneHash(outside);
  const refusedOutside = await guardrail(outside, ['add', 'claude-code', '--project', outside], { entry: SOURCE_ENTRY });

  assert.equal(refusedOutside.status, 2);
  assert.equal(refusedOutside.document.failure.reasonCode, 'guardrail-outside-project');
  assert.match(refusedOutside.document.failure.detail, /inside the repository/);
  assert.equal(await cloneHash(outside), outsideBefore);

  const ignored = await repository(t);

  await writeFile(path.join(ignored, '.gitignore'), '.claude/skills/\n');

  const ignoredBefore = await cloneHash(ignored);
  const refusedIgnored = await guardrail(ignored, ['add', 'claude-code']);

  assert.equal(refusedIgnored.status, 2);
  assert.equal(refusedIgnored.document.failure.reasonCode, 'guardrail-ignored');
  assert.equal(await cloneHash(ignored), ignoredBefore);
});

test('FS-006: run through a linked client directory, the registered path is the one the repository holds', async (t) => {
  const root = await repository(t, { installed: '.agents/skills/framework-setup' });

  await mkdir(path.join(root, '.claude'));
  await symlink(path.join(root, '.agents', 'skills'), path.join(root, '.claude', 'skills'), 'dir');
  await confirmed(root, 'add', { entry: entryIn(root, INSTALLED) });

  assert.deepEqual(JSON.parse(await readSettings(root)).hooks.PreToolUse, [group('.agents/skills/framework-setup/scripts/guardrail.mjs')]);
});

test('FS-006: configure.mjs --guardrail is the same operation, stated in --revise-gate\'s style', async (t) => {
  const throughFramework = await repository(t);
  const direct = await repository(t);
  const argv = ['--project', direct, '--guardrail', 'add', '--client', 'claude-code'];
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
  assert.equal(await readSettings(direct), await readSettings(throughFramework));

  const refused = await run(process.execPath, [configureIn(direct), ...argv], { cwd: direct });

  assert.equal(refused.status, 2);
  assert.deepEqual(Object.keys(JSON.parse(refused.stdout)), ['status', 'reasonCode', 'detail']);
  assert.equal(JSON.parse(refused.stdout).reasonCode, 'guardrail-registered');
});

test('FS-006: the text preview shows the exact change and the token', async (t) => {
  const root = await repository(t);
  const preview = await run(process.execPath, [entryIn(root), 'guardrail', 'add', 'claude-code'], { cwd: root });
  const { document } = await guardrail(root, ['add', 'claude-code']);

  assert.equal(preview.status, 1);
  assert.match(preview.stdout, /^preview: \.claude\/settings\.json \(created\)/m);
  assert.ok(preview.stdout.split('\n').some((line) => line.startsWith('+ ') && line.includes(JSON.stringify(`\${CLAUDE_PROJECT_DIR}/${SCRIPT}`))));
  assert.ok(preview.stdout.includes(`token: ${document.previewHash}`));
  assert.ok(preview.stdout.includes(`next: ${document.next.command}`));
});

test('FS-006: base setup and agent-framework setup never register the guardrail', async (t) => {
  const root = await repository(t);

  await writeFile(path.join(root, 'package.json'), '{\n  "name": "fixture",\n  "scripts": {\n    "test": "node --test"\n  }\n}\n');

  const base = await run(process.execPath, [
    configureIn(root),
    '--project', root,
    '--tracker', 'local-markdown',
    '--srs', 'null',
    '--backend', 'unknown',
    '--frontend', 'none',
    '--history', 'null',
  ], { cwd: root });

  assert.equal(base.status, 0, base.stderr);

  const plan = await run(process.execPath, [entryIn(root), 'setup', '--json'], { cwd: root });
  const planText = await run(process.execPath, [entryIn(root), 'setup'], { cwd: root });

  assert.notEqual(plan.status, 2, plan.stderr);
  assert.doesNotMatch(plan.stdout, /guardrail (?:add|remove)|guardrail\.mjs/);
  assert.doesNotMatch(planText.stdout, /guardrail (?:add|remove)|guardrail\.mjs/);
  await assert.rejects(readSettings(root), { code: 'ENOENT' });
});
