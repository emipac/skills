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

Setup records a versioned Laravel/frontend profile, proved capabilities, and
exact commands. The planner selects only relevant layers, preserves configured
command order, and explains every skip. It never guesses a replacement command.

User-facing work requires smoke or browser evidence. Frontend changes require
the configured production build. Completion requires an evidence row for every
required command with its exact outcome after the final relevant change.
