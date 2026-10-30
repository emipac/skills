# Labelled configured Gate checks with their tool

A configured check was reported only by its generic identity, such as
`configuration.static-analysis.static-analysis.2`. The number is a position in
the list, so a maintainer could not tell which tool failed without reading the
command.

- A verification command in `.agent-framework.yaml` may carry an optional
  `label` (1 to 40 printable characters, one line), for example `"label": "phpstan"`.
- `gateChecksFromConfiguration` reads it off the entry, as it does
  `prerequisites`, and projects it onto the check descriptor. The closed Command
  shape is not widened.
- A labelled check's summary reads `label (id): outcome (reason)`; an unlabelled
  one is unchanged.
- The label is display text only. The check identity, the policy binding, the
  configuration identity and the evaluation identity do not read it, so existing
  policies and recorded Evidence stay valid.
- A malformed label is refused with `descriptor-label-invalid`.

Scope held: identities are not derived from tools, nothing is inferred from a
command's arguments, and no labels are generated; a clone writes the ones it
wants.

Evidence added: `tests/gate-configuration.test.mjs`, `tests/gate-evaluation.test.mjs`.
