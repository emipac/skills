# TB-026 — Persist the Evidence the authoritative decision is made from

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: done, defect
Blocked by:
Tracker ID: 26-persist-evidence-for-the-authoritative-decision
Draft key: TB-026

**Status:** done

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A refused commit leaves a record. The one evaluation that actually gates work —
the authoritative `commit-attempt` — appends its immutable, bounded, redacted
Evidence envelope and its Lifecycle event to the clone-local store, so a
maintainer can say afterwards what was graded, which command produced which
attempt, and why authorization was withheld.

## SRS Traceability

- `FR-EVID-001`, `FR-EVID-002`, `FR-EVID-003`, `FR-EVID-005`, `FR-EVAL-001`
- `AC-EVID-001`, `AC-EVID-002`, `AC-EVAL-001`
- `SG-EVID-001`, `SG-SECRET-001`, `SG-TRUST-001`
- `NFR-AUD-001`, `NFR-REL-003`
- `RISK-001`, `RISK-006`

## Defect this contract fixes

Found while answering a maintainer's question about what an activated clone
records. `evaluate` persists evidence through
`persistEvidence(decision, { store: dependencies.evidenceStore ?? null, ... })`
(`evaluate.mjs:616`). **`runHook` never passes an `evidenceStore`**
(`hook-runner.mjs:401`), so every commit-time evaluation resolves that
dependency to `null` and appends nothing: no envelope, no log line, no blob, no
Lifecycle event.

The store itself is fully built and exercised — `gate-evidence-prune-smoke`,
`gate-fix-smoke`, and the evidence suites all drive it — but every one of them
constructs its own store and calls `evaluate` directly. The authoritative path
is the only caller that reaches a real maintainer, and it is the one caller that
writes nothing.

Two consequences, both reproduced against the shipped code:

- A denied commit is explained once, on stderr, in the terminal that ran
  `git commit`. Scroll it away and the reasoning is gone. There is nothing to
  point at afterwards, nothing to compare a later run against, and nothing an
  auditor can read — while `FR-EVID-005` requires an evaluation to leave an
  immutable Lifecycle event and `NFR-AUD-001` requires governed actions to be
  reconstructable.
- The runner also executes checks with output capture off
  (`createBoundedExecutor` defaults `captureOutput: false`,
  `bounded-execution.mjs:77`, and `hook-runner.mjs:393` does not enable it), so
  even the failing command's output is discarded. The denial names a check and
  a reason code; what the tool actually printed is lost.

`RISK-001`'s stated mitigation is exact command evidence. A gate that decides
correctly and records nothing does not carry that mitigation at the only moment
it matters.

## Domain Concepts

Evidence envelope, Evidence store, Lifecycle event, Evidence ceilings,
Redaction, Bounded execution, Activation receipt.

## Approach and Tradeoffs

**Open the store the receipt already identifies.** The hook resolves the Git
common directory and reads the receipt before it evaluates; the same identities
— gate, client `git` / `git-pre-commit`, repository identity, best-effort
unauthenticated actor — open the store. The ceilings come from the clone's own
`evaluation_gate.evidence` policy section, which `resolveEvidenceLimits` already
reads, so a project that lowered its limits keeps them at commit time.

**Capture what the checks printed.** Bounded execution captures output when
asked to, and the envelope's whole purpose is to retain a bounded, redacted
excerpt of it. Enable capture on the authoritative path so the envelope carries
evidence rather than a record that something failed.

**Evidence that cannot be written is `unverified`.** A store that cannot be
opened, an append that fails, or output that redaction cannot make safe leaves
an evaluation whose reasoning cannot be reconstructed. That is the failure
family the SRS already settled: `NFR-REL-003` normalizes every harness failure
to `unverified`, and `SG-SECRET-001`'s mitigation says in as many words to
return `unverified` when safe handling cannot be proved. So this path takes a
stable reason code inside that family rather than inventing a parallel refusal,
and policy turns the `unverified` required check into the denial. The decision
is never quietly downgraded to an unrecorded allow.

**Nothing about the store's contract changes.** Appends stay atomic and
append-only, redaction stays ahead of bounding and content addressing, pruning
stays manual and preview-bound. This slice adds one caller, correctly wired.

## Architecture Boundary and Public Seam

The boundary is between the authoritative runner and the existing Evidence
store; neither the store's shape nor the envelope's contract moves. The public
seam is `runHook`'s use of `openEvidenceStore`, the captured output it now
supplies, and the refusal reason a clone gets when evidence cannot be persisted.

First red test: a denied commit in an activated throwaway clone leaves exactly
one envelope whose attempts name the required check and carry its bounded output,
and exactly one Lifecycle event recording the outcome — where today the store is
empty after the same commit.

## Safeguards and Invariants

- `SG-SECRET-001`: output is redacted before it is bounded, addressed, or
  written, and a residual finding refuses the capture rather than storing it.
  Commit-time output is the most sensitive the gate handles; it gets the same
  treatment as every other path, not a shortcut.
- `SG-EVID-001`: the store stays append-only. This slice removes nothing,
  rewrites nothing, and adds no automatic retention.
- `FR-EVID-002`: the store lives under the resolved Git common directory, so
  every linked worktree of one clone shares one history and nothing is written
  into tracked source.
- `NFR-REL-003`: an evaluation whose evidence could not be persisted is not an
  authorization. It denies with a stated reason.
- `SG-TRUST-001`: the store remains cooperative local state. Persisting a record
  is not a claim that a machine owner cannot edit it.

## Prohibited Behavior and Non-goals

Do not change the envelope shape, the ceilings, the redaction rules, or the
pruning contract. Do not add automatic deletion or retention. Do not build the
preflight runner or its invocation — `FR-EVID-001` covers every evaluation,
preflight included, so `TB-025` reaches the store through the wiring this slice
establishes rather than through a second copy of it. Do not write evidence
during the activation self-test, which
runs against a throwaway subject and must leave the clone untouched. Do not
build the `gate` lifecycle command surface, and do not add a reporting or
`gate evidence` view: this slice writes the record, it does not present it.

## Risk and Decision Impacts

- `RISK-001`: exact command evidence is the accepted mitigation for local,
  bypassable enforcement. This slice is what makes that mitigation exist on the
  authoritative path; no disposition changes.
- `RISK-006`: evidence growth is the accepted counterweight, and it is already
  bounded by the v1 ceilings and the clone's own policy. Commit-time evidence
  makes those ceilings load-bearing rather than theoretical, which is the
  intended shape, not a new exposure.

## Acceptance Criteria

- [x] `AC-EVID-001`, `AC-EVAL-001`: a denied commit in an activated clone
  appends exactly one Evidence envelope whose attempts name the failing required
  check and carry its bounded output, and one log entry referencing it; an
  allowed commit does the same for its passing checks.
- [x] `AC-EVID-002`, `FR-EVID-005`, `NFR-AUD-001`: each commit-time evaluation
  appends exactly one immutable Lifecycle event recording time, actor, client,
  gate and repository identity, outcome, and reason — one governed action, one
  event.
- [x] `SG-SECRET-001`: a check whose output contains a secret-shaped value
  stores the redacted form, and a capture that cannot be made safe is refused
  rather than written. The declared-secret redaction path is proved fresh at
  this integration point (a runtime input the receipt names, printed by a real
  check, denied from reaching the envelope); the unsafe-capture refusal itself
  is the generic mechanism `evaluate.mjs` and `evidence-store.mjs` already own
  and `tests/gate-evidence-secrets.test.mjs` and `gate-evidence-prune-smoke`
  already prove, and wiring a real `evidenceStore` through means the
  authoritative path now inherits it rather than needing a second proof of it.
- [x] `FR-EVID-003`: the ceilings applied are the clone's own
  `evaluation_gate.evidence` limits where it sets them, and the v1 defaults
  where it does not.
- [x] `NFR-REL-003`: a store that cannot be opened or appended to denies the
  commit with a distinct stated reason, and never allows an unrecorded commit.
- [x] The activation self-test writes no evidence and leaves no store entry, so
  proving the program still touches nothing in the clone.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-EVID-001`, `AC-EVID-002`, `SG-SECRET-001`, `NFR-REL-003`: envelope, log, lifecycle-event, redaction, ceiling, and store-failure fixtures against the authoritative runner | `npm run test:unit` | Yes — configured unit suite owns the runner and the evidence contract |
| smoke | both | `AC-EVAL-001`, `AC-EVID-001`: after a real denied and a real allowed `git commit` in an activated throwaway clone, the clone-local store holds the envelopes, the referenced output, and the Lifecycle events those two decisions produced | `gate-activation-smoke` capability extended by this slice | Yes — it is the only capability that drives real commits through the registered hook |

Frontend build and browser evidence are inapplicable; this slice changes local
process persistence, not a frontend surface.

## Blocked By

None. `TB-008` delivered the bounded immutable store and `TB-018` delivered the
packaged runner; this ticket connects the two.

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

Every evidence fixture and capability constructs its own store and calls
`evaluate` directly, so the store has been proved thoroughly and the wiring
never has. `gate-activation-smoke` drives real commits and reads its store — but
only for the Activation receipt and the activation Lifecycle event, both written
by the transaction rather than by the commit. Store and runner were each correct
in isolation; nothing asked whether the runner reached the store. That is the
same shape as `TB-023` and `TB-024`: a failure sitting between a component and
the runtime that consumes it.
