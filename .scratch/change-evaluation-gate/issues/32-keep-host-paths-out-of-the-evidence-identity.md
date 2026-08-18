# TB-032 — Keep host paths out of the stored envelope, and let it state that it was stored

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 32-keep-host-paths-out-of-the-evidence-identity
Draft key: TB-032

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

Two evaluations of the same change on the same clone produce one stored
envelope, not one per temporary directory — and an envelope on disk states that
it is on disk. The evidence identity stays a function of what was evaluated,
all the way through the store.

## SRS Traceability

- `FR-EVID-001`, `FR-EVID-002`, `FR-EVID-004`
- `AC-EVID-001`, `AC-EVID-002`
- `SG-EVID-001`
- `NFR-REL-001`, `NFR-AUD-001`
- `RISK-006`

## Defect this contract fixes

Found while reviewing recorded evidence from real runs in `gms`
(`real-project-evidence/change-evaluation-gate/evidence/`). Two independent
findings, both in what the store writes.

### 1. The host temporary path leaks into the stored envelope

`buildDecision` is deliberate about this:

> The host-local execution root is excluded from the evidence identity: it names
> where the snapshot was materialized on this machine, not what was evaluated,
> so including it would make an identical binding produce a different evidence
> identity (`NFR-REL-001`).

So `decision.evidence.id` correctly excludes it. But the store addresses the
envelope by `contentIdentity(envelope)`, and the envelope embeds the whole
decision — including `decision.snapshot.executionRoot`, which is a per-run
`mkdtemp` path. The exclusion is undone one layer down.

The preserved evidence shows the consequence exactly. Five preflight runs of
byte-identical content share one `evaluationId`
(`sha256:e78a0f52…`) and one `evidence.id`, and produced **five distinct
envelope files** differing only in strings like
`gate-preflight-exec-uB9ozI` versus `gate-preflight-exec-OEhA53`. Eight
envelopes are stored for four logically distinct evaluations.

The effects are small individually and compound: an append-only store grows per
*run* rather than per *evaluation*; an auditor comparing two envelopes cannot
see they record the same thing; content addressing silently stops deduplicating
the record it was designed to deduplicate (`RISK-006`'s growth counterweight
depends on it); and every stored envelope carries a host filesystem path that
describes the machine rather than the change.

### 2. Every stored envelope says it was not stored

All eight envelopes contain:

```json
"evidence": { "persisted": false, "reference": null }
```

The record of a decision, inside the store, states that the decision was never
recorded. `persistEvidence` fills `persisted: true` and the reference on the
*returned* copy, after the envelope bytes have been written, so the stored copy
can only ever say `false`.

It is structurally circular — the reference contains the identity of the
envelope being written — and the codebase has already solved exactly this
circularity once. `HOOK_RECEIPT_PLACEHOLDER` in `activation.mjs` breaks the
same cycle between a registration and the receipt that authorizes it, by
hashing with the one self-referential value replaced by a constant, and states
plainly why. The same technique applies here.

`NFR-AUD-001` requires governed actions to be reconstructable from these
records. A field that is false in every stored record, and true only in a
value that was never persisted, is a small lie in an audit trail — and it is
the kind an auditor reasonably reads as "evidence was lost".

## Domain Concepts

Evidence envelope, Evidence identity, Content addressing, Execution root,
Evidence store, Lifecycle event, Pruning record.

## Approach and Tradeoffs

**The envelope records what was evaluated, not where it was materialized.** The
execution root is host-local scaffolding; the decision already carries the
snapshot identity, which is the reproducible statement of what was graded. The
stored decision should carry the same normalization `evidence.id` already
applies, so the identity the decision computes and the identity the store
assigns describe the same thing.

**Losing the path entirely is the wrong trade.** The execution root is genuinely
useful while a maintainer is debugging a run — every diagnosis in this
investigation used it. It belongs where run-local facts belong: the Lifecycle
event, or a retention field, both of which are already per-append and neither
of which is content-addressed. Deciding which is an implementation call worth
recording.

**Break the self-reference the way this codebase already breaks it.** Use the
established placeholder technique so the stored envelope can state
`persisted: true` and name its own store, while the identity remains computable
before the envelope exists. What must not happen is a second identity scheme:
one rule, one placeholder convention, stated once.

**Nothing about the store's contract moves.** Appends stay atomic and
append-only, redaction stays ahead of addressing, ceilings are unchanged, and
pruning stays manual and preview-bound. Deduplication becoming real is the
store behaving as specified, not a new behaviour.

**Existing envelopes stay readable.** The store is append-only and versioned;
records written before this change keep their shape and must still be read,
pruned, and audited. If the change alters what a stored envelope looks like,
the store version says so.

## Architecture Boundary and Public Seam

The boundary is between the decision a runner produces and the bytes the store
addresses and writes. The public seam is the normalization applied to the
stored decision, the placeholder convention that lets an envelope state its own
persistence, and the location the execution root is recorded instead.

First red test: two evaluations of identical content in one clone, differing
only in their `mkdtemp` execution roots, append **one** envelope and two log
entries referencing it — where today they append two envelopes.

## Safeguards and Invariants

- `NFR-REL-001`: an identical binding produces an identical evidence identity,
  through the store as well as in the decision.
- `SG-EVID-001`: append-only. Nothing is rewritten, nothing is deleted, and a
  re-append of identical evidence remains the no-op the store already intends.
- `NFR-AUD-001`: every governed action still leaves exactly one Lifecycle
  event, and the record an auditor reads is true about its own persistence.
- `FR-EVID-004`: pruning, tombstones, and their previews continue to work
  against both older and newer envelopes.
- `SG-SECRET-001`: redaction still runs before bounding, addressing, and
  writing. Normalizing a path changes nothing about that order.

## Prohibited Behavior and Non-goals

Do not change the retention ceilings, the redaction rules, the blob addressing,
or the pruning contract. Do not delete or rewrite existing envelopes. Do not
remove the execution root from the runner's diagnostics or from stderr, where a
maintainer needs it. Do not introduce a second content-identity scheme, and do
not make the envelope's identity depend on anything a different machine could
not reproduce. Do not extend this to the Activation receipt, which is current
state rather than history and is out of scope.

## Risk and Decision Impacts

- `RISK-006`: bounded evidence growth is the accepted counterweight to
  retaining output. Per-run envelope duplication is unbounded growth the
  ceilings do not cover, because the ceilings bound blobs rather than
  envelopes.
- `Q-008`'s retention answer is unchanged: no automatic deletion, manual
  preview-bound pruning only. This slice stops creating duplicates; it removes
  nothing.

## Acceptance Criteria

- [ ] `NFR-REL-001`, `AC-EVID-001`: two evaluations of identical content in one
  clone, materialized into different temporary directories, append exactly one
  envelope, and the log records both appends referencing that one envelope.
- [ ] `FR-EVID-001`, `NFR-AUD-001`: a stored envelope states that it was
  persisted and names its own evidence identity, and that statement is
  consistent with the decision the caller received.
- [ ] `NFR-REL-001`: no stored envelope contains a host-local execution-root
  path; the run-local path remains available to a maintainer through the
  Lifecycle event or a retention field, and that location is recorded on
  completion.
- [ ] `SG-EVID-001`, `AC-EVID-002`: appends stay atomic and append-only, one
  Lifecycle event per append is unchanged, and existing envelopes written
  before this change remain readable, prunable, and auditable.
- [ ] `FR-EVID-004`: pruning previews, confirmations, and tombstones behave
  identically for a deduplicated envelope referenced by several evaluations.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `NFR-REL-001`, `AC-EVID-001`, `AC-EVID-002`: identical-content-different-temp-root deduplication, self-stating persistence, absence of host paths, backward-readability of an existing envelope, and pruning across a shared envelope | `npm run test:unit` | Yes — the unit suite owns the evidence store and the decision contract |
| smoke | both | `AC-EVID-001`: two real commit-time evaluations of identical content in an activated clone leave one envelope and two log entries | `gate-evidence-prune-smoke` extended by this slice | Yes — that capability owns retention and pruning behaviour against a real store |

Frontend build and browser evidence are inapplicable; this slice changes local
evidence persistence.

## Blocked By

None. `TB-026` wired the authoritative runner to the store and is what made
both findings observable in real evidence.

## Unresolved Assumptions

1. **Where the execution root is recorded instead.** The Lifecycle event and a
   per-append retention field are both non-addressed and both suitable. Decide
   during implementation and record the choice; not start-blocking.

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

The evidence fixtures assert that repeated evaluations append *distinct*
envelopes, which is exactly what a store fed genuinely different content should
do — and every fixture supplies a fresh execution root per run, so its content
always is different. Nothing ever evaluated identical content twice and asked
whether one record resulted. The `persisted` field was likewise only ever
asserted on the decision `evaluate` returns, never on the bytes the store
wrote, so the one place it is always false is the one place no test looked.
