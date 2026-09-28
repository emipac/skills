---
"ai-skills-framework": minor
---

Treat `typecheck`, `type-check`, and `types` as one type check in
`framework-setup` discovery. Only `types` accepted a `:check` qualifier, so
`types:check` was discovered as a type check while `typecheck:check` and
`type-check:check` were declined as `unsafe-qualifier: check` and gated nothing.
All three spellings now share one definition and accept the same qualifiers,
classify into the same category and scope, and report the `typescript`
capability. Unsafe variants such as `:watch`, `:fix`, and `:write` are still
declined, and no other script name's qualifiers change.

This changes behavior for existing projects: a project that already declares
`typecheck:check` or `type-check:check` gains a static-analysis check it did not
have before. Re-running configuration will show that command appear, and it will
no longer be listed in `verification.unclassifiedScripts`.
