# Gave each execution root its own temp directory

A preflight was clean, then PHPStan and Rector failed on every later turn until
the follow-up cap was reached. Both tools cache under the system temporary
directory, which every check shared; the cache held absolute paths into
`phpstan.phar` and sources inside a previous execution root that the gate had
already deleted, so the next run crashed on a file that was gone. The agent
worked around it by moving both caches into the project.

- `createBoundedExecutor` creates `<execution root>.tmp` before a check starts
  and passes it as `TMPDIR`, `TMP`, and `TEMP`. It sits beside the root, not
  inside it, so a tool scanning the graded tree never finds its own cache.
- A name the descriptor lists in `allowed_environment` keeps its declared value.
- `releaseExecutionRoot` and the signal path remove the scratch with the root;
  its name starts with the root's prefix, so the orphan sweep reclaims it too.
- Cost: tool caches are cold on every evaluation.

Scope held: no change to snapshot identity, evaluation identity, or the check
environment beyond these three names.

Evidence added: `tests/gate-execution-environment.test.mjs`,
`tests/gate-execution-root-lifecycle.test.mjs`.
