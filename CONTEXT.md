# AI Skills Framework

A Minic-maintained collection of agent skills for a deterministic, TDD-oriented Laravel or Express with TypeScript development lifecycle with adaptable Livewire and TypeScript frontends. Released skills are flat under `skills/` and are distributed through universal, Claude Code, and Codex installers. `/framework-setup` records repository-local conventions in `.agent-framework.yaml`; `/framework-router` selects the lifecycle route.

## Language

**Issue tracker**:
The tool that hosts a repo's issues — GitHub Issues, Jira, Linear, or a local Markdown convention. Skills like `to-tickets`, `to-spec`, and `triage` read from and write to it through tracker-specific instructions.
_Avoid_: backlog manager, backlog backend, issue host

**Issue**:
A single tracked unit of work inside an **Issue tracker** — a bug, task, spec, or slice produced by `to-tickets`.
_Avoid_: ticket (use only when quoting external systems that call them tickets, or for a **Decision ticket** — see below)

**Decision ticket**:
A `wayfinder` unit — a child **Issue** of a `wayfinder:map` holding a *question* whose resolution is a decision, not a slice of a build to execute. The **decision** qualifier is what keeps it distinct from an implementation ticket; `wayfinder` introduces the term, then uses "ticket".

**Triage role**:
A canonical state-machine label applied to an **Issue** during triage (e.g. `needs-triage`, `ready-for-afk`). Each role maps to a real label string in the **Issue tracker** via `docs/agents/triage-labels.md`.

**Software Requirements Specification (SRS)**:
The canonical statement of durable intended system behavior, boundaries,
quality constraints, risks, safeguards, and acceptance criteria. It links to
the domain glossary for terminology and ADRs for architectural rationale.
_Avoid_: implementation plan, code inventory

**Active requirement**:
An SRS requirement whose status is Draft, Review, or Approved and therefore
must trace to observable acceptance evidence. Retired, Superseded, and
Withdrawn requirements retain their stable IDs but are not active.

**Safeguard**:
A stable negative-space constraint protecting one or more requirements by
stating an invariant or prohibited outcome and the response to a violation.
_Avoid_: guardrail (reserved for skill-execution boundaries)

**Feature contract**:
A `to-spec` planning artifact that extracts one cohesive delivery scope from
the SRS and binds its requirements, acceptance criteria, safeguards, risks,
non-goals, and public evidence seams. It is ready for decomposition, not ready
for implementation.
_Avoid_: feature SRS, implementation plan

**Specification handoff**:
The transfer from a completed Wayfinder decision map to one canonical Feature
contract that owns normative delivery scope. The map remains rationale;
subsequent Delivery contracts derive from the readiness-approved Feature contract.

**Delivery contract**:
The normative body of one implementation **Issue**: a vertical outcome, SRS
traceability, public seam, safeguards, non-goals, acceptance evidence,
verification matrix, assumptions, and blocking edges. `to-tickets` creates it;
`implement` executes it.
_Avoid_: REASONS Canvas, Operations script

**Readiness gate**:
A binary check that prevents a feature or delivery contract from advancing
while references, public seams, evidence, blockers, or start-blocking decisions
remain unresolved.

**Contract amendment**:
An explicit accepted, rejected, or deferred decision proposed when
implementation learning would change observable behavior, safeguards,
acceptance evidence, non-goals, public interfaces, or durable architecture.
Private implementation choices do not require one.

**Verification profile**:
The configured backend/frontend evidence contract containing confirmed source
scopes, proved capabilities, and exact scoped commands. It is selected by
project stack and consumed by `verify-change`.

**Source scope**:
A confirmed repository-relative root classified as backend, frontend, or
shared. Longest-root matching classifies changed files; shared, tied, and
unmatched files conservatively affect both verification scopes.
_Avoid_: frontend file extension, inferred TypeScript layer

**Evidence ladder**:
An impact-based verification order progressing from focused behavior through
formatting, static analysis, affected tests, smoke, build, browser, and broad
tests. Each required step records its exact command and outcome.

**Change Evaluation Gate**:
An opt-in lifecycle control that evaluates a proposed code change against its
configured evidence requirements before allowing a governed transition.
_Avoid_: eval harness, pre-commit hook, quality gate

**Enforcement role**:
The authority an integration has in the Change Evaluation Gate lifecycle.
`authoritative` integrations may allow or block the governed transition;
`preflight` integrations provide earlier feedback but cannot authorize it.
_Avoid_: required client, advisory client

**Support tier**:
The compatibility promise made for one integration surface: `supported`,
`experimental`, or `unsupported`. A supported surface is a release-blocking
compatibility target; an experimental surface is opt-in and non-release-blocking;
an unsupported surface carries no adapter compatibility claim. The tier
describes product maturity independently of the integration's Enforcement role.

**Client compatibility baseline**:
The operating-system-independent hook capabilities an integration surface must
prove, including event delivery, command invocation, result handling, trust,
repository context, and declared blocking behavior. Native agent blocking is
not required: a supported preflight integration must execute deterministically
and make its structured result visible, while authorization remains with an
authoritative integration.

**Runtime portability baseline**:
The environment capabilities the shared gate runtime must prove, including
executable discovery, path handling, process control, filesystem access, and
Git snapshot operations. It is evaluated separately from client compatibility.

**Evaluation snapshot**:
The immutable proposed code state whose identity is bound to Change Evaluation
Gate evidence. Authoritative checks execute only in an isolated materialization
of this snapshot, never against a mutable live worktree; inability to provide
that isolation produces `unverified`.

**Execution isolation**:
The v1 guarantee that approved checks run from an exact Evaluation snapshot in a
separate directory or worktree while using the developer's existing host runtime
and local services. It is source-state isolation, not virtualization, a security
sandbox, or containment of malicious repository code.

**Sensitive runtime input**:
A local environment file, variable, or credential used by an approved check in the
developer's existing environment. Its source may be declared and made available
through a temporary copy recorded by name in the Activation receipt, but its value
is never written to repository configuration or Gate evidence and must be redacted
from captured output.

**Evaluation scope**:
The evidence claim made by a Change Evaluation Gate decision. A repository-owned
delivery-contract reference permits `change-acceptance-and-regression`; without
one, the decision is explicitly `regression-only` and cannot claim that requested
behavior or acceptance criteria were proved.

**Check assertion**:
An atomic evidence claim produced by one configured Change Evaluation Gate
check. Every check reports at least one assertion; acceptance-linked assertions
use their acceptance IDs. Assertions improve diagnosis and coverage but do not
provide partial credit or compensate for a failed required check.

**Check attempt**:
One recorded invocation of a configured check, bound to an Evaluation snapshot,
configuration, and execution environment. Attempts are never retried silently;
conflicting outcomes for the same binding make the check `unverified`. A code
correction creates a new Evaluation snapshot and therefore a new evaluation.

**Evidence envelope**:
The immutable, versioned, content-addressed record of one gate evaluation,
including its identities, resolved checks, attempts, assertions, coverage,
integrity, authorization, bypass, and redaction metadata. Reruns append envelopes
rather than replacing prior outcomes.

**Evidence store**:
The fixed clone-local, append-only collection of Evidence envelopes and bounded,
redacted output blobs under resolved Git metadata. It is local audit evidence,
not tamper-proof attestation; removal is explicit and leaves pruning evidence when
referenced output is no longer retained.

**Lifecycle event**:
An immutable, content-addressed local audit record for a gate configuration,
activation, update, repair, removal, trust, evaluation, bypass, pruning, lock, or
integrity action. Actor identity is best-effort and explicitly unauthenticated;
the event provides traceability without claiming resistance to deletion by the
machine owner.

**Evaluation coordination**:
Repository-wide serialization of gate command execution across clients and Git
worktrees sharing one Git common directory. Exactly matching in-flight requests
may share check evidence, while different evaluations queue and retain separate
isolated materializations; completed results are not a persistent pass cache.

**Grader surface**:
A repository file, configuration, verification script, test, or profile provider
that defines or materially affects a configured check. Changes to Grader surfaces
are always recorded in decision integrity evidence but do not imply maliciousness
or an automatic block; project security policy owns their enforcement.

**Gate control surface**:
The active runtime, adapter, Managed hook registration, Activation receipt, Trusted
gate configuration, Command descriptors, and provider definitions whose integrity
determines whether enforcement can be trusted. Unexpected drift makes Gate health
`broken`; v1 detects ordinary drift but does not resist a malicious machine owner.

**Gate lifecycle state**:
The explicit adoption state of the Change Evaluation Gate: `installed` makes its
assets available without executing hooks; `configured` adds a reviewed repository
contract without affecting commits; `activated` registers, trusts, and verifies
the repository's Git and selected desktop adapters. Installation or configuration
never implies activation. Installation may be global, but activation is always
repository-specific; v1 has no global activation mode.

**Activation receipt**:
Clone-local evidence that records the gate configuration identity, installed
runtime and adapter versions, registered hook locations, trust state, and
successful activation checks. It is reconciled with actual state by `gate status`
and is not a committed substitute for the repository-owned gate contract.

**Managed hook registration**:
A marker-delimited hook block or dedicated shim whose ownership and original
context are recorded in an Activation receipt. Registration never overwrites an
existing hook or automatically modifies a shared/global hooks path; activation
and removal require integrity checks that preserve the surrounding hook chain.

**Activation transaction**:
The atomic transition from `configured` to `activated` for the selected adapter
set. It previews changes, establishes required trust, and self-tests the runtime,
desktop adapters, and existing Git hook chain before enabling the authoritative
Git hook last. Failure rolls back every gate-owned change and leaves the
repository `configured`; no partial adapter set is considered `activated`.

**Active gate release**:
The runtime and adapter versions pinned by an Activation receipt and used by an
activated clone. Installing newer skill or plugin assets only makes a candidate
release available. An explicit `gate update` previews migrations, validates
configuration compatibility, repeats activation self-tests, and switches releases
atomically; failure preserves the previous active release.

**Gate configuration section**:
The optional, repository-owned `evaluation_gate` policy within the shared
`.agent-framework.yaml` contract. Its presence means `configured`, not activated;
it references the Verification profile without duplicating commands and excludes
clone-local activation, trust, runtime, and health state.

**Gate policy**:
The client-independent rules within a Gate configuration section: required and
advisory check identities, total evaluation budget, bypass policy, execution
capabilities, and evidence policy. It excludes command definitions and all
clone-local adapter, executable, trust, and activation state.

**Trusted gate configuration**:
The last explicitly approved Gate configuration section and related Verification
profile identity pinned by an Activation receipt. A candidate snapshot cannot
weaken its own evaluation: policy-surface changes require hash-bound approval and
the transition must satisfy both the trusted and candidate policies.

**Command descriptor**:
An OS-independent declaration of a configured check's logical runner, arguments,
working directory, timeout, environment allowlist, category, and source scope.
Clone-local activation resolves it to a platform executable and pins that identity;
evaluation invokes it without shell parsing or operators.

**Gate removal**:
A conservative reversal of adoption. `gate deactivate` removes only unchanged,
gate-owned registrations and the clone-local Activation receipt while preserving
configuration and evidence; detected hook drift requires manual resolution.
`gate uninstall` requires deactivation and removes only project-installed gate
assets. It cannot remove a global installation, shared framework configuration,
or historical evidence.

**Activation consent**:
Explicit, repository-bound approval of an Activation transaction after previewing
the repository identity, configuration identity, selected adapters, hook locations,
and commands. Installers and package lifecycle scripts cannot grant it. Interactive
activation requires confirmation; non-interactive activation requires an explicit
approval flag plus the expected repository and configuration identities. Client
trust remains client-controlled and activation may resume after trust is granted.

**Adapter distribution**:
Delivery of gate skills, commands, adapter templates, launchers, documentation, or
status integration through Codex and Claude plugins or skill installers such as
`npx skills`. Distribution makes an adapter available but never registers or trusts
it for a repository. Registration occurs only through an Activation transaction,
and authoritative Git enforcement cannot depend on a desktop plugin remaining
installed or enabled.

**Gate module**:
The independently selectable, opt-in framework distribution unit for the Change
Evaluation Gate. Project-local installation is the default and global installation
must be explicit. `framework-setup` initially leaves gate configuration unselected.
Clients with component selection expose the module separately; clients that install
an entire plugin may bundle dormant assets, which constitutes only `installed`.

**Gate health**:
The reconciled operational condition of an intended activation: `healthy` when the
receipt, runtime, trust, hooks, and selected adapters match; `degraded` when a
non-authoritative desktop adapter is unavailable while Git enforcement remains
valid; or `broken` when the authoritative Git hook or runtime is missing or invalid.
Health checks never repair drift automatically, and broken state cannot be presented
as active commit enforcement.

**Four-axis review**:
Independent Standards, Contract, Security, and Evidence review passes over one fixed
diff. Findings remain separate so correctness on one axis cannot hide failure
on another. Security delegates a diff-scoped audit to `audit-security`.

**Durable synchronization**:
The selective update of the SRS, glossary, ADRs, tracker evidence, or history
after an explicit owning decision. Private implementation remains code truth.

## Relationships

- An **Issue tracker** holds many **Issues**
- An **Issue** carries one **Triage role** at a time
- A **Decision ticket** is an **Issue** (a child of a `wayfinder:map`)
- An **SRS** contains many **Active requirements**
- A **Safeguard** protects one or more SRS requirements
- A **Feature contract** extracts one cohesive slice from an **SRS**
- A **Feature contract** decomposes into many **Delivery contracts**
- A **Delivery contract** is the normative body of one implementation **Issue**
- A **Readiness gate** controls progression from SRS to feature contract, delivery contract, and implementation
- A **Source scope** selects the applicable commands within a **Verification profile**
- A **Verification profile** produces an **Evidence ladder** for one **Delivery contract**
- A **Change Evaluation Gate** evaluates a proposed change through its **Verification profile** and **Evidence ladder**
- A Change Evaluation Gate integration has one **Enforcement role** and one **Support tier**
- A supported integration passes both its **Client compatibility baseline** and the applicable **Runtime portability baseline**
- A **Change Evaluation Gate** executes applicable checks against one isolated **Evaluation snapshot**
- An Evaluation snapshot runs under one **Execution isolation** contract
- A **Change Evaluation Gate** decision declares one **Evaluation scope**
- A configured Change Evaluation Gate check produces one or more **Check assertions**
- A configured Change Evaluation Gate check records one or more **Check attempts**
- A gate evaluation produces one **Evidence envelope**
- An **Evidence store** contains many Evidence envelopes and **Lifecycle events**
- A Change Evaluation Gate decision identifies changed **Grader surfaces**
- Gate health reconciles one or more **Gate control surfaces**
- A repository has one **Gate lifecycle state**
- An **Activation transaction** moves a configured repository clone to activated
- An activated repository clone has one **Activation receipt**
- An activated repository clone uses one **Active gate release**
- An activated repository clone reports one **Gate health**
- An activated repository clone has one or more **Managed hook registrations**
- A **Gate module** supplies one or more **Adapter distributions**
- A repository-owned **Gate configuration section** configures its Change Evaluation Gate
- A Gate configuration section contains one **Gate policy**
- An Activation receipt pins one **Trusted gate configuration** and its resolved **Command descriptors**
- An activated clone declares zero or more **Sensitive runtime inputs**
- A **Four-axis review** evaluates the implementation after its **Evidence ladder** passes
- **Durable synchronization** records only accepted long-lived learning

## Flagged ambiguities

- "backlog" was previously used to mean both the *tool* hosting issues and the *body of work* inside it — resolved: the tool is the **Issue tracker**; "backlog" is no longer used as a domain term.
- "backlog backend" / "backlog manager" — resolved: collapsed into **Issue tracker**.
