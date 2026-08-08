# 03 — Produce stack-neutral Verification descriptors

**What to build:** Deepen the existing Verification seam so Laravel and a reference non-Laravel provider resolve project facts into the same normalized check descriptors without adding stack-specific Gate behavior.

**Blocked by:** 01 — Expand verification configuration to schema v4

**Status:** ready-for-agent

- [ ] The descriptor contract has stable identity, version, stage, capability, scope, applicability, prerequisites, policy, commands, timeout, declared writes, evidence claims, and order. (`FR-PROF-001`, `FR-PROF-002`, `AC-PROF-001`)
- [ ] Laravel and one reference non-Laravel provider emit valid descriptors consumed without a stack-name branch in Gate-core behavior. (`FR-PROF-001`, `NFR-MAINT-001`, `SG-OWNER-001`, `AC-PROF-001`)
- [ ] Laravel maps confirmed Pint, Rector dry-run, PHPStan or Larastan, Pest, smoke, build, and browser capabilities to distinct evidence claims. (`FR-PROF-003`, `AC-PROF-002`)
- [ ] Missing commands, unproved capabilities, and filename-only test guesses remain visible gaps and never produce guessed descriptors. (`FR-PROF-004`, `AC-PROF-003`)
- [ ] Descriptors use exactly the focused, format, static-analysis, affected-tests, smoke, build, browser, and broad-tests stages in order. (`FR-PROF-006`, `AC-PROF-004`)
- [ ] Outcomes distinguish passed, failed, unverified, and not-applicable; policy bindings remain separate, and new stages or outcomes require a supported contract-version change. (`FR-PROF-007`, `FR-PROF-008`, `AC-PROF-004`)

