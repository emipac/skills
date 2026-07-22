# Framework Setup

```bash
npx skills add emipac/skills --skill framework-setup
```

[Source](https://github.com/emipac/skills/tree/main/skills/framework-setup)

`framework-setup` deterministically discovers Laravel and frontend profiles,
SRS and domain artifacts, repository guidelines, history policy, protected
instruction files, and verification commands. After confirmation it writes
`.agent-framework.yaml` and the selected tracker reference.

Local Markdown, GitHub Issues, Jira, and Linear are first-class adapters.
Repeated configuration is byte-identical, and automated tests prove setup
leaves every discovered `AGENTS.md` unchanged.
