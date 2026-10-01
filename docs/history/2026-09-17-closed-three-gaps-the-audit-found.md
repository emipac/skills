# Closed three gaps the audit found

Delivered TB-050: three independent findings from an external audit, each small.

- Guarded three smokes that touched real directories. `gate-evidence-prune-smoke`,
  `gate-fix-smoke`, and `runtime-binding-smoke` create temporary directories,
  spawn processes, and two of them register real Git hooks, without the
  throwaway-repository guard the other six smokes carry. The guard now runs
  before the temporary directory is created, before each mutation, and before
  every removal. Pointed at a directory inside this repository, each smoke exits
  1 naming the refusal and leaves the directory unchanged; a unit fixture spawns
  all three.
- Made two identities independent of key order. The bypass identity and the fix
  identity each hashed `JSON.stringify` directly instead of the single
  content-identity scheme that exists to forbid exactly that. Both now use it.
  No real store carried a bypass entry and no ledger existed, so nothing
  persisted was affected; a ledger is proved to refuse a reordered spelling of a
  consumed grant.
- Removed a stale selector. The operator surface still listed `--repair` as a
  refused selector owned by `gate repair`, which TB-041 had made a first-class
  command; `status --repair` is now simply unknown.
