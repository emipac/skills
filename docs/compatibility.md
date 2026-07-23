# Compatibility

## Coding clients

| Client | Installation path | Phase 6 validation |
| --- | --- | --- |
| Codex | Universal skills CLI or native Minic marketplace | Core lifecycle install plus native plugin validation |
| Claude Code | Universal skills CLI or native Minic marketplace | Core lifecycle install |
| Cursor | Universal skills CLI | Core lifecycle install |
| GitHub Copilot | Universal skills CLI | Core lifecycle install |
| OpenCode | Universal skills CLI | Core lifecycle install |

The universal installer may share `.agents/skills` between compatible clients;
Claude Code uses `.claude/skills`. Client-specific invocation UI remains owned
by each client. The framework relies only on the installed skill contract and
does not claim identical slash-command or marketplace UX.

## Project profiles

| Backend | Frontend | Support |
| --- | --- | --- |
| Laravel | none or Livewire | First class |
| Laravel | React/TypeScript or Svelte/TypeScript | First class |
| Express/TypeScript | none | First class |
| Express/TypeScript | React/TypeScript or Svelte/TypeScript | First class with confirmed source and command scopes |
| Plain JavaScript Express | any | Conservative `unknown` profile |
| Other Node.js frameworks | any | Conservative `unknown` profile |

Workspace repositories require confirmed source scopes and explicit root
scripts. Automatic per-workspace command discovery is not part of Phase 6.
