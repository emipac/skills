# 06 — Prove task scope and Grader/runtime integrity

**What to build:** Make evaluation coverage and integrity explicit so regression evidence, changed Grader surfaces, and locally served runtime behavior cannot overclaim what the snapshot proves.

**Blocked by:** 04 — Evaluate an exact snapshot end to end

**Status:** ready-for-agent

- [ ] Without a valid delivery contract, evaluation is `regression-only` and never claims requested behavior or acceptance coverage. (`FR-EVAL-007`, `SG-SCOPE-001`, `AC-EVAL-005`)
- [ ] With a valid delivery contract, every applicable check reports assertions, acceptance-linked assertions use stable AC IDs, and coverage gaps remain explicit. (`FR-PROF-005`, `AC-EVAL-005`)
- [ ] Changing a test, verification script, provider, or Gate configuration reports the affected Grader surface and binds runner, provider, configuration, environment, and snapshot identities. (`FR-EVAL-009`, `FR-CFG-007`, `AC-EVAL-007`)
- [ ] Complex command behavior is accepted only through a declared repository-script Grader surface rather than hidden shell behavior. (`FR-CFG-007`, `SG-CMD-001`, `AC-CFG-002`)
- [ ] HTTP and browser checks prove the served application originates from the materialized Evaluation snapshot. (`FR-EVAL-010`, `SG-EVAL-002`, `AC-EVAL-008`)
- [ ] Routing to the live worktree or any unprovable served source returns `unverified` and denies authoritative authorization. (`FR-EVAL-010`, `SG-EVAL-002`, `AC-EVAL-008`)

