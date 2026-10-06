import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The destructive-command guardrail answering Cursor (FS-007), driven only
 * through its public seam: the script run as a child process, as the
 * registered command runs it, with a Cursor `beforeShellExecution` payload on
 * standard input.
 *
 * The payload carries the fields the observation recorded on Cursor 3.23.23
 * (`.scratch/framework-scripts/cursor-before-shell-observation.md`), with fake
 * values; `cwd` is empty, as it was observed.
 */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARDRAIL = path.join(FRAMEWORK_ROOT, 'skills', 'framework-setup', 'scripts', 'guardrail.mjs');
const EMAIL = 'someone@example.test';

/** Run the guardrail with `argv` and `input` on standard input. */
const guard = (input, argv = ['--client', 'cursor']) => new Promise((resolve) => {
  const child = execFile(process.execPath, [GUARDRAIL, ...argv], { encoding: 'utf8' }, (error, stdout, stderr) => {
    resolve({ status: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout, stderr });
  });

  child.stdin.end(input);
});

/** A Cursor `beforeShellExecution` payload, with every field the observation recorded. */
const payload = (command) => JSON.stringify({
  conversation_id: '00000000-0000-4000-8000-000000000001',
  generation_id: '00000000-0000-4000-8000-000000000002',
  model: 'some-model',
  command,
  cwd: '',
  sandbox: true,
  hook_event_name: 'beforeShellExecution',
  cursor_version: '3.23.23',
  workspace_roots: ['/tmp/project'],
  user_email: EMAIL,
  transcript_path: null,
  session_id: '00000000-0000-4000-8000-000000000003',
});

const blockedMessage = (command, rule) => `BLOCKED: '${command}' matches dangerous pattern '${rule}'. The user has prevented you from doing this.`;

/** The answer the observation saw stop a command: `deny` with both messages, on stdout, exit 0. */
const denied = (command, rule) => ({
  status: 0,
  stdout: `${JSON.stringify({ permission: 'deny', userMessage: blockedMessage(command, rule), agentMessage: blockedMessage(command, rule) })}\n`,
  stderr: '',
});

const ALLOWED = { status: 0, stdout: '{"permission":"allow"}\n', stderr: '' };

test('FS-007: a Cursor payload for git reset --hard is denied with the observed answer on stdout and exit 0', async () => {
  assert.deepEqual(await guard(payload('git reset --hard')), denied('git reset --hard', 'git reset --hard'));
});

/** One blocked and one allowed spelling per FS-006 rule, and one lookalike each. `null` means allowed. */
const RULE_TABLE = [
  ['git reset --hard HEAD~1', 'git reset --hard'],
  ['git reset --soft HEAD~1', null],
  ['git clean -xdf', 'git clean --force'],
  ['git clean -n', null],
  ['git branch -D feature', 'git branch -D'],
  ['git branch --delete --force feature', 'git branch -D'],
  ['git branch -d feature', null],
  ['git checkout -- .', 'git checkout .'],
  ['git checkout .env.example', null],
  ['git restore .', 'git restore .'],
  ['git restore --staged .', null],
  ['git push -f origin main', 'git push --force'],
  ['git push --force-with-lease', null],
  ['git stash clear', 'git stash clear'],
  ['git stash drop stash@{1}', 'git stash drop'],
  ['git stash pop', null],
  ['git -C app reset --hard', 'git reset --hard'],
  ['git fetch && git push --force', 'git push --force'],
  ["bash -lc 'git stash drop'", 'git stash drop'],
  ['echo "git reset --hard"', null],
  ['echo hello', null],
];

test('FS-007: every FS-006 rule is denied in Cursor\'s answer, and every other command is allowed', async () => {
  const results = await Promise.all(RULE_TABLE.map(async ([command, rule]) => [command, rule, await guard(payload(command))]));

  for (const [command, rule, result] of results) {
    assert.deepEqual(result, rule === null ? ALLOWED : denied(command, rule), JSON.stringify(command));
  }
});

test('FS-007: a payload Cursor\'s contract does not describe is allowed, with a one-line notice that echoes nothing of it', async () => {
  const inputs = [
    '',
    'not json',
    '[]',
    'null',
    JSON.stringify({ hook_event_name: 'beforeShellExecution', user_email: EMAIL }),
    JSON.stringify({ command: 42, user_email: EMAIL }),
    // A Claude Code payload reaching the Cursor registration carries no top-level `command`.
    JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git reset --hard' } }),
  ];

  for (const input of inputs) {
    const result = await guard(input);

    assert.equal(result.status, 0, input);
    assert.equal(result.stdout, ALLOWED.stdout, input);
    assert.match(result.stderr, /^guardrail: [^\n]+; the command was allowed unchecked\.\n$/, input);
    assert.equal(result.stderr.includes(EMAIL), false, input);
  }
});

test('FS-007: the person\'s email in the payload never appears in any answer', async () => {
  for (const command of ['git reset --hard', 'git status', '']) {
    const result = await guard(payload(command));

    assert.equal(`${result.stdout}${result.stderr}`.includes(EMAIL), false, command);
  }
});

test('FS-007: an empty command is allowed', async () => {
  assert.deepEqual(await guard(payload('')), ALLOWED);
});

test('FS-007: without a client argument the guardrail answers in Claude Code\'s format exactly as before', async () => {
  const claude = (command) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });

  assert.deepEqual(await guard(claude('git reset --hard'), []), { status: 2, stdout: '', stderr: `${blockedMessage('git reset --hard', 'git reset --hard')}\n` });
  assert.deepEqual(await guard(claude('git status'), []), { status: 0, stdout: '', stderr: '' });

  // A Cursor payload read as Claude Code's carries no `tool_input.command`.
  const cursorAsClaude = await guard(payload('git reset --hard'), []);

  assert.equal(cursorAsClaude.status, 0);
  assert.equal(cursorAsClaude.stdout, '');
  assert.equal(cursorAsClaude.stderr, 'guardrail: the hook payload carries no tool_input.command string; the command was allowed unchecked.\n');
});

test('FS-007: arguments the guardrail does not know allow the command with a notice, in no client\'s format', async () => {
  for (const argv of [['--client', 'codex'], ['--client'], ['--verbose']]) {
    const result = await guard(payload('git reset --hard'), argv);

    assert.equal(result.status, 0, argv.join(' '));
    assert.equal(result.stdout, '', argv.join(' '));
    assert.match(result.stderr, /^guardrail: [^\n]+; the command was allowed unchecked\.\n$/, argv.join(' '));
  }
});
