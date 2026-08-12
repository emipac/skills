# Define the Laravel profile and generic extension contract

Status: done
Parent: change-evaluation-gate
Assignee: Codex
Labels: wayfinder:research
Blocked by:

## Question

How should Rector, Pint, PHPStan or Larastan, analysis of tests, focused and broad Pest suites, smoke tests, builds, and browser checks map onto the existing Evidence ladder, and what capability contract lets other stacks provide equivalent checks without hard-coded framework logic?

## Comments

### Resolution — 2026-08-04

The [Laravel profile and generic extension contract](../research/laravel-profile-and-generic-extension-contract.md) defines one stack-neutral check descriptor consumed by the existing Verification profile and Evidence ladder. Providers resolve project facts into stable IDs, stages, semantic capabilities, scope/applicability, prerequisites, required/advisory policy, separate non-mutating evaluation and optional fix commands, timeouts, declared writes, coverage claims, and normalized evidence. The gate does not branch on framework or tool names.

Laravel maps Pint to `format`; Rector dry-run and PHPStan/Larastan to distinct checks in `static-analysis`; explicit Pest selections to `focused` and `affected-tests`; and confirmed project commands to `smoke`, `build`, `browser`, and `broad-tests`. Application and test analysis remain separate evidence claims even when one PHPStan command covers both. Missing or unproved commands remain visible capability gaps rather than guessed defaults.
