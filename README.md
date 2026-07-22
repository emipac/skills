# AI Skills Framework

AI Skills Framework is Minic's installable development lifecycle for Laravel backends with Livewire or TypeScript frontends using React or Svelte.

It keeps Matt Pocock's composable, language-agnostic engineering skills as the backbone and selectively adds OpenSPDD-inspired risk analysis, safeguards, traceability, and intent-drift checks. Delivery favors comprehensive SRS documents, vertical tracer-bullet tickets, test-driven implementation, deterministic verification, and contract-aware review.

> **Status:** Phase 5 development: planning and delivery contracts are published as `v0.4.0`; deterministic verification and three-axis review are being prepared for `0.5.0`.

## Install with the universal skills CLI

```bash
npx skills@latest add emipac/skills
```

Choose the skills and supported coding agents you want the installer to configure.

## Install as a Codex plugin

Add the repository marketplace:

```bash
codex plugin marketplace add emipac/skills
```

Then install **AI Skills Framework** from the Minic marketplace in Codex.

## Install as a Claude Code plugin

```text
/plugin marketplace add emipac/skills
/plugin install ai-skills-framework@minic
```

## Framework principles

- Keep product intent, implementation truth, executable evidence, and delivery sequencing in distinct artifacts.
- Use a comprehensive SRS as the durable requirements baseline.
- Decompose work into independently verifiable vertical tracer bullets.
- Prefer public testing seams and red-green-refactor delivery.
- Treat safeguards and prohibited behavior as explicit ticket constraints.
- Run static analysis, tests, smoke checks, and browser verification according to impact.
- Review standards, contract alignment, drift, and evidence independently.
- Synchronize only durable behavioral, domain, and architectural knowledge.
- Never commit, push, or modify generated `AGENTS.md` files without explicit authorization.

See [the development plan](./docs/skill-framework-development-plan.md) for the lifecycle, delivery phases, release cadence, and `1.0.0` criteria.

## Released skills

The `skills/` directory contains only released skills. Experimental, personal, miscellaneous, and deprecated upstream material lives outside the released discovery path.

### Explicitly invoked workflows

- **[framework-router](./skills/framework-router/SKILL.md)** — Route a situation to the appropriate lifecycle branch.
- **[framework-setup](./skills/framework-setup/SKILL.md)** — Discover project instructions and write the protected, idempotent lifecycle configuration.
- **[grill-with-docs](./skills/grill-with-docs/SKILL.md)** — Sharpen a plan while maintaining domain terminology and ADRs.
- **[srs-modeling](./skills/srs-modeling/SKILL.md)** — Create, surgically refine, and audit the durable requirements baseline.
- **[triage](./skills/triage/SKILL.md)** — Move issues through configured triage roles.
- **[improve-codebase-architecture](./skills/improve-codebase-architecture/SKILL.md)** — Find deep-module opportunities and guide the selected improvement.
- **[to-spec](./skills/to-spec/SKILL.md)** — Extract one traceable, safeguard-aware feature contract from the SRS.
- **[to-tickets](./skills/to-tickets/SKILL.md)** — Produce ready vertical delivery contracts with an acyclic blocker graph.
- **[implement](./skills/implement/SKILL.md)** — Orchestrate one ready contract through red-green evidence, explicit amendments, verification, and review.
- **[wayfinder](./skills/wayfinder/SKILL.md)** — Resolve multi-session planning uncertainty through a decision map.
- **[grill-me](./skills/grill-me/SKILL.md)** — Interview a plan or design until its decision branches are resolved.
- **[handoff](./skills/handoff/SKILL.md)** — Create a compact continuation artifact.
- **[teach](./skills/teach/SKILL.md)** — Teach a skill or concept through a stateful multi-session process.
- **[writing-great-skills](./skills/writing-great-skills/SKILL.md)** — Apply predictable skill-authoring vocabulary and principles.

### Supporting disciplines

- **[prototype](./skills/prototype/SKILL.md)** — Build a disposable artifact to answer a design question.
- **[diagnosing-bugs](./skills/diagnosing-bugs/SKILL.md)** — Reproduce, minimize, hypothesize, instrument, fix, and regression-test.
- **[research](./skills/research/SKILL.md)** — Investigate against high-trust primary sources.
- **[tdd](./skills/tdd/SKILL.md)** — Deliver one behavior at a time through public seams.
- **[domain-modeling](./skills/domain-modeling/SKILL.md)** — Maintain precise domain terminology and durable decisions.
- **[codebase-design](./skills/codebase-design/SKILL.md)** — Design deep modules at clean seams.
- **[verify-change](./skills/verify-change/SKILL.md)** — Plan and audit configured Laravel and frontend evidence from focused checks through broad suites.
- **[code-review](./skills/code-review/SKILL.md)** — Review Standards, Contract, and Evidence independently.
- **[resolving-merge-conflicts](./skills/resolving-merge-conflicts/SKILL.md)** — Resolve merge and rebase conflicts from source intent.
- **[grilling](./skills/grilling/SKILL.md)** — Provide the reusable decision interview loop.

## Repository layout

```text
skills/          released installable skills
experimental/    drafts and non-promoted upstream utilities
deprecated/      retired upstream skills
docs/            human-facing documentation and development plan
scripts/         deterministic validation, version, and install checks
.codex-plugin/   Codex plugin manifest
.claude-plugin/  Claude plugin and marketplace manifests
```

## Versioning

The package uses Changesets and semantic versions.

- During `0.x`, milestone minors correspond to framework phases and compatible fixes are batched weekly.
- After `1.0.0`, compatible minors follow a two-week release train.
- Urgent installation, security, or destructive-behavior fixes may release immediately.
- Package and plugin versions are synchronized from `package.json`.

## Provenance

AI Skills Framework is derived from:

- [Matt Pocock skills](https://github.com/mattpocock/skills), used as the lifecycle backbone.
- [OpenSPDD](https://github.com/gszhangwei/open-spdd), used selectively for analysis and safeguard concepts.

See [UPSTREAM.md](./UPSTREAM.md), [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md), and [LICENSE](./LICENSE).
