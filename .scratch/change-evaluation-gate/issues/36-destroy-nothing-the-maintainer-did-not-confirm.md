# TB-036 — Destroy nothing the maintainer did not confirm

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 36-destroy-nothing-the-maintainer-did-not-confirm
Draft key: TB-036

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

Every destructive operation removes exactly what the maintainer saw and
confirmed, verified against the files as they are at the moment of removal. A
preview handed back to the gate is treated as a claim to be re-established, not
as an instruction to be obeyed.

## SRS Traceability

- `FR-LIFE-007`, `FR-LIFE-016`, `FR-EVID-004`
- `AC-LIFE-008`, `AC-EVID-002`, `AC-ADAPT-003`
- `SG-LIFE-001`, `SG-EVID-001`, `SG-HOOK-001`
- `NFR-REL-002`
- `RISK-010`

## Defect this contract fixes

Raised by an external audit of `HEAD` `9569362` as a `P0`: *"destructive
confirmations trust caller-mutated preview objects. Configuration cleanup can
delete unintended lines, while evidence pruning has an analogous
forged-preview/path-containment risk."* A related `P1`: *"adapter registration
can replace incompatible existing client configuration and lose concurrent
edits."*

The pattern is one mistake in three places. A destructive operation takes a
preview object from its caller, matches a confirmation hash *against that
object*, and then acts on the object's contents. The hash proves the caller
handed back the same object it was given — it proves nothing about whether that
object still describes the files on disk, and nothing at all if the caller
composed the object itself.

Three consequences, in ascending order of how easy they are to reach:

- **Evidence pruning** removes blob paths named in the preview. A preview whose
  paths were altered removes something else, and path containment under the
  store root is not re-established at removal.
- **Configuration cleanup** deletes lines identified in the preview. A preview
  built after the file changed — or built by the caller — deletes lines the
  maintainer never saw.
- **Adapter registration** rewrites a client configuration file whose shape no
  longer matches what the declaration expects, replacing content it does not
  own, and a concurrent edit between read and write is lost.

For this product the caller is very often an AI agent invoking the skill on the
maintainer's behalf. That is not a hostile-actor scenario; it is the ordinary
one, and it is exactly why the confirmation has to bind to the filesystem
rather than to an object the agent is holding.

`SG-EVID-001` already requires that pruning remove only previewed blobs.
`SG-HOOK-001` already requires that registration never rewrite a part of a
client configuration file the adapter does not own. Both hold in the code that
computes previews; neither is re-established where the removal happens.

## Domain Concepts

Preview, Confirmation, Compensating action, Evidence blob, Tombstone, Adapter
registration surface, Ownership.

## Approach and Tradeoffs

**Recompute the preview at confirmation, and compare.** The confirmation names
what the maintainer approved; the operation re-derives the preview from the
current filesystem and proceeds only when the two agree. A file that changed
between preview and confirmation stops the operation with a stated reason and
an instruction to preview again — which is also the correct answer when an
editor or another process touched it. This is the one change that makes all
three cases safe, because it removes the caller's object from the trust path
entirely.

**Bind to path and content, not to a hash of a payload.** Every path a
destructive operation touches is re-established as contained within the
directory that operation owns — the store root for pruning, the configuration
file for cleanup — at the moment of the write, not only when the preview was
built.

**Refuse an incompatible shape; never replace it.** A client configuration file
whose structure does not match the adapter's declaration is `unverified` and
left alone. `SG-HOOK-001` says the Gate does not rewrite what it does not own,
and "the shape is unfamiliar" is precisely the case where it does not know what
it owns.

**Write against what was read.** Registration re-reads the file immediately
before writing and refuses if it changed since the read the plan was built
from, so a concurrent edit is reported rather than silently overwritten.

**Deliberately not a locking protocol.** No cross-process lease, no file
locking, no CAS layer. Re-read, compare, refuse — the smallest thing that
converts silent loss into a stated refusal, which is all a single-developer
workflow needs.

## Architecture Boundary and Public Seam

The boundary is between a confirmation a maintainer granted and the bytes a
destructive operation removes or replaces. The public seam is the
recompute-and-compare step each destructive path performs, and the refusal it
returns when the recomputed preview disagrees.

First red test: a prune confirmation whose preview object was altered after it
was produced removes nothing and returns a stated refusal — where today it
removes what the altered object names.

## Safeguards and Invariants

- `SG-EVID-001`: only previewed blobs are removed, and "previewed" now means
  agreed by a preview recomputed at removal. Envelopes, decisions, bypass
  records, Lifecycle events, pruning records, and tombstones are preserved.
- `SG-HOOK-001`: registration never rewrites a part of a client configuration
  file the adapter does not own, and never replaces a shape it cannot confirm.
- `SG-LIFE-001`: an operation that refuses leaves the clone exactly as it was.
- `NFR-REL-002`: writes stay atomic; a refusal happens before any mutation
  rather than partway through one.
- `FR-EVID-004`: pruning stays manual, preview-first, and confirmation-bound.
  Nothing here makes any removal automatic.

## Prohibited Behavior and Non-goals

Do not add file locking, leases, or a CAS layer. Do not make any destructive
operation automatic or retryable. Do not change what a preview selects, the
pruning selectors, or the ceilings. Do not repair or normalize an incompatible
client configuration file — refuse it. Do not extend this to Git's own hook
files beyond what `SG-HOOK-001` already governs.

## Risk and Decision Impacts

- `RISK-010`: evidence growth is accepted on the basis that removal is
  deliberate and audited. A removal driven by an object the caller controls is
  neither.
- No disposition changes. Every destructive operation keeps its preview and
  confirmation; what changes is that the confirmation now binds to the
  filesystem.

## Acceptance Criteria

- [ ] `AC-EVID-002`, `SG-EVID-001`: a prune whose preview object was altered
  after production removes nothing and returns a stated refusal; an unaltered
  preview still prunes exactly the blobs it named and writes their tombstones.
- [ ] `AC-EVID-002`: a prune whose store contents changed between preview and
  confirmation refuses with a reason directing the operator to preview again,
  and removes nothing.
- [ ] `AC-LIFE-008`, `SG-LIFE-001`: configuration cleanup whose file changed
  between preview and confirmation removes nothing and says so; an unchanged
  file is cleaned exactly as previewed.
- [ ] Every path a destructive operation writes to or removes is re-established
  as contained within the directory that operation owns, at the moment of the
  write.
- [ ] `AC-ADAPT-003`, `SG-HOOK-001`: a client configuration file whose shape
  does not match the adapter's declaration is reported `unverified` and left
  byte-for-byte unchanged; a file edited between read and write is refused
  rather than overwritten.
- [ ] Every refusal added here leaves the clone byte-for-byte as it was, proved
  by comparing the whole affected file or directory before and after.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-EVID-002`, `AC-LIFE-008`, `AC-ADAPT-003`: altered-preview, changed-file, escaping-path, incompatible-shape, and concurrent-edit fixtures against the real destructive paths | `npm run test:unit` | Yes — the unit suite owns pruning, cleanup, and registration |
| smoke | both | `AC-EVID-002`: a real store pruned through the packaged path removes only previewed blobs and refuses an altered preview, leaving every other file unchanged | `gate-evidence-prune-smoke`, extended by this slice | Yes — that capability owns real pruning against a real store |

Frontend build and browser evidence are inapplicable; this slice changes local
destructive operations.

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

Every destructive fixture produces a preview and hands that exact object back,
which is the cooperative path. The confirmation is therefore proved to match
what it was given and never proved to describe what is on disk — a distinction
invisible to any test that never separates the two. `AC-EVID-002` is satisfied
by fixtures that mismatch the *confirmation string*, not the preview contents,
so the one input that matters here has never been varied.
