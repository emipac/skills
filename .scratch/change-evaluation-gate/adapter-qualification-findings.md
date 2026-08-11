# Adapter qualification — real-client findings (for TB-015)

Evidence gathered 2026-08-11 by driving real clients, per the Product Owner's
decision to qualify adapters against real event payloads rather than shipping
TB-013's injected-fixture assumptions as `supported`.

Raw captures: `scratchpad/native-captures/`.

## Hook registration per client (confirmed by the Product Owner)

Each surface registers its hook in a DIFFERENT file, and the file schemas are
not identical. `NFR-COMP-001` should record this per supported surface.

| Client | Hook file | Registration schema |
| --- | --- | --- |
| Claude Code | `.claude/settings.local.json` | hooks nested inside a general **settings** file alongside `permissions`; also valid in `.claude/settings.json` and `~/.claude/settings.json` |
| Codex | `.codex/hooks.json` | **dedicated** file; block shape verified byte-identical to Claude Code's |
| Cursor | `.cursor/hooks.json` | **dedicated**, independently versioned file with a materially different block shape |

Claude Code and Codex (identical, two-level with a matcher group):

```json
{ "hooks": { "Stop": [ { "matcher": "",
    "hooks": [ { "type": "command", "command": "…" } ] } ] } }
```

Cursor (one-level, no matcher, no type discriminator, top-level version):

```json
{ "version": 1, "hooks": { "stop": [ { "command": "…" } ] } }
```

### Finding 8 — registration differs at BOTH file and schema level

Four independent divergences:

1. **File** — a general settings file (Claude Code) vs a dedicated hooks file
   (Codex, Cursor).
2. **Nesting** — Cursor registers a flat `[{ command }]`; the other two require
   a matcher group wrapping a typed inner array.
3. **Discriminators** — Cursor has neither `matcher` nor `type`.
4. **Schema versioning** — only Cursor carries a top-level `"version": 1`, so
   only Cursor can signal a future breaking change in its own registration
   format.

Activation therefore cannot assume one registration mechanism across desktop
surfaces, and `gate status` cannot reconcile them by reading a single path or
shape. TB-011's hook-chain composition work considered only Git.

### Finding 9 — event casing is consistent WITHIN each client

Cursor uses lowercase `stop` in BOTH its registration key and its
`hook_event_name` payload value. Claude Code and Codex use capitalised `Stop`
in both. So one declared event name per adapter can serve both registration and
trigger matching — but only per client, never shared across clients.

This is the second independent axis of divergence (after payload shape), and it
is the concrete reason the three adapters must keep separate declarations.

## claude-code-desktop — CAPTURED, all assumptions refuted

Environment: Claude Code, macOS 26.6.1 arm64, Node v24.6.0, git 2.51.0.
Hook: `Stop` in `.claude/settings.local.json`, `type: command`.

Observed payload top-level keys:
`session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`,
`effort`, `hook_event_name`, `stop_hook_active`, `last_assistant_message`,
`background_tasks`, `session_crons`.

| Adapter declaration (TB-013) | Observed reality | Verdict |
| --- | --- | --- |
| `nativeIdentity.event: 'event'` | `hook_event_name` | wrong |
| `nativeIdentity.repositoryRoot: 'workspace.path'` | `cwd` (see caveat) | wrong |
| `nativeIdentity.sessionId: 'session.id'` | `session_id` | wrong |
| `nativeEvents['work-complete']: 'code-tab.turn-completed'` | `Stop` | wrong |
| `nativeEvents['commit-attempt']: 'code-tab.before-commit'` | no such event | wrong |

### Finding 1 — no commit-attempt event exists

Claude Code's hook events are `PreToolUse`, `PostToolUse`, `Stop`,
`SubagentStop`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`,
`Notification`, `PreCompact`, `ConfigChange`, `FileChanged`. None is a
before-commit event.

**Action:** `claude-code-desktop` must declare `work-complete` ONLY, and its
`capabilities.event.normalizedTriggers` must drop `commit-attempt` — matching
how `codex-desktop` already handles the same absence. Deriving one from
`PreToolUse` + a Bash matcher would be a guessed trigger, which `FR-ADAPT-003`
forbids.

### Finding 2 — `cwd` is NOT the repository root

Observed `cwd` was `/Users/emipac/www/ai skill framework`, which is **not a git
repository**; the repository root is the `ai-skills-framework` subdirectory.
`CLAUDE_PROJECT_DIR` carried the same non-repo path.

The synthetic fixtures always supplied a root that was already a repository, so
this was structurally invisible to TB-013.

**Action:** the adapter must RESOLVE a repository root from `cwd` rather than
assume `cwd` is one, and must return `unverified` (never guess) when no
repository can be resolved. This is a behaviour change, not just a field rename,
and needs its own red-green cycle.

### Finding 3 — the native payload carries conversation content

`last_assistant_message` holds the full previous assistant reply and
`transcript_path` points at the entire conversation transcript.

This VALIDATES TB-013's design: it normalizes exactly three fields and has a
test asserting no native payload field reaches gate core. Forwarding raw native
payloads into Evidence would breach `SG-SECRET-001`. Do not relax that boundary
when correcting the field paths.

## codex-desktop — CAPTURED, all assumptions refuted

Environment: Codex, model `gpt-5.6-sol`, macOS 26.6.1 arm64. Captured from
`/Users/emipac/www/gms`, which IS a git repository root.

Observed payload top-level keys:
`session_id`, `turn_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`,
`permission_mode`, `stop_hook_active`, `last_assistant_message`.

| Adapter declaration (TB-013) | Observed reality | Verdict |
| --- | --- | --- |
| `nativeIdentity.event: 'type'` | `hook_event_name` | wrong |
| `nativeIdentity.repositoryRoot: 'project.root'` | `cwd` | wrong |
| `nativeIdentity.sessionId: 'conversationId'` | `session_id` | wrong |
| `nativeEvents['work-complete']: 'project.task-finished'` | `Stop` | wrong |
| (no `commit-attempt` declared) | none observed | **correct** |

A deterministic local event DOES exist and can invoke a child process, so this
surface is not disqualified under `FR-ADAPT-006`.

### Finding 7 — `cwd` is a repository root SOMETIMES

Codex's `cwd` was a git repository root. Claude Code's was not (Finding 2).
Both behaviours are now observed in the wild from the same field.

This is conclusive: the adapter must RESOLVE a repository root and report
`unverified` when it cannot. Neither "assume `cwd` is the root" nor "assume it
is not" is correct, and no fixture would have revealed this because a fixture
author picks one behaviour and encodes it.

### The one thing TB-013 got right

`codex-desktop` declared NO `commit-attempt` mapping, with a comment reasoning
that the surface exposes no deterministic pre-commit event. That conservative
non-declaration is the single correct call in the whole declaration set, and it
was reached by refusing to invent — the same instinct that should now be
applied to `claude-code-desktop` (Finding 1).

## cursor — CAPTURED, all assumptions refuted

Environment: Cursor **3.15.6** (from `cursor_version` in the payload), macOS
26.6.1 arm64. Hook fired on agent stop; captured from a different local
workspace (`/Users/emipac/www/tudakozda`), which does not affect payload shape.

Observed payload top-level keys:
`conversation_id`, `generation_id`, `model`, `model_id`, `model_params`,
`status`, `loop_count`, `input_tokens`, `output_tokens`, `cache_read_tokens`,
`cache_write_tokens`, `session_id`, `hook_event_name`, `cursor_version`,
`workspace_roots`, `user_email`, `transcript_path`.

| Adapter declaration (TB-013) | Observed reality | Verdict |
| --- | --- | --- |
| `nativeIdentity.event: 'name'` | `hook_event_name` | wrong |
| `nativeIdentity.repositoryRoot: 'folder.path'` | `workspace_roots` (ARRAY) | wrong |
| `nativeIdentity.sessionId: 'agentRunId'` | `session_id` | wrong |
| `nativeEvents['work-complete']: 'agent.run-finished'` | `stop` (lowercase) | wrong |
| `nativeEvents['commit-attempt']: 'agent.before-commit'` | not observed | unverified |

### Finding 4 — `workspace_roots` is an ARRAY, not a scalar path

Observed `workspace_roots: ["/Users/emipac/www/tudakozda"]`. That value WAS a
git repository root in this capture, unlike Claude Code's `cwd`.

Two consequences:
- `readDeclaredPath` resolves dotted paths to scalars. An array breaks that
  contract, so the adapter needs an explicit multi-root rule rather than a
  field rename.
- Cursor supports multi-root workspaces. With more than one root there is no
  single repository root, and picking `[0]` would be a guess. Per
  `SG-EVAL-001`/`FR-ADAPT-005` that case must be `unverified`.

### Finding 5 — event-name CASE differs between clients

Claude Code sends `"Stop"`; Cursor sends `"stop"`. Both use the same key name,
`hook_event_name`. Trigger matching is exact-string today, so casing must be
declared per adapter — do NOT introduce a blanket case-insensitive compare,
which would erase a real per-client distinction.

### Finding 6 — the Cursor payload contains PII

`user_email` carries the end user's email address, alongside
`transcript_path`, model identity, and token counts.

Combined with Claude Code's `last_assistant_message`, this is now proven across
TWO clients: native payloads carry user content and personal data.
`SG-SECRET-001` therefore depends on TB-013's normalize-three-fields boundary
holding. **Treat the raw capture files as sensitive**; do not copy their
contents into committed evidence, tests, or fixtures. Any fixture derived from
them must use synthetic values.

### Useful for the compatibility manifest

`cursor_version` is self-reported in every payload, giving `NFR-COMP-001` an
exact client version without probing the app.

## Consequence for TB-015

All three clients captured. **14 declared mappings tested: 13 refuted, 1
unverified** (Cursor's `commit-attempt`, not observable from a stop capture).
One conservative NON-declaration was correct. Zero declared mappings survived.

Do not record any desktop surface as `supported` on fixture evidence alone;
that is exactly the `SG-SUPPORT-001` failure this exercise exists to prevent.

### Observed payload-key overlap

| Key | claude-code | codex | cursor |
| --- | --- | --- | --- |
| `hook_event_name` | yes | yes | yes |
| `session_id` | yes | yes | yes |
| `transcript_path` | yes | yes | yes |
| `cwd` | yes | yes | — |
| `workspace_roots` | — | — | yes (array) |
| `last_assistant_message` | yes | yes | — |
| `permission_mode`, `stop_hook_active` | yes | yes | — |
| `user_email`, `cursor_version`, token counts | — | — | yes |

Event value casing: `"Stop"` (claude-code), `"Stop"` (codex), `"stop"` (cursor).

### Do NOT collapse the three adapters into one shared mapping

`hook_event_name` and `session_id` are universal today, and claude-code and
codex are near-identical. Sharing one normalization would be the obvious
refactor and it would be WRONG: `FR-ADAPT-004` requires each adapter to declare
its own contract precisely so one client's change cannot silently redefine
another's. Today's convergence is an observation, not a guarantee — Cursor
already diverges on both repository root and casing. Keep three declarations.

### The correction is not a rename

Three of the six findings are behavioural, not field-path, changes and each
needs its own red-green cycle:

1. **Finding 2** — resolve a repository root from `cwd` instead of assuming one;
   `unverified` when none resolves.
2. **Finding 4** — handle `workspace_roots` as an array; `unverified` when a
   multi-root workspace gives no single repository root.
3. **Finding 1** — drop `commit-attempt` from `claude-code-desktop` entirely,
   including its `normalizedTriggers`.

### Cross-client observations worth keeping

- Both captured clients use the key `hook_event_name`, but with different value
  casing (`Stop` vs `stop`). Convergent conventions, non-identical values.
- Neither client's real payload resembles the dotted, namespaced event names
  TB-013 invented (`code-tab.turn-completed`, `agent.run-finished`). The
  fixtures were internally consistent and externally fictional — which is
  precisely why fixture-only evidence cannot establish support.
- Raw captures contain conversation text and PII. Keep them out of the repo.
