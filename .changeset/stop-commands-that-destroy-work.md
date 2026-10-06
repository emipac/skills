---
"ai-skills-framework": minor
---

Add an opt-in guardrail that stops Claude Code before it runs a shell command
that silently destroys uncommitted or unpushed work: `git reset --hard`,
`git clean` with any force flag, `git branch -D` (and `--delete --force`),
`git checkout .` and `git checkout -- .`, `git restore .` unless it only
unstages, `git push --force` and `-f`, `git stash clear`, and `git stash drop`.
`--force-with-lease`, `--force-if-includes`, and lookalikes such as
`git checkout .env.example` still run. The guardrail ships in `framework-setup`
as `scripts/guardrail.mjs`, a Node `PreToolUse` hook with no other dependency.
It reads the command as a POSIX shell would — chained commands, `sh -c`
strings, Git's global options — and blocks with exit 2 and
`BLOCKED: '<command>' matches dangerous pattern '<rule>'. The user has prevented you from doing this.`
A payload it does not recognise is allowed with a one-line notice.

`agent-framework guardrail add claude-code` and `guardrail remove claude-code`
(and `configure.mjs --guardrail add|remove --client claude-code`) preview the
exact `.claude/settings.json` change and write it only with that preview's
token: one `PreToolUse` matcher group, matcher `Bash`, running the script by its
repository-relative path under `${CLAUDE_PROJECT_DIR}` in Claude Code's exec
form. Every other key and hook is kept, and the file is created only when
missing. A duplicate, a missing entry, a file that is not JSON or does not
round-trip as two-space JSON, a skill installed outside the repository or
ignored by Git, and a stale token are refused with nothing written. Setup never
registers it. It guards against accidents and is not a security boundary.

The guardrail also stops Cursor's agent (FS-007).
`agent-framework guardrail add cursor` and `guardrail remove cursor` (and
`configure.mjs --guardrail add|remove --client cursor`) preview and confirm one
flat `beforeShellExecution` entry in `.cursor/hooks.json`, beside any Gate entry,
which keeps every byte, so `gate status` stays healthy. The entry runs
`node <repository-relative path>/guardrail.mjs --client cursor` from the project
root, where Cursor runs its hooks. The file is created with `"version": 1` only
when missing, its version is never changed, and it keeps its own indentation.
A skill at a path a shell would need quoted is refused. With `--client cursor`
the guardrail answers in the contract observed on Cursor 3.23.23: it reads
`command`, prints `{"permission":"deny","userMessage":…,"agentMessage":…}`, both
carrying the `BLOCKED: …` line, or `{"permission":"allow"}`, and exits 0. It
never echoes the payload, which carries the person's email. Whether Cursor shows
either message, and how it treats a non-zero exit, was not established. Without
an argument the guardrail answers Claude Code exactly as before.
