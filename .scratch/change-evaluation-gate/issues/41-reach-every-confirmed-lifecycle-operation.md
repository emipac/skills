# TB-041 — Reach every confirmed lifecycle operation

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by: 40-let-a-maintainer-and-an-agent-observe-the-gate

Tracker ID: 41-reach-every-confirmed-lifecycle-operation
Draft key: TB-041

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

Every lifecycle operation that writes — recovering drift, taking a release,
removing the Gate, cleaning configuration, pruning evidence, recovering a stale
lock — is reachable by a maintainer and by an agent, always as a preview the
operator reads and a separate confirmation of that exact preview, and always
recorded.

## SRS Traceability

- `FR-LIFE-014`, `FR-LIFE-018`, `FR-LIFE-019`, `FR-EVID-004`, `FR-COORD-005`
- `AC-LIFE-005`, `AC-LIFE-007`, `AC-LIFE-010`, `AC-EVID-002`
- `SG-LIFE-001`, `SG-EVID-001`, `SG-HOOK-001`, `SG-TRUST-001`
- `NFR-REL-002`, `NFR-AUD-001`
- `RISK-004`, `RISK-010`

## Defect this contract fixes

`TB-040` makes the read-only half of the lifecycle reachable. The half that
writes is still reachable only from tests: `confirmRepair`, `updateGate`,
`deactivateGate`, `uninstallGate`, `confirmConfigurationCleanup`,
`confirmEvidencePrune`, and stale-lock recovery.

The practical case is the one this project has already met. A clone whose
managed hook block is clobbered reports `broken`, and `gate repair` would
restore exactly the registration the Activation receipt authorizes. Today
neither the maintainer nor an agent can run it, so the only recovery available
is to re-activate — a heavier operation that does more than the situation needs.

Verified: `inspectCoordination` already returns `action: 'gate locks --recover'`
for a stale held lock (`lifecycle.mjs:1332`), instructing an operator to run a
command that has never existed.

Verified: every mutating lifecycle operation already appends a Lifecycle event —
`updateGate` at `lifecycle.mjs:210`, the three removal paths at `:584`, `:807`,
and `:1037`, and `confirmRepair` at `:1224`. Making these reachable therefore
makes them *more* legible, not less: an operation run through this surface
leaves a durable record, where the bespoke script an agent writes today may
leave none.

## Domain Concepts

Preview, Confirmation token, Compensating action, Lifecycle event, Drift
recovery, Conservative removal, Stale-lock recovery.

## Approach and Tradeoffs

Verified: each operation already implements preview-and-confirm as two library
functions, and `TB-036` bound each confirmation to the filesystem rather than to
the caller's object. This slice adds no safety property; it exposes the ones
already built.

Proposed — two invocations, never one. Preview and confirmation are separate
runs of the command, and the surface refuses any invocation that would both
propose and perform. A single call that previewed and confirmed in one step
would put the decision inside the process rather than with the operator, which
is the property every one of these operations was designed around. This does not
stop a determined caller from running both commands back to back, and it is not
meant to: it means no single command destroys anything.

Proposed — the confirmation is the token, and the token comes from the preview.
The operator passes back the token they were shown, exactly as
`framework-setup`'s migration already works
(`configure.mjs --migrate-v4 --confirm` followed by the preview hash). The implementer follows
that established idiom rather than inventing a second one, and confirms what
each operation's preview actually returns before designing its flag.

Proposed — record what this surface did, using what already records it. No new
event type, no new store, no parallel log. The implementer confirms each
operation's existing Lifecycle event is appended when driven through the
surface, and that a refusal is recorded as a refusal rather than silently.

Proposed — an agent may run all of it. The threat this raises is real and is
accepted deliberately: an agent blocked by a failing check could deactivate the
Gate and commit. It is accepted because the Gate is already cooperative —
`SG-TRUST-001` states it does not resist the machine owner, and `--no-verify`
has always been one flag away — and because an operation run here is recorded,
where a hand-rolled script is not. The surface must not pretend otherwise: it
states the trust boundary rather than implying enforcement it does not have.

Deliberately not activation. `gate activate` needs a decision this contract does
not contain — see Blocked By — and re-activation is not the recovery path for
drift that `repair` already handles.

Deliberately not a transaction framework, a retry policy, or an undo. Each
operation keeps exactly the compensations it has.

## Architecture Boundary and Public Seam

The boundary is between an operator's decision and a lifecycle write. The public
seam is the pair of invocations each operation exposes — the preview and its
separate confirmation — and the refusal returned when a confirmation does not
reproduce the preview it names.

First red test: a confirmation that names a preview the clone no longer matches
performs no write and returns a stated refusal, driven through the command
surface rather than through the library.

## Safeguards and Invariants

- `SG-LIFE-001`: every removal stays conservative — only unchanged Gate-owned
  state, refusing the whole operation rather than half-performing it. Drifted,
  shared, global, and historical state is left alone.
- `FR-LIFE-019`: drift changes only through a confirmed repair or an Activation
  transaction. Nothing here repairs implicitly, and observation stays read-only.
- `SG-EVID-001`: pruning removes only previewed blobs and preserves envelopes,
  decisions, bypass records, Lifecycle events, pruning records, and tombstones.
- `SG-HOOK-001`: repair restores only the registration the receipt authorizes,
  and rewrites no part of a file the Gate does not own.
- `NFR-REL-002`: a refusal happens before any mutation, never partway through.
- `SG-TRUST-001`: the surface states the local trust boundary rather than implying
  enforcement the Gate does not have, and exposing these operations to an agent
  changes nothing about what that boundary already was.
- `NFR-AUD-001`: every operation performed through this surface is recorded by
  the Lifecycle event its library function already appends.
- The evaluation runtime is untouched: hooks, adapters, snapshots, and decisions
  behave exactly as they do today.

## Prohibited Behavior and Non-goals

Do not implement `gate activate` or resumption — a separate contract owns them.
Do not implement `gate fix`; mutating a maintainer's working tree is a different
risk profile and a different contract. Do not add a flag that previews and
confirms in one invocation, and do not add `--yes`, `--force`, or any bypass of
the token. Do not change any function in `lifecycle.mjs`. Do not add a new
event type, store, or log. Do not make any operation automatic, scheduled, or
retryable. Do not repair drift as a side effect of `update`.

## Risk and Decision Impacts

- `RISK-004`: adapter loss stays a reinstall rather than a repair; this surface
  reports it as unrepairable rather than attempting it.
- `RISK-010`: Evidence growth is accepted on the basis that removal is
  deliberate and audited. This makes deliberate removal possible for the first
  time, which is what the disposition assumed.
- `SG-TRUST-001` is unchanged and now stated at the surface: exposing these
  operations to an agent does not weaken a boundary that was already
  cooperative.

## Acceptance Criteria

- [ ] `FR-LIFE-019`, `AC-LIFE-010`: a clone with a clobbered managed hook block
  is restored by a confirmed repair to exactly what the receipt authorizes, and
  is left unrepaired by every other command this surface exposes.
- [ ] `NFR-REL-002`: for every operation, a confirmation that does not reproduce
  its preview performs no write and returns a stated refusal — proved by
  comparing the whole clone and store before and after.
- [ ] The surface refuses any single invocation that would both preview and
  confirm, and says why.
- [ ] `AC-LIFE-005`: deactivation removes only unchanged Gate-owned
  registrations and the receipt; uninstall removes only project assets and
  preserves shared configuration, global assets, and all historical Evidence.
- [ ] `AC-LIFE-007`, `FR-LIFE-014`: an ordinary distribution bump changes
  nothing until a confirmed update, and a failed update preserves the previous
  Active gate release.
- [ ] `AC-EVID-002`: a confirmed prune removes only previewed blobs and writes
  their tombstones; `FR-COORD-005`: a stale lock is recovered only against its
  own recovery token, and a live one is never taken.
- [ ] `NFR-AUD-001`: every operation performed and every refusal returned is
  recorded as a Lifecycle event, and `status` still records none.
- [ ] The evaluation runtime is unchanged, proved by the existing commit and
  preflight capabilities passing untouched.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-LIFE-010`, `AC-LIFE-005`, `AC-EVID-002`: stale-preview, single-invocation-refusal, clobbered-hook, removal, update-failure, prune, and stale-lock fixtures driven through the surface, and `AC-LIFE-007`: a distribution bump changes nothing until a confirmed update | `npm run test:unit` | Yes — the unit suite owns the lifecycle library |
| smoke | both | `AC-LIFE-010`, `NFR-AUD-001`: a real activated clone whose hook block is clobbered is repaired through the packaged command, commits exactly as before, and carries a Lifecycle event for the repair | `gate-lifecycle-smoke`, extended by this slice | Yes — that capability already drives real activated clones and real drift |

Frontend build and browser evidence are inapplicable; this slice adds local
command-line operations.

## Blocked By

- `40-let-a-maintainer-and-an-agent-observe-the-gate` — the command surface,
  its two renderings, and its exit statuses are established there and are not
  redesigned here.

`gate activate` is deliberately absent: `runActivation` destructures
`establishTrust`, `selfTestEvaluation`, and `selfTestAdapter` with no defaults
(`activation.mjs:1505-1509`), so an activation surface must author three
behaviors the library left abstract — and what client-controlled trust means for
a clone with no desktop client is an open product decision, not an
implementation detail.

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

The lifecycle suite proves each operation behaves correctly when called with
well-formed arguments, which is what a library test is for. Nothing has ever
asked whether an operator could assemble those arguments, or whether the
preview a caller holds could survive a round trip through a shell. Both
questions are invisible to a test that constructs the preview object and passes
it straight back in the same function scope.
