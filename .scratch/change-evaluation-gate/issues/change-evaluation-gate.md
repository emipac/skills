# Change Evaluation Gate

Status: done
Parent: none
Assignee:
Labels: wayfinder:map
Blocked by:

## Destination

A resolved decision set sufficient to produce an implementation-ready specification for an optional, system-agnostic Change Evaluation Gate. The gate must evaluate every commit in an enabled repository through a portable Git enforcement seam, with Cursor, Codex, and Claude Code hooks acting as early-feedback adapters.

## Notes

- Planning only: implementation and release work follow through `to-spec` and `to-tickets` after this map is resolved.
- Every session should consult `domain-modeling`, `codebase-design`, and the ticket-appropriate `research`, `prototype`, or `grill-with-docs` skill.
- Confirmed standing constraint: an enabled project evaluates human and agent commits identically; agent hooks do not replace Git enforcement.
- Existing framework seams to deepen or deliberately supersede: `framework-setup` owns exact project commands and `verify-change` owns the Evidence ladder.
- The public product term is **Change Evaluation Gate**; avoid using “eval harness” for this feature.

## Decisions so far

- [Research cross-client hook and installation capabilities](research-cross-client-hook-and-install-capabilities.md) — Git is the portable commit seam; client hooks require native capability-aware adapters, and skill installation alone cannot activate them everywhere.
- [Decide gate policy and bypass contract](decide-gate-policy-and-bypass-contract.md) — Commit evaluation is check-only and exact-snapshot-bound; required deterministic failures or missing evidence block, while advisory checks and explicit audited bypass remain visibly non-passing.
- [Define the Laravel profile and generic extension contract](define-laravel-profile-and-generic-extension-contract.md) — Stack providers emit normalized check descriptors into the existing Verification profile; Laravel maps Pint, Rector, PHPStan/Larastan, Pest, smoke, build, and browser evidence without adding framework logic to the gate.
- [Define client support tiers and compatibility baseline](define-client-support-tiers-and-baseline.md) — Git is the supported authoritative integration; Claude Code Desktop, Codex Desktop, and Cursor IDE are supported preflight targets proved through OS-independent client capabilities plus a separate gate-runtime portability baseline.
- [Design the shared gate interface and adapters](design-shared-gate-interface-and-adapters.md) — One versioned `evaluate(request) -> decision` process interface owns isolated snapshot grading, coverage, integrity, policy, and evidence; Git and desktop clients remain thin event/result adapters.
- [Decide installation and activation model](decide-installation-and-activation-model.md) — The opt-in gate separates installation, repository configuration, and clone-local transactional activation; it preserves shared configuration and existing hooks, pins active releases, and reports reconciled health without silent activation, updates, repair, or removal.
- [Define configuration, evidence, and security contract](define-configuration-evidence-and-security-contract.md) — Schema v4 adds opt-in gate policy and OS-independent shell-free commands; pinned configuration, same-host snapshot execution, immutable local evidence, serialized evaluations, explicit runtime inputs, drift detection, and lifecycle events provide reproducibility without virtualization or adversarial-security claims.
- [Set specification readiness and handoff criteria](set-spec-readiness-and-handoff-criteria.md) — Wayfinder remains authoritative; the approved SRS supplies stable traceability IDs; the contract-complete handoff, ownership, compatibility evidence, `0.9.0` migration path, retention bounds, scope boundary, and release-gated risk dispositions are settled.

## Not yet specified

- None.

## Out of scope

- Implementing, publishing, or enabling the gate while this decision map is open.
- Replacing `framework-setup` or `verify-change` without a decision proving that their existing interfaces cannot support the gate.
- Treating local hooks as tamper-proof enforcement or preventing raw `--no-verify`, hook removal, or Git reconfiguration; CI or server-side attestation is a possible later scope.
- Provisioning Docker, virtual machines, separate databases, or hardened OS/container sandboxes for local evaluation; v1 reuses the existing developer runtime and services.
- Supporting additional clients beyond local Git `pre-commit`, Claude Code Desktop's local Code tab, Codex Desktop with a local project, and Cursor IDE's local Agent; each requires a fresh post-v1 Wayfinder effort and separate compatibility evidence.

## Comments
