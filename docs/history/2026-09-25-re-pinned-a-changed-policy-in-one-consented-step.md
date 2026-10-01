# Re-pinned a changed policy in one consented step

Delivered TB-062. Every policy edit on an activated clone took four commands —
deactivate and activate, each previewed and confirmed — and nothing on that path
asked whether the new policy was weaker than the one that authorized the clone.
The judgement `FR-CFG-005` requires already existed, and its only caller was a
smoke script.

- Added `gate sync`, an Activation transaction scoped to a changed configuration
  under the adapter set the receipt already pins: the same ordered steps and
  self-tests, one `activation` Lifecycle event, and no registration.
- Kept the hook block and every client registration, refusing — and naming
  `gate repair`, `gate status`, or the deactivate/activate pair — when one is not
  exactly what the sync would write, or when the installed Gate declares a
  different adapter set.
- Made the receipt the one write, switched atomically and read back. It keeps
  `activatedAt` and the Active release, pins the candidate identity with its
  policy and commands, and records the prior id in `receiptLineage`. A failure at
  any step restores the prior receipt byte for byte.
- Showed the trusted and candidate identities and every weakening in the preview,
  under a `WEAKER than the trusted policy` heading. A weaker candidate offers no
  token unless `--acknowledge-weakening` binds the acknowledgement into it.
- Made `gate status` name `gate sync` for configuration and command-descriptor
  drift.

Three limits were stated. The trusted policy is read only from a document that
reproduces the pinned identity — a receipt a sync wrote, the unchanged file, or
the committed file at `HEAD` — and a transition with none is refused. Weakening
detection recognizes only a demoted or removed required check, so a looser budget
or an enabled bypass previews as not weaker. No check runs during a sync. SRS
0.2.11 records it.
