# Ran every check in an environment it can actually start in

Delivered TB-028, a defect slice found by committing in a real Laravel project:
five of six required checks never executed at all, each exiting `127` —
*command not found* — in one to five milliseconds, and every one of them was
reported to the maintainer as their own code failing.

- Named the cause exactly. `environmentFor` built the child environment from
  `{}` and copied only the names a descriptor declared, and migration defaults
  that declaration to `[]`. A check therefore ran with **no environment at all,
  PATH included**. That is survivable for a directly-spawned absolute path —
  which is why the one `php-script` check got far enough to fail on something
  real — and fatal for an executable that is a script: `vendor/bin/pint` and
  `vendor/bin/phpstan` begin `#!/usr/bin/env php`, `npm` begins
  `#!/usr/bin/env node`, and the kernel resolves those interpreters through a
  PATH that did not exist.
- Made resolution mean *launchable*. An executable that is a script names its
  interpreter in its own first line; resolution now reads that line and pins the
  interpreter beside the executable. Nothing is executed to discover it and no
  interpreter is named anywhere in the codebase — `php` and `node` appear in no
  special case, because the file says which one it needs (`SG-OWNER-001`).
- Refused at activation instead of at commit time. An interpreter that cannot be
  found on this machine leaves the runner `runner-unresolved`, which the
  existing `runner-resolution` step already refuses: the clone stays configured,
  with no receipt and no registered hook. This needed no new activation probe,
  which is stronger than the ticket proposed — activation gained no new way to
  run somebody's code.
- Gave a pinned program the path it needs. Execution supplies a runtime-owned
  search path: the pinned executables' directories, then their pinned
  interpreters', then the platform's own utility directories. A descriptor that
  declares `PATH` has its ambient value appended after those, never before, so a
  project can widen what its command reaches without hiding the runtime's
  entries behind it.
- Corrected the ticket's own proposal where implementation disproved it. The
  approach section derived the search path from the pins alone; the first
  fixture written that way failed, because a path of only pinned directories
  cannot run `grep`, `sh`, or `env` — and neither could any real formatter, test
  runner, or build script that shells out. The platform's standard directories
  are part of the existing developer runtime the decision record already reuses.
  It is still not the maintainer's shell: no version manager, package-manager
  prefix, or user-specific entry appears, so nothing on the path can change
  *which* program a pinned command runs.
- Left migration alone, deliberately. The acceptance criterion offered two
  remedies in `configure.mjs`; neither was taken, because the cause was removed
  one layer down. `[]` is now launchable, so migration no longer produces
  anything structurally unable to start — and fixing it there would have left
  every already-migrated clone broken until it was migrated again, while asking
  maintainers to know that their own tool binary is a script.
- Extended the fixture that should have caught this. `vendor-binary-commit`
  was added by `TB-024` to run a real vendor binary and wrote it with
  `#!/bin/sh` — an absolute interpreter the kernel finds without a search path,
  which is precisely why it passed. It now writes `#!/usr/bin/env sh` and
  declares `allowed_environment: []`, so it reproduces the shape a real
  migration produces and proves the whole chain through real `git commit`
  invocations.
- Added `tests/gate-execution-environment.test.mjs`, which drives a real
  shebang executable whose interpreter lives outside the clone: it proves the
  interpreter is pinned, that the tool reports its own verdict rather than
  `127`, that an unresolvable interpreter is refused, that an absolute
  interpreter needs nothing pinned, that an undeclared parent variable never
  crosses, and that the invoking shell's PATH never reaches the child.

Scope held: no shell introduced, no `process.env` passed through wholesale, no
change to `composeArguments` or the descriptor contract's runner rows, no
re-resolution of a pin, and no dependency roots placed in the snapshot —
`TB-030` owns that and the `php artisan test` failure it explains.

Verification: `npm run test:unit` (352 passing), `npm run validate` (29 skills,
243 Markdown files), `npm run test:install`, and regression runs of all nine
capabilities — `gate-runtime-binding-smoke`, `gate-fix-smoke`,
`gate-evidence-prune-smoke`, `gate-activation-smoke`,
`gate-hook-conformance-smoke`, `gate-lifecycle-smoke`,
`gate-adapter-conformance`, `gate-security-control-smoke`, and
`gate-runtime-portability`.

A note for the next slice: an Activation receipt written before this change
pins no interpreter. Such a clone still runs — the search path falls back to
the executables' own directories and the platform base — but a shebang binary
whose interpreter lives elsewhere needs `gate repair` to be re-pinned.
