# Cursor `beforeShellExecution` — observed contract

Observed for FS-007 on 2026-10-06, Cursor **3.23.23**, macOS, agent model as
Cursor reported it. The observation used a disposable Git repository with one
project hook registered in `.cursor/hooks.json`:

```json
{
  "version": 1,
  "hooks": {
    "beforeShellExecution": [
      { "command": "node .probe/recorder.mjs" }
    ]
  }
}
```

The recorder logged its input and environment. It answered
`{"permission":"deny","userMessage":"…","agentMessage":"…"}` for a command
containing the marker `PROBE_DENY`, and `{"permission":"allow"}` otherwise,
always exiting 0. The agent was asked to run `echo hello`, then
`echo PROBE_DENY`.

## What was observed

- **The hook fired before each shell command**, once per command, with
  `hook_event_name: "beforeShellExecution"`.
- **The input is one JSON object on stdin.** Fields observed:
  - `command` (the full command string);
  - `cwd` (an **empty string** in this run, so it is not a reliable working
    directory);
  - `sandbox` (`true`);
  - `hook_event_name`, `cursor_version`, `workspace_roots` (an array with the
    project root), `model`, `conversation_id`, `generation_id`, `session_id`,
    `transcript_path` (`null`);
  - `user_email`. This is personal data: the guardrail must never log or echo
    the payload.
- **Environment.** `CURSOR_PROJECT_DIR` was set to the project root, and the
  hook's working directory (`PWD`) was the project root, so a relative command
  such as `node .probe/recorder.mjs` resolved.
- **Allow.** `{"permission":"allow"}` with exit 0: `echo hello` ran and printed
  `hello`.
- **Deny.** `{"permission":"deny", …}` with exit 0: `echo PROBE_DENY` did not
  run. The agent reported "Command execution was blocked by a hook" and did not
  quote the `agentMessage` text.
- **Not established:**
  - whether the `userMessage` text was shown to the person in Cursor's UI (not
    reported);
  - whether the `agentMessage` text reached the model (the agent's words did not
    include it);
  - how a non-zero exit code, or output that is not JSON, is treated.

## What FS-007 takes from this

- Block with `{"permission":"deny","userMessage":…,"agentMessage":…}` on stdout
  and exit 0. Allow with `{"permission":"allow"}` and exit 0. Both messages
  carry the guardrail's `BLOCKED: …` text, but nothing should depend on either
  being shown.
- Read the command from `command`. Do not rely on `cwd`; the project root is
  `CURSOR_PROJECT_DIR` or `workspace_roots[0]`.
- Never record the payload. It carries `user_email`.
