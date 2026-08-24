# TB-040 — Let a maintainer and an agent observe the Gate the same way

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 40-let-a-maintainer-and-an-agent-observe-the-gate
Draft key: TB-040

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A maintainer can ask an activated clone how it is, and so can an agent, by
running the same command. Observation reports health, coordination, and what a
prune would remove, and it writes nothing at all.

## SRS Traceability

- `FR-LIFE-009`, `FR-EVID-004`, `FR-COORD-005`
- `AC-LIFE-004`, `AC-EVID-002`, `AC-COORD-001`
- `SG-LIFE-001`, `SG-EVID-001`, `SG-TRUST-001`
- `NFR-OPER-001`, `NFR-PORT-002`
- `RISK-004`

## Defect this contract fixes

The lifecycle operations exist, are tested, and cannot be reached. Verified:
`statusGate`, `inspectCoordination`, `previewEvidencePrune`, and every other
export of `lifecycle.mjs` (1362 lines) appear repository-wide only in `tests/`,
in three smoke scripts, in the contract markdown, and in `lifecycle.mjs` itself.
Verified: `package.json` declares exactly one `bin` entry,
`change-evaluation-gate-precommit`, and the only other entrypoint is
`gate-preflight.mjs`, which a client hook invokes by path. There is no
observation surface for a human or for an agent.

The consequence is not only that a maintainer cannot type `gate status`. It is
that an agent asked to diagnose a clone has to import `lifecycle.mjs` and
reconstruct its argument shapes from the test suite, producing a different
throwaway script every time — and that the code path a real clone would take is
exercised only by fixtures. That is the same shape as the defects this project
already fixed repeatedly: a component proved in isolation and never reached by
anything a user runs. `gms` failed on first contact for exactly that reason.

Verified: the code already anticipates the surface it does not have.
`inspectCoordination` returns `action: 'gate locks --recover'` when it finds a
stale held lock (`lifecycle.mjs:1332`), naming a command that does not exist.

This slice builds the surface and proves it on the operations that write
nothing. The operations that write are `TB-041`.

## Domain Concepts

Operator surface, Observation, Gate health, Coordination lock, Prune preview,
Machine-readable rendering, Exit status.

## Approach and Tradeoffs

Verified: `statusGate` reconciles desired against actual state and returns
`healthy`, `degraded`, or `broken`; `lifecycle.mjs` appends a Lifecycle event in
`updateGate`, `deactivateGate`, `uninstallGate`, `confirmConfigurationCleanup`,
and `confirmRepair` — and deliberately appends none in `statusGate`. Observation
already writes nothing; nothing in this slice may change that.

Verified: the existing smoke capabilities already carry the dual-rendering
idiom — `process.argv.includes('--json')` in `gate-activation-smoke.mjs:1769`
and `gate-adapter-conformance.mjs:1138`. This slice does not invent a
convention; it applies the repository's own.

Proposed — one surface, two readers. A single command implementation renders
either a human summary or, with `--json`, a machine-readable document. The same
code path produces both, so an agent and a maintainer never observe different
things. The implementer confirms the JSON document is stable enough to parse:
named fields, no prose-only signals.

Proposed — three observation commands to establish the surface: report health,
inspect the coordination lock, and preview a prune. Each already has a seam —
`statusGate`, `inspectCoordination`, `previewEvidencePrune` — and none of them
writes. The implementer confirms each seam's real argument shape from the
executed path rather than from this ticket.

Proposed — an exit status an agent can branch on without parsing. Distinguish
at minimum "ran and the clone is healthy", "ran and the clone is not healthy",
and "could not run". A clone that is `broken` is not a failed invocation, and
conflating the two would make every agent parse prose to recover the difference.

Proposed — refuse to be a lifecycle back door. This surface exposes no
mutation, not even behind a flag, and `--recover`, `--confirm`, and every
destructive selector belong to `TB-041`. A preview here is a preview: it returns
a confirmation token and does not accept one.

Deliberately not an interactive prompt, anywhere. A prompt is exactly what would
lock an agent out of the surface, and both callers matter equally. Deliberately
not a new dependency: argument parsing stays within what the repository already
uses.

## Architecture Boundary and Public Seam

The boundary is between the lifecycle library and everything that is not a
test. The public seam is the command surface itself — its argument grammar, its
two renderings, and its exit statuses — with the lifecycle functions unchanged
behind it.

First red test: running the observation command against an activated fixture
clone reports its health and writes nothing, where today no such command exists.

## Safeguards and Invariants

- `SG-LIFE-001`: observation never repairs drift, never deletes, and never
  writes. Proved by comparing the whole clone and the whole Evidence store
  before and after every command this slice adds.
- `FR-LIFE-009`: `status` reports `healthy`, `degraded`, or `broken` and records
  no Lifecycle event — not even a `drift-detected` one.
- `SG-EVID-001`: a prune preview removes nothing and appends nothing.
- `SG-TRUST-001`: the surface states the local trust boundary rather than
  implying the Gate resists the machine owner.
- `NFR-PORT-002`: no operating-system-labelled product logic in the surface.
- Nothing in the evaluation runtime changes: `gate-precommit.mjs`,
  `gate-preflight.mjs`, snapshot capture, adapters, and decisions are untouched.

## Prohibited Behavior and Non-goals

Do not expose any mutating operation, including behind a flag, an environment
variable, or a `--force`. Do not accept a confirmation token. Do not add
interactive prompting, a TUI, colour that carries meaning on its own, or a
progress spinner. Do not change any function in `lifecycle.mjs` — this slice
calls them. Do not add a runtime dependency for argument parsing. Do not touch
`activate`, `repair`, `update`, `deactivate`, `uninstall`, `cleanup`, or
`fix`. Do not change the evaluation runtime in any way.

## Risk and Decision Impacts

- `RISK-004`: adapter or client loss is reported rather than repaired, and this
  surface is how a maintainer would see it at all.
- No disposition changes. Every lifecycle rule keeps its current behavior; what
  changes is that a human and an agent can reach the read-only half of it.

## Acceptance Criteria

- [ ] `FR-LIFE-009`, `AC-LIFE-004`: the health command reports `healthy`,
  `degraded`, and `broken` against fixtures that produce each, and every one of
  those runs leaves the clone and the Evidence store byte-for-byte unchanged.
- [ ] `NFR-OPER-001`: `--json` returns a parseable document naming the same
  findings the human rendering shows, from the same run — proved by asserting
  both renderings of one invocation agree.
- [ ] `AC-COORD-001`, `FR-COORD-005`: the lock command reports a free lock, a
  live holder, and a stale holder, and recovers nothing in any of those cases.
- [ ] `AC-EVID-002`, `SG-EVID-001`: the prune preview names the exact blobs and
  bytes a prune would remove, returns its confirmation token, removes nothing,
  and appends nothing.
- [ ] An unhealthy clone and a failed invocation are distinguishable by exit
  status alone, without reading output.
- [ ] The surface refuses every mutating selector, flag, and confirmation token
  it is given, and says which operation owns it.
- [ ] The evaluation runtime is unchanged, proved by the existing commit and
  preflight capabilities passing untouched.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `FR-LIFE-009`, `NFR-OPER-001`, `AC-COORD-001`: healthy/degraded/broken, free/live/stale lock, prune-preview, rendering-agreement, and mutation-refusal fixtures against the real surface | `npm run test:unit` | Yes — the unit suite owns the lifecycle library |
| smoke | both | `AC-LIFE-004`, `AC-EVID-002`: a real activated clone observed through the packaged command reports its health, and the clone and store are byte-for-byte unchanged afterwards | `gate-lifecycle-smoke`, extended by this slice | Yes — that capability already drives real activated clones |

Frontend build and browser evidence are inapplicable; this slice adds a local
command-line surface.

## Blocked By

None.

## Unresolved Assumptions

None.

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

## Why existing coverage missed this

Every lifecycle test calls the library function directly, which is the right
way to test a library and says nothing about whether anything can reach it. No
fixture has ever asked "what does a maintainer type", because the suite has
never needed a maintainer. The gap is not a missing assertion inside a test; it
is a missing subject the tests were never written against.
