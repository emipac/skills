# AI Skills Framework repository guidance

This repository is the Minic-maintained AI Skills Framework. It is derived from
Matt Pocock's skills and is evolving toward a deterministic, TDD-oriented
Laravel lifecycle with adaptable Livewire, React/TypeScript, and
Svelte/TypeScript frontend support.

## Repository structure

- `skills/<skill-name>/SKILL.md` contains released, installable skills.
- `experimental/` contains drafts that are not shipped.
- `deprecated/` contains retired skills that are not shipped.
- `docs/` contains human-facing documentation and the lifecycle plan.
- `.claude-plugin/` and `.codex-plugin/` expose the same released skill set.
- `.agents/plugins/marketplace.json` exposes the root Codex plugin.

Released skills must stay flat under `skills/`. Every released skill must be
listed in the top-level `README.md`; the Claude manifest must list the exact
same set. Experimental and deprecated skills must never be referenced by a
release manifest.

## Versioning and verification

`package.json` is the authoritative version. Run `npm run sync-version` after
changing it. Before handing off repository changes, run:

```bash
npm run validate
npm run test:unit
npm run test:install
```

Also run `claude plugin validate . --strict` when the Claude manifest changes,
when that CLI is available. The repository validator enforces the shared
manifest versions, flat released-skill layout, skill metadata, released-skill
parity, marketplace source, and relative Markdown links.

Invocation policy is client-specific. Codex skills that require explicit
invocation use `policy.allow_implicit_invocation: false` in
`agents/openai.yaml`; portable `SKILL.md` frontmatter stays within the shared
Agent Skills schema. See [.agents/invocation.md](./.agents/invocation.md).

`framework-setup` owns deterministic project discovery and configuration.
Changes to it must retain unit coverage proving repeat runs are byte-identical
and every discovered `AGENTS.md` remains byte-for-byte unchanged.

Do not automatically commit or push changes. Preserve upstream attribution in
`UPSTREAM.md`, `THIRD_PARTY_NOTICES.md`, `LICENSE`, and the upstream changelog
history.
