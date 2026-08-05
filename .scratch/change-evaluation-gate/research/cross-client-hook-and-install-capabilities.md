# Cross-client hook and installation capabilities

Research date: 2026-08-04

## Question

Which documented lifecycle, blocking, trust, scope, distribution, and invocation
contracts can support early agent feedback while Git remains the portable commit
enforcement seam?

## Executive finding

There is no single portable agent-hook contract across Cursor, Codex, and Claude
Code. All three can run commands during their agent loops, but their event names,
decision payloads, trust controls, supported handler types, plugin systems, and
failure behavior differ. Git `pre-commit` is the only common local commit event,
and even it is bypassable with `--no-verify`.

The Change Evaluation Gate should therefore expose one client-independent CLI or
process interface. Git invokes it authoritatively for every enabled commit. Agent
hooks invoke the same interface earlier for feedback, but never count as commit
enforcement.

## Capability comparison

| Surface | Relevant lifecycle and blocking contract | Scope and trust | Distribution and material limits |
| --- | --- | --- | --- |
| Git | `pre-commit` runs before the commit is created; a non-zero exit aborts the commit. Git changes to the worktree root before invoking client-side hooks. | Hooks are executables under `$GIT_DIR/hooks` or a directory selected by `core.hooksPath`. Git has no per-hook review or hash-trust workflow. | Hooks are not propagated by cloning a repository. `git commit --no-verify` bypasses `pre-commit`; stronger enforcement therefore requires explicit bypass policy and, if needed later, CI or server-side verification. [Git hooks](https://git-scm.com/docs/githooks) |
| Codex | Lifecycle events include `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`, session, compaction, and subagent events. Command hooks receive JSON on stdin. A supported `PreToolUse` result can deny a Bash tool call, but the manual explicitly says specialized tool paths may opt out and tool hooks are not a complete enforcement boundary. | User and project hooks live in `hooks.json` or inline `config.toml`; enabled plugins may bundle hooks. Non-managed command hooks are skipped until the exact definition hash is reviewed and trusted. Managed hooks can be enforced by policy. | Only command handlers execute currently; prompt and agent handlers are parsed but skipped, and async command hooks are not supported. Plugin hooks use the same trust review. Codex can load `hooks/hooks.json` or a manifest `hooks` entry. [Codex hooks](https://developers.openai.com/codex/config-advanced#hooks) |
| Claude Code | Events include `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`, session, prompt, subagent, and additional lifecycle events. Command hooks receive JSON on stdin; exit codes and structured output can allow, block, or add context. Command, HTTP, MCP-tool, prompt, and experimental agent handlers are documented. Matching hooks run in parallel. | Hooks may be user-level, project-shared, project-local, managed, plugin-bundled, or scoped to active skill/agent frontmatter. Managed policy can restrict which hook sources run. The hooks reference documents policy and settings precedence rather than a Codex-style per-definition hash trust flow. | Plugins can bundle `hooks/hooks.json`; skill frontmatter hooks exist only while that skill is active. Model-backed prompt/agent handlers are not a deterministic enforcement substitute. Non-managed hooks may be disabled through settings. [Claude Code hooks](https://code.claude.com/docs/en/hooks), [hooks guide](https://code.claude.com/docs/en/hooks-guide) |
| Cursor | Cursor documents project hooks in `.cursor/hooks.json`, including `beforeShellExecution` for command decisions and `stop` for feedback loops. Hook scripts receive event data on stdin and return structured output. Cursor also supports broader tool, session, MCP, prompt, response, subagent, and cloud-agent events, but availability varies by event and surface. | Cursor supports project and user hook configuration, plugin-bundled hooks, marketplace review, and team/enterprise plugin distribution. Plugins can be project-scoped or user-level; enterprise marketplaces support Default Off, Default On, and Required installation modes. | Cursor plugins may bundle hooks, while ordinary Agent Skills are a separate portable format. Cursor hook behavior is agent-loop behavior, not coverage of human terminal commits. The stable design must capability-negotiate instead of assuming Claude or Codex event names and payloads. [Cursor hooks](https://cursor.com/docs/hooks), [Cursor plugins](https://cursor.com/docs/plugins.md), [official hook example](https://cursor.com/blog/agent-best-practices) |
| `npx skills` | The CLI installs Agent Skills; it does not define a universal lifecycle-hook runtime. | Project installation is the default and `--global` installs to user directories. `--skill`, `--agent`, and `--yes` support selective, targeted, non-interactive installation. | Its compatibility matrix reports hook support for Claude Code skills but not Codex or Cursor skills. It can deliver the gate skill and scripts, but cannot activate every native client hook or Git hook by itself. [skills CLI](https://github.com/vercel-labs/skills) |

## Local framework fit

- [`framework-setup`](../../../skills/framework-setup/SKILL.md) already owns
  discovery of exact project commands and writes schema version 3
  `.agent-framework.yaml`.
- [`verify-change`](../../../skills/verify-change/SKILL.md) already turns that
  configuration plus changed files and a delivery matrix into an ordered Evidence
  ladder.
- The current [Codex plugin manifest](../../../.codex-plugin/plugin.json) and
  [Claude plugin manifest](../../../.claude-plugin/plugin.json) distribute skills
  only; neither currently declares hooks.
- The current [configuration schema](../../../skills/framework-setup/references/agent-framework.schema.json)
  has no gate policy, adapter, activation, timeout, bypass, or evidence-attestation
  fields.

These facts favor deepening the existing verification seam rather than creating
a second Laravel-specific runner.

## Resolved constraints for later decisions

1. **Portable authority:** Git commit invocation is authoritative; agent hooks are
   preflight adapters only.
2. **One core interface:** every adapter must invoke the same client-independent
   gate interface and consume the same structured result.
3. **Separate installation from activation:** `npx skills` may install the skill
   project-locally or globally, but activation must deliberately register Git and
   selected native-client adapters.
4. **Native packaging remains useful:** Codex, Claude Code, and Cursor plugins can
   bundle their own adapters, but enabling a plugin must not silently imply that
   the repository-level commit gate is active.
5. **Capability negotiation:** adapters must declare supported events, blocking
   semantics, scope, and trust state. The shared interface must not emulate one
   client's event schema.
6. **No agent-only proof:** a successful agent hook is evidence of early feedback,
   not proof that the commit gate ran.
7. **Bypass is explicit:** local Git enforcement is bypassable. The policy ticket
   must decide authorization, audit evidence, and whether later CI/server
   enforcement is required.

## Bounded uncertainties

- Cursor's hook catalog is evolving across desktop, CLI, and cloud agents. The
  adapter design must pin a tested compatibility baseline rather than promise all
  documented events on every Cursor surface.
- Native plugin install and trust UX can change independently from the portable
  Agent Skills standard. Installation tests must validate hooks separately from
  existing skill-install smoke tests.
- Noninteractive and remote-agent execution environments may not expose the same
  filesystem, shell, or Git hook installation permissions as local clients. That
  behavior belongs in adapter compatibility tests, not in the shared interface.

## Sources

- [Git hooks documentation](https://git-scm.com/docs/githooks)
- [Codex hooks documentation](https://developers.openai.com/codex/config-advanced#hooks)
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)
- [Claude Code hooks guide](https://code.claude.com/docs/en/hooks-guide)
- [Cursor hooks documentation](https://cursor.com/docs/hooks)
- [Cursor plugin documentation](https://cursor.com/docs/plugins.md)
- [Cursor agent hook example](https://cursor.com/blog/agent-best-practices)
- [`npx skills` primary repository](https://github.com/vercel-labs/skills)
