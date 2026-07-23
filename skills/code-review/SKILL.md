---
name: code-review
description: Review a branch, pull request, or fixed diff through three independent axes — Standards, Contract, and Evidence — with traceable findings for conventions, intent drift, safeguards, scope, and verification sufficiency.
---

# Code Review

Review one fixed diff through three independent lenses. Do not let a clean axis
cancel findings from another.

## 1. Pin the review surface

Resolve the user-supplied fixed point and capture these commands once:

```bash
git rev-parse <fixed-point>
git diff <fixed-point>...HEAD
git log <fixed-point>..HEAD --oneline
```

Ask for the fixed point only when the user did not supply one. Stop on a bad
reference or empty diff.

Completion criterion: one immutable merge-base diff and commit list define the
entire review.

## 2. Load normative sources

Read `.agent-framework.yaml`, its selected profiles and source scopes, every
configured guideline, the originating delivery contract and comments, parent feature contract, linked SRS
requirements and safeguards, accepted contract amendments, red-green evidence,
and the final verification report. Resolve tracker references through the
configured adapter.

When no delivery contract exists, use the best available issue or spec and
mark missing contract/evidence sources rather than inventing them.

Completion criterion: every available standard, requirement, safeguard,
non-goal, acceptance ID, and evidence source is indexed before review begins.

## 3. Run three independent review passes

Use isolated subagents in parallel when the client supports them and the user
has authorized delegation. Otherwise run three separate sequential passes,
discarding provisional conclusions between passes. Each pass reads the same
diff but only its own sources:

- **Standards** — apply configured repository rules and
  [the standards baseline](references/standards-baseline.md). For an
  `express-typescript` backend also load
  [the Express/TypeScript baseline](references/express-typescript.md). Apply a
  framework baseline only to files in its confirmed source scope. Report
  documented violations separately from judgement-call smells. Repository
  rules override the baseline.
- **Contract** — compare the diff with SRS, feature, and delivery intent. Find
  missing or partial behavior, scope additions, safeguard or non-goal
  violations, incorrect behavior, implicit decisions, and intent drift not
  covered by an accepted amendment.
- **Evidence** — map every acceptance ID and affected safeguard to red-green
  evidence and final verification. Find missing tests, stale passes, command
  substitutions, unjustified skips, insufficient assertions, and user-facing
  changes without smoke or browser evidence.

Every finding cites the changed file/hunk and its normative source or missing
evidence row. Use `P0` through `P3` severity within each axis.

Completion criterion: all three passes cover the complete diff without seeing
or adapting to another pass's findings.

## 4. Reconcile without blending

Deduplicate only identical findings within the same axis. Keep the three axes
under separate headings and never produce one cross-axis score. An item that
appears in multiple axes remains in each because its consequence differs.

Use [the review report](references/review-report.md). Report zero findings
explicitly for a clean axis and name unavailable sources or skipped evidence.

Completion criterion: each axis has its own findings, worst severity, and
source-completeness statement.

## 5. Propose the next action

Return actionable fixes for in-scope findings. Contract or durable knowledge
changes require an explicit contract-amendment decision before implementation;
review never silently rewrites the SRS, glossary, ADRs, ticket, or history.

Completion criterion: every finding is fixed, accepted as a contract amendment,
deferred with an owner, or left as an explicit blocker.
