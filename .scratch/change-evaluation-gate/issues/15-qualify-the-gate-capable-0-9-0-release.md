# 15 — Qualify the Gate-capable 0.9.0 release

**What to build:** Produce the release-blocking runtime, client, security, migration, and operational evidence needed to qualify the first Gate-capable `0.9.0` release candidate without overstating support.

**Blocked by:** 07 — Fix Laravel code explicitly and reevaluate; 13 — Deliver supported desktop preflight adapters; 14 — Protect policy transitions, Sensitive inputs, and drift

**Status:** ready-for-agent

- [ ] The portability matrix proves non-interactive executable launch, arguments, streams, structured JSON, timeout, process-tree termination, Git-index access, linked worktrees, paths with spaces, declared writes, and source immutability on every claimed environment. (`NFR-PORT-001`, `NFR-PORT-002`, `AC-PORT-001`)
- [ ] The compatibility manifest records exact Gate, Git, Node.js, client, and operating-system versions plus pass or fail outcomes for authoritative Git, every supported adapter, and runtime fixtures. (`NFR-COMP-001`, `AC-ADAPT-002`, `AC-PORT-001`)
- [ ] Untested versions receive no verified support claim and are not converted into a permanent deny-list. (`NFR-COMP-001`, `SG-SUPPORT-001`, `AC-ADAPT-002`)
- [ ] Mandatory release evidence covers shared-runtime safety, adapter compatibility, schema migration, secret redaction, Grader integrity, snapshot portability, hook composition, rollback, and local trust documentation. (`RISK-002`, `RISK-004`, `RISK-005`, `RISK-006`, `RISK-008`, `RISK-009`)
- [ ] Open latency and flaky-check risks remain visible with timing and attempt evidence rather than being silently closed. (`RISK-003`, `RISK-007`)
- [ ] The release candidate identifies `0.9.0` as the first Gate-capable release, reads schema v3 and v4, permits Gate configuration only in v4, and preserves the declared v3 compatibility floor. (`FR-CFG-008`, `AC-CFG-005`)
- [ ] Full contract verification reports all 39 acceptance criteria through the confirmed evaluation, lifecycle, and adapter-conformance seams with no blocking release artifact missing.

