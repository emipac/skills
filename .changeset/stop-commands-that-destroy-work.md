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
