# AI Skills Framework

A Minic-maintained collection of agent skills for a deterministic, TDD-oriented Laravel development lifecycle with adaptable TypeScript frontends. Released skills are flat under `skills/` and are distributed through universal, Claude Code, and Codex installers. `/framework-setup` records repository-local conventions in `.agent-framework.yaml`; `/framework-router` selects the lifecycle route.

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
The configured Laravel/frontend evidence contract containing proved
capabilities and exact commands. It is selected by project stack and consumed
by `verify-change`.

**Evidence ladder**:
An impact-based verification order progressing from focused behavior through
formatting, static analysis, affected tests, smoke, build, browser, and broad
tests. Each required step records its exact command and outcome.

**Three-axis review**:
Independent Standards, Contract, and Evidence review passes over one fixed
diff. Findings remain separate so correctness on one axis cannot hide failure
on another.

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
- A **Verification profile** produces an **Evidence ladder** for one **Delivery contract**
- A **Three-axis review** evaluates the implementation after its **Evidence ladder** passes
- **Durable synchronization** records only accepted long-lived learning

## Flagged ambiguities

- "backlog" was previously used to mean both the *tool* hosting issues and the *body of work* inside it — resolved: the tool is the **Issue tracker**; "backlog" is no longer used as a domain term.
- "backlog backend" / "backlog manager" — resolved: collapsed into **Issue tracker**.
