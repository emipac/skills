# Change Evaluation Gate — Software Requirements Specification

## 1. Document Control

| Field | Value |
| --- | --- |
| Project | Change Evaluation Gate |
| Version | 0.1.1 |
| Status | Draft |
| Product owner | Unassigned; see Q-002 |
| Last updated | 2026-08-04 |
| Sources | [Wayfinder map](issues/change-evaluation-gate.md), its resolved decision tickets, research records, and accepted interface prototype |

### Revision history

| Version | Date | Status | Change | Decision source |
| --- | --- | --- | --- | --- |
| 0.1.0 | 2026-08-04 | Draft | Initial traceable SRS baseline | [Change Evaluation Gate Wayfinder map](issues/change-evaluation-gate.md) |
| 0.1.1 | 2026-08-04 | Draft | Reconciled portability, snapshot routing, lifecycle, and traceability findings | [Corrected Wayfinder decision sources](issues/change-evaluation-gate.md) |

## 2. Purpose and Scope

### Purpose

This SRS records the durable product contract for an optional, system-agnostic Change Evaluation Gate. The gate evaluates proposed changes from humans and agents identically, provides early feedback through supported desktop adapters, and uses Git as the portable authoritative local commit seam. This baseline converts resolved Wayfinder decisions into stable requirements while keeping unresolved readiness and release decisions visible.

### In scope

- Opt-in installation, repository configuration, clone-local activation, update, health, deactivation, and uninstall behavior.
- Authoritative evaluation of every commit in an activated repository through local Git `pre-commit`.
- Preflight evaluation through Claude Code Desktop, Codex Desktop, and Cursor IDE local-project adapters.
- One client-independent evaluation interface and thin native adapters.
- Stack-neutral Verification profile providers, with Laravel as the first defined profile.
- Exact-snapshot execution, required and advisory policy, explicit bypass, evidence, integrity, coordination, and audit behavior.
- Capability-based client compatibility and gate-runtime portability baselines.

### Success measures

- Every governed commit attempt receives a decision bound to the exact proposed snapshot and current trusted policy.
- No supported preflight adapter can be mistaken for authoritative commit enforcement.
- Every applicable required check either passes with current evidence or prevents authorization.
- Installation and configuration cannot activate hooks or start blocking commits without explicit repository-bound consent.
- A release cannot claim a supported integration until its compatibility baseline passes.

## 3. Product Context

### Current state

`framework-setup` owns repository discovery and the shared framework configuration. `verify-change` owns the Verification profile and ordered Evidence ladder. Cursor, Codex, Claude Code, and Git expose different lifecycle, trust, and blocking contracts; no portable agent-hook runtime activates the same enforcement behavior across them. Agent Skill or plugin distribution alone does not install a portable authoritative hook.

### Target state and boundaries

The Change Evaluation Gate adds an opt-in lifecycle control around the existing verification seam. A versioned process interface accepts a normalized evaluation request, resolves repository-owned checks and policy, materializes the proposed snapshot, produces evidence, and returns one structured decision. Git is authoritative. Desktop clients provide preflight feedback only. The gate evaluates the resulting code state and declared acceptance evidence, not the author, agent transcript, or tool sequence that produced it.

The v1 trust boundary is the developer's existing machine and local services. Execution isolation protects source-state identity but is not virtualization, hostile-code containment, remote attestation, or protection from the machine owner. Stronger CI or server-side enforcement may be added later but is not implied by local gate success.

### Assumptions and dependencies

- The repository uses Git and the local actor can run the configured project commands.
- Project maintainers review and confirm Verification profile commands, Gate policy, runtime inputs, and activation changes.
- Required checks are intended to be deterministic; flaky checks are treated as evidence defects rather than averaged scores.
- The host runtime, local databases, browser services, Laravel Herd, Composer, Node dependencies, and other declared services remain project-owned dependencies.
- Exact supported product versions and the release evidence matrix remain unresolved under Q-004.
- The canonical long-term SRS path and approval ownership remain unresolved under Q-001 and Q-002.

## 4. Domain Concepts and Actors

Canonical terminology is owned by the [AI Skills Framework glossary](../../CONTEXT.md).

### Domain relationships and invariants

| Concept | Responsibility | Relationships and invariants | Glossary source |
| --- | --- | --- | --- |
| Change Evaluation Gate | Evaluates a proposed change before a governed transition | Uses one Verification profile and Evidence ladder; evaluates human and agent changes identically | [Glossary](../../CONTEXT.md) |
| Evaluation snapshot | Immutable proposed code state | All authoritative evidence and authorization bind to one exact snapshot identity | [Glossary](../../CONTEXT.md) |
| Evaluation scope | States what the decision proves | Is `change-acceptance-and-regression` only with a valid repository-owned delivery contract; otherwise `regression-only` | [Glossary](../../CONTEXT.md) |
| Gate policy | Defines required and advisory checks, budget, bypass, execution, and evidence rules | Excludes commands and clone-local activation state | [Glossary](../../CONTEXT.md) |
| Check assertion | Atomic evidence claim from a configured check | A check emits at least one assertion; assertion counts never provide partial authorization | [Glossary](../../CONTEXT.md) |
| Evidence envelope | Immutable record of one evaluation | Binds task, snapshot, configuration, environment, checks, attempts, coverage, integrity, authorization, and redaction metadata | [Glossary](../../CONTEXT.md) |
| Activation transaction | Moves one configured clone to activated | Enables authoritative Git last and rolls back every gate-owned change on failure | [Glossary](../../CONTEXT.md) |
| Managed hook registration | Gate-owned hook block or shim | Preserves the existing hook chain and can be removed only when its owned content is unchanged | [Glossary](../../CONTEXT.md) |
| Gate health | Reconciled operational condition | Is `healthy`, `degraded`, or `broken`; health checks never repair state | [Glossary](../../CONTEXT.md) |
| Support tier | Product compatibility promise for an integration surface | Is independent of the integration's Enforcement role | [Glossary](../../CONTEXT.md) |

### Actors and authorization boundaries

| Actor | Goal | Authority and boundary |
| --- | --- | --- |
| Change author | Receive feedback and commit an acceptable change | May be human or agent; authorship does not change policy or evidence requirements |
| Repository maintainer | Configure verification and gate policy | Reviews repository-owned configuration and policy changes; cannot silently activate another clone |
| Activation operator | Activate, update, repair, deactivate, or remove the gate in one clone | Must provide repository-bound consent and satisfy client-controlled trust prompts |
| Git adapter | Govern local commit creation | Authoritative; maps `deny` to a blocking native result |
| Desktop adapter | Provide early work-complete feedback | Preflight only; never authorizes a commit |
| Gate module | Grade a proposed snapshot and persist evidence | Owns evaluation, policy, coverage, integrity, and evidence behind one process interface |
| Verification profile provider | Resolve project facts into normalized checks | Does not execute checks or decide authorization |
| Machine owner | Controls the host, hooks, files, and local evidence | Outside the v1 adversarial trust model; can bypass or delete local controls |

### Information lifecycle

| Information or record | Created by | Lifecycle and retention | Access and audit boundary | Requirement IDs |
| --- | --- | --- | --- | --- |
| Gate configuration section | Repository maintainer through `framework-setup` | Versioned with the repository; absence means not configured | Reviewed repository configuration; changes require trusted transition handling | FR-CFG-001, FR-CFG-005 |
| Activation receipt | Successful Activation transaction | Clone-local; updated atomically; removed by deactivation after integrity checks | Stored under resolved Git metadata; not a committed configuration substitute | FR-LIFE-003, FR-LIFE-006 |
| Evidence envelope | Gate module | Append-only; never automatically deleted | Fixed runtime-owned location under Git common metadata; local and not tamper-proof | FR-EVID-001, FR-EVID-002 |
| Evidence output blob | Gate module | Content-addressed; removable only by explicit previewed pruning that leaves a tombstone | Redacted before persistence; pruning is audited | FR-EVID-003, FR-EVID-004, NFR-SEC-003 |
| Lifecycle event | Gate module | Immutable local record; created for every governed lifecycle and integrity action | Best-effort actor identity is explicitly unauthenticated | FR-EVID-005, NFR-AUD-001 |
| Sensitive runtime input | Activation operator and project runtime | Temporarily copied into an isolated materialization and removed afterward | Name and source may be recorded; value must not enter configuration or evidence | FR-CFG-006, NFR-SEC-003 |
| Bypass record and marker | Authorized change author | One-shot and snapshot-bound; evidence is retained and the accepted marker is commit-visible | Records reason, actor, policy, snapshot, and failed or unverified checks | FR-POL-006, SG-BYP-001 |

## 5. Architecture Constraints and Decisions

| Constraint or ADR | Consequence for the system |
| --- | --- |
| [Portable Git seam decision](issues/research-cross-client-hook-and-install-capabilities.md) | Local Git `pre-commit` is authoritative; native client hooks are capability-aware preflight adapters |
| [Shared gate interface](issues/design-shared-gate-interface-and-adapters.md) | One versioned `evaluate(request) -> decision` process interface contains evaluation complexity; adapters remain thin |
| Existing `framework-setup` ownership | Gate configuration extends the shared configuration and does not create a second command-discovery contract |
| Existing `verify-change` ownership | The gate reuses the Verification profile and Evidence ladder rather than creating a second verifier |
| [Generic profile provider](issues/define-laravel-profile-and-generic-extension-contract.md) | The gate never branches on framework or tool names |
| [Configuration and security contract](issues/define-configuration-evidence-and-security-contract.md) | Schema version 4 uses shell-free Command descriptors, trusted policy transitions, exact-snapshot evidence, and explicit local trust limits |
| Host-runtime execution | V1 reuses existing local runtimes and services; HTTP and browser evidence must prove that the served application matches the Evaluation snapshot or return `unverified`; the gate does not provision containers, virtual machines, databases, or hostile-code sandboxes |
| Local-only authority | Local enforcement and evidence cannot claim resistance to `--no-verify`, hook removal, Git reconfiguration, evidence deletion, or a malicious machine owner |

## 6. Functional Requirements

| ID | Area | Requirement | Priority | Source | Status |
| --- | --- | --- | --- | --- | --- |
| FR-EVAL-001 | Evaluation | An activated repository shall invoke the authoritative gate for every local commit through the managed Git `pre-commit` integration. | Must | [Portable seam](issues/research-cross-client-hook-and-install-capabilities.md) | Draft |
| FR-EVAL-002 | Evaluation | The gate shall expose one versioned `evaluate` operation whose request identifies repository root, snapshot target, optional delivery-contract reference, Enforcement role, normalized trigger, adapter capabilities, and session identity. | Must | [Shared interface](issues/design-shared-gate-interface-and-adapters.md) | Draft |
| FR-EVAL-003 | Evaluation | The gate shall resolve the trusted Verification profile, Gate policy, provider descriptors, prerequisites, and deterministic applicability for the requested snapshot. | Must | [Profile contract](issues/define-laravel-profile-and-generic-extension-contract.md) | Draft |
| FR-EVAL-004 | Evaluation | The gate shall materialize the exact proposed snapshot in a separate execution root before running an applicable check. | Must | [Shared interface](issues/design-shared-gate-interface-and-adapters.md) | Draft |
| FR-EVAL-005 | Evaluation | `gate evaluate` shall execute applicable check-only commands in the configured Evidence ladder order without modifying evaluated source files. | Must | [Gate policy](issues/decide-gate-policy-and-bypass-contract.md) | Draft |
| FR-EVAL-006 | Evaluation | The gate shall return a structured decision containing evaluation and protocol identity, outcome, authorization, Evaluation scope, snapshot and environment identity, check results, attempts, assertions, coverage, integrity, advisories, bypass data, and evidence identity. | Must | [Shared interface](issues/design-shared-gate-interface-and-adapters.md) | Draft |
| FR-EVAL-007 | Evaluation | The gate shall report `regression-only` when no valid repository-owned delivery contract is available and shall not claim task-specific acceptance coverage. | Must | [Evaluation research](research/anthropic-agent-evals-gate-lessons.md) | Draft |
| FR-EVAL-008 | Evaluation | The gate shall preserve every Check attempt with a reason classification and shall produce `unverified` when equivalent attempts conflict. | Must | [Shared interface](issues/design-shared-gate-interface-and-adapters.md) | Draft |
| FR-EVAL-009 | Evaluation | The gate shall identify changed Grader surfaces and bind runner, provider, configuration, environment, and snapshot identities into decision integrity evidence. | Must | [Evaluation research](research/anthropic-agent-evals-gate-lessons.md) | Draft |
| FR-EVAL-010 | Evaluation | An HTTP or browser check shall prove that the existing local runtime serves the Evaluation snapshot from its materialized source; inability to prove that binding shall produce `unverified`. | Must | [Configuration and security contract](issues/define-configuration-evidence-and-security-contract.md) | Draft |
| FR-POL-001 | Policy | The authoritative gate shall deny authorization when any applicable required check is `failed` or `unverified`. | Must | [Gate policy](issues/decide-gate-policy-and-bypass-contract.md) | Draft |
| FR-POL-002 | Policy | An advisory check shall record warnings and evidence without denying authorization. | Must | [Gate policy](issues/decide-gate-policy-and-bypass-contract.md) | Draft |
| FR-POL-003 | Policy | Final authorization shall require a current pass for every applicable required check bound to the exact snapshot, command, configuration, and relevant tool environment. | Must | [Gate policy](issues/decide-gate-policy-and-bypass-contract.md) | Draft |
| FR-POL-004 | Policy | The gate shall not exempt a pre-existing required failure through baseline comparison or a persistent pass-result cache. | Must | [Gate policy](issues/decide-gate-policy-and-bypass-contract.md) | Draft |
| FR-POL-005 | Policy | A per-check timeout or exhausted total budget before required coverage completes shall terminate the affected process tree and produce `unverified`. | Must | [Gate policy](issues/decide-gate-policy-and-bypass-contract.md) | Draft |
| FR-POL-006 | Policy | When bypass is enabled, the gate shall support an explicit one-shot bypass bound to the exact snapshot and requiring a reason plus any policy-required reference. | Must | [Gate policy](issues/decide-gate-policy-and-bypass-contract.md) | Draft |
| FR-POL-007 | Policy | A supported bypass shall return `bypassed`, retain failed and unverified checks, persist machine-readable evidence, and emit the configured commit-visible marker without rewriting any check as passed. | Must | [Gate policy](issues/decide-gate-policy-and-bypass-contract.md) | Draft |
| FR-POL-008 | Policy | The repository Gate policy shall be able to disable the supported bypass. | Must | [Gate policy](issues/decide-gate-policy-and-bypass-contract.md) | Draft |
| FR-POL-009 | Policy | Mutating formatter and rewrite commands shall be available only through an explicit `gate fix` operation outside commit evaluation. | Must | [Profile contract](issues/define-laravel-profile-and-generic-extension-contract.md) | Draft |
| FR-ADAPT-001 | Adapters | The Git adapter shall translate a structured `deny` authorization into a native blocking result while preserving the returned decision for the user. | Must | [Shared interface](issues/design-shared-gate-interface-and-adapters.md) | Draft |
| FR-ADAPT-002 | Adapters | Claude Code Desktop local Code tab, Codex Desktop with a local project, and Cursor IDE local Agent shall be supported v1 preflight integration targets. | Must | [Support tiers](issues/define-client-support-tiers-and-baseline.md) | Draft |
| FR-ADAPT-003 | Adapters | A desktop adapter shall normalize a deterministic native event to `work-complete`, invoke the shared gate non-interactively, and present the structured result without claiming commit authority. | Must | [Support tiers](issues/define-client-support-tiers-and-baseline.md) | Draft |
| FR-ADAPT-004 | Adapters | An adapter shall declare its event, blocking, trust, repository, session, filesystem, Git, and invocation capabilities instead of assuming another client's contract. | Must | [Support tiers](issues/define-client-support-tiers-and-baseline.md) | Draft |
| FR-ADAPT-005 | Adapters | Trust failure, invocation failure, timeout, capability mismatch, or malformed output shall be presented as `unverified`. | Must | [Support tiers](issues/define-client-support-tiers-and-baseline.md) | Draft |
| FR-ADAPT-006 | Adapters | CLI, SSH, remote, cloud, and background-agent variants shall be classified as experimental until separately proven, while chat-only or hosted surfaces without repository execution capabilities shall be unsupported. | Must | [Support tiers](issues/define-client-support-tiers-and-baseline.md) | Draft |
| FR-PROF-001 | Profiles | A stack provider shall emit versioned normalized Check descriptors and the gate shall consume them without framework-specific branching. | Must | [Profile contract](issues/define-laravel-profile-and-generic-extension-contract.md) | Draft |
| FR-PROF-002 | Profiles | Each Check descriptor shall define stable identity, stage, capability, scope, applicability, prerequisites, policy, non-mutating evaluation command, optional fix command, timeout, declared writes, evidence claims, and stable order. | Must | [Profile contract](issues/define-laravel-profile-and-generic-extension-contract.md) | Draft |
| FR-PROF-003 | Profiles | The Laravel provider shall map confirmed Pint, Rector dry-run, PHPStan or Larastan, Pest, smoke, build, and browser capabilities onto the existing Evidence ladder without treating tool names as gate logic. | Must | [Profile contract](issues/define-laravel-profile-and-generic-extension-contract.md) | Draft |
| FR-PROF-004 | Profiles | Missing or unproved commands shall remain visible capability gaps and shall not be replaced by guessed defaults or filename-only test selection. | Must | [Profile contract](issues/define-laravel-profile-and-generic-extension-contract.md) | Draft |
| FR-PROF-005 | Profiles | Every applicable check shall report at least one Check assertion, and an acceptance-linked assertion shall use its stable acceptance ID. | Must | [Evaluation research](research/anthropic-agent-evals-gate-lessons.md) | Draft |
| FR-LIFE-001 | Lifecycle | The gate shall represent adoption as the explicit states `installed`, `configured`, and `activated`. | Must | [Activation model](issues/decide-installation-and-activation-model.md) | Draft |
| FR-LIFE-002 | Lifecycle | Skill installers and plugin distributions shall only make gate assets available and shall not configure a repository, register hooks, establish trust, or activate enforcement. | Must | [Activation model](issues/decide-installation-and-activation-model.md) | Draft |
| FR-LIFE-003 | Lifecycle | Project-local installation shall be the default, global installation shall require explicit selection, and activation shall always be clone-local and repository-specific. | Must | [Activation model](issues/decide-installation-and-activation-model.md) | Draft |
| FR-LIFE-004 | Lifecycle | `gate activate` shall preview exact changes and commands, obtain repository-bound consent, establish client-controlled trust, validate the existing hook chain, self-test selected adapters and runtime, and enable authoritative Git last. | Must | [Activation model](issues/decide-installation-and-activation-model.md) | Draft |
| FR-LIFE-005 | Lifecycle | A failed Activation transaction shall roll back every gate-owned change and leave the clone configured rather than partially activated. | Must | [Activation model](issues/decide-installation-and-activation-model.md) | Draft |
| FR-LIFE-006 | Lifecycle | Successful activation shall create a clone-local Activation receipt that pins configuration identity, active runtime and adapter versions, hook locations, trust state, runtime input names, and self-test results. | Must | [Activation model](issues/decide-installation-and-activation-model.md) | Draft |
| FR-LIFE-007 | Lifecycle | Managed hook registration shall preserve the existing hook chain and shall not overwrite hooks or automatically change a shared or global `core.hooksPath`. | Must | [Activation model](issues/decide-installation-and-activation-model.md) | Draft |
| FR-LIFE-008 | Lifecycle | `gate update` shall preview migrations, validate compatibility, rerun activation self-tests, and switch the Active gate release atomically while retaining the previous release on failure. | Must | [Activation model](issues/decide-installation-and-activation-model.md) | Draft |
| FR-LIFE-009 | Lifecycle | `gate status` shall reconcile desired and actual state as `healthy`, `degraded`, or `broken` without repairing drift automatically. | Must | [Activation model](issues/decide-installation-and-activation-model.md) | Draft |
| FR-LIFE-010 | Lifecycle | `gate deactivate` shall remove only unchanged gate-owned registrations and the Activation receipt while preserving configuration and evidence. | Must | [Activation model](issues/decide-installation-and-activation-model.md) | Draft |
| FR-LIFE-011 | Lifecycle | `gate uninstall` shall require deactivation and remove only project-installed assets without removing global assets, shared framework configuration, or historical evidence. | Must | [Activation model](issues/decide-installation-and-activation-model.md) | Draft |
| FR-LIFE-012 | Lifecycle | The Gate module shall be independently selectable through installers; when a client installs only a whole plugin, bundled Gate assets shall remain dormant. | Must | [Activation model](issues/decide-installation-and-activation-model.md) | Draft |
| FR-LIFE-013 | Lifecycle | `framework-setup` shall present Gate configuration as an initially unselected option and shall not infer consent from installed assets. | Must | [Activation model](issues/decide-installation-and-activation-model.md) | Draft |
| FR-LIFE-014 | Lifecycle | An ordinary skill or plugin update shall only make a candidate Gate release available and shall not replace the Active gate release. | Must | [Activation model](issues/decide-installation-and-activation-model.md) | Draft |
| FR-LIFE-015 | Lifecycle | Non-interactive activation shall require the expected repository and configuration identities and shall reject a mismatch before changing clone-local state. | Must | [Activation model](issues/decide-installation-and-activation-model.md) | Draft |
| FR-CFG-001 | Configuration | Framework schema version 4 shall allow an optional top-level `evaluation_gate` section whose absence means not configured and whose presence means configured but not activated. | Must | [Configuration contract](issues/define-configuration-evidence-and-security-contract.md) | Draft |
| FR-CFG-002 | Configuration | The Gate configuration section shall contain only required and advisory check identities, total budget, bypass policy, execution policy, and evidence policy while the Verification profile remains the sole source of command definitions. | Must | [Configuration contract](issues/define-configuration-evidence-and-security-contract.md) | Draft |
| FR-CFG-003 | Configuration | Schema version 4 shall represent each command as an OS-independent Command descriptor with a logical runner, argument array, repository-relative working directory, timeout, allowed environment names, evidence category, and source scope. | Must | [Configuration contract](issues/define-configuration-evidence-and-security-contract.md) | Draft |
| FR-CFG-004 | Configuration | Activation shall resolve each logical runner to a platform executable, record its identity and version, and preview the equivalent human-readable command. | Must | [Configuration contract](issues/define-configuration-evidence-and-security-contract.md) | Draft |
| FR-CFG-005 | Configuration | A candidate policy-surface change shall be evaluated against the prior Trusted gate configuration, validated as a candidate, explicitly approved by candidate hash, and satisfy both policies where they differ before becoming trusted. | Must | [Configuration contract](issues/define-configuration-evidence-and-security-contract.md) | Draft |
| FR-CFG-006 | Configuration | Activation shall confirm approved Sensitive runtime inputs, temporarily copy approved environment files, record only their names and sources, and remove the copies with the evaluation materialization. | Must | [Configuration contract](issues/define-configuration-evidence-and-security-contract.md) | Draft |
| FR-EVID-001 | Evidence | Every evaluation shall produce one immutable, versioned, canonical, content-addressed Evidence envelope containing the decision's task, identities, checks, attempts, assertions, reason codes, coverage, integrity, authorization, bypass, and redaction metadata. | Must | [Evidence contract](issues/define-configuration-evidence-and-security-contract.md) | Draft |
| FR-EVID-002 | Evidence | Evidence envelopes shall be appended at a fixed runtime-owned path under the resolved Git common directory using atomic writes and restrictive permissions where supported. | Must | [Evidence contract](issues/define-configuration-evidence-and-security-contract.md) | Draft |
| FR-EVID-003 | Evidence | The gate shall retain bounded redacted excerpts in the envelope and may retain larger redacted output as content-addressed blobs. | Must | [Evidence contract](issues/define-configuration-evidence-and-security-contract.md) | Draft |
| FR-EVID-004 | Evidence | V1 shall never delete evidence automatically; explicit previewed pruning shall preserve bypass and pruning events and leave a tombstone for each removed referenced blob. | Must | [Evidence contract](issues/define-configuration-evidence-and-security-contract.md) | Draft |
| FR-EVID-005 | Evidence | Configuration approval, activation, update, repair, removal, trust, evaluation, bypass, pruning, stale-lock recovery, and detected drift shall each create an immutable Lifecycle event. | Must | [Evidence contract](issues/define-configuration-evidence-and-security-contract.md) | Draft |
| FR-COORD-001 | Coordination | Gate command execution shall be serialized per Git common directory across clients and linked worktrees. | Must | [Evidence contract](issues/define-configuration-evidence-and-security-contract.md) | Draft |
| FR-COORD-002 | Coordination | Exactly matching in-flight snapshot, trusted configuration, plan, and environment identities may share Check execution while each subscriber receives a role-appropriate decision. | Must | [Evidence contract](issues/define-configuration-evidence-and-security-contract.md) | Draft |
| FR-COORD-003 | Coordination | Different evaluations shall queue, except that authoritative Git may advance ahead of queued but not running preflights. | Must | [Evidence contract](issues/define-configuration-evidence-and-security-contract.md) | Draft |
| FR-COORD-004 | Coordination | Evaluation cancellation shall be subscriber-specific and shall not cancel shared execution required by another active subscriber. | Must | [Evidence contract](issues/define-configuration-evidence-and-security-contract.md) | Draft |
| FR-COORD-005 | Coordination | Coordination locks shall record process, host, start, and heartbeat evidence; stale-lock recovery shall be explicit and audited; coordination failure shall produce `unverified`. | Must | [Evidence contract](issues/define-configuration-evidence-and-security-contract.md) | Draft |

## 7. Non-functional Requirements

| ID | Quality area | Requirement | Measure | Scope | Status |
| --- | --- | --- | --- | --- | --- |
| NFR-REL-001 | Reproducibility | An identical evaluation binding shall resolve the same ordered checks and authorization inputs. | Conformance fixture compares canonical plans and identity hashes across repeated runs | Gate core and providers | Draft |
| NFR-REL-002 | Atomicity | Lifecycle state and evidence writes shall not expose partial successful state. | Failure-injection tests prove rollback or complete atomic record publication | Activation, update, evidence, and receipts | Draft |
| NFR-REL-003 | Failure semantics | Missing prerequisites, invalid configuration, timeouts, process crashes, malformed output, snapshot mismatch, integrity drift, and coordination failure shall normalize to `unverified`. | Negative conformance fixtures assert stable reason family and authorization | Evaluation and adapters | Draft |
| NFR-PORT-001 | Runtime portability | The runtime shall launch executables non-interactively with explicit roots, arguments, standard streams, exit status, structured JSON, timeout, process-tree termination, Git access, and no dependency on an interactive shell. | Runtime portability suite passes on every release-supported environment | Shared gate runtime | Draft |
| NFR-PORT-002 | Filesystem portability | The runtime shall handle repository, worktree, Git metadata, temporary, and evidence paths without operating-system-labelled product logic. | Cross-environment fixtures cover spaces, linked worktrees, path separators, and executable resolution | Runtime and activation | Draft |
| NFR-COMP-001 | Client compatibility | Each supported desktop adapter shall pass the shared client baseline for deterministic event delivery, non-interactive invocation, repository and session identity, filesystem and Git access, structured result visibility, trust failures, parallel isolation, and declared native blocking behavior. | Release-blocking adapter conformance suite passes for every supported surface | Claude Code Desktop, Codex Desktop, Cursor IDE | Draft |
| NFR-COMP-002 | Git compatibility | Authoritative Git integration shall preserve a valid existing local hook chain and prove that both the chain and gate execute before activation completes. | Activation conformance fixtures cover no hook, existing hook, managed hook, drift, and shared hooks path | Git adapter and activation | Draft |
| NFR-SEC-001 | Source integrity | `gate evaluate` shall keep evaluated source immutable and detect writes inside the materialized snapshot outside declared cache, temporary, report, screenshot, or evidence locations without claiming general host-filesystem containment. | Snapshot hash remains unchanged and materialized-root undeclared-write fixtures produce `unverified` | Check execution | Draft |
| NFR-SEC-002 | Command safety | Command descriptors shall not permit shell parsing, operators, pipes, redirection, substitutions, or inline environment assignments. | Schema and runner reject every prohibited construction | Configuration and runner | Draft |
| NFR-SEC-003 | Secret handling | Sensitive runtime values shall never be written to repository configuration or Evidence envelopes and shall be redacted from captured output. | Secret-canary fixtures find no raw value in configuration, envelopes, blobs, or events | Activation, execution, and evidence | Draft |
| NFR-SEC-004 | Integrity detection | Unexpected drift in the runtime, adapters, managed hooks, receipt, trusted configuration, Command descriptors, or providers shall make Gate health `broken` and authoritative evaluation `unverified`. | Integrity fixtures mutate each Gate control surface independently | Status and authoritative evaluation | Draft |
| NFR-AUD-001 | Auditability | Lifecycle events shall record UTC time, explicitly unauthenticated best-effort actor, client and gate identity, repository identity, relevant before and after hashes, outcome, reason, and redaction metadata. | Event schema audit passes for every event-producing operation | Local audit trail | Draft |
| NFR-AUD-002 | Evidence honesty | User-facing output shall distinguish `passed`, `failed`, `unverified`, and `bypassed`, and shall distinguish transport success from authorization. | Contract tests assert outcome and authorization independently across all result scenarios | Core and adapters | Draft |
| NFR-PERF-001 | Bounded execution | Every check shall have a configured timeout and every evaluation shall have a configured total budget. | Plan validation rejects missing required limits and runtime enforces both levels | Check execution | Draft |
| NFR-OPER-001 | Diagnosability | A decision shall expose stable check identities, attempts, reason codes, assertions, coverage gaps, Grader surface changes, and evidence identity sufficient to diagnose a denial without reading client-native logs. | Scenario review confirms each negative fixture names the failed claim and evidence location | Decision and adapter output | Draft |
| NFR-MAINT-001 | Extensibility | A new stack provider using an existing descriptor contract and Evidence ladder stage shall not require a gate-core branch. | Reference non-Laravel provider passes the provider contract suite without gate-core modification | Provider seam | Draft |

## 8. Safeguards

| ID | Protects | Constraint | Violation response | Rationale source |
| --- | --- | --- | --- | --- |
| SG-EVAL-001 | FR-EVAL-004, FR-POL-003, NFR-SEC-001 | Authorization must never rely on checks executed against a mutable live worktree or a snapshot identity that differs from the execution root. | Return `unverified` and deny authoritative authorization. | [Evaluation research](research/anthropic-agent-evals-gate-lessons.md) |
| SG-EVAL-002 | FR-EVAL-004, FR-EVAL-010 | HTTP or browser evidence must never authorize a snapshot when the served application cannot be proved to originate from that snapshot's materialized source. | Return `unverified` and deny authoritative authorization. | [Configuration and security contract](issues/define-configuration-evidence-and-security-contract.md) |
| SG-POL-001 | FR-POL-001, FR-POL-002, NFR-AUD-002 | Advisory success must never compensate for a required failure, and advisory failure must never be silently promoted to blocking. | Preserve per-check policy and recompute authorization conjunctively over required checks. | [Gate policy](issues/decide-gate-policy-and-bypass-contract.md) |
| SG-BYP-001 | FR-POL-006, FR-POL-007, FR-POL-008 | A bypass must never be represented as a pass, reused for another snapshot, or accepted without its required reason and reference. | Reject invalid reuse; otherwise record `bypassed` with evidence and marker. | [Gate policy](issues/decide-gate-policy-and-bypass-contract.md) |
| SG-SCOPE-001 | FR-EVAL-007, FR-PROF-005, NFR-AUD-002 | Regression evidence without a valid delivery contract must never claim requested behavior or acceptance criteria were proved. | Set Evaluation scope to `regression-only` and report coverage limitations. | [Evaluation research](research/anthropic-agent-evals-gate-lessons.md) |
| SG-DIST-001 | FR-LIFE-001, FR-LIFE-002, FR-LIFE-003 | Installing a skill, plugin, runtime, or adapter must never configure a repository or activate commit blocking. | Leave the repository installed or configured and require an explicit Activation transaction. | [Activation model](issues/decide-installation-and-activation-model.md) |
| SG-HOOK-001 | FR-LIFE-004, FR-LIFE-005, FR-LIFE-007, NFR-COMP-002 | Activation must never overwrite an existing hook, silently alter shared or global hook paths, or leave a partial adapter set active. | Roll back gate-owned changes and remain configured; require manual resolution for drift. | [Activation model](issues/decide-installation-and-activation-model.md) |
| SG-LIFE-001 | FR-LIFE-008, FR-LIFE-009, FR-LIFE-010, FR-LIFE-011, NFR-REL-002 | Update, status, deactivation, and uninstall must never silently repair drift, delete shared configuration, delete historical evidence, or remove global assets. | Abort the destructive step, preserve prior state, and require an explicit previewed recovery action. | [Activation model](issues/decide-installation-and-activation-model.md) |
| SG-CFG-001 | FR-CFG-001, FR-CFG-002, FR-CFG-005, NFR-SEC-004 | A candidate snapshot must never weaken the policy used to authorize its own transition. | Evaluate under the trusted policy, validate the candidate separately, and require hash-bound approval satisfying both. | [Configuration contract](issues/define-configuration-evidence-and-security-contract.md) |
| SG-CMD-001 | FR-CFG-003, FR-CFG-004, FR-PROF-002, NFR-SEC-002 | Evaluation must never invoke repository command text through shell parsing or accept an unresolved executable identity. | Reject configuration or return `unverified` before command execution. | [Configuration contract](issues/define-configuration-evidence-and-security-contract.md) |
| SG-SECRET-001 | FR-CFG-006, FR-EVID-003, NFR-SEC-003 | Sensitive values must never persist in committed configuration, evidence, retained output, or lifecycle events. | Redact output, reject unsafe evidence, remove temporary copies, and return `unverified` if safe handling cannot be proved. | [Configuration contract](issues/define-configuration-evidence-and-security-contract.md) |
| SG-EVID-001 | FR-EVID-001, FR-EVID-002, FR-EVID-004, FR-EVID-005, NFR-AUD-001 | Evaluation history must never be silently replaced, automatically deleted, or pruned without a retained audit record. | Append new evidence; require explicit previewed pruning with tombstones and events. | [Evidence contract](issues/define-configuration-evidence-and-security-contract.md) |
| SG-COORD-001 | FR-COORD-001, FR-COORD-002, FR-COORD-003, FR-COORD-004, FR-COORD-005, NFR-REL-001 | Different evaluation bindings must never share mutable roots or completed pass results, and one subscriber must not cancel another's required execution. | Queue or isolate evaluations; return `unverified` on coordination failure. | [Evidence contract](issues/define-configuration-evidence-and-security-contract.md) |
| SG-SUPPORT-001 | FR-ADAPT-002, FR-ADAPT-003, FR-ADAPT-004, FR-ADAPT-005, FR-ADAPT-006, NFR-COMP-001 | An integration must never be labelled supported until its declared surface passes the release baseline. | Classify it as experimental or unsupported and prevent the support claim. | [Support tiers](issues/define-client-support-tiers-and-baseline.md) |
| SG-OWNER-001 | FR-EVAL-003, FR-PROF-001, FR-PROF-003, FR-PROF-004, NFR-MAINT-001 | The gate must never duplicate `framework-setup` command ownership, replace `verify-change`, or add framework-specific branches to the core. | Reject the descriptor or design change and route it through the owning provider or verification seam. | [Profile contract](issues/define-laravel-profile-and-generic-extension-contract.md) |
| SG-TRUST-001 | FR-EVAL-001, FR-LIFE-009, NFR-SEC-004 | Local hooks and evidence must never be presented as tamper-proof enforcement or protection from the machine owner. | State the limitation, report observable drift, and reserve stronger guarantees for later CI or server-side scope. | [Configuration contract](issues/define-configuration-evidence-and-security-contract.md) |

## 9. Scenarios and Use Cases

| Scenario | Actor and trigger | Preconditions | Observable outcome | Requirement IDs |
| --- | --- | --- | --- | --- |
| Passing governed commit | Change author runs `git commit` | Clone is activated; all applicable required checks pass for the staged snapshot | Git permits the commit and records a `passed` Evidence envelope | FR-EVAL-001, FR-EVAL-006, FR-POL-003 |
| Required grader rejection | Change author runs `git commit` | An applicable required check completes negatively | Git blocks; decision is `failed`; assertion and attempt evidence identify the rejection | FR-POL-001, FR-EVAL-008 |
| Harness failure | Required executable is unavailable or output is malformed | Check is applicable | Git blocks; decision is `unverified` with a stable reason | FR-ADAPT-005, NFR-REL-003 |
| Advisory failure | Advisory review or check completes negatively | Required checks pass | Commit authorization remains allowed; advisory evidence stays visible | FR-POL-002 |
| Explicit bypass | Change author requests bypass | Bypass is enabled; exact snapshot, reason, and required reference are supplied | Outcome is `bypassed`; marker and evidence are retained; no check becomes passed | FR-POL-006, FR-POL-007 |
| Bypass disabled | Change author requests bypass | Repository policy disables bypass | Request is rejected and required failure remains blocking | FR-POL-008 |
| Regression-only preflight | Desktop adapter evaluates work with no delivery contract | Adapter baseline passes and exact snapshot is captured | Structured feedback declares `regression-only` and does not claim feature acceptance | FR-EVAL-007, FR-ADAPT-003 |
| Herd-backed snapshot check | An applicable HTTP or browser check runs through the existing local runtime | The Evaluation snapshot is materialized and the local runtime can route to it | Evidence proves the served application matches the snapshot; otherwise the check is `unverified` | FR-EVAL-010, NFR-SEC-001 |
| Atomic activation | Operator runs `gate activate` | Repository is configured; consent and trust can be established | All self-tests pass and Git is enabled last, or every gate-owned change rolls back | FR-LIFE-004, FR-LIFE-005 |
| Existing hook preservation | Operator activates in a repository with an existing local hook | Existing hook chain is valid and preview accepted | Both existing chain and gate execute; surrounding hook content remains unchanged | FR-LIFE-007, NFR-COMP-002 |
| Candidate policy change | Commit changes Gate policy or a Command descriptor | Clone has a Trusted gate configuration | Prior policy remains authoritative; candidate is separately validated and hash-approved before trust moves | FR-CFG-005 |
| Concurrent desktop and Git evaluations | Desktop preflight is queued when a Git commit begins | Evaluations share one Git common directory | Running work is not preempted; authoritative Git may advance ahead of queued preflight; bindings stay isolated | FR-COORD-001, FR-COORD-003 |
| Sensitive runtime input | Applicable check needs an approved environment file | Activation receipt declares its name and source | Temporary copy is used and removed; raw value does not appear in evidence | FR-CFG-006, NFR-SEC-003 |
| Integrity drift | Managed hook or active runtime changes unexpectedly | Clone was previously activated | Status becomes `broken`; authoritative evaluation is `unverified`; no repair occurs automatically | FR-LIFE-009, NFR-SEC-004 |
| Explicit evidence pruning | Operator previews and confirms blob pruning | Referenced output is eligible under policy | Blob is removed; envelope remains; tombstone and pruning event are appended | FR-EVID-004, FR-EVID-005 |

## 10. Risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| RISK-001 | A machine owner bypasses or removes local enforcement and evidence, causing a commit to appear governed when it was not. | Medium | High | State the local trust limit, detect ordinary drift, retain commit-visible bypass markers, and consider later CI or server-side attestation. | Product and security owner | Accepted for local v1 |
| RISK-002 | Checks using shared databases, services, browsers, or Laravel Herd interfere with developer state or each other. | Medium | High | Serialize project commands, declare prerequisites and writes, reuse project safety controls, and make isolation limits explicit. | Runtime owner and repository maintainer | Open |
| RISK-003 | Long required checks or queue contention make commit latency unacceptable and encourage unsupported bypass. | Medium | Medium | Configure per-check timeouts and a total budget, expose timing evidence, and keep exact bypass policy visible. | Product owner | Open |
| RISK-004 | Client hook, trust, or plugin behavior changes and invalidates a claimed supported adapter. | High | High | Pin a tested compatibility baseline and make each supported surface release-blocking. | Adapter owners | Open |
| RISK-005 | Schema version 4 or Command descriptor migration changes established verification behavior. | Medium | High | Preview migrations, retain trusted policy, validate old and candidate semantics, and switch atomically. | Framework configuration owner | Open |
| RISK-006 | Redaction misses a secret in command output or a generated report. | Medium | High | Use allowlisted inputs, secret-canary tests, bounded excerpts, redaction metadata, and fail `unverified` when safe capture cannot be proved. | Security owner | Open |
| RISK-007 | A flaky required check produces conflicting attempts and blocks delivery. | Medium | Medium | Preserve attempt history, forbid silent retries, classify conflicts as `unverified`, and require the project to stabilize or reconfigure the check. | Repository maintainer | Open |
| RISK-008 | A Grader surface is weakened with the same change it evaluates, reducing meaningful coverage. | Medium | High | Surface changed Grader surfaces, bind trusted and candidate identities, and apply dual-policy approval to control-surface changes. | Repository maintainer and security owner | Open |
| RISK-009 | Snapshot materialization cannot safely reuse large dependencies or runtime inputs across all supported environments. | Medium | High | Make the runtime portability suite release-blocking and return `unverified` rather than executing against the live worktree. | Runtime owner | Open |
| RISK-010 | Evidence growth consumes excessive local storage because v1 never deletes automatically. | Medium | Medium | Provide explicit previewed pruning with bounded redacted blobs, tombstones, and retained audit events. | Activation operator | Open |

## 11. Open Questions

| ID | Question | Blocks | Owner | Status | Resolution |
| --- | --- | --- | --- | --- | --- |
| Q-001 | What canonical repository path will own the durable Change Evaluation Gate SRS after this scratch baseline is reviewed? | SRS handoff readiness | Product owner | Open | This baseline remains beside the Wayfinder map until configured ownership is confirmed. |
| Q-002 | Who is accountable for approving the SRS and accepting or mitigating its high-impact residual risks? | SRS approval | Framework maintainers | Open | — |
| Q-003 | Which additional agent clients, if any, enter scope after the three supported v1 desktop surfaces? | Post-v1 scope only | Product owner | Open | — |
| Q-004 | Which exact client versions, operating environments, and fixture results constitute the release evidence matrix for each supported adapter and the shared runtime? | FR-ADAPT-002, NFR-COMP-001, NFR-PORT-001 | Adapter and release owners | Open | — |
| Q-005 | What release sequence, version boundary, and repository migration path introduce schema version 4 and the optional Gate module? | FR-CFG-001, FR-LIFE-008 | Framework and release owners | Open | — |
| Q-006 | Which acceptance examples, interface conformance artifacts, installation examples, and compatibility evidence are mandatory before the Wayfinder map may hand off to `to-spec` and `to-tickets`? | Specification handoff readiness | Wayfinder decision owner | Open | Tracked by [Set specification readiness and handoff criteria](issues/set-spec-readiness-and-handoff-criteria.md). |
| Q-007 | What project-level default budgets and timeouts should `framework-setup` propose when a repository has no existing evidence? | None | Framework configuration owner | Resolved | No universal duration is defined; `framework-setup` requires project-confirmed per-check timeouts and a total evaluation budget. |
| Q-008 | What retained output size bounds and operator-facing pruning policy should v1 ship? | FR-EVID-003, FR-EVID-004 | Product and runtime owners | Open | Automatic evidence deletion remains prohibited. |

## 12. Acceptance Criteria

| ID | Requirement IDs | Criterion | Evidence seam |
| --- | --- | --- | --- |
| AC-EVAL-001 | FR-EVAL-001, FR-POL-001, FR-POL-003 | In an activated fixture repository, every `git commit` invokes the gate; a snapshot with all current required passes is allowed and a snapshot with one required failure is blocked. | Git integration test |
| AC-EVAL-002 | FR-EVAL-002, FR-EVAL-006, NFR-AUD-002, NFR-OPER-001 | Contract fixtures validate the versioned request and prove every passing, failing, unverified, and bypassed decision contains the required identities, authorization, diagnostics, coverage, integrity, and evidence reference. | Public process-interface contract test |
| AC-EVAL-003 | FR-EVAL-003, FR-EVAL-005, NFR-REL-001 | Repeating resolution for one identical binding produces the same applicable descriptor order and runs only check-only Evidence ladder commands. | Gate-core conformance test |
| AC-EVAL-004 | FR-EVAL-004, NFR-SEC-001 | A test changes an unstaged live-worktree file after snapshot capture and proves evaluated output and evidence still match the isolated snapshot while the live file remains unchanged. | Snapshot materialization integration test |
| AC-EVAL-005 | FR-EVAL-007, FR-PROF-005 | Without a valid delivery contract, the decision is `regression-only`; with one, acceptance-linked assertions use its stable AC IDs and coverage gaps are explicit. | Task-scope and assertion contract test |
| AC-EVAL-006 | FR-EVAL-008, NFR-REL-003 | Fixtures preserve all attempts and map missing prerequisites, invalid configuration, timeout, crash, malformed output, snapshot mismatch, integrity drift, and coordination failure to `unverified`; conflicting equivalent attempts cannot pass. | Negative gate-core conformance suite |
| AC-EVAL-007 | FR-EVAL-009 | A fixture changing a test, verification script, provider, or Gate configuration reports the affected Grader surface and binds all integrity identities in the decision. | Integrity contract test |
| AC-EVAL-008 | FR-EVAL-010, NFR-SEC-001, SG-EVAL-002 | A Herd-backed HTTP or browser fixture proves that the served application comes from the materialized Evaluation snapshot; routing to the live worktree or an unprovable source returns `unverified`. | Host-runtime snapshot-routing integration test |
| AC-POL-001 | FR-POL-002, FR-POL-004 | A pre-existing required failure still blocks, an advisory failure does not block, and no completed pass from an older evaluation authorizes a changed snapshot. | Policy integration test |
| AC-POL-002 | FR-POL-005, NFR-PERF-001 | Per-check timeout and total-budget fixtures terminate process trees, skip only eligible advisory work, and block with `unverified` when required coverage is incomplete. | Process-runner integration test |
| AC-POL-003 | FR-POL-006, FR-POL-007, FR-POL-008 | Bypass fixtures prove disabled bypass is rejected and enabled bypass is one-shot, snapshot-bound, reason-bound, visibly `bypassed`, evidence-backed, marker-emitting, and never rewrites a failed check. | Policy and Git adapter integration test |
| AC-POL-004 | FR-POL-009 | Commit evaluation rejects mutating descriptors, while explicit `gate fix` may invoke the separately declared fix command and requires a new evaluation snapshot afterward. | CLI contract and source-immutability test |
| AC-ADAPT-001 | FR-ADAPT-001, FR-ADAPT-003 | The same returned decision causes Git to block on `deny` and each desktop adapter to show structured preflight feedback with `not-authoritative`. | Cross-adapter contract suite |
| AC-ADAPT-002 | FR-ADAPT-002, FR-ADAPT-004, FR-ADAPT-005, FR-ADAPT-006, NFR-COMP-001 | Each supported local desktop surface passes the shared baseline; a capability, trust, timeout, or output failure is `unverified`; unproved remote and hosted variants cannot claim support. | Release-blocking client compatibility matrix |
| AC-PROF-001 | FR-PROF-001, FR-PROF-002, NFR-MAINT-001 | Laravel and one reference non-Laravel provider emit valid descriptors consumed through the same interface without a stack-name branch in gate-core behavior. | Provider contract suite and architecture review |
| AC-PROF-002 | FR-PROF-003 | A Laravel fixture maps confirmed Pint, Rector dry-run, PHPStan or Larastan, Pest, smoke, build, and browser commands to their defined Evidence ladder stages and distinct evidence claims. | Laravel provider integration test |
| AC-PROF-003 | FR-PROF-004 | A fixture with a missing command, unproved capability, or filename-only test guess reports a visible capability gap and persists no guessed descriptor. | Provider discovery test |
| AC-LIFE-001 | FR-LIFE-001, FR-LIFE-002, FR-LIFE-003 | Project and global distribution fixtures leave repositories unconfigured or configured but never activated; a fresh clone has no active receipt or managed hook until repository-bound activation. | Installation and clone smoke tests |
| AC-LIFE-002 | FR-LIFE-004, FR-LIFE-005, FR-LIFE-006, NFR-REL-002 | Successful activation records the previewed identities and enables Git last; failure injected at every step restores the configured state and leaves no partial receipt or registration. | Transaction failure-injection suite |
| AC-LIFE-003 | FR-LIFE-007, NFR-COMP-002 | Activation fixtures preserve surrounding hook content, execute the prior chain and gate, refuse unsafe shared-hook changes, and require manual resolution after marker drift. | Git hook compatibility suite |
| AC-LIFE-004 | FR-LIFE-008, FR-LIFE-009 | Update failure preserves the previous Active gate release, and independent drift fixtures produce `degraded` only for non-authoritative adapter loss and `broken` for authoritative Git or runtime loss without automatic repair. | Lifecycle integration suite |
| AC-LIFE-005 | FR-LIFE-010, FR-LIFE-011 | Deactivation removes only unchanged gate-owned registrations and the receipt; uninstall removes only project assets and preserves shared configuration, global assets, and all historical evidence. | Removal integration test |
| AC-LIFE-006 | FR-LIFE-012, FR-LIFE-013 | Selective installers expose the Gate module independently, whole-plugin installations leave bundled Gate assets dormant, and `framework-setup` leaves Gate configuration unselected until confirmed. | Distribution and setup smoke tests |
| AC-LIFE-007 | FR-LIFE-014 | Updating a skill or plugin makes a candidate release visible without changing the receipt's Active gate release; only a successful explicit `gate update` advances it. | Update lifecycle integration test |
| AC-LIFE-008 | FR-LIFE-015 | Non-interactive activation with a missing or mismatched repository or configuration identity performs no mutation, while an exact identity match may proceed through the remaining activation checks. | Activation identity contract test |
| AC-CFG-001 | FR-CFG-001, FR-CFG-002 | Schema tests prove absent `evaluation_gate` means not configured, present means configured only, exactly five policy subcontracts are accepted, and command definitions remain owned by Verification. | Schema validation suite |
| AC-CFG-002 | FR-CFG-003, FR-CFG-004, NFR-SEC-002 | Descriptor validation rejects shell syntax and unresolved runners; activation resolves, versions, pins, and previews each approved executable without shell parsing. | Schema and cross-platform runner test |
| AC-CFG-003 | FR-CFG-005 | A candidate that weakens a required policy cannot authorize itself; only a candidate-hash approval after both trusted and candidate policies succeed advances trust. | Trusted-transition integration test |
| AC-CFG-004 | FR-CFG-006, NFR-SEC-003 | Secret-canary fixtures copy only approved inputs into the isolated root, remove them afterward, and find no raw secret in configuration, decisions, envelopes, blobs, or events. | Sensitive-input and redaction test |
| AC-EVID-001 | FR-EVID-001, FR-EVID-002, FR-EVID-003, NFR-AUD-001 | Repeated evaluations append distinct canonical content-addressed envelopes at the fixed Git-common location using atomic publication, and retained output is bounded and redacted. | Evidence-store integration and schema audit |
| AC-EVID-002 | FR-EVID-004, FR-EVID-005 | No operation deletes evidence automatically; explicit pruning removes only previewed blobs and appends tombstones plus complete pruning and lifecycle audit events. | Evidence retention and pruning integration test |
| AC-COORD-001 | FR-COORD-001, FR-COORD-002, FR-COORD-003, FR-COORD-004, FR-COORD-005 | Concurrency fixtures prove per-repository serialization, safe matching in-flight sharing, role-specific decisions, Git priority over queued preflights, subscriber-local cancellation, audited stale-lock recovery, and `unverified` coordination failure. | Multi-client and linked-worktree integration suite |
| AC-PORT-001 | NFR-PORT-001, NFR-PORT-002 | The runtime portability suite passes executable, stream, JSON, timeout, process-tree, Git-index, linked-worktree, path-with-spaces, materialized-root declared-write, source-immutability, and non-interactive-shell fixtures on every release-supported environment. | Release-blocking runtime portability matrix |
| AC-SEC-001 | NFR-SEC-004 | Independent drift of each Gate control surface produces `broken` health and an `unverified` authoritative result while changed ordinary Grader surfaces remain visible without automatic malicious classification. | Integrity and tamper-model conformance suite |

## 13. Traceability and Readiness

Acceptance Criteria `Requirement IDs` are the canonical requirement-to-evidence mapping. Safeguards `Protects` are the canonical negative-space mapping.

- Mechanical audit result: Pass for this baseline.
- Uncovered active requirements: None.
- Unresolved blocking questions: Q-001, Q-002, Q-004, Q-005, Q-006, Q-008.
- Unmitigated or unaccepted high-impact risks: RISK-002, RISK-004, RISK-005, RISK-006, RISK-008, RISK-009.
- Semantic review result: Draft-ready and traceable, but not ready for `Approved` status or implementation handoff until the open [readiness decision ticket](issues/set-spec-readiness-and-handoff-criteria.md) resolves the required evidence package and the named approval blockers have owners and dispositions.

## 14. Out of Scope

- Implementing, publishing, releasing, installing, configuring, or activating the gate as part of this baseline task.
- Replacing `framework-setup`, `verify-change`, or the existing Evidence ladder without a separate accepted decision.
- Preventing raw `git commit --no-verify`, hook removal, Git reconfiguration, local evidence deletion, or actions by the machine owner.
- CI enforcement, server-side attestation, signing, encryption, privileged daemons, hidden tests, or tamper-proof audit storage.
- Provisioning Docker, virtual machines, separate databases, hardened operating-system sandboxes, or isolated copies of project services.
- Authoritative model-based grading, human grading, agent transcript grading, preferred tool-sequence grading, weighted required-check scores, `pass@k`, or repeated-trial authorization.
- Treating a broad test suite as proof of missing task-specific acceptance evidence.
- Automatically enabling the gate through package lifecycle scripts, skill installation, plugin installation, configuration discovery, or a fresh clone.
- Supporting additional desktop, CLI, SSH, remote, cloud, background, chat-only, or hosted surfaces beyond the stated v1 matrix without separate compatibility evidence.
- Selecting the final implementation design, physical schemas, classes, files, command serialization internals, or release sequence while the Wayfinder readiness decision remains open.
