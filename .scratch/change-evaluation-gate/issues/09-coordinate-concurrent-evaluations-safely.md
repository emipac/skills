# 09 — Coordinate concurrent evaluations safely

**What to build:** Make simultaneous Git and desktop evaluations share work only when safe, preserve role-specific authorization, and recover visibly from abandoned coordination state.

**Blocked by:** 08 — Persist and prune bounded immutable Evidence

**Status:** ready-for-agent

- [ ] Evaluations serialize per Git common directory without sharing mutable roots across different bindings. (`FR-COORD-001`, `SG-COORD-001`, `AC-COORD-001`)
- [ ] Identical in-flight bindings may share execution while each subscriber receives a role-appropriate decision. (`FR-COORD-002`, `AC-COORD-001`)
- [ ] Authoritative Git work may advance ahead of queued, not-running preflight work without preempting a running evaluation. (`FR-COORD-003`, `AC-COORD-001`)
- [ ] Subscriber cancellation detaches only that subscriber and cannot cancel execution still required by another subscriber. (`FR-COORD-004`, `SG-COORD-001`, `AC-COORD-001`)
- [ ] Locks record process, host, start, and heartbeat evidence; stale-lock recovery is explicit and appends an audit event. (`FR-COORD-005`, `AC-COORD-001`)
- [ ] Unsafe coordination failure returns `unverified` and never reuses a completed pass from a different binding. (`FR-COORD-005`, `NFR-REL-003`, `SG-COORD-001`, `AC-COORD-001`)

