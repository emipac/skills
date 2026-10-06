/**
 * A script path a single command string can name bare: letters, digits, `.`,
 * `_`, `-`, and `/`, not starting with `-`. A shell — POSIX, `cmd`, or
 * PowerShell — passes such a word through as it is, and `node` does not read
 * it as an option, so no quoting is needed.
 */
export const BARE_PATH = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/;

/** The indentation a JSON document already uses, read the way the Gate's registration reads it. */
const ownIndentation = (contents) => {
  const match = /\n([ \t]+)\S/.exec(contents);

  return match === null ? 2 : (match[1].includes('\t') ? '\t' : match[1].length);
};

/**
 * Where each client reads the destructive-command guardrail from, and the
 * one entry registration writes there: the shared, committed hooks file, the
 * hook event, the entry, the hooks one entry runs (to find a duplicate), the
 * document a missing file starts as, the indentation the file round-trips
 * with, and whether removing the last entry also removes an empty `hooks`.
 *
 * - **Claude Code** (FS-006): one `PreToolUse` matcher group for `Bash` in
 *   `.claude/settings.json`, in exec form — `node` spawned directly with the
 *   script as its one argument under `${CLAUDE_PROJECT_DIR}`, which Claude
 *   Code substitutes, so a path with spaces needs no quoting and no shell is
 *   involved. Settings are two-space JSON, as Claude Code writes them.
 * - **Cursor** (FS-007): one flat `{ command }` entry under
 *   `beforeShellExecution` in `.cursor/hooks.json`, the file the Gate's Cursor
 *   adapter registers in. Observed on Cursor 3.23.23, the hook runs in the
 *   project root, so the command names the script by its path relative to the
 *   repository — the form the observation's own probe ran — and passes
 *   `--client cursor` so the guardrail answers in Cursor's format. A missing
 *   file starts as `{ "version": 1 }`; an existing file's version is never
 *   touched. The file keeps its own indentation, as the Gate's registration
 *   keeps it, and its `hooks` object stays when the last entry goes, as in the
 *   `{ "version": 1, "hooks": {} }` file the skill seeds.
 *
 * Codex follows after its hook is observed (FS-008).
 */
export const GUARDRAIL_CLIENTS = Object.freeze({
  'claude-code': Object.freeze({
    file: '.claude/settings.json',
    event: 'PreToolUse',
    noun: 'matcher group',
    entry: (script) => ({ matcher: 'Bash', hooks: [{ type: 'command', command: 'node', args: [`\${CLAUDE_PROJECT_DIR}/${script}`] }] }),
    barePathOnly: false,
    hooksOf: (entry) => entry?.hooks,
    seed: () => ({}),
    indentation: () => 2,
    writtenAs: 'the way Claude Code writes settings — two-space JSON, each key once',
    keepsEmptyHooks: false,
  }),
  cursor: Object.freeze({
    file: '.cursor/hooks.json',
    event: 'beforeShellExecution',
    noun: 'entry',
    entry: (script) => ({ command: `node ${script} --client cursor` }),
    // Cursor's quoting of its one command string was not observed, so none is relied on.
    barePathOnly: true,
    hooksOf: (entry) => [entry],
    seed: () => ({ version: 1 }),
    indentation: ownIndentation,
    writtenAs: 'as JSON in its own indentation throughout, the way the Gate rewrites it — each key once',
    keepsEmptyHooks: true,
  }),
});

export const guardrailOperations = Object.freeze(['add', 'remove']);

export const guardrailClients = Object.freeze(Object.keys(GUARDRAIL_CLIENTS));
