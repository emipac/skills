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
