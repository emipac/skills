# Stopped Cursor running a command that destroys work

Delivered FS-007. The FS-006 guardrail stopped only Claude Code, so Cursor's
agent could still run `git reset --hard` or a forced push in a framework-set-up
repository.

The Cursor contract was observed, not assumed. On Cursor 3.23.23 (macOS), the
maintainer ran a probe `beforeShellExecution` hook in a throwaway repository.
The record, with personal data removed, is
`.scratch/framework-scripts/cursor-before-shell-observation.md`. It showed:

- the hook runs once before each shell command, with one JSON object on
  standard input;
- the command is in `command`, and `cwd` was empty;
- `CURSOR_PROJECT_DIR` is set, and the hook runs in the project root;
- `{"permission":"deny","userMessage":…,"agentMessage":…}` with exit 0 stops
  the command, and `{"permission":"allow"}` with exit 0 lets it run;
- the payload carries `user_email`.

Not established: whether either message is shown to the person or to the
model, and how a non-zero exit or output that is not JSON is treated.

- `skills/framework-setup/scripts/guardrail.mjs` takes `--client cursor`. It
  then reads `command` and prints the observed answer on standard output,
  exiting 0. Both messages carry FS-006's `BLOCKED: …` line, and the rules are
  unchanged. A payload without a `command` string is allowed with
  `{"permission":"allow"}` and a one-line notice on standard error. Arguments it
  does not know allow the command with a notice and no answer. Nothing from the
  payload but the command is ever echoed. With no argument, Claude Code is
  answered exactly as before.
- `GUARDRAIL_CLIENTS` in `configure.mjs` now gives each client its own
  file, event, entry shape, seed, and round-trip rule. Cursor's entry is one
  flat `{ "command": "node <path>/guardrail.mjs --client cursor" }` under
  `beforeShellExecution` in `.cursor/hooks.json`:
  - **Path.** The path is relative to the repository. The observed hook ran in
    the project root, and the observation's own probe ran as
    `node .probe/recorder.mjs`. A path naming `CURSOR_PROJECT_DIR` would have to
    be spelt differently for POSIX shells, `cmd`, and PowerShell.
  - **Quoting.** Cursor's quoting was not observed, so the path must be one
    every shell passes through unquoted: letters, digits, `.`, `_`, `-`, `/`,
    not starting with `-`. A skill at any other path, one with a space say, is
    refused as `guardrail-path-unsafe`. FS-006's `guardrail-outside-project` and
    `guardrail-ignored` refusals hold.
  - **Missing file.** It is created as `{"version": 1, "hooks": {…}}`. An
    existing file's version is never changed or added.
  - **Round trip.** The file must round-trip in its own indentation, the
    indentation the Gate's registration keeps.
  - **Remove** keeps the `hooks` object, so the `{"version": 1, "hooks": {}}`
    seed the skill documents comes back exactly.
- `agent-framework guardrail add|remove cursor` and `configure.mjs
  --guardrail add|remove --client cursor` drive it. The text preview names
  "one beforeShellExecution entry".
- Step 7 of the skill offers the guardrail for `claude-code`, `cursor`, or
  both. The command reference documents the Cursor entry, the observed
  contract, and the new refusal. Section 04 of the guide says what was seen on
  Cursor 3.23.23, in plain words.

Verification: the first red test, a Cursor payload for `git reset --hard`
answered with the observed deny on stdout and exit 0, failed before the change.

- `tests/guardrail-cursor.test.mjs` covers every FS-006 rule in Cursor's
  answer, allowed commands, malformed payloads, unknown arguments, the email
  never appearing in any output, and the Claude path unchanged.
- `tests/guardrail-cursor-registration.test.mjs` covers:
  - preview, confirm, and remove;
  - a Gate entry kept byte for byte in 2-space, 4-space, and tab files, and
    restored on remove;
  - the seeded file restored, and an unversioned file left unversioned;
  - every refusal leaving the clone hash unchanged;
  - a project path with a space;
  - the direct path;
  - a clone the Gate activated for Cursor staying `healthy` through add and
    remove.
- `gate-activation-smoke` gained `guardrail-beside-activated-cursor`. On a clone
  the packaged command activated for Cursor, it registers the guardrail through
  the skill installed in that clone and checks:
  - the Gate entry kept;
  - status healthy;
  - a real deny and allow;
  - removal restoring the file.
- `npm run test:install` registers, runs, and removes the Cursor entry through
  the installed and the linked skill.

Limits:

- FS-006's limits hold. It guards against accidents and is not a security
  boundary.
- In Cursor the person and the agent may see only that a hook blocked the
  command, not the rule.
- If a broken install made `node` fail, Cursor's handling of the non-zero exit
  is unknown: it might let every command through, or block every one.
- Only `"version": 1` was observed, and a file with another version is not
  refused.
- Codex follows in FS-008.
