# Decide gate policy and bypass contract

Status: done
Parent: change-evaluation-gate
Assignee: Codex
Labels: wayfinder:grilling
Blocked by:

## Question

Which evaluation stages are required, may commands mutate files, when does the gate block or warn, and how must it handle timeouts, pre-existing failures, unavailable tools, emergency bypasses, partial reruns, and fail-open versus fail-closed behavior?

## Comments

### Resolution — 2026-08-04

The authoritative commit-time evaluation is non-mutating. `gate evaluate` and every Git or agent preflight adapter use check-only commands; mutating tools such as Rector and Pint run only through an explicit `gate fix` mode outside the commit hook.

Only deterministic checks explicitly configured as required for the affected change may block. A required check that runs and detects a problem is `failed`; a required check that cannot produce evidence because of missing tools, invalid configuration, timeout, crash, or unreadable output is `unverified`. Both block. Optional checks and model-based review are advisory in v1: they warn and record evidence but cannot block.

Pre-existing required failures receive no automatic exemption in v1. They remain blocking until fixed, deliberately reconfigured through review, or handled by the supported bypass. The gate does not implement baseline comparison or persistent pass-result caching. Iteration may rerun a failed check, but final authorization requires every applicable required check to have a current pass bound to the exact staged snapshot, command, configuration, and relevant tool environment. Relevant staged changes invalidate prior evidence; exact duplicates within one unchanged evaluation may be reused.

Each command has a project-confirmed timeout and the evaluation has an overall budget. A required timeout or exhaustion before all required checks pass produces `unverified` and blocks. Optional checks may be skipped for insufficient remaining budget with a warning. Timed-out process trees must be terminated, and background completion cannot authorize the current commit.

Projects may disable bypass. When enabled, the supported bypass is explicit, one-shot, bound to the exact staged snapshot, and requires a reason with an optional policy-required ticket or reference. It records actor, timestamp, reason, failed or unverified checks, configuration identity, and staged-tree identity; it emits machine-readable evidence and a commit-visible marker. Its outcome is `bypassed`, never `passed`. Local hooks cannot reliably audit direct `--no-verify`, hook removal, or Git reconfiguration, so the gate is not represented as a security boundary.
