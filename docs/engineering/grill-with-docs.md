Quickstart:

```bash
npx skills add emipac/skills --skill grill-with-docs
```

```bash
npx skills update grill-with-docs
```

[Source](https://github.com/emipac/skills/tree/main/skills/grill-with-docs)

## What it does

`grill-with-docs` interviews you relentlessly about a plan or design, one question at a time, until you and the agent reach a shared understanding — and it writes each accepted decision to its owning artifact as it goes.

The grilling **leaves a paper trail**. Product behavior and constraints go to
the configured SRS through `srs-modeling`, canonical terms go to the glossary,
and hard, one-way architectural decisions go to ADRs. Each meaning has one
owner, with links instead of duplicated prose.

## When to reach for it

You invoke this by typing `/grill-with-docs` — the agent won't reach for it on its own.

Reach for it at the very start of a change, when the plan is still fuzzy and the domain language isn't settled, and you want to stress-test both before any code exists. If you only want the interview and don't need the artifacts, use [grilling](https://aihero.dev/skills-grilling); if the plan is already clear and you just need to pin down or record terminology, use [domain-modeling](https://aihero.dev/skills-domain-modeling). And if the change is too big to hold in one session and its route is still foggy — a greenfield project, a huge feature build — start upstream with [wayfinder](https://aihero.dev/skills-wayfinder): it charts the effort as a map of decisions, then hands back to this main flow once the way is clear.

## Prerequisites

This skill is stateful. Run `framework-setup` first so the SRS, glossary, ADR,
guideline, and protected-file paths are explicit. The configured `AGENTS.md`
files remain read-only.

## The grill

The engine is a **grill**: a relentless, one-question-at-a-time walk down the decision tree, resolving dependencies between decisions before moving on, with a recommended answer offered for every question. Questions the codebase can answer are answered by reading the codebase, not by asking you.

What makes this variant its own skill is where the answers go. As the grill runs, fuzzy language gets sharpened into canonical terms and written to the glossary inline — not batched at the end. The glossary stays a glossary: pure vocabulary, no implementation details, no spec. ADRs are offered sparingly, only when a decision is hard to reverse, surprising without context, and the result of a real trade-off. Most sessions produce a sharper glossary and few or no ADRs, and that's the intended shape.

## It's working if

- It asks one question at a time and waits, rather than dumping a questionnaire.
- Product decisions update the configured SRS through `srs-modeling`; terms and ADRs retain their distinct ownership.
- It reaches into the codebase to answer its own questions where it can.
- ADRs stay rare — you're not asked to rubber-stamp reversible choices.

## Where it fits

`grill-with-docs` is the opening step of the main build chain:

```txt
grill-with-docs → srs-modeling → to-spec → to-tickets → implement → code-review
```

It produces the shared understanding that [srs-modeling](./srs-modeling.md)
records as durable requirements before `to-spec` extracts one feature slice.
Its close neighbours are `grilling`, the interview primitive, and
`domain-modeling`, the glossary-and-ADR discipline it drives. When you're
unsure which flow fits, [framework-router](./framework-router.md) routes you.
