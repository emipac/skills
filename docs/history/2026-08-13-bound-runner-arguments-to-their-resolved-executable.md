# Bound runner arguments to their resolved executable

Delivered TB-019, a defect slice: each logical runner named an executable and
each descriptor carried an argument array, but nothing said how the two combine,
so two of six previews described a command that would not run.

- Named the missing rule and gave it an owner. `composeArguments` in
  `command-descriptor.mjs` is now the single place that turns a runner and its
  stored arguments into an argument vector. The rule lives with the runner, not
  with the resolver: the resolver's job is to find an executable and record its
  identity and version, and a resolver that also knew how each runner shapes its
  arguments would hand every caller a copy of that knowledge to drift from.
- Fixed composition in one place rather than two. `commandPreview` and the
  bounded executor's `spawn` had each concatenated `[executable, ...args]`
  independently. Both now derive their argument list from the one rule, so the
  invocation a maintainer approves and the invocation that runs cannot diverge
  again — which is the defect, not a symptom of it.
- Stopped `composer-bin` repeating its binary. Migration stores the binary name
  as the first argument, and resolution consumes it to find the binary under the
  vendor directory, so composition passes on the rest. `vendor/bin/pint pint
  --dirty --format agent` is again `vendor/bin/pint --dirty --format agent`.
- Gave `package-script` its `run` subcommand. The descriptor stores a script
  name and a package manager reaches a script through `run`, so `npm
  format:check` is again `npm run format:check`.
- Left `php-script` and `repository-script` passing their arguments through.
  `artisan` genuinely is an argument to `php`, so direct concatenation was
  right for those two by accident; the fixtures now prove correcting the other
  two left them alone.
- Kept stored descriptors untouched. Composition was corrected instead of
  rewriting what is on disk, so an existing schema v4 repository produced by a
  real migration composes correctly without being migrated again
  (`AC-CFG-002`).
- Reported what cannot be composed. A `composer-bin` descriptor with no leading
  argument has no binary name to consume; `resolveExecutables` reports it as
  `command-args-uncomposable` and the executor refuses with
  `configuration-invalid`. Neither guesses a repair.
- Held the safeguard. Composition only selects, reorders, or prefixes whole
  stored arguments. Nothing is parsed, split, joined, or re-quoted, no shell is
  introduced, and an unresolved runner is still reported rather than looked up
  through a shell (`SG-CMD-001`).
- Drove the fixtures with the exact descriptors migration produces rather than
  synthetic ones, in `tests/gate-command-composition.test.mjs`, and proved
  execution against a launched process that reports its own argument vector, so
  preview and execution cannot agree merely by reading the same stored array.
- Corrected two fixtures that had encoded the defect. Activation's preview
  expectation gained the `run` it always should have shown, and the provider
  contract's `composer-bin` resolver now resolves the binary its descriptor
  names instead of the directory holding it — the fixture shape that let this
  reach a preview.

Scope held: no change to the stored descriptor shape, no fifth runner, no
change to descriptor validation or Grader surface reporting, and no rewrite of
the resolver's own responsibilities.

Verification: `npm run test:unit` (268 passing), `npm run validate` (29 skills,
216 Markdown files), `npm run test:install`, and regression runs of all nine
capabilities — `gate-runtime-binding-smoke`, `gate-fix-smoke`,
`gate-evidence-prune-smoke`, `gate-activation-smoke`,
`gate-hook-conformance-smoke`, `gate-lifecycle-smoke`,
`gate-adapter-conformance`, `gate-security-control-smoke`, and
`gate-runtime-portability`.
