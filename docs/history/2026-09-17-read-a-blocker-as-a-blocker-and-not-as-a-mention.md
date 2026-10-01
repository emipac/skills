# Read a blocker as a blocker, and not as a mention

Delivered FS-004, a defect slice in the `to-tickets` audit. Blockers were
extracted as every `TB-nnn` token in a `## Blocked By` section, so
"None. `TB-020` is also done." read as an edge. Two finished tickets that each
acknowledged the other became a cycle the audit had been reporting, without
naming it, for as long as either existed. Seventeen tickets carried false edges,
and the frontier had excluded them for its whole history.

- Parsed the section by its grammar. A first content line beginning with `None`
  declares no blockers whatever follows; otherwise a blocker is an id that begins
  a line after an optional bullet or emphasis, and the rest of the line is
  explanation.
- Warned, with `None` winning, when a `None` section also bullets an id —
  narrowed to bulleted items, because two real tickets wrap prose onto a line
  that happens to start with an id.
- Reported a cycle with its path.
- Cross-checked the front-matter `Blocked by:` line, warning on a disagreement
  and never treating it as a second source of edges.

Against the real ticket set the false cycle disappeared and nothing else changed:
every genuinely blocked ticket parsed to the same edges, seventeen moved from
blocked to unblocked, and no ticket file was touched. The cross-check found that
TB-041 and TB-042 bullet a tracker slug rather than an id; both were done, so it
was reported rather than reinterpreted.
