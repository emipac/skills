# 05 — Apply required, advisory, budget, and bypass policy

**What to build:** Turn one current snapshot evaluation into an honest authorization decision using project-owned required, advisory, timeout, budget, and bypass policy.

**Blocked by:** 04 — Evaluate an exact snapshot end to end

**Status:** ready-for-agent

- [ ] Every applicable required failure or unverified result denies authoritative authorization. (`FR-POL-001`, `SG-POL-001`, `AC-EVAL-001`)
- [ ] Advisory failure remains visible without blocking, and advisory success never compensates for required failure. (`FR-POL-002`, `SG-POL-001`, `AC-POL-001`)
- [ ] Authorization is bound to the current snapshot, command, configuration, and relevant environment without a baseline exemption or persistent pass cache. (`FR-POL-003`, `FR-POL-004`, `AC-POL-001`)
- [ ] Project-confirmed per-check timeouts and the total budget terminate process trees, skip only eligible advisory work, and return blocking `unverified` when required coverage is incomplete. (`FR-POL-005`, `NFR-PERF-001`, `AC-POL-002`)
- [ ] Disabled bypass is rejected; enabled bypass is one-shot and bound to the exact snapshot, reason, and policy-required reference. (`FR-POL-006`, `FR-POL-008`, `SG-BYP-001`, `AC-POL-003`)
- [ ] A valid bypass returns `bypassed`, preserves failures and unknowns, appends machine-readable Evidence, emits the commit-visible marker, and never rewrites a check as passed. (`FR-POL-007`, `SG-BYP-001`, `AC-POL-003`)

