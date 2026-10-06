# FS-006 — Stop an agent running a command that destroys work

Status: ready-for-agent
Labels: ready-for-agent, enhancement
Blocked by:
Tracker ID: 06-stop-an-agent-running-a-command-that-destroys-work
Draft key: FS-006

**Status:** ready-for-agent

**Parent feature contract:** none. `framework-setup` owns repository-local
agent conventions, and this adds one opt-in guardrail it can register. The
maintainer's decisions of 2026-10-06 are recorded under Decisions below.

## Outcome

A maintainer can opt a repository into a shared guardrail. After that, Claude
Code stops before it runs a command that silently destroys uncommitted or
unpushed work, such as `git reset --hard`, `git clean -fd`, or a forced push.
It tells the agent which rule stopped it. Ordinary commands that only look
similar, such as `git checkout .env.example` or
`git push --force-with-lease`, run normally. The guardrail ships inside
`framework-setup`, has no dependency beyond Node, works on every platform the
framework supports, and is registered only through a previewed,
token-confirmed step the maintainer approves.

## Decisions (maintainer, 2026-10-06)

- **Clients.** Every client with hooks. This ticket delivers Claude Code; FS-007
  delivers Cursor and FS-008 delivers Codex, each after that client's hook is
  observed.
- **Placement.** Opt-in. Written to the shared, committed client settings
  (`.claude/settings.json` for Claude Code), so the whole team gets it. It is
  never written by base setup and never without the maintainer's yes.
- **Implementation.** A Node port of the maintainer's bash script, with no
  `jq` and working on Windows. It reads commands as arguments, not raw text.
- **Rules.** The maintainer's list as intended, plus the gaps found:
  - `git reset --hard`;
  - `git clean` with any force flag (`-f`, `-fd`, `-xdf`, `--force`);
  - `git branch -D` (and `--delete --force`);
  - `git checkout .` and `git checkout -- .`;
  - `git restore .` (except a restore that only unstages);
  - `git push --force` and `git push -f`;
  - `git stash clear` and `git stash drop`.

  `--force-with-lease` and `--force-if-includes` stay allowed.

## Defect in the proposed script this contract avoids

Verified by running the maintainer's bash script against these commands:

| Command | Script | Intended |
| --- | --- | --- |
| `git checkout .env.example` | blocked | allowed |
| `git restore ./src/a.php` | blocked | allowed |
| `git push --force-with-lease` | blocked | allowed |
| `git push -f origin main` | allowed | blocked |
| `git checkout -- .` | allowed | blocked |
| `git clean -xdf` | allowed | blocked |
| `git  reset   --hard` (extra spaces) | allowed | blocked |
| `git stash clear` | allowed | blocked |

The script also needs `bash` and `jq` on every machine.

## Approach and Tradeoffs

- Verified: `framework-setup` writes only its four managed files today, and the
  Gate pins only its own entry in a client's hooks file
  (`registrationEntryIdentity`), not the whole file. A sibling guardrail entry
  therefore cannot read as Gate drift.
- Proposed: the guardrail is one Node program in `framework-setup`'s scripts. It:
  - splits a command on `&&`, `||`, `;`, `|`, and newlines;
  - tokenizes each part the way a POSIX shell would;
  - looks inside `sh -c` / `bash -c` strings;
  - skips git's global options (`-C <dir>`, `-c <key=value>`, `--git-dir=…`);
  - matches each rule on the subcommand and its flags.

  A command it cannot tokenize, such as one with unbalanced quotes, is matched
  against the original text patterns instead, so it is blocked only if that
  text is plainly destructive.
- Proposed: Claude Code's `PreToolUse` contract. The hook reads JSON on stdin,
  takes the command from `tool_input.command`, and exits 2 with the message on
  stderr to block. The implementer confirms this against the current Claude
  Code hook documentation, and by a real hook run if one is available, before
  relying on it. The message keeps the maintainer's wording:
  `BLOCKED: '<command>' matches dangerous pattern '<rule>'. The user has prevented you from doing this.`
- Proposed: malformed or unexpected input is allowed, with a one-line notice on
  stderr, rather than blocking every tool call. A broken guardrail must not stop
  all work. The implementer states this choice.
- Proposed: registration is a new previewed operation in `framework-setup`,
  reachable as `agent-framework guardrail add claude-code` and
  `agent-framework guardrail remove claude-code`, plus a direct
  `configure.mjs` path. It:
  - merges one `PreToolUse` matcher group (matcher `Bash`) into
    `.claude/settings.json`, creating the file only if it is missing;
  - keeps every other key and hook as it was;
  - previews the exact change and applies only with the preview's token.
- Proposed: the registered command must resolve for every teammate who clones
  the repository, so it names the script by a project-relative path under
  `$CLAUDE_PROJECT_DIR`. When the skill is not installed inside the repository,
  registration is refused with a stated reason. Confirm how `$CLAUDE_PROJECT_DIR`
  is expanded in a hook command.
- Tradeoff, stated honestly: this is a guardrail against accidents, not a
  security boundary. An agent that writes a script file and runs it, or uses a
  shell the hook does not see, is not stopped.

## Architecture Boundary and Public Seam

The program is `framework-setup`'s guardrail script; its public seam is the
script run as a child process with a client payload on stdin. The registration
seam is the Framework command and `configure.mjs` run as child processes on
fixtures.

First red test: the payload for `git push -f origin main` exits 2 with the
`BLOCKED:` message, and the payload for `git checkout .env.example` exits 0.

## Safeguards and Invariants

- Installing a skill never registers the guardrail, and base setup never writes
  client settings (`SG-DIST-001` in spirit). Registration needs the
  maintainer's confirmed preview.
- Registration changes only the one hook entry. Every other byte of the client
  file's meaning is kept, and a file the writer cannot round-trip is refused
  with nothing written.
- No `AGENTS.md` or `CLAUDE.md` is written.
- The guardrail never runs, rewrites, or "fixes" a command. It only allows or
  blocks.

## Prohibited Behavior and Non-goals

- No network access, no logging of commands to disk, and no new runtime
  dependency.
- No blocking of `rm -rf`. That was not chosen.
- No Cursor or Codex registration in this ticket (FS-007, FS-008).

## Acceptance Criteria

- [ ] A table-driven test covers every rule, with at least one blocked and one
  allowed variant per rule. It includes all eight probe commands above with
  their intended results, extra whitespace, `git -C dir …`, chained commands,
  and an `sh -c` wrapper.
- [ ] A Claude Code `PreToolUse` payload for a blocked command exits 2 with the
  maintainer's message on stderr. An allowed one exits 0 with no output. A
  malformed payload is handled as the ticket states.
- [ ] `agent-framework guardrail add claude-code` previews the exact
  `.claude/settings.json` change and writes only with its token. It keeps
  every other key and hook, creates the file only if it is missing, and refuses
  a duplicate or an unparseable file with nothing written. `remove` reverses
  exactly that entry.
- [ ] Without the maintainer's confirmed token nothing is written, and base
  setup and `agent-framework setup` never register the guardrail.
- [ ] The `framework-setup` skill offers the guardrail as an opt-in step with
  its preview, and the guide documents it for maintainers.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | every rule's blocked and allowed variants, the payload contract, the registration preview, confirm, remove, refusals, and an unchanged clone without a token | `npm run test:unit` | Yes — every behavior is observable at the script and the command |
| smoke | both | the installed skill's guardrail blocks a destructive payload and registers through the installed and linked skill | `npm run test:install` | Yes — teammates run the installed copy |

Frontend build and browser evidence are inapplicable.

## Blocked By

None — can start immediately.

## Unresolved Assumptions

None.

## Readiness

- [x] The outcome is a complete vertical behavior.
- [x] Acceptance criteria trace to the SRS and feature contract.
- [x] The public seam and first red test are identified.
- [x] Safeguards and non-goals are explicit.
- [x] Risks and resolved decisions are traced to the parent contract.
- [x] Blocking edges exist and are acyclic.
- [x] No unresolved assumption blocks the start.
- [x] The ticket fits one fresh implementation context.
- [x] User-facing and frontend evidence requirements are covered or explicitly inapplicable.
