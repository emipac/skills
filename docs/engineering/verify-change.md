# Verify Change

```bash
npx skills add emipac/skills --skill verify-change
```

[Source](https://github.com/emipac/skills/tree/main/skills/verify-change)

`verify-change` converts the delivery contract and `.agent-framework.yaml`
into an impact-based evidence ladder:

```text
focused → format → static analysis → affected tests → smoke → build → browser → broad tests
```

Setup records a versioned Laravel or Express/TypeScript profile, confirmed source
scopes, proved capabilities, and exact commands partitioned by backend, frontend,
or both. The planner classifies changed files against those scopes, preserves
configured command order, and explains every skip or ambiguous classification. It
never guesses a replacement command.

Shared, tied, and unmatched files affect every configured active profile.
`none` means that profile is inactive and is never synthesized; `unknown`
remains active and conservative. A production frontend build is required only
when a real configured frontend profile is affected.

User-facing work requires smoke or browser evidence. Completion requires an evidence row for every
required command with its exact outcome after the final relevant change.
