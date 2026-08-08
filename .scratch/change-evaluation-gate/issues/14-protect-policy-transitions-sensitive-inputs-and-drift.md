# 14 — Protect policy transitions, Sensitive inputs, and drift

**What to build:** Prevent the evaluated change from weakening its own policy, keep approved runtime secrets out of durable records, and make unexpected control-surface drift visibly non-authorizing.

**Blocked by:** 05 — Apply required, advisory, budget, and bypass policy; 06 — Prove task scope and Grader/runtime integrity; 12 — Manage the active release and removal lifecycle

**Status:** ready-for-agent

- [ ] A candidate policy-surface change is evaluated under the prior Trusted policy and validated separately as a candidate. (`FR-CFG-005`, `SG-CFG-001`, `AC-CFG-003`)
- [ ] Trust advances only after both policies succeed where they differ and the maintainer approves the exact candidate hash. (`FR-CFG-005`, `SG-CFG-001`, `AC-CFG-003`)
- [ ] Sensitive runtime inputs are approved at activation, copied only temporarily into the isolated materialization, recorded by name and source only, and removed afterward. (`FR-CFG-006`, `NFR-SEC-003`, `SG-SECRET-001`, `AC-CFG-004`)
- [ ] Secret-canary fixtures find no raw value in configuration, decisions, envelopes, blobs, or Lifecycle events. (`NFR-SEC-003`, `SG-SECRET-001`, `AC-CFG-004`)
- [ ] Independent drift in runtime, adapters, hooks, receipt, Trusted configuration, Command descriptors, or providers produces broken health and an authoritative `unverified` result. (`NFR-SEC-004`, `AC-SEC-001`)
- [ ] Ordinary changed Grader surfaces remain visible without being automatically classified as malicious, and no repair occurs implicitly. (`NFR-SEC-004`, `SG-TRUST-001`, `AC-SEC-001`)

