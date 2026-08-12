# TB-016 — Reconcile desktop adapter registration surfaces

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent
Blocked by:
Tracker ID: 16-reconcile-desktop-adapter-registration-surfaces
Draft key: TB-016

**Status:** ready-for-agent

Unblocked 2026-08-12: `FR-ADAPT-008` and `AC-ADAPT-003` were added to the SRS at
v0.2.4 and `SG-HOOK-001` was extended to client configuration files, so this
contract now traces to approved IDs.
**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

Activation can register, and health reconciliation can observe, a Gate preflight
adapter in each supported desktop client despite those clients using different
registration files, block shapes, and schema versioning — or it reports the
surface `unverified` rather than assuming a mechanism it cannot confirm.

## SRS Traceability

- `FR-ADAPT-008`, `FR-LIFE-007`, `FR-LIFE-017`
- `AC-ADAPT-003`
- `SG-HOOK-001`, `SG-LIFE-001`, `SG-OWNER-001`
- `RISK-004`, `Q-003`

`FR-ADAPT-008` and `AC-ADAPT-003` were added to the SRS at v0.2.4, and
`SG-HOOK-001` now also forbids rewriting a part of a client configuration file
the adapter does not own. Those are the governing IDs; the rest are the adjacent
lifecycle constraints this work must not break.

### Why the pre-existing traceability was insufficient

This section is kept because it records why the requirement was added rather
than stretched out of an existing one.

- `FR-LIFE-007` and `FR-LIFE-017` describe hook registration in **Git terms**
  — `core.hooksPath`, a repository-local hook, an owned shim. Neither describes
  a client-owned registration file with its own schema.
- `FR-LIFE-004` self-tests "selected adapters" and `FR-LIFE-006` pins "hook
  locations" in the receipt, both presupposing adapter registration without
  specifying it for desktop clients.
- `FR-ADAPT-004` names exactly eight declared capability categories — event,
  blocking, trust, repository, session, filesystem, Git, invocation. A
  registration surface is **not** among them.
- `SG-HOOK-001` forbids leaving "a partial adapter set active", which
  presupposes adapter registration without defining how it happens.
- The lifecycle acceptance criteria covering hook composition and trust resume
  are Git-scoped and cannot be stretched to client configuration files.

## Domain Concepts

Managed hook registration, Adapter distribution, Gate health, Activation
receipt, and Support tier.

## Approach and Tradeoffs

Treat the registration surface as declared per-adapter data, exactly as TB-013
treats event names and identity fields, rather than as branching logic in
activation. Activation writes through the declaration; `gate status` reads
through it; `gate deactivate` removes through it. An adapter whose declaration
cannot be confirmed against the real file is `unverified` rather than assumed
healthy.

The tradeoff is that a per-client declaration cannot be validated without that
client present, so registration remains structurally unverifiable in CI for the
same reason adapter payloads are. This contract does not solve that; it makes
the surface explicit so a real client-driven run can confirm it.

## Architecture Boundary and Public Seam

The boundary is clone-local adapter registration within lifecycle activation and
health, outside Gate core. The public seam is the adapter registration
declaration plus the activation, status, and deactivate results that consume it.
First red test: two adapters declaring different registration schemas both
register and both reconcile, without activation branching on a client name.

## Safeguards and Invariants

- `SG-HOOK-001`: registration never overwrites an existing client hook entry,
  never rewrites an unrelated part of a client's configuration file, and never
  leaves a partial adapter set active.
- `SG-LIFE-001`: status reconciles registration without repairing it, and
  removal takes only unchanged Gate-owned entries.
- `SG-OWNER-001`: registration mechanics stay in adapter declarations; Gate core
  gains no client-name branch.

## Prohibited Behavior and Non-goals

Do not branch activation on a client name, infer a registration mechanism from a
client's presence on disk, write to a client configuration file the adapter did
not declare, register a fourth client (`Q-003`), or claim a surface is
registered when only the file's existence was checked.

## Risk and Decision Impacts

- `RISK-004`: reinforced. Client registration formats are versioned
  independently of the Gate — Cursor already carries its own `"version": 1` —
  so a client can invalidate a registration claim without changing the Gate.
  Registration evidence belongs in the release manifest alongside payload
  evidence.
- `Q-003`: unchanged. This contract covers only the three v1 desktop surfaces.

## Acceptance Criteria

- [ ] `AC-ADAPT-003`: each supported desktop adapter declares its registration
  file, block schema, and schema-versioning behaviour, and activation registers
  through that declaration with no client-name branch in activation or Gate core.
- [ ] `AC-ADAPT-003`: `gate status` reconciles a registered adapter, reports
  drift when the registered block no longer matches the declaration, and repairs
  nothing.
- [ ] `AC-ADAPT-003`: `gate deactivate` removes only an unchanged Gate-owned
  registration entry and preserves every unrelated entry in the same client file.
- [ ] `AC-ADAPT-003`: an adapter whose declared registration surface cannot be
  confirmed on disk is `unverified` and never counted as registered.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-ADAPT-003`, `SG-HOOK-001`, `SG-LIFE-001`, `SG-OWNER-001`: registration, reconciliation, drift, and removal fixtures across three declared schemas | `npm run test:unit` | Yes — configured unit suite exercises the lifecycle and adapter seams |
| smoke | both | `AC-ADAPT-003`: registration preserves unrelated entries in a real client configuration file | `gate-hook-conformance-smoke` capability extended by this slice | Yes — the existing hook conformance selector owns registration behaviour |

Frontend build and browser evidence are inapplicable; these are local
configuration surfaces, not repository frontend code.

## Blocked By

None. `FR-ADAPT-008` and `AC-ADAPT-003` were approved in the SRS at v0.2.4, and
`TB-013` — whose corrected adapter declarations these registration declarations
extend — is done.

## Unresolved Assumptions

None start-blocking. Two evidence caveats to carry into implementation:

1. **Cursor's registration block shape is reported, not captured.** The
   Product Owner supplied it after the file had been reset; unlike the payload
   evidence it was not read from a live configuration. Confirm before relying on
   it.
2. **Only Codex's and Claude Code's block shapes were read from disk**, each
   from a single machine and client version. Whether these schemas are stable
   across client versions is unknown, which is precisely why `FR-ADAPT-008`
   requires declaring the schema-versioning behaviour.

## Readiness

- [x] The outcome is a complete vertical behavior.
- [x] Acceptance criteria trace to the SRS and feature contract.
- [x] The public seam and first red test are identified.
- [x] Safeguards and non-goals are explicit.
- [x] Risks and resolved decisions are traced to the parent contract.
- [x] Blocking edges exist and are acyclic.
- [x] No unresolved assumption blocks the start.
- [x] The ticket fits one fresh implementation context.
- [x] User-facing and frontend evidence requirements are covered or explicitly inapplicable.

## Evidence

Source finding: `.scratch/change-evaluation-gate/adapter-qualification-findings.md`,
Finding 8 — desktop registration diverges four ways.

| Client | File | Block schema |
| --- | --- | --- |
| Claude Code | `.claude/settings.local.json` | nested in a general settings file; `Stop → [{ matcher, hooks: [{ type, command }] }]` |
| Codex | `.codex/hooks.json` | dedicated file; block shape identical to Claude Code |
| Cursor | `.cursor/hooks.json` | dedicated, `"version": 1`; flat `stop → [{ command }]`, no matcher, no type |
