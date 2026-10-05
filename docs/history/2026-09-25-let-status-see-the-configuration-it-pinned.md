# Let status see the configuration it pinned

Delivered TB-060, a defect slice. A maintainer who edited `.agent-framework.yaml`
on an activated clone ran `gate status`, was told `healthy`, and had the next
commit denied with `integrity-drift`. Status already knew how to reconcile a
control-surface observation and both runners built one before every evaluation;
the status command simply never passed one.

- Made `gate status` read the configuration, pin its checks, and reconcile the
  same control-surface observation the runners use, so status and the next
  commit cannot disagree about drift. A changed configuration is `broken` with a
  `trusted-configuration` finding that names the file.
- Ran no pinned program and wrote nothing: each executable is re-observed with
  one access check. A healthy one-check status went from about 16 ms to 22 ms.
- Ended status with a `next:` line naming the remedy for every finding code and
  control surface, with a fixture that fails on any code without an entry. The
  line uses `git gate` only where `.git/config` holds exactly the alias
  activation writes. A healthy clone prints `next: nothing`.
- Added `observation.next` and `observation.controlSurface` to `--json` without
  changing any existing field.

Two consequences were stated. A supporting adapter the installed Gate no longer
declares is drift of the pinned adapter set, which the runners already deny, so
status now calls that clone `broken` rather than `degraded`; a lost supporting
registration is still `degraded`. Fixtures that pinned executables and policies
their clones never declared now pin what the configuration declares. The guide's
claim that deactivation removes the `git gate` alias was false and was corrected.
SRS 0.2.10 records it.
