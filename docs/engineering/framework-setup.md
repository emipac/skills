# Framework Setup

```bash
npx skills add emipac/skills --skill framework-setup
```

[Source](https://github.com/emipac/skills/tree/main/skills/framework-setup)

`framework-setup` deterministically discovers Laravel or Express/TypeScript
backend profiles, frontend profiles, source-scope candidates, SRS and domain
artifacts, repository guidelines, history policy, protected instruction files,
and verification profiles. Schema version 3 records confirmed backend,
frontend, and shared roots plus proved, package-manager-correct commands scoped
to backend, frontend, or both. Safe qualified tests and smoke checks are
discovered, non-mutating format checks are preferred, source-root references
inform command scope, and explicit exclusions remove redundant or unsafe
commands. After confirmation it writes
`.agent-framework.yaml` and the selected tracker reference.

Schema v3 remains supported. An explicit previewed migration upgrades it to
schema v4, converts raw commands to OS-independent descriptors only when their
meaning is known, and requires mappings for ambiguity and every v3 `unknown`
profile. Schema v4 supports backend-only, frontend-only, full-stack, and
tooling-only repositories through symmetric `none` profile values. Preview is
read-only; installation requires the exact preview hash, writes atomically, and
does not configure or activate the Change Evaluation Gate.

When no SRS exists, setup reserves `docs/specifications/srs.md` for
`srs-modeling` without creating it. An explicit `null` remains available for
repositories that intentionally exclude an SRS.

Local Markdown, GitHub Issues, Jira, and Linear are first-class adapters.
Repeated configuration is byte-identical, and automated tests prove setup
leaves every discovered `AGENTS.md` unchanged.
