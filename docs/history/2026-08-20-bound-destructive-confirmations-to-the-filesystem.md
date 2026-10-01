# Bound destructive confirmations to the filesystem

Delivered TB-036. Every destructive operation now removes exactly what the
maintainer saw and confirmed, verified against the files as they are at the
moment of removal. A preview handed back to the Gate is treated as a claim to be
re-established, not as an instruction to be obeyed.

- A prune whose preview object was altered after it was produced removes
  nothing and states why; an unaltered preview still prunes exactly the blobs it
  named and writes their tombstones (`AC-EVID-002`, `SG-EVID-001`).
- A prune whose store changed between preview and confirmation refuses and
  directs the operator to preview again.
- Configuration cleanup whose file changed between preview and confirmation
  removes nothing and says so (`AC-LIFE-008`, `SG-LIFE-001`).
- Every path a destructive operation writes to or removes is re-established as
  contained within the directory that operation owns, at the moment of the
  write.

Evidence added: `tests/gate-adapter-registration.test.mjs`,
`tests/gate-evidence.test.mjs`, and `tests/gate-lifecycle.test.mjs`, with
`gate-evidence-prune-smoke` extended.
