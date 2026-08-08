# 07 — Fix Laravel code explicitly and reevaluate

**What to build:** Offer a clearly mutating Laravel repair workflow outside commit evaluation, using proved commands and requiring a fresh full evaluation of the resulting snapshot.

**Blocked by:** 04 — Evaluate an exact snapshot end to end

**Status:** ready-for-agent

- [ ] Laravel setup proposes proved Pint, Rector dry-run, PHPStan or Larastan, and broad-test checks as required defaults. (`FR-PROF-009`, `AC-PROF-005`)
- [ ] Focused, affected-test, smoke, build, and browser checks become required only after their capabilities and commands are proved and confirmed. (`FR-PROF-009`, `AC-PROF-005`)
- [ ] Commit evaluation rejects every mutating descriptor. (`FR-POL-009`, `AC-POL-004`)
- [ ] The explicit fix operation invokes only separately declared fix commands and runs Rector before Pint. (`FR-POL-009`, `FR-PROF-010`, `AC-POL-004`, `AC-PROF-005`)
- [ ] A fix never authorizes itself; the resulting snapshot receives a complete new non-mutating evaluation. (`FR-PROF-010`, `AC-PROF-005`)

