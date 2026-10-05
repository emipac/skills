# Treated the three type-check spellings alike

Delivered FS-003, a defect slice in `framework-setup` discovery. Discovery accepted
a `:check` qualifier on `types` but not on `typecheck` or `type-check`, so
`types:check` was classified as a type check while `typecheck:check` and
`type-check:check` were declined as an unsafe qualifier and gated nothing. The
only remedy was renaming a project script to match a table the maintainer cannot
see.

- Made the three spellings one list that the category table, the safe-qualifier
  table, and the TypeScript capability check all read, so a spelling cannot be
  accepted in one place and missed in another.
- Gave all three the same qualifiers, including `check`, while still checking the
  unsafe list first, so `:watch`, `:fix`, and `:write` stay declined and named in
  the discovery output.
- Left every other base name's qualifiers unchanged.

Evidence added: tests that compare the spellings against each other on one
fixture for category, scope, and capability, with guards for unsafe qualifiers,
the untouched bases, and byte-identical repeat discovery and configuration.

This changes behavior for existing projects: one already declaring
`typecheck:check` or `type-check:check` gains a static-analysis check on its next
configuration run, which the `minor` changeset states.
