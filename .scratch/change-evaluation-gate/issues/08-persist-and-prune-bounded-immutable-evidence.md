# 08 — Persist and prune bounded immutable Evidence

**What to build:** Retain reproducible local evaluation and lifecycle history under Git-common metadata while bounding sensitive output and making every deletion explicit, previewed, and auditable.

**Blocked by:** 05 — Apply required, advisory, budget, and bypass policy

**Status:** ready-for-agent

- [ ] Repeated evaluations append distinct versioned, canonical, content-addressed Evidence envelopes atomically at the Git-common location. (`FR-EVID-001`, `FR-EVID-002`, `NFR-AUD-001`, `AC-EVID-001`)
- [ ] Sensitive output is redacted before persistence; unsafe capture returns `unverified` rather than retaining raw secrets. (`NFR-SEC-003`, `SG-SECRET-001`)
- [ ] Inline output is capped at 32 KiB per attempt, one blob at 4 MiB, and all blobs for one evaluation at 32 MiB; projects may only lower these ceilings. (`FR-EVID-003`, `AC-EVID-001`)
- [ ] Truncated excerpts preserve beginning and end and record redacted and omitted byte counts. (`FR-EVID-003`, `AC-EVID-001`)
- [ ] Governed evaluation, bypass, trust, activation, update, repair, removal, pruning, stale-lock recovery, and detected drift append immutable redacted Lifecycle events. (`FR-EVID-005`, `NFR-AUD-001`, `AC-EVID-002`)
- [ ] Pruning is manual, preview-first, selectable by evaluation, age, or reclaimed size, and confirmation-bound to the exact preview. (`FR-EVID-004`, `SG-EVID-001`, `AC-EVID-002`)
- [ ] Matching pruning removes only selected blobs and preserves envelopes, decisions, bypass and Lifecycle events, pruning records, and tombstones; no automatic deletion exists. (`FR-EVID-004`, `SG-EVID-001`, `AC-EVID-002`)

