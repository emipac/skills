# Ran a skill script through the path a client installed it at

Delivered FS-001. A released skill script now does what it was asked to do when
it is invoked through the path a client installed it at, whatever that path is.
Before, the CLI entry guard compared a resolved module URL against an unresolved
`argv` path, so a script invoked through a symbolic link loaded, printed
nothing, and exited 0.

- Stated the entry rule once, in `scripts/lib/cli-entry-point.mjs`, and vendored
  it into each skill that ships a script, because skills install independently.
  `npm run validate` and a unit test fail on any divergence between the copies.
- Each of the five released scripts, invoked through a symbolic link to itself,
  produces exactly the output it produces through its real path.
- Each script, imported as a module, still runs no CLI, and an `argv` path that
  does not exist does not throw.
- Every script's existing arguments, output, and exit statuses are unchanged.
- A fixture fails if any one of the five scripts reverts to the old comparison.

Evidence added: the entry-point unit tests and the divergence check, with
`npm run test:install` running each installed command through a link and through
its installed path and comparing them. A changeset records the fix.
