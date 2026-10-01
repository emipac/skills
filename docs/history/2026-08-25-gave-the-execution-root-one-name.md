# Gave the execution root one name

Delivered TB-043. The directory a check runs in now has exactly one name. A tool
that resolves the path it was given reaches the same place the Gate named, so no
check fails because two spellings of one directory did not compare equal.

- Resolved the system temporary directory before creating the execution root,
  so a tool that canonicalizes its path reaches the directory the decision
  records, on platforms where the temporary directory is reached through a
  symbolic link (`AC-EVAL-004`, `AC-EVAL-006`).
- Left snapshot identities unchanged, proved by deriving an identity for the
  same content before and after (`SG-EVAL-001`).
- Kept the root removed on every path, and kept TB-038's interruption and sweep
  behavior reclaiming it under its own prefix (`FR-EVAL-005`).
- Kept declared dependency roots resolving to the installed directories they
  name, absent from the snapshot's path list (`NFR-REL-001`).

Evidence added: `tests/gate-execution-root-lifecycle.test.mjs`, with
`gate-runtime-portability` and the release-qualification contract updated. The
SRS records the change.
