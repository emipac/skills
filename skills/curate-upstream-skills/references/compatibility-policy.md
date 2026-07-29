# Curated intake compatibility policy

Use this policy as the single source of truth for automatic port eligibility.
The analyzer proves structural compatibility; an agent still inspects upstream
intent and the resulting diff.

## Path mapping

Map released upstream skills from:

- `skills/engineering/<skill>/...` to `skills/<skill>/...`;
- `skills/productivity/<skill>/...` to `skills/<skill>/...`.

Treat repository documentation, personal, miscellaneous, in-progress,
deprecated, and unknown upstream categories as `no-port` unless the user starts
a separate promotion decision.

These intentional adaptations always require manual review:

| Upstream skill | Local skill |
| --- | --- |
| `ask-matt` | `framework-router` |
| `setup-matt-pocock-skills` | `framework-setup` |
| `code-review` | `code-review` |
| `grill-with-docs` | `grill-with-docs` |
| `implement` | `implement` |
| `to-spec` | `to-spec` |
| `to-tickets` | `to-tickets` |
| `triage` | `triage` |
| `wayfinder` | `wayfinder` |
| `writing-great-skills` | `writing-great-skills` |

Minic-owned skills without an upstream mapping are outside this intake.

## Auto-port gate

Classify a skill as `auto-port` only when every changed path for that skill
satisfies all applicable gates:

1. The mapped local skill already exists.
2. The upstream status is added or modified; deletion and rename require manual
   review.
3. The changed file is Markdown. Scripts, executable files, manifests, YAML,
   dependencies, hooks, and configuration require manual review.
4. A changed `SKILL.md` preserves its complete YAML frontmatter.
5. A modified file has a conflict-free three-way merge using the last-reviewed
   upstream file as base, the local file as current, and upstream head as
   incoming.
6. An added file does not collide with a local path.
7. The local target has no uncommitted change before intake.
8. Every related path for the same skill passes; port the upstream skill change
   atomically.

A clean merge is evidence of structural compatibility, not semantic safety.
Commit inspection and post-apply diff review remain required completion gates.

## Dispositions

- `auto-port`: every gate passes; guarded application is allowed.
- `manual-review`: an upstream-derived skill changed but at least one gate is
  unresolved, protected, conflicting, executable, destructive, or ambiguous.
- `no-port`: the change does not target a released upstream-derived skill.

Classify new upstream skills as `manual-review` only when the user explicitly
asks to assess promotion; otherwise use `no-port`.
