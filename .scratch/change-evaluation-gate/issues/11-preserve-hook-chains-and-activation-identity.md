# 11 — Preserve hook chains and activation identity

**What to build:** Extend activation safely across existing hooks, trust pauses, and automation without overwriting shared behavior or resuming a changed transaction.

**Blocked by:** 10 — Activate authoritative Git enforcement transactionally

**Status:** ready-for-agent

- [ ] Existing hook content is preserved and the prior hook chain and Gate both execute. (`FR-LIFE-007`, `NFR-COMP-002`, `SG-HOOK-001`, `AC-LIFE-003`)
- [ ] Registration selects, in order of applicability, a native hook manager, a confirmed marker-delimited local-hook block, or a clearly owned shim. (`FR-LIFE-017`, `AC-LIFE-009`)
- [ ] Activation never overwrites a hook, silently changes shared or global hook paths, or repairs marker drift automatically. (`FR-LIFE-007`, `SG-HOOK-001`, `AC-LIFE-003`)
- [ ] A transaction paused for client-controlled trust resumes only when repository, configuration, adapter selection, and preview identities are unchanged. (`FR-LIFE-016`, `SG-HOOK-001`, `AC-LIFE-009`)
- [ ] A paused or failed transaction leaves no integration active. (`FR-LIFE-016`, `AC-LIFE-009`)
- [ ] Non-interactive activation requires expected repository and configuration identities and rejects mismatch before any clone-local mutation. (`FR-LIFE-015`, `AC-LIFE-008`)

