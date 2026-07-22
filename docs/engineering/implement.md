# Implement

```bash
npx skills add emipac/skills --skill implement
```

[Source](https://github.com/emipac/skills/tree/main/skills/implement)

`implement` is the single implementation orchestrator. It works one ready
delivery contract in one fresh context and refuses coding when blockers,
start-blocking assumptions, traceability, public seams, or evidence are
incomplete.

For every acceptance behavior it drives one vertical cycle:

1. Produce a targeted failure caused by the missing behavior at the agreed
   public seam.
2. Implement only enough end-to-end code to make the same command pass.
3. Record the red and green evidence.
4. Continue with the next behavior.

When implementation learning would change behavior, safeguards, non-goals,
acceptance evidence, public interfaces, or durable architecture, the skill
pauses and proposes a contract amendment. Work resumes only after an explicit
accepted, rejected, or deferred decision; incidental private implementation
details remain code truth.

After all cycles, it delegates the impact-based evidence ladder to
`verify-change`, then runs independent Standards, Contract, and Evidence review
passes. Accepted durable learning updates only its owning SRS, glossary, ADR,
tracker issue, or history artifact; private implementation remains code truth.
It commits or pushes only when explicitly requested.
