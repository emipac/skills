# Framework Router

```bash
npx skills add emipac/skills --skill framework-router
```

[Source](https://github.com/emipac/skills/tree/main/skills/framework-router)

`framework-router` maps a request onto the preserved lifecycle: discovery and
grilling, specification, tracer-bullet tickets, TDD implementation, and review.
It also routes incoming issues through triage, difficult failures through bug
diagnosis, and multi-session uncertainty through wayfinder.

The router performs no downstream work itself. When an engineering flow lacks
`.agent-framework.yaml`, it routes to `framework-setup` first.
