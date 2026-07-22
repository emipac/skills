# Upstream provenance

AI Skills Framework is maintained by Minic as a derivative of two MIT-licensed projects.

## Matt Pocock skills

- Repository: https://github.com/mattpocock/skills
- Fork baseline: `ed37663cc5fbef691ddfecd080dff42f7e7e350d`
- Role: lifecycle backbone, composable engineering workflows, tracer-bullet decomposition, TDD, domain modeling, deep-module vocabulary, and code review.
- License: MIT, Copyright (c) 2026 Matt Pocock.

The Git remote named `upstream` must continue to point to `git@github.com:mattpocock/skills.git`. Upstream changes are reviewed and ported intentionally; they are never merged blindly across AI Skills Framework contracts.

## OpenSPDD

- Repository: https://github.com/gszhangwei/open-spdd
- Analysis baseline: `a44f9dca3053d1c508fc973217b94d72289d65ea`
- Role: source of selected risk analysis, safeguards, scope-boundary checks, implicit-decision checks, intent-drift detection, and durable synchronization concepts.
- License: MIT, Copyright (c) 2026 gszhangwei.

OpenSPDD's Java/Spring vocabulary, exhaustive class and method inventories, immutable Operations scripts, and batch generation are not adopted.

## Adaptation policy

- Preserve Matt Pocock's language-agnostic vocabulary unless an intentional framework decision says otherwise.
- Record material deviations from upstream in the changelog or an ADR.
- Attribute copied or substantially adapted text to its source.
- Keep AI Skills Framework artifacts, configuration schemas, and Laravel/TypeScript profiles owned by Minic.
- Treat code as implementation truth, tests as behavioral evidence, and long-lived documents as durable intent rather than mirrors of implementation details.

## Intentional divergences

### Phase 2 — framework setup and routing

- Renamed upstream `ask-matt` to `framework-router`; its flow, tracer-bullet
  vocabulary, wayfinder on-ramp, and supporting disciplines remain intact.
- Replaced `setup-matt-pocock-skills` with `framework-setup` and a versioned
  `.agent-framework.yaml` contract.
- Replaced prompt-only setup writes to `AGENTS.md` or `CLAUDE.md` with a
  deterministic script that treats instruction files as read-only inputs.
- Added Laravel, Livewire, React/TypeScript, and Svelte/TypeScript discovery.
- Made local Markdown, GitHub Issues, Jira, and Linear first-class tracker
  adapters. GitLab remains available in upstream history but is not a Phase 2
  framework contract.
- Updated dependent skills only at the configuration seam; their domain,
  architecture, TDD, vertical-slice, and review behavior remains upstream.
- Adapted `writing-great-skills` invocation guidance to portable Agent Skills
  frontmatter and client-specific implicit-invocation policy.

### Phase 3 — SRS lifecycle

- Added Minic-owned `srs-modeling`; upstream Matt skills do not prescribe a
  canonical comprehensive SRS or stable requirement identifier contract.
- Extracted the useful product, requirement, role, scenario, non-functional,
  risk, question, and acceptance structure of the Oldwood SRS while excluding
  its project-specific physical schemas, Filament menus, and implementation
  inventories.
- Added OpenSPDD-inspired safeguards and traceability as lightweight SRS
  constraints without adopting REASONS Operations or batch generation.
- Integrated normative SRS maintenance with `grill-with-docs`, `wayfinder`, and
  the lifecycle router while preserving upstream glossary and ADR ownership.

### Phase 4 — planning and delivery contracts

- Extended upstream `to-spec` with SRS traceability, concept/risk/gap analysis,
  safeguards, prohibited behavior, public evidence seams, and a deterministic
  `ready-for-tickets` gate.
- Extended upstream `to-tickets` while preserving tracer bullets, blocker
  edges, prefactoring, and the expand-migrate-contract exception. Each ticket
  now carries a lightweight delivery contract and deterministic readiness gate.
- Expanded upstream `implement` into the single implementation orchestrator:
  contract readiness, vertical red-before-green evidence, configured checks,
  review, and explicit authorization before commits or pushes.
- Replaced OpenSPDD REASONS Operations and batch generation with contracts that
  constrain outcomes while leaving private implementation learning to TDD.
- Added explicit contract amendments for accepted intent changes; incidental
  implementation details remain code truth and do not synchronize upstream.
