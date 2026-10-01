# Named the command that actually recovers

Delivered TB-065, a defect slice. Five places told a maintainer to run
`gate repair` for drift `gate repair` cannot touch: both copies of the
`integrity-drift` diagnostic and the `runner-unpinned` and `runner-pin-drift`
denials named it for every surface, while repair restores exactly three
Gate-owned hook findings. On a real clone whose descriptors an agent had
correctly fixed, every check passed and the commit was denied with an instruction
to run the one command that refuses — and since TB-064 the preflight channel
repeated it to the agent.

- Moved every remedy into one table, `REMEDIES` in the new leaf module
  `scripts/lib/remedies.mjs`, which both runners, `evaluate`, and the operator
  surface read without the operator surface importing a runner. TB-060's status
  table moved there too.
- Rendered every "what to run" through it: the drift diagnostic, the runner-pin
  denials, status's and repair's `next:` lines, and the recovery rows of
  `gate sync`'s refusals.
- Named the right command per surface: `gate repair` for a Gate-owned
  registration; `gate sync` for the trusted configuration, command descriptors,
  and runner pins; deactivate then activate for receipt, runtime, adapters, and
  providers. Each recovery that writes says it keeps `.agent-framework.yaml` and
  all historical Evidence, and uses `git gate` only where activation wrote that
  alias.
- Made `gate repair` reconcile the same observation status does, listing drift it
  cannot restore as unrepairable and naming what does recover it. No outcome,
  reason code, or authorization changed.

Evidence added: fixtures that enumerate every surface and runner-pin code, fail on
a library module other than the table that names a recovery inline, and drive
each surface through the real hook runner; `gate-security-control-smoke` gained
`packaged-descriptor-recovery`, where following `git gate sync` exactly lets the
next real commit through. One limit was stated: a runner pin whose program is gone
from the machine names `gate sync`, and installing the program comes first. SRS
0.2.13 records it.
