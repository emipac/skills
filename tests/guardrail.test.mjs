import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The destructive-command guardrail (FS-006), driven only through its public
 * seam: the script run as a child process with a Claude Code `PreToolUse`
 * payload on standard input.
 */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARDRAIL = path.join(FRAMEWORK_ROOT, 'skills', 'framework-setup', 'scripts', 'guardrail.mjs');

/** Run the guardrail with `input` on standard input. */
const guard = (input) => new Promise((resolve) => {
  const child = execFile(process.execPath, [GUARDRAIL], { encoding: 'utf8' }, (error, stdout, stderr) => {
    resolve({ status: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout, stderr });
  });

  child.stdin.end(input);
});

/** A Claude Code `PreToolUse` payload for the Bash tool, shaped as the hook reference documents it. */
const payload = (command) => JSON.stringify({
  session_id: 'abc123',
  transcript_path: '/tmp/transcript.jsonl',
  cwd: '/tmp/project',
  permission_mode: 'default',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command, description: 'probe', timeout: 120000, run_in_background: false },
  tool_use_id: 'toolu_01',
});

const blockedMessage = (command, rule) => `BLOCKED: '${command}' matches dangerous pattern '${rule}'. The user has prevented you from doing this.\n`;

test('FS-006: a forced push is blocked with the maintainer\'s message, and checking out a dotfile is allowed', async () => {
  const blocked = await guard(payload('git push -f origin main'));

  assert.equal(blocked.status, 2);
  assert.equal(blocked.stdout, '');
  assert.equal(blocked.stderr, blockedMessage('git push -f origin main', 'git push --force'));

  const allowed = await guard(payload('git checkout .env.example'));

  assert.deepEqual(allowed, { status: 0, stdout: '', stderr: '' });
});

/**
 * Every rule with blocked and allowed variants. `null` means allowed. The
 * first eight rows are the ticket's probe commands, which the maintainer's
 * bash script got wrong.
 */
const RULE_TABLE = [
  ['git checkout .env.example', null],
  ['git restore ./src/a.php', null],
  ['git push --force-with-lease', null],
  ['git push -f origin main', 'git push --force'],
  ['git checkout -- .', 'git checkout .'],
  ['git clean -xdf', 'git clean --force'],
  ['git  reset   --hard', 'git reset --hard'],
  ['git stash clear', 'git stash clear'],

  ['git reset --hard', 'git reset --hard'],
  ['git reset --hard HEAD~1', 'git reset --hard'],
  ['git reset --hard origin/main', 'git reset --hard'],
  ['git reset', null],
  ['git reset --soft HEAD~1', null],
  ['git reset HEAD src/a.php', null],
  ['git reset -- --hard', null],

  ['git clean -f', 'git clean --force'],
  ['git clean -fd', 'git clean --force'],
  ['git clean --force', 'git clean --force'],
  ['git clean -d -f', 'git clean --force'],
  ['git clean -n', null],
  ['git clean -nd', null],
  ['git clean -e foo -n', null],
  ['git clean -efoo -n', null],

  ['git branch -D feature', 'git branch -D'],
  ['git branch --delete --force feature', 'git branch -D'],
  ['git branch -d -f feature', 'git branch -D'],
  ['git branch -df feature', 'git branch -D'],
  ['git branch -d feature', null],
  ['git branch --delete feature', null],
  ['git branch -f main HEAD~1', null],
  ['git branch --list', null],

  ['git checkout .', 'git checkout .'],
  ['git checkout ./', 'git checkout .'],
  ['git checkout HEAD -- .', 'git checkout .'],
  ['git checkout main', null],
  ['git checkout -b feature', null],
  ['git checkout -- src/a.php', null],
  ['git checkout ./src', null],

  ['git restore .', 'git restore .'],
  ['git restore --worktree .', 'git restore .'],
  ['git restore --staged --worktree .', 'git restore .'],
  ['git restore -SW .', 'git restore .'],
  ['git restore --source HEAD .', 'git restore .'],
  ['git restore --staged .', null],
  ['git restore -S .', null],
  ['git restore src/a.php', null],
  ['git restore --source . src/a.php', null],

  ['git push --force', 'git push --force'],
  ['git push -f', 'git push --force'],
  ['git push origin main --force', 'git push --force'],
  ['git push -uf origin main', 'git push --force'],
  ['git push --force-with-lease=main:abc123 origin main', null],
  ['git push --force-if-includes --force-with-lease', null],
  ['git push origin main', null],
  ['git push -u origin feature', null],
  ['git push -o f origin main', null],

  ['git stash drop', 'git stash drop'],
  ['git stash drop stash@{1}', 'git stash drop'],
  ['git stash', null],
  ['git stash list', null],
  ['git stash pop', null],
  ['git stash push -m "clear the drop"', null],

  // Whitespace, Git's global options, and how the program is named.
  ['  git\treset  --hard  ', 'git reset --hard'],
  ['git -C dir reset --hard', 'git reset --hard'],
  ['git -C "some dir" clean -fd', 'git clean --force'],
  ['git -c core.pager=cat push -f', 'git push --force'],
  ['git --git-dir=.git --work-tree=. stash clear', 'git stash clear'],
  ['git --no-pager -C dir checkout -- .', 'git checkout .'],
  ['git -C dir log --oneline', null],
  ['/usr/bin/git reset --hard', 'git reset --hard'],
  ['GIT_TRACE=1 git reset --hard', 'git reset --hard'],
  ['sudo -u builder git reset --hard', 'git reset --hard'],
  ['env -i git clean -f', 'git clean --force'],

  // Chained commands: each part is read.
  ['git add . && git reset --hard', 'git reset --hard'],
  ['git status || git stash clear', 'git stash clear'],
  ['git fetch; git push -f', 'git push --force'],
  ['git status | git clean -fd', 'git clean --force'],
  ['git fetch &\ngit checkout .', 'git checkout .'],
  ['cd sub && (git restore .)', 'git restore .'],
  ['git add . && git commit -m "wip" && git push', null],
  ['git log 2>&1 | head', null],

  // A shell running a command string is read inside that string.
  ["sh -c 'git reset --hard'", 'git reset --hard'],
  ['bash -c "git fetch && git push --force"', 'git push --force'],
  ["bash -lc 'git stash drop'", 'git stash drop'],
  ["bash -o pipefail -c 'git clean -f'", 'git clean --force'],
  ['sh -c "sh -c \'git branch -D x\'"', 'git branch -D'],
  ["sh -c 'git status'", null],

  // Text that only mentions a rule is not running it.
  ['echo "git reset --hard"', null],
  ["grep -r 'git push --force' docs", null],
  ['git commit -m "never git reset --hard"', null],
  ['git log # git reset --hard', null],
  ['rm -rf build', null],

  // A command that cannot be split into words is matched as plain text.
  ['git reset --hard && echo "unbalanced', 'git reset --hard'],
  ['git status && echo "unbalanced', null],
];

test('FS-006: every rule blocks its destructive spellings and allows the lookalikes', async () => {
  const results = await Promise.all(RULE_TABLE.map(async ([command, rule]) => [command, rule, await guard(payload(command))]));

  for (const [command, rule, result] of results) {
    if (rule === null) {
      assert.deepEqual(result, { status: 0, stdout: '', stderr: '' }, `allowed: ${JSON.stringify(command)}`);
    } else {
      assert.deepEqual(result, { status: 2, stdout: '', stderr: blockedMessage(command, rule) }, `blocked: ${JSON.stringify(command)}`);
    }
  }
});

test('FS-006: a payload the hook reference does not describe is allowed with a one-line notice', async () => {
  for (const input of ['', 'not json', '[]', 'null', JSON.stringify({ tool_name: 'Bash' }), JSON.stringify({ tool_input: { command: 42 } })]) {
    const result = await guard(input);

    assert.equal(result.status, 0, input);
    assert.equal(result.stdout, '', input);
    assert.match(result.stderr, /^guardrail: [^\n]+; the command was allowed unchecked\.\n$/, input);
  }
});

test('FS-006: an empty command is allowed silently', async () => {
  assert.deepEqual(await guard(payload('')), { status: 0, stdout: '', stderr: '' });
});
