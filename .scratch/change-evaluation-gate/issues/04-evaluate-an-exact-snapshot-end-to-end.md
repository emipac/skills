# TB-004 — Evaluate an exact snapshot end to end

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent
Blocked by: 02-configure-the-gate-as-a-dormant-opt-in-module, 03-produce-stack-neutral-verification-descriptors
Tracker ID: 04-evaluate-an-exact-snapshot-end-to-end
Draft key: TB-004

**Status:** ready-for-agent
**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

One versioned evaluation request grades an isolated proposed snapshot through the existing Verification seam and returns a complete reproducible decision without mutating the live worktree.

## SRS Traceability

- `FR-EVAL-002`, `FR-EVAL-003`, `FR-EVAL-004`, `FR-EVAL-005`, `FR-EVAL-006`, `FR-EVAL-008`, `NFR-AUD-002`, `NFR-OPER-001`, `NFR-REL-001`, `NFR-REL-003`, `NFR-SEC-001`
- `AC-EVAL-002`, `AC-EVAL-003`, `AC-EVAL-004`, `AC-EVAL-006`
- `SG-EVAL-001`, `SG-OWNER-001`
- `RISK-007`, `RISK-009`

## Domain Concepts

Evaluation snapshot, Evaluation scope, Check assertion, Check attempt, and Evidence envelope identity.

## Approach and Tradeoffs

Build the narrow `evaluate(request) -> decision` process contract around isolated Git snapshot materialization and `verify-change` delegation. Preserve all attempts and normalize harness failures to stable `unverified` reasons. Keep evidence persistence, authorization policy, and coordination behind later slices while returning their contract fields explicitly.

## Architecture Boundary and Public Seam

The boundary is Gate orchestration around the existing Verification seam; the public seam is the versioned evaluation process interface. First red test: an unstaged live-worktree edit made after snapshot capture cannot change evaluated output or the returned snapshot identity.

## Safeguards and Invariants

- `SG-EVAL-001`: evaluation never relies on mutable live source or mismatched roots; violations return `unverified`.
- `SG-OWNER-001`: evaluation delegates ordered check resolution and execution to `verify-change`.

## Prohibited Behavior and Non-goals

Do not mutate source, silently retry, choose a convenient conflicting attempt, create a parallel verifier, or claim sandboxing against hostile code.

## Risk and Decision Impacts

- `RISK-007`: remains open and visible; conflicting flaky attempts produce `unverified`.
- `RISK-009`: accepted conditionally; unsafe snapshot or runtime reuse returns `unverified` and remains release-gated.

## Acceptance Criteria

- [x] `AC-EVAL-002`: request and decision fixtures expose every required identity, outcome, authorization, diagnostic, coverage, integrity, and evidence reference.
- [x] `AC-EVAL-003`: identical bindings preserve descriptor order and configured inputs while invoking only check-only Verification commands.
- [x] `AC-EVAL-004`: post-capture live edits cannot alter evaluation or Evidence, and the live file remains unchanged.
- [x] `AC-EVAL-006`: all attempts are retained and every defined harness failure or conflict becomes `unverified`, never passed.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-EVAL-002`, `AC-EVAL-003`, `AC-EVAL-004`, `AC-EVAL-006`, `SG-EVAL-001`, `SG-OWNER-001`: process-contract and snapshot fixtures | `npm run test:unit` | Yes — configured unit suite drives the evaluation public seam |

Frontend build and browser evidence are inapplicable to this non-UI process slice.

## Blocked By

- `TB-002` — evaluation consumes the configured Gate policy.
- `TB-003` — evaluation consumes normalized Verification descriptors.

## Unresolved Assumptions

None.

## Readiness

- [x] The outcome is a complete vertical behavior.
- [x] Acceptance criteria trace to the SRS and feature contract.
- [x] The public seam and first red test are identified.
- [x] Safeguards and non-goals are explicit.
- [x] Risks and resolved decisions are traced to the parent contract.
- [x] Blocking edges exist and are acyclic.
- [x] No unresolved assumption blocks the start.
- [x] The ticket fits one fresh implementation context.
- [x] User-facing and frontend evidence requirements are covered or explicitly inapplicable.
