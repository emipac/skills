# Invocation policy across clients

Every released `SKILL.md` follows the portable Agent Skills frontmatter schema.
Client-specific invocation controls belong in that client's metadata rather
than in shared frontmatter.

- **Explicitly invoked** — Codex uses
  `policy.allow_implicit_invocation: false` in `agents/openai.yaml`. Keep the
  skill description concise and avoid broad automatic trigger phrases.
- **Model-invoked** — omit that policy and describe the situations in which the
  model should reach for the skill.

The inherited repository used Claude Code's non-portable
`disable-model-invocation` frontmatter. It is intentionally absent from the
cross-client baseline because the native Codex plugin validator rejects it.
Clients do not currently expose identical invocation controls, so lifecycle
safety must also come from explicit confirmation gates, safeguards, and
authorization rules inside orchestration skills. Phase 2 must review these
controls while adapting the inherited router and setup skills.

Dependencies are expressed as `/skill`-style prose invocation, not deep
cross-skill file references. Shared reference documents live inside the skill
that owns them.
