# Research cross-client hook and installation capabilities

Status: done
Parent: change-evaluation-gate
Assignee: Codex
Labels: wayfinder:research
Blocked by:

## Question

What current, documented lifecycle hooks, trust controls, project/global configuration locations, plugin or skill distribution mechanisms, invocation guarantees, and limitations do Cursor, Codex, Claude Code, and Git provide for implementing early feedback plus portable commit enforcement?

## Comments

### Resolution — 2026-08-04

[Cross-client hook and installation capabilities](../research/cross-client-hook-and-install-capabilities.md) establishes that no portable agent-hook runtime exists across Cursor, Codex, and Claude Code. Git `pre-commit` is the common local enforcement event but remains bypassable with `--no-verify`; native client hooks are early-feedback adapters and must capability-negotiate their event, blocking, trust, and execution guarantees. `npx skills` supports selective project/global skill installation but does not activate native hooks for Codex or Cursor, so installation and activation must remain separate.
