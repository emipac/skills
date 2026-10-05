# Named every script the setup did not classify

Delivered FS-002. A project script `framework-setup` does not recognise is now
named in the discovery output, so a maintainer can see it was left out and decide
what to do. A script whose name begins `types` is recognised, because it is a
type check.

- `types:check` is classified as a type check (`types` became a recognised base
  name), while a qualifier the table treats as unsafe is still refused for it.
- Every script the resolver declines is named in the discovery output, with its
  reason where one is available.
- That project still configures without answering anything about those scripts,
  and nothing about the written configuration changes because of them.
- Repeat discovery and repeat configuration are byte-identical, and the
  not-classified list is ordered deterministically; a project whose scripts are
  all recognised gets an empty list rather than a missing one.

Evidence added: `tests/framework-setup.test.mjs`, with `SKILL.md` updated. The
same change wrote FS-003, because `typecheck:check`, `type-check:check`, and
`types:check` still disagreed.
