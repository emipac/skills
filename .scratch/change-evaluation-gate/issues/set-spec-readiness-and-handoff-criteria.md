# Set specification readiness and handoff criteria

Status: done
Parent: change-evaluation-gate
Assignee: Codex
Labels: wayfinder:grilling
Blocked by: decide-installation-and-activation-model, define-configuration-evidence-and-security-contract, define-laravel-profile-and-generic-extension-contract

## Question

Which resolved decisions, acceptance scenarios, safeguards, non-goals, compatibility evidence, interface definitions, and installation examples must exist before this map can hand the Change Evaluation Gate to `to-spec` and `to-tickets` without leaving implementation decisions open?

## Comments

### Accepted handoff decision — 2026-08-05

`to-spec` shall use the completed Change Evaluation Gate Wayfinder decision set
as its authoritative planning input: the root map is the index, resolved Decision
tickets own their decisions, and accepted linked research or prototypes supply
the referenced detail. The Change Evaluation Gate SRS is a traceability projection
that supplies stable FR, NFR, AC, SG, RISK, and Q IDs; it cannot override a
Wayfinder decision. If the artifacts conflict, the Wayfinder decision governs and
the SRS must be refined before handoff.

The absence of `.agent-framework.yaml` does not change this source precedence.
It remains an operational prerequisite for invoking the current `to-spec` and
`to-tickets` skills, not a product decision or a reason to make the SRS normative.

### Accepted Q-006 decision — 2026-08-05

Handoff requires a contract-complete package: the completed authoritative
Wayfinder decision set; the SRS's applicable FR, NFR, AC, SG, RISK, and Q
traceability; the accepted `evaluate(request) -> decision` interface contract;
acceptance scenarios mapped to observable evidence; safeguards, non-goals, and
failure behavior; compatibility and runtime evidence requirements; installation,
configuration, activation, update, and removal examples; named owners and
dispositions for blocking risks; and no unresolved decision that could alter
externally observable behavior.

The package does not prescribe physical schemas, classes, files, command
serialization internals, or other implementation design. Those belong to the
Feature contract and implementation tickets after Wayfinder handoff.

### Confirmed Q-007 decision — 2026-08-05

Retain the existing Wayfinder decision: `framework-setup` defines no universal
durations. It requires project-confirmed per-check timeouts and a total
evaluation budget, including which advisory checks may be skipped when that
budget is exhausted. Required evidence may not be skipped merely to meet the
budget.

### Accepted Q-008 decision — 2026-08-05

V1 retains at most 32 KiB of redacted inline output per Check attempt while
preserving its beginning and end, at most 4 MiB in one redacted output blob, and
at most 32 MiB of output blobs for one evaluation. Projects may configure lower
limits but cannot exceed these v1 ceilings. Truncation records the redacted
output byte count and omitted-byte count.

Pruning is manual, preview-first, and selectable by evaluation, age, or desired
reclaimed size. Confirmation must match the exact preview. Pruning removes only
the selected output blobs and preserves Evidence envelopes, decisions, bypass
records, Lifecycle events, pruning records, and tombstones. V1 performs no
automatic evidence deletion or background retention job.

### Accepted Q-001 decision — 2026-08-05

When Wayfinder readiness closes, promote the reviewed SRS traceability
projection to `docs/specifications/change-evaluation-gate-srs.md`. Keep the
working Draft in `.scratch` until that point. Promotion updates decision links
without changing stable SRS IDs or the authoritative status of the Wayfinder
decision set.

### Accepted Q-002 authority model — 2026-08-05

Use one named Change Evaluation Gate Product Owner as the sole accountable SRS
approver and residual-risk acceptance authority. Domain owners may prepare
mitigations and evidence, but their concurrence is not required for the Product
Owner to accept a residual risk. Q-002 remains open only until that Product
Owner is identified.

### Accepted Q-004 decision — 2026-08-05

Support remains capability-based. Each Gate release candidate publishes a
compatibility manifest containing the exact Gate, Git, Node.js, client, and
operating-system versions actually tested and the pass or fail outcomes of the
authoritative Git, supported adapter, and runtime portability fixtures. These
versions are release-time evidence snapshots, not a permanent runtime
allowlist. An untested version has no verified support claim until its
applicable baseline passes.

### Accepted Q-005 decision — 2026-08-05

Framework release `0.9.0` is the first Gate-capable release. It reads schema v3
and v4, while only v4 may contain `evaluation_gate`. Schema v3 remains readable
throughout `0.x` and may be removed no earlier than `1.0.0` with migration
notice.

`framework-setup` owns an explicit previewed v3-to-v4 migration. It converts
only unambiguous raw commands, requires repository-maintainer mapping when a
Command descriptor is ambiguous, aborts without modification while ambiguity
remains, and writes atomically. Migration does not configure or activate the
Gate. Gate configuration and clone-local activation remain separate confirmed
steps; failed Gate updates preserve the prior active release and configuration.

### Q-005 release-boundary correction — 2026-08-07

The repository is already released at `0.8.0`, so the accepted backward-compatible
introduction moves to the next minor, `0.9.0`. The schema compatibility,
migration, configuration, and activation decisions are otherwise unchanged.

### Accepted Q-005 profile-presence addendum — 2026-08-10

Schema version 4 adds explicit `backend: none` symmetry with the existing
`frontend: none`. `none` means proved absent, while `unknown` remains a
conservative present-but-unclassified profile. Backend-only, frontend-only,
full-stack, and tooling-only configurations are valid; tooling-only uses the
Verification profile `tooling`.

Migration may preserve a concrete or `none` profile without reinterpretation,
but schema v3 `unknown` requires an explicit maintainer mapping before it can
become schema v4 `none`. Shared, tied, and unmatched paths affect configured
active profiles only, and profile-specific scopes or commands cannot target a
profile declared `none`.

### Accepted Q-002 owner — 2026-08-05

The repository owner or lead maintainer is the Change Evaluation Gate Product
Owner. This role is solely accountable for SRS approval and may accept residual
risks without domain-owner concurrence. Domain owners may prepare mitigations
and evidence but do not hold approval authority.

### Accepted high-impact risk disposition — 2026-08-07

The Product Owner conditionally accepts the residual local-v1 impact of
RISK-002, RISK-004, RISK-005, RISK-006, RISK-008, and RISK-009 only when each
risk's mandatory acceptance and release evidence passes. Missing or failed
evidence blocks the Gate release; it cannot be waived by treating the risk as
already accepted.

The mandatory gates are shared-runtime safety and declared-write evidence for
RISK-002; adapter and portability matrices for RISK-004; backward-compatible
schema migration evidence for RISK-005; secret-canary, redaction, and
sensitive-input evidence for RISK-006; Grader-surface and trusted/candidate
policy evidence for RISK-008; and snapshot-routing plus runtime-portability
evidence for RISK-009.

### Accepted Q-003 scope decision — 2026-08-07

No additional client enters v1 beyond local Git `pre-commit`, Claude Code
Desktop's local Code tab, Codex Desktop with a local project, and Cursor IDE's
local Agent. Any additional client requires a fresh post-v1 Wayfinder effort and
its own compatibility evidence before it may claim support.

### Resolution — 2026-08-07

The required contract-complete handoff package, durable SRS path, approval
authority, compatibility evidence policy, release and migration sequence,
retention bounds, and high-impact risk dispositions are accepted. No product
decision remains open for `to-spec`. The approved traceability projection is
[Change Evaluation Gate SRS](../../../docs/specifications/change-evaluation-gate-srs.md).

The absence of `.agent-framework.yaml` remains an operational prerequisite for
invoking and publishing through `to-spec`; it is not a product-readiness gap.
