# Stopped an agent running a command that destroys work

Delivered FS-006. Nothing stopped Claude Code from running `git reset --hard`,
`git clean -fd`, or a forced push in a repository set up with the framework.
The maintainer's bash hook needed `bash` and `jq`, and matched raw text, so it
blocked `git checkout .env.example` and allowed `git push -f origin main`.

- Added `skills/framework-setup/scripts/guardrail.mjs`, a Node `PreToolUse`
  hook with no other dependency. It reads `tool_input.command` from the JSON
  on standard input. It splits the command on `&&`, `||`, `;`, `|`, `&`,
  parentheses, backticks, and newlines. It splits each part into POSIX words,
  reads `sh -c` and `bash -c` strings recursively, looks past assignments,
  `sudo`, `env`, `command`, and `exec`, and skips Git's global options. Each
  rule then matches the subcommand and its flags:
  - `git reset --hard`;
  - `git clean` with any force flag;
  - `git branch -D`, `--delete --force`, or `-d -f`;
  - a whole-tree `git checkout .`;
  - a whole-tree `git restore .`, unless it only unstages;
  - `git push --force` or `-f`;
  - `git stash clear` and `git stash drop`.

  A blocked command exits 2 with the maintainer's `BLOCKED: …` line on stderr.
  An allowed one exits 0 silently. A command that cannot be split into words is
  matched against plain-text patterns. A payload that is not JSON, or carries no
  `tool_input.command` string, is allowed with a one-line notice, so that a
  broken guardrail does not stop every tool call.
- Added `previewGuardrail` and `applyGuardrail` to `configure.mjs`. They follow
  `previewGateRevision` and `reviseGate`: `previewHash` is sha256 of the
  current file, `\0`, and the proposed file, and a stale token is refused as
  `preview-mismatch`.
  - **Add** merges one `PreToolUse` group (`matcher: "Bash"`) into the shared
    `.claude/settings.json`, creating the file only when it is missing.
  - **Remove** takes out exactly that group, plus the `PreToolUse` list and
    `hooks` object if the group was all they held.
  - **Refusals** cover a duplicate, nothing to remove, a duplicated group, a
    file that is not JSON, and a file that does not round-trip. Round-trip
    means `JSON.stringify(value, null, 2)`, with the original final newline
    kept or left out, gives back the file's exact bytes.
  - **Location.** The registered path is the running script's real path,
    relative to the repository. A skill installed outside the repository, or
    one Git ignores, is refused, because a teammate's clone would not have it.

  `agent-framework guardrail add|remove claude-code` and
  `configure.mjs --guardrail add|remove --client claude-code` drive the same
  operation. `replaceConfiguration` now delegates to a shared `replaceFile`.
- Added step 7 of the skill, which offers the guardrail only on the
  maintainer's yes, plus a rule bullet. Documented the subcommand and its
  refusals in `references/framework-command.md`, and added a plain section after
  the quick start in Section 04 of the guide.

The Claude Code contract, and how each part was checked:

- From the hooks reference at code.claude.com/docs/en/hooks (docs.claude.com
  redirects there), fetched 2026-10-06:
  - stdin carries `tool_name` and `tool_input.command`;
  - for `PreToolUse`, exit 2 "Blocks the tool call", and stderr becomes the
    blocking message;
  - `Bash` is an exact-match matcher;
  - the settings shape is `hooks.PreToolUse[]` of
    `{matcher, hooks: [{type: "command", command, args?}]}`.
- Observed with Claude Code 2.1.193 on a throwaway fixture whose path has a
  space:
  - a project `.claude/settings.json` hook in exec form (`command: "node"`,
    `args: ["${CLAUDE_PROJECT_DIR}/…"]`) ran;
  - Claude Code substituted the placeholder as one argument and exported
    `CLAUDE_PROJECT_DIR`;
  - the real guardrail ran under Claude Code's hook runner.

  This used `SessionStart` probes with `--include-hook-events`. The local CLI
  was not logged in, so no model-driven `PreToolUse` call could be made, and the
  exit-2 block itself rests on the documentation and on the unit tests.
- One deviation from the ticket: the registered hook uses exec form (`args`),
  which the reference recommends whenever a path placeholder is used. It needs
  no shell, so it works with Git Bash or PowerShell on Windows, and with spaces
  in the path.

Verification: the first red test (`git push -f origin main` exits 2 with the
message, `git checkout .env.example` exits 0) failed with the script missing.
The table test covers every rule, the eight probe commands, extra whitespace,
`git -C`, chains, nested `sh -c`, and text that only mentions a rule.
Registration tests cover:

- preview, confirm, and remove back to the original bytes;
- every refusal, each leaving the clone hash unchanged;
- a linked client directory;
- the direct path producing the same file;
- base setup and `setup` never writing the file;
- the registered hook, run as Claude Code runs it, blocking.

`npm run test:install` blocks a destructive payload through the installed and
the linked skill, then registers, runs, and removes the hook through both.
`npm run test:unit` (816 passing, 1 skipped, three runs), `npm run test:install`,
and `npm run validate` pass.

Limits:

- It guards against accidents and is not a security boundary. Scripts the agent
  writes, Git aliases, `$(…)` inside double quotes, and `git push origin +main`
  are not stopped. Neither are `git checkout -f` or `git switch
  --discard-changes`, which the rules do not name, nor the PowerShell tool.
- A Claude Code release too old for `args` would presumably run `node` with no
  script and fail open, showing a hook error. This was not observed.
- Cursor and Codex follow in FS-007 and FS-008.
