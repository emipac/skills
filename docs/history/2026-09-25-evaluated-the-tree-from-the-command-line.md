# Evaluated the tree from the command line

Delivered TB-061. A maintainer who wanted to know whether the working tree passed
had three options: commit for real, wait for the client's own hook, or pipe a
hand-written client payload into the preflight runner. During one week of real
use the third was done seven times; it claimed a client that was not running,
spent that client's loop guard, and answered through the client's channel — for
Cursor, a pass came back as an empty string.

- Added `gate check` for the working tree and `gate check --staged` for the
  index, printing the decision a hook would produce.
- Lifted the preflight's inline evaluation into one shared function that both
  call. The preflight's output, loop-guard silences, and appended evidence ids
  stayed byte-identical on failing, passing, settled, and drifted clones.
- Matched each scope to its hook: on one tree the check and the preflight give
  the same outcomes and snapshot identity, and `--staged` matches what the commit
  hook graded.
- Kept it non-authoritative by construction. It reads and spends no bypass grant,
  runs under an identity that is no declared adapter, uses no channel, and cannot
  touch a client's loop guard.
- Printed every check with its reason code, the diagnostics, changed Grader
  surfaces, the dependency record, declared Sensitive input names, elapsed time,
  and whether evidence was appended. `--json` is the same document. Exit status
  is 0 passed, 1 failed or unverified, 2 could not run.

The ticket's evidence premise was only half right, and that was stated: the
preflight records every decision about a changed tree, because that record bounds
its client's loop, while the check has no loop to bound and so records only what
did not pass. A commit after a passing check is still graded by the registered
hook, as the new `check-then-commit` smoke scenario shows. SRS 0.2.14 records it.
