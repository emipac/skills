# 01 — Expand verification configuration to schema v4

**What to build:** Preserve established verification behavior while adding the backward-compatible schema v4 Command descriptor contract and a safe, explicit migration path from schema v3.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] Schema v3 and v4 configurations remain readable, while only schema v4 can express Gate configuration. (`FR-CFG-008`, `AC-CFG-005`)
- [ ] Schema v4 Command descriptors express a logical runner, argument array, working directory, timeout, allowed environment names, evidence category, and source scope without shell parsing. (`FR-CFG-003`, `FR-CFG-004`, `SG-CMD-001`, `AC-CFG-002`)
- [ ] Runner resolution records and previews the executable identity and version, and unresolved runners fail before execution. (`FR-CFG-004`, `AC-CFG-002`)
- [ ] Migration previews the exact descriptor conversion and writes atomically only after confirmation. (`FR-CFG-009`, `SG-CFG-002`, `AC-CFG-005`)
- [ ] Ambiguous command conversion aborts without mutation until the maintainer supplies an explicit mapping. (`FR-CFG-009`, `SG-CFG-002`, `AC-CFG-005`)
- [ ] Migration neither configures nor activates the Gate, and schema v3 read support remains available throughout `0.x`. (`FR-CFG-008`, `FR-CFG-009`, `AC-CFG-005`)

