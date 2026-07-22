# Code Review

```bash
npx skills add emipac/skills --skill code-review
```

[Source](https://github.com/emipac/skills/tree/main/skills/code-review)

`code-review` pins one merge-base diff and evaluates it through three
independent axes:

- **Standards:** repository conventions plus a judgement-call code-smell
  baseline.
- **Contract:** SRS, feature, and delivery intent, including safeguards,
  non-goals, scope additions, implicit decisions, and unapproved drift.
- **Evidence:** acceptance coverage, red-green proof, exact final commands,
  skipped layers, and smoke or browser coverage.

The passes run in isolated subagents when the client supports them and the user
authorizes delegation; otherwise they run sequentially with separate working
notes. Findings remain separated and are never collapsed into one score.

Each finding cites the changed hunk and its rule, contract ID, or missing
evidence row. Review proposes fixes or contract-amendment decisions but does not
silently rewrite durable artifacts.
