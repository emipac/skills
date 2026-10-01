# Said a Gate configuration is unversioned, once

Delivered TB-066, a defect slice. A worktree change rightly includes every
untracked path, but on a clone whose `.agent-framework.yaml` was never committed —
and `framework-setup` never commits it — that file appeared as a changed Gate
configuration on every preflight, though nobody had edited it. The line read the
same on the turn somebody did, and on Cursor a passing turn re-prompted the agent
with it.

- Called an untracked declared surface unversioned, a different fact with a
  different word. Every decision records `integrity.unversionedGraderSurfaces` as
  a new required field, and the contract refuses a path in both lists.
- Made `controlSurfaceChanged` true only when a tracked control surface moved; a
  configuration staged for the first time counts as tracked.
- Stated the unversioned set on the preflight channel once, with the
  maintainer's remedy — commit it — rendered from the remedy table. It is
  restated only when the recorded set changes, so an unchanged turn and a turn
  that edits other work are silent again. Only that statement is withheld, never
  a changed Grader surface.
- Made `gate status` show each unversioned surface as an informational
  `grader-surface-unversioned` finding that leaves health alone, reading Git with
  `--no-optional-locks` so status still writes nothing. Nothing refuses, denies,
  stages, or commits.

Evidence added: unit fixtures for the untracked, staged, and edited cases;
`unversioned-channel` in `gate-hook-conformance-smoke`; and
`packaged-unversioned-configuration` in `gate-security-control-smoke`. SRS 0.2.17
records it.

Two limits were stated. The once-only rule reads the clone's shared Evidence log,
so a set first recorded by a commit or a failing `gate check` is not restated on
the channel, though `gate status` always shows it. And because the evaluation
identity does not include the set, committing a surface without other changes can
be silenced by the existing loop guard once that identity was reported twice.
