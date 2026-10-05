# Skipped evaluation for a preflight turn that changed nothing

Delivered TB-039. A desktop turn that changed nothing now costs nothing: no
snapshot is copied, no Evidence envelope is appended, and the agent is answered
with the same silence it received before. The authoritative Git path is
untouched.

- A preflight turn against a clean worktree materializes no execution root
  (`AC-EVAL-004`, `NFR-PERF-001`).
- That turn's feedback is byte-for-byte identical to what it produced before
  (`FR-ADAPT-005`).
- A worktree with one changed file — including a change that is only an
  untracked file — still captures, grades, and reports exactly as before; the
  skip triggers only on a genuinely empty change set.
- The decision itself states that an idle turn was not recorded, so a reader can
  tell an unrecorded idle turn from a lost one (`RISK-010`, `AC-EVID-002`).
- The authoritative commit path returns the same decision as before
  (`NFR-REL-001`).

Evidence added: `tests/gate-preflight-runner.test.mjs`, with
`gate-hook-conformance-smoke` extended.
