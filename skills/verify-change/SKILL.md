---
name: verify-change
description: Verify a code change through the configured Laravel and frontend profile. Use when another lifecycle skill needs an ordered verification plan, exact command evidence, smoke or browser coverage, or an explanation of intentionally skipped checks.
---

# Verify Change

Turn a delivery contract and `.agent-framework.yaml` into an evidence ladder:
focused behavior first, broad regression confidence last. Never guess commands
that setup did not prove.

## 1. Load the evidence contract

Read the changed files, delivery-contract Verification Matrix, configured
verification profile, capabilities, and commands. Read
[Laravel verification](references/laravel.md) when the backend profile is
Laravel and [TypeScript frontends](references/typescript-frontends.md) for the
selected frontend profile.

Mark whether the change affects user-visible routes, screens, forms, browser
state, or responses. Treat an absent required command or capability as a gap,
not permission to improvise.

Completion criterion: every changed surface and required matrix row maps to a
configured capability or a visible gap.

## 2. Plan the evidence ladder

Run the deterministic planner:

```bash
node <skill-directory>/scripts/verification-plan.mjs \
  --config .agent-framework.yaml \
  --ticket-matrix <matrix-json> \
  --changed-file <path> \
  --user-facing \
  --json
```

Repeat `--changed-file` for every changed path. Omit `--user-facing` only when
the diff has no observable user workflow. The matrix JSON is an array of
`layer`, `evidence`, `command`, and `required` values extracted without
rewriting the approved ticket.

The ladder order is focused, format, static analysis, affected tests, smoke,
build, browser, then broad tests. Commands within a stage remain in configured
order. Remove only exact duplicates.

Completion criterion: the plan is valid, ordered, and contains a reason for
every configured layer that is not selected.

## 3. Execute narrowly to broadly

Run one planned command at a time. Capture its exact command, exit outcome, and
short result. Repair a failure and rerun the affected command before advancing;
do not bury a narrow failure under broader output.

User-facing behavior requires smoke or browser evidence. Frontend changes
require the configured production build. A required unavailable layer blocks
completion until setup or the delivery contract is explicitly amended.

Completion criterion: every required planned command passed at least once
after the final relevant change.

## 4. Audit and report

Record results with [the evidence report](references/evidence-report.md), then
run the planner with `--evidence <evidence-json>`. A skipped optional command
needs a concrete reason; required commands cannot be skipped.

Report exact commands and outcomes, acceptance IDs proved, selected profile,
pre-existing failures, skipped layers with reasons, and unresolved capability
gaps. Never claim a layer passed based on another command.

Completion criterion: the evidence audit is valid and every acceptance ID in
the Verification Matrix has observable evidence.
