# Design the shared gate interface and adapters

Status: done
Parent: change-evaluation-gate
Assignee: Codex
Labels: wayfinder:prototype
Blocked by: research-cross-client-hook-and-install-capabilities, define-client-support-tiers-and-baseline, decide-gate-policy-and-bypass-contract, define-laravel-profile-and-generic-extension-contract

## Question

What smallest deep-module interface should accept a proposed change, reuse the configured Verification profile and Evidence ladder, return a structured decision, and keep Git, Cursor, Codex, and Claude Code integrations as thin adapters?

## Comments

### Resolution — 2026-08-04

The accepted [shared gate interface prototype](../prototypes/shared-gate-interface/README.md) exposes one versioned process operation: `evaluate(request) -> decision`. The request contains the repository root, snapshot target, optional repository-owned delivery-contract reference, Enforcement role, normalized trigger, and adapter/capability/session identity. It never carries client-native payloads, verification commands, or policy overrides.

The deep gate module resolves the Verification profile, materializes the exact Evaluation snapshot in an isolated execution root, plans and executes the Evidence ladder, treats configured checks as deterministic code-based graders, evaluates required/advisory policy and bypass, calculates acceptance coverage and integrity, and persists evidence. `gate fix` and installation remain separate interfaces.

The decision returns protocol and evaluation identity; `passed`, `failed`, `unverified`, or `bypassed`; `allow`, `deny`, or `not-authoritative`; Evaluation scope; snapshot and environment identity; checks with mandatory Check assertions and preserved Check attempts; acceptance coverage and gaps; changed Grader surfaces; configuration, runner, and provider integrity; and evidence identity. A missing contract produces an explicit `regression-only` decision. Conflicting attempts for the same snapshot/configuration/environment produce `unverified`.

Git, Claude Code Desktop, Codex Desktop, and Cursor IDE adapters only normalize their native event into the request and translate the decision into native exit/output behavior. A successfully returned decision envelope is transport success even when authorization is denied: Git maps `deny` to a blocking exit, while desktop preflight adapters return visible structured feedback without claiming authority.

The user-requested [Anthropic eval research](../research/anthropic-agent-evals-gate-lessons.md) strengthened the interface with isolated snapshot materialization, explicit task scope, code-grader method/target metadata, atomic assertions, attempt/reason history, coverage, and grader-integrity evidence. Transcript/tool-sequence grading, `pass@k`, weighted required-check scoring, and authoritative model-based graders remain outside the gate.
