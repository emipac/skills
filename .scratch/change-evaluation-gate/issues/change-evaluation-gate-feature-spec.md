# Change Evaluation Gate — Feature Contract

Status: open
Parent: change-evaluation-gate
Assignee:
Labels:
Blocked by:

## Feature Contract

| Field | Value |
| --- | --- |
| Status | ready-for-tickets |
| SRS baseline | [Change Evaluation Gate SRS v0.2.2 — Approved](../../../docs/specifications/change-evaluation-gate-srs.md) |
| Decision sources | [Completed Wayfinder map](change-evaluation-gate.md), its resolved decision tickets, and [readiness and handoff decision](set-spec-readiness-and-handoff-criteria.md) |

## Problem and Outcome

Repositories using the AI Skills Framework can describe verification commands and evidence expectations, but they do not have one opt-in, system-agnostic mechanism that evaluates the exact content of every local commit before Git accepts it. Client-specific hooks can provide early feedback, yet they are not portable enforcement and can diverge in payloads, lifecycle behavior, policy interpretation, and evidence.

The Change Evaluation Gate must provide a single authoritative local Git decision for human and agent commits while preserving existing framework ownership: `framework-setup` owns project configuration and schema migration, and `verify-change` owns the Verification profile and Evidence ladder. The feature must remain honest about its local trust boundary. It is reproducible, auditable pre-commit enforcement for a trusted developer environment, not tamper-proof CI or hostile-code containment.

Deliver an optional Change Evaluation Gate centered on one versioned, deep process interface: `evaluate(request) -> decision`. The gate materializes and evaluates an isolated snapshot, invokes the existing Verification Evidence ladder through normalized stack-neutral check descriptors, applies required, advisory, and bypass policy, and emits a complete snapshot-bound decision and immutable evidence record.

Local Git `pre-commit` is the authoritative v1 enforcement adapter. Claude Code Desktop's local Code tab, Codex Desktop local projects, and Cursor IDE local Agent integrations are supported preflight adapters when their capabilities are proved. Installation, repository configuration, and clone-local activation remain separate lifecycle states. Activation is transactional, preserves existing hooks and shared Git configuration, enables Git last, and records a pinned receipt. Configuration uses schema v4; the first Gate-capable framework release is `0.9.0`.

The Wayfinder decision map is the product and behavior source of truth. The approved SRS is the stable-ID traceability projection. If they conflict, implementation follows the Wayfinder decision and the SRS is corrected without replacing its stable IDs.

## SRS Traceability

Acceptance Criteria `Requirement IDs` are the canonical requirement-to-evidence mapping. Safeguards preserve the applicable negative-space constraints.

| Requirement IDs | Acceptance IDs | Safeguard IDs | Scope | Risk IDs | Question IDs |
| --- | --- | --- | --- | --- | --- |
| `FR-EVAL-001`, `FR-POL-001`, `FR-POL-003` | `AC-EVAL-001` | `SG-EVAL-001`, `SG-POL-001`, `SG-TRUST-001` | Authoritative Git commit authorization | `RISK-001` | `Q-002` |
| `FR-EVAL-002`, `FR-EVAL-006`, `NFR-AUD-002`, `NFR-OPER-001` | `AC-EVAL-002` | None | Versioned request and complete decision contract | None | None |
| `FR-EVAL-003`, `FR-EVAL-005`, `NFR-REL-001` | `AC-EVAL-003` | `SG-OWNER-001` | Delegation through the existing Verification seam | None | None |
| `FR-EVAL-004`, `NFR-SEC-001` | `AC-EVAL-004` | `SG-EVAL-001` | Exact-snapshot isolation and source immutability | `RISK-009` | None |
| `FR-EVAL-007`, `FR-PROF-005` | `AC-EVAL-005` | `SG-SCOPE-001` | Delivery-contract coverage and regression-only scope | None | None |
| `FR-EVAL-008`, `NFR-REL-003` | `AC-EVAL-006` | None | Attempt preservation and normalized unverified failures | `RISK-007` | None |
| `FR-EVAL-009` | `AC-EVAL-007` | `SG-CFG-001` | Changed Grader-surface and integrity identities | `RISK-008` | None |
| `FR-EVAL-010`, `NFR-SEC-001` | `AC-EVAL-008` | `SG-EVAL-002` | Served-runtime binding to the Evaluation snapshot | `RISK-009` | None |
| `FR-POL-002`, `FR-POL-004` | `AC-POL-001` | `SG-POL-001` | Advisory policy and current-result authorization | None | None |
| `FR-POL-005`, `NFR-PERF-001` | `AC-POL-002` | `SG-POL-001` | Per-check timeout and total-budget behavior | `RISK-003` | `Q-007` |
| `FR-POL-006`, `FR-POL-007`, `FR-POL-008` | `AC-POL-003` | `SG-BYP-001` | Disabled and explicit audited bypass behavior | `RISK-001`, `RISK-003` | None |
| `FR-POL-009` | `AC-POL-004` | `SG-OWNER-001` | Separation of check-only evaluation and mutating fix | None | None |
| `FR-ADAPT-001`, `FR-ADAPT-003` | `AC-ADAPT-001` | `SG-SUPPORT-001` | Shared decision mapping across Git and desktop adapters | None | None |
| `FR-ADAPT-002`, `FR-ADAPT-004`, `FR-ADAPT-005`, `FR-ADAPT-006`, `FR-ADAPT-007`, `NFR-COMP-001` | `AC-ADAPT-002` | `SG-SUPPORT-001` | Capability-based client support and release evidence | `RISK-004` | `Q-003`, `Q-004` |
| `FR-PROF-001`, `FR-PROF-002`, `NFR-MAINT-001` | `AC-PROF-001` | `SG-OWNER-001` | Stack-neutral provider contract | None | None |
| `FR-PROF-003` | `AC-PROF-002` | `SG-OWNER-001` | Laravel check-descriptor mapping | None | None |
| `FR-PROF-004` | `AC-PROF-003` | `SG-OWNER-001` | Visible capability gaps without guessed commands | None | None |
| `FR-PROF-006`, `FR-PROF-007`, `FR-PROF-008` | `AC-PROF-004` | `SG-OWNER-001` | Ordered stages, normalized outcomes, and extension versioning | None | None |
| `FR-PROF-009`, `FR-PROF-010` | `AC-PROF-005` | `SG-OWNER-001` | Proved Laravel defaults and explicit fix workflow | None | None |
| `FR-LIFE-001`, `FR-LIFE-002`, `FR-LIFE-003` | `AC-LIFE-001` | `SG-DIST-001` | Installed, configured, and clone-local activated states | None | None |
| `FR-LIFE-004`, `FR-LIFE-005`, `FR-LIFE-006`, `NFR-REL-002` | `AC-LIFE-002` | `SG-HOOK-001`, `SG-LIFE-001` | Transactional activation and receipt | None | None |
| `FR-LIFE-007`, `NFR-COMP-002` | `AC-LIFE-003` | `SG-HOOK-001` | Existing hook preservation | None | None |
| `FR-LIFE-008`, `FR-LIFE-009` | `AC-LIFE-004` | `SG-LIFE-001` | Atomic update and read-only health reconciliation | None | None |
| `FR-LIFE-010`, `FR-LIFE-011` | `AC-LIFE-005` | `SG-LIFE-001` | Conservative deactivation and uninstall | None | None |
| `FR-LIFE-012`, `FR-LIFE-013` | `AC-LIFE-006` | `SG-DIST-001` | Selective distribution without implied adoption | None | None |
| `FR-LIFE-014` | `AC-LIFE-007` | `SG-LIFE-001` | Candidate release availability without implicit activation | None | None |
| `FR-LIFE-015` | `AC-LIFE-008` | `SG-HOOK-001` | Non-interactive activation identity binding | None | None |
| `FR-LIFE-016`, `FR-LIFE-017` | `AC-LIFE-009` | `SG-HOOK-001` | Trust resumption and ordered hook strategy | None | None |
| `FR-LIFE-018`, `FR-LIFE-019` | `AC-LIFE-010` | `SG-LIFE-001` | Explicit cleanup and repair | None | None |
| `FR-CFG-001`, `FR-CFG-002` | `AC-CFG-001` | `SG-CFG-001`, `SG-OWNER-001` | Schema v4 Gate policy ownership | None | `Q-005` |
| `FR-CFG-003`, `FR-CFG-004`, `FR-CFG-007`, `NFR-SEC-002` | `AC-CFG-002` | `SG-CMD-001` | Shell-free command descriptors and runner resolution | None | None |
| `FR-CFG-005` | `AC-CFG-003` | `SG-CFG-001` | Trusted-to-candidate dual-policy transition | `RISK-008` | None |
| `FR-CFG-006`, `NFR-SEC-003` | `AC-CFG-004` | `SG-SECRET-001` | Sensitive runtime-input handling and redaction | `RISK-006` | None |
| `FR-CFG-008`, `FR-CFG-009` | `AC-CFG-005` | `SG-CFG-002` | Backward-compatible schema migration | `RISK-005` | `Q-005` |
| `FR-EVID-001`, `FR-EVID-002`, `FR-EVID-003`, `NFR-AUD-001` | `AC-EVID-001` | `SG-EVID-001`, `SG-SECRET-001` | Immutable bounded Evidence envelopes and output | `RISK-006`, `RISK-010` | `Q-008` |
| `FR-EVID-004`, `FR-EVID-005` | `AC-EVID-002` | `SG-EVID-001` | Manual preview-bound pruning and Lifecycle events | `RISK-010` | `Q-008` |
| `FR-COORD-001`, `FR-COORD-002`, `FR-COORD-003`, `FR-COORD-004`, `FR-COORD-005` | `AC-COORD-001` | `SG-COORD-001` | Serialized, shareable, role-aware evaluation coordination | `RISK-002` | None |
| `NFR-PORT-001`, `NFR-PORT-002` | `AC-PORT-001` | `SG-CMD-001`, `SG-SUPPORT-001` | Release-blocking runtime portability | `RISK-009` | `Q-004` |
| `NFR-SEC-004` | `AC-SEC-001` | `SG-CFG-001`, `SG-TRUST-001` | Integrity drift and trusted-local-process limits | `RISK-001`, `RISK-008` | None |
| None | None | None | Specification authority and contract-complete handoff | None | `Q-001`, `Q-006` |

## User Stories and Scenarios

### Adoption and lifecycle states

1. As a repository maintainer, I want Gate use to be opt-in so that installing the framework never silently configures or activates commit enforcement. (`FR-LIFE-002`, `SG-DIST-001`, `AC-LIFE-001`)
2. As a repository maintainer, I want installation, configuration, and activation to be distinct declared states so that I can reason about what has changed in the project and in my clone. (`FR-LIFE-001`, `AC-LIFE-001`)
3. As a repository maintainer, I want Gate installation to be project-local by default and global installation to require an explicit choice so that unrelated repositories are not affected. (`FR-LIFE-003`, `AC-LIFE-001`)
4. As a repository maintainer, I want activation to be clone-local and repository-specific so that enabling the Gate in one clone does not claim to enable it for every collaborator. (`FR-LIFE-003`, `AC-LIFE-001`)

### Evaluation interface

5. As a repository maintainer, I want the authoritative Gate to run on every local commit in an activated repository so that human and agent commits receive the same enforcement. (`FR-EVAL-001`, `AC-EVAL-001`)
6. As a client adapter, I want to invoke one versioned evaluation operation so that native client events do not create separate policy implementations. (`FR-EVAL-002`, `FR-ADAPT-001`, `SG-OWNER-001`, `AC-ADAPT-001`)
7. As a Gate caller, I want the request to identify repository root, snapshot target, optional delivery contract, Enforcement role, normalized trigger, adapter capabilities, and session identity so that evaluation context is explicit without leaking native payloads into the core interface. (`FR-EVAL-002`, `AC-EVAL-002`)
8. As a repository maintainer, I want a decision to report protocol and evaluation identity, outcomes, authorization, scope, snapshot and environment, check attempts, coverage gaps, integrity, and evidence identity so that a denial is diagnosable without reading client-native logs. (`FR-EVAL-006`, `NFR-OPER-001`, `NFR-AUD-002`, `AC-EVAL-002`)
9. As a repository maintainer, I want evaluation to operate on the exact proposed commit snapshot while leaving the live worktree immutable so that results cannot be confused with unstaged or concurrently edited content. (`FR-EVAL-004`, `NFR-SEC-001`, `SG-EVAL-001`, `AC-EVAL-004`)
10. As a repository maintainer, I want HTTP and browser checks to prove that the existing runtime serves the materialized Evaluation snapshot so that stale or live-worktree runtimes cannot produce a false pass. (`FR-EVAL-010`, `SG-EVAL-002`, `AC-EVAL-008`)
11. As a repository maintainer, I want failure to prove runtime-to-snapshot binding to be `unverified` so that absence of evidence never becomes success. (`FR-EVAL-010`, `NFR-REL-003`, `SG-EVAL-002`, `AC-EVAL-008`)
12. As a repository maintainer, I want the Gate to reuse the existing `verify-change` Evidence ladder so that verification ordering and evidence semantics have one owner. (`FR-EVAL-003`, `FR-EVAL-005`, `SG-OWNER-001`, `AC-EVAL-003`)
13. As a repository maintainer, I want every check attempt retained with a reason classification so that retries and fallbacks remain auditable. (`FR-EVAL-008`, `AC-EVAL-006`)
14. As a repository maintainer, I want conflicting equivalent attempts to produce `unverified` so that the Gate does not choose a convenient result. (`FR-EVAL-008`, `NFR-REL-003`, `AC-EVAL-006`)
15. As a repository maintainer, I want evaluation without a valid delivery contract to be labeled `regression-only` so that the Gate does not claim task-specific acceptance coverage. (`FR-EVAL-007`, `SG-SCOPE-001`, `AC-EVAL-005`)
16. As a reviewer, I want a change that modifies a test, verification script, provider, or Gate configuration to report the affected Grader surface and to bind runner, provider, configuration, environment, and snapshot identities into the decision so that a change cannot quietly weaken the evidence that judges it. (`FR-EVAL-009`, `FR-CFG-007`, `AC-EVAL-007`)
17. As a repository maintainer, I want an identical evaluation binding to resolve the same ordered checks and authorization inputs on every run so that decisions are reproducible rather than incidental. (`NFR-REL-001`, `AC-EVAL-003`)
18. As a repository maintainer, I want missing prerequisites, invalid configuration, timeouts, crashes, malformed output, snapshot mismatch, integrity drift, and coordination failure to normalize to `unverified` with a stable reason family so that no harness fault is reported as a pass. (`NFR-REL-003`, `AC-EVAL-006`)

### Policy and bypass

19. As a repository maintainer, I want required checks that fail or remain unverified to deny authorization so that missing evidence cannot be mistaken for a passing commit. (`FR-POL-001`, `SG-POL-001`, `AC-EVAL-001`)
20. As a repository maintainer, I want advisory checks to record warnings and evidence without blocking so that policy severity is explicit and advisory success never compensates for a required failure. (`FR-POL-002`, `SG-POL-001`, `AC-POL-001`)
21. As a repository maintainer, I want final authorization bound to the current snapshot, command, configuration, and relevant tool environment so that stale results cannot authorize a changed commit. (`FR-POL-003`, `AC-EVAL-001`)
22. As a repository maintainer, I want no baseline exemption or persistent pass cache in v1 so that every required authorization is based on a current evaluation. (`FR-POL-004`, `AC-POL-001`)
23. As a repository maintainer, I want project-confirmed per-check timeouts and a total evaluation budget so that runtime expectations are explicit instead of framework-invented. (`FR-POL-005`, `NFR-PERF-001`, `AC-POL-002`)
24. As a repository maintainer, I want only eligible advisory work skipped when the remaining budget is insufficient, and incomplete required coverage reported as `unverified`, so that required evidence is never sacrificed to meet the budget. (`FR-POL-005`, `NFR-PERF-001`, `AC-POL-002`)
25. As a repository maintainer, I want bypass to be optional and policy-disableable so that a project may prohibit the supported escape hatch. (`FR-POL-008`, `SG-BYP-001`, `AC-POL-003`)
26. As an authorized committer, I want a supported bypass to require an explicit, one-shot, snapshot-bound reason and any policy-required reference so that its scope cannot silently carry forward. (`FR-POL-006`, `SG-BYP-001`, `AC-POL-003`)
27. As a reviewer, I want bypass to return `bypassed`, preserve failed and unverified checks, record machine-readable evidence, and emit a commit-visible marker so that it is never represented as a pass. (`FR-POL-007`, `NFR-AUD-002`, `SG-BYP-001`, `AC-POL-003`)
28. As a repository maintainer, I want mutating formatter and rewrite commands available only through an explicit `gate fix` operation outside commit evaluation so that evaluation itself remains check-only. (`FR-POL-009`, `AC-POL-004`)

### Client adapters

29. As a supported desktop client user, I want early preflight feedback through a thin capability-aware adapter that normalizes `work-complete` and, where available, `before-commit-attempt` so that I can correct failures before attempting a commit. (`FR-ADAPT-002`, `FR-ADAPT-003`, `AC-ADAPT-001`)
30. As a supported desktop client user, I want preflight results to remain non-authoritative so that only the Git integration grants or denies commit authorization. (`FR-ADAPT-003`, `FR-ADAPT-007`, `SG-SUPPORT-001`, `AC-ADAPT-001`)
31. As a framework releaser, I want each adapter to declare its event, blocking, trust, repository, session, filesystem, Git, and invocation capabilities so that no adapter assumes another client's contract. (`FR-ADAPT-004`, `AC-ADAPT-002`)
32. As a supported desktop client user, I want trust failure, invocation failure, timeout, capability mismatch, and malformed output presented as `unverified` so that a broken adapter never looks like a clean preflight. (`FR-ADAPT-005`, `NFR-REL-003`, `AC-ADAPT-002`)
33. As a framework releaser, I want unproved CLI, SSH, remote, cloud, and background variants classified as experimental and chat-only or hosted surfaces classified as unsupported so that support claims remain testable across client changes. (`FR-ADAPT-006`, `SG-SUPPORT-001`, `AC-ADAPT-002`)
34. As a framework releaser, I want supported Git, Claude Code Desktop, Codex Desktop, and Cursor fixtures to pass the release baseline so that v1 support is evidence-backed even where an adapter declares no native blocking. (`FR-ADAPT-002`, `NFR-COMP-001`, `AC-ADAPT-002`)

### Profiles and checks

35. As a stack provider, I want to emit versioned normalized stack-neutral check descriptors with stable identity, stage, capability, scope, applicability, prerequisites, policy, commands, timeout, declared writes, evidence claims, and order so that framework-specific knowledge does not enter Gate orchestration. (`FR-PROF-001`, `FR-PROF-002`, `NFR-MAINT-001`, `AC-PROF-001`)
36. As a Laravel repository maintainer, I want the Laravel profile to map Pint, Rector dry-run, PHPStan or Larastan, Pest, smoke, build, and browser evidence into normalized checks so that the Gate uses established Laravel tooling without tool names becoming gate logic. (`FR-PROF-003`, `AC-PROF-002`)
37. As a repository maintainer, I want missing or unproved commands to remain visible capability gaps so that the Gate never substitutes guessed defaults or filename-only test selection. (`FR-PROF-004`, `AC-PROF-003`)
38. As a reviewer, I want every applicable check to report at least one Check assertion, with acceptance-linked assertions using their stable acceptance IDs, so that a decision states which claims were actually proved. (`FR-PROF-005`, `AC-EVAL-005`)
39. As a repository maintainer, I want check descriptors assigned to the exact ordered stages focused, format, static-analysis, affected-tests, smoke, build, browser, and broad-tests so that ordering is stable and stack-neutral. (`FR-PROF-006`, `AC-PROF-004`)
40. As a repository maintainer, I want each resolved descriptor normalized as `passed`, `failed`, `unverified`, or `not-applicable`, with `required` and `advisory` remaining policy bindings rather than outcomes, so that inapplicable work is never confused with missing evidence. (`FR-PROF-007`, `AC-PROF-004`)
41. As a stack provider, I want to add a capability name without changing the gate runner while a new Evidence ladder stage or changed outcome semantics requires a provider contract-version change so that the extension seam stays honest. (`FR-PROF-008`, `NFR-MAINT-001`, `AC-PROF-004`)
42. As a repository maintainer, I want broad tests to remain regression evidence rather than implicit task acceptance so that scope claims are honest. (`FR-EVAL-007`, `SG-SCOPE-001`, `AC-EVAL-005`)
43. As a Laravel repository maintainer, I want proved Pint, Rector dry-run, PHPStan or Larastan, and broad-test checks proposed as required while focused, affected-test, smoke, build, and browser checks become required only once proved and confirmed so that defaults are earned rather than assumed. (`FR-PROF-009`, `AC-PROF-005`)
44. As a Laravel repository maintainer, I want Gate fixing to run Rector before Pint and then fully reevaluate the resulting snapshot so that mutations are ordered and never self-authorizing. (`FR-PROF-010`, `AC-PROF-005`)

### Lifecycle operations

45. As a repository maintainer, I want activation to preview exact changes and commands, obtain repository-bound consent, establish client-controlled trust, validate the existing hook chain, self-test selected adapters, and enable authoritative Git last so that enforcement is enabled knowingly. (`FR-LIFE-004`, `AC-LIFE-002`)
46. As a repository maintainer, I want a failed Activation transaction to roll back every gate-owned change and leave the clone configured so that partial activation cannot masquerade as healthy. (`FR-LIFE-005`, `NFR-REL-002`, `SG-LIFE-001`, `AC-LIFE-002`)
47. As a repository maintainer, I want an Activation receipt to pin configuration identity, runtime and adapter versions, hook locations, trust state, runtime input names, and self-test results so that active behavior can be reconciled. (`FR-LIFE-006`, `AC-LIFE-002`)
48. As a repository maintainer, I want managed hook registration to preserve the existing hook chain and never overwrite a hook or automatically change a shared or global `core.hooksPath` so that unrelated tooling remains intact. (`FR-LIFE-007`, `NFR-COMP-002`, `SG-HOOK-001`, `AC-LIFE-003`)
49. As a repository maintainer, I want hook registration to prefer a native hook manager, then a confirmed marker-delimited block in an existing hook, then a clearly owned shim so that composition follows a declared order. (`FR-LIFE-017`, `SG-HOOK-001`, `AC-LIFE-009`)
50. As a repository maintainer, I want an Activation transaction to pause for client-controlled trust and resume only under identical repository, configuration, selected-adapter, and preview identities so that a paused transaction never leaves an integration active. (`FR-LIFE-016`, `SG-HOOK-001`, `AC-LIFE-009`)
51. As an automation operator, I want non-interactive activation to require the expected repository and configuration identities and reject a mismatch before changing clone-local state so that scripted activation cannot target the wrong clone. (`FR-LIFE-015`, `AC-LIFE-008`)
52. As a repository maintainer, I want `gate update` to preview migrations, validate compatibility, rerun self-tests, and switch the Active gate release atomically while retaining the previous release on failure so that an update cannot break working enforcement. (`FR-LIFE-008`, `NFR-REL-002`, `AC-LIFE-004`)
53. As a repository maintainer, I want an ordinary skill or plugin update to make a candidate release available without replacing the Active gate release so that enforcement behavior changes only through an explicit Gate update. (`FR-LIFE-014`, `AC-LIFE-007`)
54. As a repository maintainer, I want `gate status` to reconcile and report `healthy`, `degraded`, or `broken` without repairing anything so that observation has no hidden mutation. (`FR-LIFE-009`, `SG-LIFE-001`, `AC-LIFE-004`)
55. As a repository maintainer, I want recovery from detected lifecycle or hook drift to require an explicit `gate repair` or Activation transaction so that neither status nor an ordinary update silently restores enforcement. (`FR-LIFE-019`, `SG-LIFE-001`, `AC-LIFE-010`)
56. As a repository maintainer, I want `gate deactivate` to remove only unchanged gate-owned registrations and the Activation receipt while preserving configuration and evidence so that turning the Gate off is not destructive. (`FR-LIFE-010`, `SG-LIFE-001`, `AC-LIFE-005`)
57. As a repository maintainer, I want `gate uninstall` to require deactivation and remove only project-installed assets so that global assets, shared framework configuration, and historical evidence survive. (`FR-LIFE-011`, `SG-LIFE-001`, `AC-LIFE-005`)
58. As a repository maintainer, I want a separate previewed configuration cleanup that removes only Gate-specific `.agent-framework.yaml` keys and never deletes the shared configuration file so that removal cannot damage unrelated framework settings. (`FR-LIFE-018`, `SG-LIFE-001`, `AC-LIFE-010`)
59. As a repository maintainer, I want the Gate module independently selectable through installers, with bundled Gate assets left dormant when only a whole plugin is installed, so that distribution never implies adoption. (`FR-LIFE-012`, `SG-DIST-001`, `AC-LIFE-006`)
60. As a repository maintainer, I want `framework-setup` to present Gate configuration as an initially unselected option and never infer consent from installed assets so that configuration remains a deliberate choice. (`FR-LIFE-013`, `SG-DIST-001`, `AC-LIFE-006`)

### Configuration and migration

61. As a repository maintainer, I want schema v4 to treat an absent `evaluation_gate` section as not configured and its presence as configured but not activated so that configuration state is unambiguous. (`FR-CFG-001`, `AC-CFG-001`)
62. As a repository maintainer, I want the Gate configuration section to contain only required and advisory check identities, total budget, bypass policy, execution policy, and evidence policy so that policy is project-owned while Verification remains the sole source of command definitions. (`FR-CFG-002`, `SG-OWNER-001`, `AC-CFG-001`)
63. As a cross-platform user, I want shell-free, operating-system-independent Command descriptors with a logical runner, argument array, working directory, timeout, allowed environment names, evidence category, and source scope so that configuration is portable and no command text is shell-parsed. (`FR-CFG-003`, `NFR-SEC-002`, `SG-CMD-001`, `AC-CFG-002`)
64. As a repository maintainer, I want activation to resolve each logical runner to a platform executable, record its identity and version, and preview the equivalent human-readable command so that what will run is visible before it runs. (`FR-CFG-004`, `SG-CMD-001`, `AC-CFG-002`)
65. As a reviewer, I want complex command behavior invoked only through an explicitly declared `repository-script` descriptor that is reported as a changed Grader surface when modified so that logic cannot hide outside the declared contract. (`FR-CFG-007`, `SG-CMD-001`, `AC-CFG-002`)
66. As a repository maintainer, I want a candidate policy-surface change evaluated against the prior Trusted gate configuration, validated separately, approved by candidate hash, and required to satisfy both policies where they differ so that a change can never weaken the policy authorizing its own commit. (`FR-CFG-005`, `SG-CFG-001`, `AC-CFG-003`)
67. As an activation operator, I want approved Sensitive runtime inputs confirmed at activation, copied only temporarily into the isolated materialization, recorded by name and source only, and removed afterwards so that secrets never enter repository configuration or evidence. (`FR-CFG-006`, `NFR-SEC-003`, `SG-SECRET-001`, `AC-CFG-004`)
68. As an existing framework user, I want release `0.9.0` to read schema v3 and v4 while permitting Gate configuration only in v4, with v3 read support retained throughout `0.x` and removable no earlier than `1.0.0` with migration notice, so that adoption is backward compatible with a declared floor. Schema v4 distinguishes proved-absent `none` profiles from conservative `unknown` profiles and supports backend-only, frontend-only, full-stack, and tooling-only repositories. (`FR-CFG-008`, `AC-CFG-005`)
69. As a repository maintainer, I want v3-to-v4 migration previewed, atomic, and limited to unambiguous command and profile-presence conversions so that migration never guesses. (`FR-CFG-009`, `SG-CFG-002`, `AC-CFG-005`)
70. As a repository maintainer, I want ambiguous commands or schema v3 `unknown` profiles to require maintainer mapping and abort without writing while ambiguity remains so that no verification behavior is silently altered. (`FR-CFG-009`, `SG-CFG-002`, `AC-CFG-005`)
71. As a repository maintainer, I want migration to neither configure nor activate the Gate so that schema evolution does not expand enforcement authority. (`FR-CFG-009`, `SG-CFG-002`, `AC-CFG-005`)

### Evidence and audit

72. As a reviewer, I want immutable, versioned, canonical, content-addressed Evidence envelopes appended atomically under Git common metadata so that all worktrees share append-only local records without modifying tracked source. (`FR-EVID-001`, `FR-EVID-002`, `NFR-AUD-001`, `AC-EVID-001`)
73. As a repository maintainer, I want v1 evidence ceilings of 32 KiB inline per attempt, 4 MiB per output blob, and 32 MiB of blobs per evaluation, with lower project limits allowed, so that evidence growth is bounded. (`FR-EVID-003`, `AC-EVID-001`)
74. As a repository maintainer, I want truncation to preserve output beginning and end and record redacted and omitted byte counts so that reduced evidence remains interpretable. (`FR-EVID-003`, `AC-EVID-001`)
75. As a repository maintainer, I want sensitive values redacted before persistence and unsafe capture reported as `unverified` so that Gate evidence does not become a secret store. (`NFR-SEC-003`, `SG-SECRET-001`, `AC-CFG-004`)
76. As a repository maintainer, I want pruning to be manual, preview-first, and selectable by evaluation, age, or reclaimed size so that evidence deletion is deliberate. (`FR-EVID-004`, `SG-EVID-001`, `AC-EVID-002`)
77. As an auditor, I want pruning to require a confirmation matching its preview and to remove only selected blobs while preserving envelopes, decisions, bypass and lifecycle records, pruning records, and tombstones so that the audit trail survives. (`FR-EVID-004`, `SG-EVID-001`, `AC-EVID-002`)
78. As a repository maintainer, I want no automatic evidence deletion or background retention job in v1 so that data is not removed unexpectedly. (`FR-EVID-004`, `SG-EVID-001`, `AC-EVID-002`)
79. As an auditor, I want configuration approval, activation, update, repair, removal, trust, evaluation, bypass, pruning, stale-lock recovery, and detected drift each to create an immutable Lifecycle event recording UTC time, explicitly unauthenticated best-effort actor, client and gate identity, repository identity, before and after hashes, outcome, reason, and redaction metadata so that governed actions are reconstructable. (`FR-EVID-005`, `NFR-AUD-001`, `AC-EVID-002`)

### Coordination

80. As a user with multiple worktrees or clients, I want evaluations serialized per Git common directory so that competing runs cannot corrupt shared state. (`FR-COORD-001`, `SG-COORD-001`, `AC-COORD-001`)
81. As a user triggering the exact same in-flight evaluation, I want the work shareable among subscribers while each receives a role-appropriate decision so that identical checks are not needlessly duplicated. (`FR-COORD-002`, `AC-COORD-001`)
82. As a committer, I want authoritative Git evaluation allowed to advance ahead of queued but not running preflights so that early-feedback traffic cannot indefinitely delay a commit. (`FR-COORD-003`, `AC-COORD-001`)
83. As a subscriber, I want cancellation to detach my interest without cancelling work still needed by others so that shared evaluations remain correct. (`FR-COORD-004`, `AC-COORD-001`)
84. As a repository maintainer, I want coordination locks to record process, host, start, and heartbeat evidence, stale-lock recovery to be explicit and audited, and coordination failure to be `unverified` so that concurrency faults never become authorization. (`FR-COORD-005`, `NFR-REL-003`, `SG-COORD-001`, `AC-COORD-001`)

### Portability, compatibility, and trust boundary

85. As a framework releaser, I want a compatibility manifest containing exact Gate, Git, Node.js, client, and operating-system versions and fixture outcomes so that each support claim has release-time evidence. (`NFR-COMP-001`, `NFR-PORT-001`, `AC-ADAPT-002`, `AC-PORT-001`)
86. As a framework releaser, I want untested versions to remain unverified rather than permanently denied so that compatibility stays capability-based rather than becoming a static allowlist. (`NFR-COMP-001`, `AC-ADAPT-002`)
87. As a cross-platform user, I want the runtime to launch executables non-interactively with explicit roots, arguments, standard streams, exit status, structured JSON, timeouts, process-tree termination, and Git access, without depending on an interactive shell, so that behavior does not vary by login environment. (`NFR-PORT-001`, `AC-PORT-001`)
88. As a cross-platform user, I want repository, worktree, Git metadata, temporary, and evidence paths handled without operating-system-labelled product logic so that spaces, linked worktrees, separators, and executable resolution behave identically everywhere. (`NFR-PORT-002`, `AC-PORT-001`)
89. As a repository maintainer, I want lifecycle state and evidence writes never to expose partial successful state so that an interrupted operation is either fully applied or fully absent. (`NFR-REL-002`, `AC-LIFE-002`)
90. As a repository maintainer, I want undeclared writes inside the materialized snapshot detected and reported as `unverified` so that a check cannot quietly modify what it is grading. (`NFR-SEC-001`, `AC-EVAL-004`)
91. As a repository maintainer, I want unexpected drift in the runtime, adapters, managed hooks, receipt, trusted configuration, Command descriptors, or providers to make Gate health `broken` and authoritative evaluation `unverified` so that a tampered control surface cannot authorize a commit. (`NFR-SEC-004`, `AC-SEC-001`)
92. As a security reviewer, I want the Gate to declare its trusted-local-process boundary so that users do not infer protection against hostile repository code, hook bypass, or machine-owner tampering. (`SG-TRUST-001`, `AC-SEC-001`)
93. As a maintainer, I want protocol, descriptors, evidence, and lifecycle contracts versioned and modular, with a new stack provider requiring no gate-core branch, so that the feature remains maintainable without widening its public interface. (`NFR-MAINT-001`, `AC-PROF-001`)

## Approach and Decisions

- The authoritative planning source is the completed Wayfinder map and its resolved decision tickets. The approved SRS preserves traceability IDs and must not override a Wayfinder decision.
- The Gate is one deep Module behind the versioned `evaluate(request) -> decision` Interface. Git and supported desktop integrations are thin Adapters at that Seam; native client payloads, native commands, and policy overrides do not cross it.
- The request contains repository root, exact snapshot target, optional delivery-contract reference, Enforcement role, normalized trigger, adapter capability identity, and session identity.
- The decision contains protocol and evaluation identity; passed, failed, unverified, or bypassed outcomes; allow, deny, or not-authoritative authorization; Evaluation scope; snapshot and environment identity; checks, assertions, and attempts; coverage and gaps; Grader surfaces; configuration, runner, and provider integrity; and evidence identity.
- The Gate materializes and grades an isolated exact snapshot. Evaluation is read-only with respect to the live worktree. HTTP or browser evidence is valid only when the existing local runtime is proved to serve that materialized snapshot.
- `verify-change` retains ownership of the Verification profile, applicable-check selection, ordered Evidence ladder, command execution semantics, and normalized evidence. Gate orchestration consumes that Interface instead of duplicating it.
- Required failed or unverified checks deny authoritative authorization. Advisory checks never deny. There is no baseline exemption or result cache in v1.
- Projects confirm per-check timeouts, total budget, and which advisory checks may be skipped for insufficient remaining budget. Required checks are not skipped merely to meet the budget.
- Supported bypass is optional, may be disabled, is explicit and one-shot, and is bound to the exact snapshot, reason, and reference. It returns `bypassed`, preserves failures and unknowns, records evidence, and emits the configured commit-visible marker.
- `gate fix` is a separate mutating operation. For Laravel it applies Rector before Pint and then invokes full reevaluation; mutations never authorize themselves.
- Stack providers supply normalized check descriptors. The exact ordered stages are focused, format, static-analysis, affected-tests, smoke, build, browser, and broad-tests. Broad tests are regression evidence, not implicit task acceptance.
- The Laravel provider maps Pint, Rector dry-run, PHPStan or Larastan, Pest, and proved smoke, build, and browser checks without embedding Laravel behavior in Gate orchestration.
- Distribution, project configuration, and clone-local activation are separate. Distribution never configures or activates. Project-local installation is the default; global installation is explicit.
- The Gate module is independently selectable through installers. A whole-plugin installation leaves bundled Gate assets dormant, and `framework-setup` presents Gate configuration as an initially unselected option rather than inferring consent from installed assets.
- An ordinary skill or plugin update only makes a candidate Gate release available. Only a successful explicit `gate update` advances the Active gate release recorded in the receipt.
- Non-interactive activation requires the expected repository and configuration identities and rejects a mismatch before any clone-local mutation. An Activation transaction may pause for client-controlled trust and resumes only under identical repository, configuration, selected-adapter, and preview identities; a paused transaction leaves no integration active.
- `framework-setup` owns schema configuration and migration. Gate activation owns preview, consent, trust confirmation, self-tests, hook composition, transactional rollback, receipt creation, and enabling Git last.
- Hook composition prefers a native hook manager, then a marker-delimited local hook, then an owned shim. It never overwrites an existing hook or changes shared hooks-path configuration.
- The activation receipt pins configuration, runtime, adapter, hook strategy, trust, named inputs, and self-test results. Updates are explicit and atomic. Failure retains the previous active release.
- Status reports healthy, degraded, or broken and does not repair. Deactivation, uninstall, and cleanup are conservative and preserve project configuration and evidence unless removal is explicitly selected.
- Recovery from detected lifecycle or hook drift requires an explicit `gate repair` or a new Activation transaction. Neither `gate status` nor an ordinary update ever repairs drift.
- Schema v4 adds optional top-level Gate configuration. Absence means not configured; presence means configured only. Its five subcontracts cover required and advisory identifiers, total budget, bypass, execution, and evidence.
- Verification owns commands. Configuration uses shell-free, operating-system-independent Command descriptors. Activation resolves each logical runner to a platform executable, records its identity and version, and previews the equivalent human-readable command.
- Complex command behavior is invoked only through an explicitly declared `repository-script` descriptor, and that script is reported as a changed Grader surface when modified.
- A candidate policy-surface change is evaluated under the prior Trusted gate configuration, validated separately as a candidate, approved by candidate hash, and must satisfy both policies where they differ. A change can never weaken the policy authorizing its own commit.
- Approved Sensitive runtime inputs are confirmed at activation, copied only temporarily into the isolated materialization, recorded by name and source only, and removed with that materialization.
- Framework `0.9.0` is the first Gate-capable release. It reads schema v3 and v4; only v4 may configure the Gate. Schema v3 remains readable through `0.x` and may be removed no earlier than `1.0.0` with notice.
- Migration from v3 to v4 is explicit, previewed, atomic, and limited to unambiguous conversions. Ambiguity requires maintainer mapping and aborts without a write. Migration neither configures nor activates the Gate.
- Evidence envelopes are immutable, content-addressed, append-only, and stored under Git common metadata. Sensitive values are redacted before persistence.
- Evidence ceilings are 32 KiB inline per attempt, 4 MiB per output blob, and 32 MiB of blobs per evaluation. Projects may lower but not raise these v1 ceilings.
- Pruning is manual and preview-bound. It may select by evaluation, age, or desired reclaimed size, removes only selected output blobs, and preserves envelopes, decisions, bypass and lifecycle records, pruning records, and tombstones. V1 has no automatic deletion.
- Configuration approval, activation, update, repair, removal, trust, evaluation, bypass, pruning, stale-lock recovery, and detected drift each create an immutable Lifecycle event recording UTC time, explicitly unauthenticated best-effort actor, client and gate identity, repository identity, before and after hashes, outcome, reason, and redaction metadata.
- Evaluation coordination is serialized per Git common directory. Identical in-flight work may be shared, Git may jump queued preflights, subscriber cancellation is isolated, and stale-lock recovery is audited. Unsafe coordination failure is `unverified`.
- Support is capability-based. Each release candidate records exact tested Gate, Git, Node.js, client, and operating-system versions and fixture outcomes in its compatibility manifest. The manifest is evidence, not a permanent allowlist.
- The runtime launches executables non-interactively with explicit roots, arguments, standard streams, exit status, structured JSON, timeouts, process-tree termination, and Git access, without depending on an interactive shell. Repository, worktree, Git metadata, temporary, and evidence paths are handled without operating-system-labelled product logic.
- Local Git `pre-commit` is authoritative. Claude Code Desktop local Code tab, Codex Desktop local project, and Cursor IDE local Agent are supported preflight targets. Other CLI, SSH, remote, cloud, and background contexts are experimental; chat-only or hosted contexts without repository, process, and Git access are unsupported.
- The trust model is a cooperative local process on a trusted developer machine. The Gate makes no claim of preventing raw Git bypass, hook removal, Git reconfiguration, machine-owner tampering, or hostile code from attacking local services.

## Public Interfaces and Test Seams

| Seam | Behavior observed | Acceptance IDs | Prior art |
| --- | --- | --- | --- |
| Versioned `evaluate(request) -> decision` process Interface | Exact-snapshot evaluation, Verification delegation, normalized attempts, policy, evidence, coverage, integrity, and coordination produce one complete non-mutating decision. | `AC-EVAL-002`, `AC-EVAL-003`, `AC-EVAL-004`, `AC-EVAL-005`, `AC-EVAL-006`, `AC-EVAL-007`, `AC-EVAL-008`, `AC-POL-001`, `AC-POL-002`, `AC-POL-003`, `AC-PROF-001`, `AC-PROF-002`, `AC-PROF-003`, `AC-PROF-004`, `AC-EVID-001`, `AC-COORD-001`, `AC-SEC-001` | Existing `verify-change` tests for ordered plans, capability reporting, missing evidence, schema parsing, read-only execution, and machine-readable results |
| Lifecycle command Interface | Installation, configuration, activation, migration, update, status, repair, fix, evidence pruning, deactivation, uninstall, and cleanup expose previews, consent, transactionality, preservation, and stable outcomes. | `AC-POL-004`, `AC-PROF-005`, `AC-LIFE-001`, `AC-LIFE-002`, `AC-LIFE-003`, `AC-LIFE-004`, `AC-LIFE-005`, `AC-LIFE-006`, `AC-LIFE-007`, `AC-LIFE-008`, `AC-LIFE-009`, `AC-LIFE-010`, `AC-CFG-001`, `AC-CFG-002`, `AC-CFG-003`, `AC-CFG-004`, `AC-CFG-005`, `AC-EVID-002`, `AC-SEC-001` | Existing `framework-setup` tests for discovery, schema migration, idempotency, protected instruction preservation, safe write scopes, and capability gaps |
| Adapter conformance Interface | Git maps authoritative authorization to commit behavior; supported desktop adapters normalize triggers and present the same structured result as non-authoritative preflight; release fixtures prove declared capabilities and portability. | `AC-EVAL-001`, `AC-ADAPT-001`, `AC-ADAPT-002`, `AC-PORT-001` | Existing structured CLI result conventions plus the accepted cross-client capability and compatibility fixtures |

## Safeguards and Prohibited Behavior

- `SG-EVAL-001`: authorization must never rely on a mutable live worktree or a snapshot identity different from the execution root; violation returns `unverified` and denies authoritative authorization.
- `SG-EVAL-002`: HTTP or browser evidence must never authorize a snapshot without proved served-source binding; violation returns `unverified` and denies.
- `SG-POL-001`: advisory success never compensates for required failure, and advisory failure is never silently promoted to blocking.
- `SG-BYP-001`: bypass is never represented as a pass, reused for another snapshot, or accepted without its required reason and reference.
- `SG-SCOPE-001`: regression evidence without a valid delivery contract never claims requested behavior or acceptance criteria were proved.
- `SG-DIST-001`: installing a skill, plugin, runtime, or adapter never configures a repository or activates commit blocking.
- `SG-HOOK-001`: activation never overwrites an existing hook, silently changes shared hook paths, resumes against changed identities, or leaves a partial adapter set active.
- `SG-LIFE-001`: lifecycle operations never silently repair drift, delete shared configuration, delete historical evidence, or remove global assets.
- `SG-CFG-001`: a candidate snapshot never weakens the policy used to authorize its own transition.
- `SG-CFG-002`: upgrade or migration never guesses an ambiguous command or profile presence, targets an inactive profile with scopes or commands, modifies v3 without confirmation, or configures or activates the Gate as a side effect.
- `SG-CMD-001`: evaluation never shell-parses repository command text, accepts an unresolved executable identity, or hides complex behavior outside a declared `repository-script` Grader surface.
- `SG-SECRET-001`: Sensitive values never persist in committed configuration, Evidence, retained output, or Lifecycle events.
- `SG-EVID-001`: evaluation history is never silently replaced, automatically deleted, or pruned without a retained audit record.
- `SG-COORD-001`: different evaluation bindings never share mutable roots or completed pass results, and one subscriber never cancels another subscriber's required execution.
- `SG-SUPPORT-001`: an integration is never labelled supported before its declared surface passes the release baseline; lack of native blocking does not disqualify a conforming preflight adapter.
- `SG-OWNER-001`: the Gate never duplicates `framework-setup` command ownership, replaces `verify-change`, hides the Evidence ladder, or adds framework-specific branches to gate-core behavior.
- `SG-TRUST-001`: local hooks and Evidence are never presented as tamper-proof enforcement or protection from the machine owner.

## Risks, Gaps, and Assumptions

| ID | Type | Description | Impact | Blocks readiness | Resolution |
| --- | --- | --- | --- | --- | --- |
| `RISK-001` | Risk | A machine owner may bypass or remove local enforcement and evidence. | High | No | Accepted for local v1 by the Product Owner; trust limits and observable drift remain explicit. |
| `RISK-002` | Risk | Shared services or developer state may interfere across checks. | High | No | Accepted conditionally; serialization, declared prerequisites and writes, and the mandatory runtime release gate apply. |
| `RISK-003` | Risk | Long required checks or queue contention may encourage unsupported bypass. | Medium | No | Open medium-impact delivery risk owned by the Product Owner; project-confirmed budgets, timing evidence, and explicit bypass policy remain required. |
| `RISK-004` | Risk | Client hook, trust, or plugin changes may invalidate support claims. | High | No | Accepted conditionally; exact adapter compatibility fixtures are a mandatory release gate. |
| `RISK-005` | Risk | Schema v4 or Command migration may change established verification behavior. | High | No | Accepted conditionally; backward compatibility, profile-presence symmetry, and ambiguity-rejecting atomic migration are a mandatory release gate. |
| `RISK-006` | Risk | Redaction may miss a secret in retained evidence. | High | No | Accepted conditionally; secret-canary and redaction evidence are a mandatory release gate, with unsafe capture returning `unverified`. |
| `RISK-007` | Risk | A flaky required check may conflict across attempts and block delivery. | Medium | No | Open medium-impact delivery risk owned by the repository maintainer; attempts remain visible and conflict returns `unverified` until the check is stabilized or reconfigured. |
| `RISK-008` | Risk | A changed Grader surface may weaken the evidence judging the same change. | High | No | Accepted conditionally; integrity identities and dual-policy transition fixtures are a mandatory release gate. |
| `RISK-009` | Risk | Snapshot materialization may not safely reuse dependencies or inputs in every environment. | High | No | Accepted conditionally; runtime portability evidence is a mandatory release gate and unsafe binding returns `unverified`. |
| `RISK-010` | Risk | Retained Evidence may consume excessive local storage. | Medium | No | Mitigated by fixed v1 ceilings and explicit preview-bound pruning. |
| `Q-001` | Resolved decision | Durable SRS location and authority. | Specification authority | No | Resolved by promoting the stable-ID SRS projection to `docs/specifications/change-evaluation-gate-srs.md` while retaining the Wayfinder decision set as authoritative. |
| `Q-002` | Resolved decision | SRS approval and residual-risk authority. | Approval authority | No | Resolved by assigning sole Product Owner accountability to the repository owner or lead maintainer. |
| `Q-003` | Resolved decision | Additional client scope after the three v1 desktop surfaces. | V1 scope | No | Resolved with no additional v1 client; any later client requires a fresh Wayfinder effort and compatibility evidence. |
| `Q-004` | Resolved decision | Evidence required to claim adapter and runtime support. | Support claims | No | Resolved with capability-based support and an exact release manifest of tested versions, environments, fixtures, and outcomes rather than a permanent allowlist. |
| `Q-005` | Resolved decision | Gate release, schema migration, and compatibility boundary. | Release compatibility | No | Resolved with `0.9.0` as the first Gate-capable release, v3 and v4 reads, v4-only Gate configuration, explicit atomic migration, and v3 read support throughout `0.x`. |
| `Q-006` | Resolved decision | Mandatory handoff evidence. | Handoff completeness | No | Resolved with the contract-complete Wayfinder, SRS traceability, interface, acceptance, safeguard, compatibility, lifecycle, ownership, and risk package; physical design remains for delivery tickets. |
| `Q-007` | Resolved decision | Default evaluation budgets and timeouts. | Performance policy | No | Resolved with no universal duration; `framework-setup` requires project-confirmed per-check timeouts and a total evaluation budget. |
| `Q-008` | Resolved decision | Retained-output bounds and pruning policy. | Evidence retention | No | Resolved with 32 KiB inline excerpts, 4 MiB blobs, 32 MiB per evaluation, lower project limits only, and manual preview-bound pruning without automatic deletion. |
| `DEP-001` | Dependency | Gate orchestration depends on the established `framework-setup` and `verify-change` Interfaces. | Architecture ownership | No | Ownership and public seams are confirmed; implementation must deepen rather than duplicate them. |
| `DEP-002` | Dependency | Release support depends on exact Git, Node.js, client, and operating-system fixture evidence. | Release qualification | No | Implementation may start; missing or failed compatibility evidence blocks release rather than specification readiness. |
| `ASM-001` | Assumption | V1 operates as a cooperative local process on a trusted developer machine. | Security boundary | No | Accepted scope boundary with explicit exclusions for hostile-code containment and tamper-proof enforcement. |
| `DEC-001` | Resolved implicit decision | Wayfinder decisions govern if wording conflicts with the SRS projection. | Traceability authority | No | Accepted by the readiness and handoff decision; the SRS must be corrected without changing stable IDs. |

No blocking gap, dependency, assumption, architecture decision, authorization ambiguity, or unaccepted high-impact risk remains.

## Acceptance Criteria

| ID | Criterion | Evidence seam |
| --- | --- | --- |
| `AC-EVAL-001` | Every commit in an activated fixture invokes the Gate; all current required passes allow, and one required failure blocks. | Adapter conformance Interface |
| `AC-EVAL-002` | Contract fixtures validate the versioned request and prove every decision contains the required identities, authorization, diagnostics, coverage, integrity, and evidence reference. | Evaluation process Interface |
| `AC-EVAL-003` | Repeating one identical binding delegates through `verify-change`, preserves descriptor order and configured policy, and executes only check-only Evidence ladder commands. | Evaluation process Interface |
| `AC-EVAL-004` | An unstaged live-worktree change after snapshot capture cannot alter evaluated output or Evidence, and the live file remains unchanged. | Evaluation process Interface |
| `AC-EVAL-005` | Evaluation without a valid delivery contract is `regression-only`; with one, assertions use stable AC IDs and expose coverage gaps. | Evaluation process Interface |
| `AC-EVAL-006` | All attempts are preserved; missing prerequisites, invalid configuration, timeout, crash, malformed output, snapshot mismatch, integrity drift, coordination failure, and conflicting attempts cannot pass and become `unverified`. | Evaluation process Interface |
| `AC-EVAL-007` | Changing a test, verification script, provider, or Gate configuration reports the affected Grader surface and binds all integrity identities. | Evaluation process Interface |
| `AC-EVAL-008` | A Herd-backed HTTP or browser fixture proves served-source binding to the Evaluation snapshot; live-worktree or unprovable routing is `unverified`. | Evaluation process Interface |
| `AC-POL-001` | A pre-existing required failure still blocks, advisory failure does not block, and an older pass cannot authorize a changed snapshot. | Evaluation process Interface |
| `AC-POL-002` | Per-check timeout and total-budget fixtures terminate process trees, skip only eligible advisory work, and return blocking `unverified` when required coverage is incomplete. | Evaluation process Interface |
| `AC-POL-003` | Disabled bypass is rejected; enabled bypass is one-shot, snapshot- and reason-bound, visibly `bypassed`, evidence-backed, marker-emitting, and never rewrites failure. | Evaluation process Interface |
| `AC-POL-004` | Commit evaluation rejects mutating descriptors; explicit `gate fix` may run its separately declared command and requires a new evaluation snapshot. | Lifecycle command Interface |
| `AC-ADAPT-001` | The same decision makes Git block on `deny` while desktop adapters normalize supported triggers and present structured `not-authoritative` preflight feedback. | Adapter conformance Interface |
| `AC-ADAPT-002` | Every supported local desktop surface passes the shared baseline; capability, trust, timeout, and output failures are `unverified`; unsupported contexts cannot claim support; exact versions and outcomes are recorded. | Adapter conformance Interface |
| `AC-PROF-001` | Laravel and one reference non-Laravel provider emit valid descriptors consumed through the same Interface without a stack-name branch in gate-core behavior. | Evaluation process Interface |
| `AC-PROF-002` | A Laravel fixture maps confirmed Pint, Rector dry-run, PHPStan or Larastan, Pest, smoke, build, and browser commands to defined stages and distinct evidence claims. | Evaluation process Interface |
| `AC-PROF-003` | A missing command, unproved capability, or filename-only test guess produces a visible capability gap and no guessed descriptor. | Evaluation process Interface |
| `AC-PROF-004` | Provider fixtures accept only the eight ordered v1 stages, distinguish `not-applicable` from unavailable `unverified`, allow a new capability without a core branch, and require a contract-version change for new stages or outcomes. | Evaluation process Interface |
| `AC-PROF-005` | Laravel setup proposes only proved defaults, conditionally proposes runtime checks, and explicit fix runs Rector before Pint followed by full non-mutating reevaluation. | Lifecycle command Interface |
| `AC-LIFE-001` | Project and global distribution never activate a repository; a fresh clone has no receipt or managed hook before repository-bound activation. | Lifecycle command Interface |
| `AC-LIFE-002` | Successful activation records previewed identities and enables Git last; failure injected at any step restores configured state with no partial receipt or registration. | Lifecycle command Interface |
| `AC-LIFE-003` | Activation preserves surrounding hook content, executes the prior chain and Gate, refuses unsafe shared-hook changes, and requires manual resolution after marker drift. | Lifecycle command Interface |
| `AC-LIFE-004` | Update failure preserves the previous Active release; adapter loss may be `degraded`, authoritative loss is `broken`, and neither result repairs automatically. | Lifecycle command Interface |
| `AC-LIFE-005` | Deactivation removes only unchanged Gate-owned registrations and the receipt; uninstall removes only project assets while preserving shared configuration, global assets, and Evidence. | Lifecycle command Interface |
| `AC-LIFE-006` | Selective installers expose the Gate independently, whole-plugin installation leaves it dormant, and `framework-setup` leaves Gate configuration unselected until confirmed. | Lifecycle command Interface |
| `AC-LIFE-007` | Skill or plugin update exposes a candidate without changing the Active release; only a successful explicit `gate update` advances it. | Lifecycle command Interface |
| `AC-LIFE-008` | Non-interactive activation with missing or mismatched repository or configuration identity performs no mutation; an exact match may continue. | Lifecycle command Interface |
| `AC-LIFE-009` | Activation pauses and resumes across trust only with identical transaction identities and selects native hook manager, confirmed marker block, or owned shim in order without partial activation. | Lifecycle command Interface |
| `AC-LIFE-010` | Cleanup removes only previewed Gate keys while preserving shared configuration; drift remains unrepaired until confirmed repair or Activation. | Lifecycle command Interface |
| `AC-CFG-001` | Schema tests prove absent Gate configuration is not configured, presence is configured only, exactly five policy subcontracts are accepted, and Verification retains command ownership. | Lifecycle command Interface |
| `AC-CFG-002` | Descriptor validation rejects shell syntax and unresolved runners, surfaces declared repository scripts as Grader surfaces, and activation resolves, versions, pins, and previews approved executables. | Lifecycle command Interface |
| `AC-CFG-003` | A candidate weakening required policy cannot authorize itself; only candidate-hash approval after both trusted and candidate policies pass advances trust. | Lifecycle command Interface |
| `AC-CFG-004` | Secret-canary fixtures copy only approved inputs into the isolated root, remove them, and find no raw secret in configuration, decisions, envelopes, blobs, or events. | Lifecycle command Interface |
| `AC-CFG-005` | Upgrade fixtures prove `0.9.0` reads schema v3 and v4; v4 accepts backend-only, frontend-only, full-stack, and tooling-only profiles; inactive profiles have no scopes or commands; only v4 configures the Gate; migration is previewed and atomic; command or profile ambiguity writes nothing until mapped; and migration does not configure or activate. | Lifecycle command Interface |
| `AC-EVID-001` | Repeated evaluations append canonical content-addressed envelopes atomically at the Git-common location; all output ceilings, lower limits, excerpt boundaries, and omitted-byte counts are enforced. | Evaluation process Interface |
| `AC-EVID-002` | No automatic deletion occurs; pruning previews exact blobs and bytes, mismatched confirmation removes nothing, and matched confirmation removes only selected blobs while preserving the audit trail. | Lifecycle command Interface |
| `AC-COORD-001` | Concurrency fixtures prove repository serialization, matching in-flight sharing, role-specific decisions, Git priority over queued preflights, subscriber-local cancellation, audited stale-lock recovery, and `unverified` failure. | Evaluation process Interface |
| `AC-PORT-001` | The runtime portability matrix passes executable, stream, JSON, timeout, process-tree, Git-index, linked-worktree, path, declared-write, immutability, and non-interactive fixtures on every claimed environment. | Adapter conformance Interface |
| `AC-SEC-001` | Independent control-surface drift produces `broken` health and an `unverified` authoritative result while ordinary changed Grader surfaces remain visible without automatic malicious classification. | Lifecycle command Interface and evaluation process Interface |

## Verification Strategy

- The primary public test seam is the versioned `evaluate(request) -> decision` process Interface. Contract tests exercise exact-snapshot isolation, scope, required and advisory policy, bypass, conflicting attempts, evidence identity, runtime binding, integrity drift, budgets, and coordination through observable decisions rather than private methods.
- The lifecycle command Interface is the public seam for install, configure, activate, update, status, deactivate, uninstall, cleanup, migration, evidence preview, and pruning behavior. Tests assert previews, consent boundaries, atomic writes, rollback, prior-release retention, hook preservation, receipts, health classification, conservative removal, and matched pruning confirmation.
- The adapter conformance Interface is the public seam for authoritative Git and supported desktop preflight integrations. One shared suite proves capability negotiation, event normalization, snapshot identity, Enforcement role, result presentation, Git authority, and release-manifest fixtures without testing client-native payload internals in the core suite.
- Existing `framework-setup` tests are prior art for discovery, schema migration, idempotency, protected instruction preservation, safe write scopes, and capability gaps. They remain collaborators and are not duplicated by Gate tests.
- Existing `verify-change` tests are prior art for ordered plans, capability reporting, missing evidence, schema parsing, read-only execution, and machine-readable results. Gate tests consume this public behavior and do not create a second verifier suite.
- Acceptance evidence must cover all `AC-EVAL-001..008`, `AC-POL-001..004`, `AC-ADAPT-001..002`, `AC-PROF-001..005`, `AC-LIFE-001..010`, `AC-CFG-001..005`, `AC-EVID-001..002`, `AC-COORD-001`, `AC-PORT-001`, and `AC-SEC-001` at one of the three confirmed public seams.
- Release qualification must execute the authoritative Git fixture, every supported adapter fixture, and the runtime portability baseline on each exact version combination claimed in the compatibility manifest.
- Negative-path tests must prove that missing evidence, ambiguous migration, unproved runtime binding, integrity drift, stale or unsafe coordination, partial activation, and required timeout or budget exhaustion cannot yield `passed` or authoritative `allow`.
- Tests must verify that evaluation never mutates the evaluated source, while the separate fix operation mutates only after explicit invocation and always triggers a fresh full evaluation.

## Out of Scope

- CI, server-side enforcement, server attestation, or remote policy authority.
- Signing, encryption, privileged daemons, hidden tests, tamper-proof storage, or prevention of machine-owner bypass.
- Preventing raw `--no-verify`, hook removal, or Git configuration changes.
- Docker, virtual machines, separate databases, or hardened operating-system or container sandboxes.
- Containment of hostile repository code or protection of existing local services from that code.
- Model, human, transcript, or tool-sequence grading; pass@k; weighted required scores; or hidden graders.
- Treating a broad test suite as proof of task-specific acceptance.
- Automatic Gate configuration, activation, update, repair, evidence deletion, or background retention.
- Additional supported clients beyond authoritative local Git and the three named local desktop preflight targets.
- Global prevention of bypass by repository or machine owners.
- Physical class, file, schema-storage, or command-serialization design beyond the externally observable contracts recorded here.

## Readiness

- [x] Every in-scope requirement maps to acceptance evidence.
- [x] Public test seams are agreed.
- [x] Safeguards and prohibited behavior are explicit.
- [x] Risks and resolved decisions have explicit dispositions.
- [x] Blocking gaps and assumptions are resolved.
- [x] Out-of-scope behavior is explicit.

The approved SRS v0.2.2, completed Wayfinder decision set, all 39 acceptance criteria, all 17 safeguards, ten risk dispositions, eight resolved questions, and three confirmed public test seams support these checks. The contract is ready for `to-tickets`; it is not an implementation issue and is not `ready-for-agent`. The repository's `.agent-framework.yaml` now provides the configured local Markdown lifecycle workspace without configuring or activating the Gate.

## Comments
