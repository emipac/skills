# Reclaimed execution roots an interrupted run abandons

Delivered TB-038. A run that is killed rather than finished now leaves no
materialized snapshot behind, and a machine that already accumulated some
reclaims them the next time the Gate runs. The maintainer never has to know that
execution roots exist.

- A runner interrupted by `SIGINT` or `SIGTERM` mid-evaluation leaves no
  directory matching its prefix, and still terminates — the signal is honored,
  not swallowed (`AC-CFG-004`, `SG-SECRET-001`).
- A root left behind by an earlier run and older than the stated ceiling is
  removed by the next run of either runner.
- A root younger than the ceiling, or belonging to a concurrent evaluation, is
  left alone, proved with a live root present while a sweep runs
  (`NFR-REL-001`).
- The sweep removes nothing outside the Gate's own prefix under the system
  temporary directory, proved by similarly named decoys left untouched
  (`SG-LIFE-001`).
- A root the sweep cannot remove never changes the evaluation's decision.

Evidence added: `tests/gate-execution-root-lifecycle.test.mjs`, with
`gate-activation-smoke` extended.
