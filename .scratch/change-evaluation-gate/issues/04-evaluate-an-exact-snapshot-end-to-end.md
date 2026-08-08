# 04 — Evaluate an exact snapshot end to end

**What to build:** Provide one versioned evaluation process that grades an isolated proposed snapshot through the existing Verification seam and returns a complete, reproducible decision without mutating the live worktree.

**Blocked by:** 02 — Configure the Gate as a dormant opt-in module; 03 — Produce stack-neutral Verification descriptors

**Status:** ready-for-agent

- [ ] The request identifies repository root, exact snapshot target, optional delivery contract, Enforcement role, normalized trigger, adapter capabilities, and session identity. (`FR-EVAL-002`, `AC-EVAL-002`)
- [ ] The decision reports protocol and evaluation identity, outcome, authorization, scope, snapshot and environment, checks, assertions, attempts, coverage, integrity, and Evidence identity. (`FR-EVAL-006`, `AC-EVAL-002`)
- [ ] Evaluation materializes the exact snapshot, leaves the live worktree unchanged, and detects undeclared writes in the materialized source. (`FR-EVAL-004`, `NFR-SEC-001`, `SG-EVAL-001`, `AC-EVAL-004`)
- [ ] Applicable checks are resolved and executed through the existing `verify-change` Evidence ladder with no parallel verifier and no mutating command. (`FR-EVAL-003`, `FR-EVAL-005`, `SG-OWNER-001`, `AC-EVAL-003`)
- [ ] Repeating an identical binding produces the same ordered descriptors and configured authorization inputs. (`NFR-REL-001`, `AC-EVAL-003`)
- [ ] All attempts remain visible, and missing prerequisites, invalid configuration, timeout, crash, malformed output, snapshot mismatch, integrity drift, coordination failure, or conflicting attempts normalize to `unverified`. (`FR-EVAL-008`, `NFR-REL-003`, `AC-EVAL-006`)

