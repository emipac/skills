# Bounded Evidence and Lifecycle event contract

The clone-local Evidence store, the fixed v1 retention ceilings, redaction at
the persistence boundary, manual preview-bound pruning, and the immutable
Lifecycle event record.

Serves `FR-EVID-001` … `FR-EVID-005`, `NFR-AUD-001`, `NFR-SEC-003`,
`AC-EVID-001`, `AC-EVID-002`, `SG-EVID-001`, `SG-SECRET-001`, `RISK-006`,
`RISK-010`, and `Q-008`.

## Where the store lives

The store is created under the resolved Git common directory, at
`<git-common-dir>/change-evaluation-gate/evidence`. Every linked worktree of one
clone therefore shares exactly one append-only local history, and nothing is
ever written into tracked source. The resolved common directory is canonicalized
so a linked worktree and the primary worktree agree on one store identity.

The store is cooperative local state. It is not tamper-proof and makes no such
claim: a machine owner can always edit these files (`SG-TRUST-001`).

| Path | Contents |
| --- | --- |
| `envelopes/<aa>/<identity>.json` | One canonical, content-addressed Evidence envelope |
| `blobs/<aa>/<digest>` | One redacted, content-addressed output blob |
| `log.ndjson` | Append-only index of every appended envelope |
| `events.ndjson` | Append-only immutable Lifecycle events |
| `bypass-ledger.ndjson` | Durable one-shot bypass consumption |
| `prunings.ndjson` | Every pruning attempt, confirmed or refused |
| `tombstones.ndjson` | One tombstone per removed referenced blob |
| `staging/` | Write-then-rename staging for atomic writes |

Envelopes and blobs are written through a staging file and one `rename`, so a
reader never observes a partial record. Index, event, ledger, pruning, and
tombstone records are single-line appends. Directories are created `0700` and
files `0600` where the platform supports it.

Per-common-directory serialization is a separate concern. Every mutating
operation is one atomic rename or one append, so a lock layers above this
contract without changing it.

## What an envelope carries

| Field | Meaning |
| --- | --- |
| `storeVersion` | `change-evaluation-gate/evidence/v2` |
| `evidenceId` | Content identity of the canonical envelope |
| `evaluationId` | The evaluation this envelope records |
| `decision` | The complete redacted decision envelope, with its run-local values elided and its own persistence stated |
| `redaction` | Redaction version, declared Sensitive input names and sources, applied rules, and redacted byte count |
| `retention.limits` | The effective inline, per-blob, and per-evaluation limits |
| `retention.violations` | Every configured limit that tried to exceed a fixed ceiling |
| `retention.attempts[]` | Per Check attempt: bounded inline excerpt, byte counts, blob outcome, redaction metadata |
| `retention.totals` | Attempt count and retained blob bytes for this evaluation |
| `blobs[]` | Retained blob identities, byte counts, and owning check and attempt |

Identity is canonical: key order never changes an envelope's identity, and
identical evidence addresses one envelope while the append-only log still
records each append.

## What an envelope is a function of

An evaluation identity is a function of what was evaluated (`NFR-REL-001`), so
values that describe one run on one machine are replaced by the stated constant
`<run-local>` before anything is hashed or written:

- the host-local execution root, in the field that names it and in every string
  that quotes it, including a check's own captured output and its inline
  excerpt;
- the wall-clock `durationMs` of each Check attempt;
- the store root and append instant inside the envelope's own evidence
  reference.

Two evaluations of identical content therefore address one envelope, however
many temporary directories they were materialized into, and the append-only log
still records one entry per append.

Nothing is lost. Every elided value is a fact about one append, so it is
recorded on that append's log entry, under `execution`: the `executionRoot` the
snapshot was materialized into and the `durationMs` of every attempt. Log
entries are per-append and never content-addressed. The decision the caller
receives is untouched: a maintainer reading a runner's diagnostics still gets
the real path and the real durations.

A stored envelope states its own persistence: `decision.evidence.persisted` is
`true` and `decision.evidence.reference.evidenceId` is the envelope's own
identity. That is self-referential, so the identity is computed with the
placeholder `<evidence-identity>` in that one position and the real value is
substituted into the bytes that are written — the same technique
`HOOK_RECEIPT_PLACEHOLDER` uses for the Activation receipt. A reader recomputes
the identity by putting the two unhashed values back (`envelopeIdentity`), which
answers correctly for `v1` and `v2` envelopes alike.

`v1` envelopes, written before this rule, carry the host execution root, real
durations, and `persisted: false`. They remain readable, prunable, and
auditable exactly as written; nothing rewrites them.

## Fixed v1 ceilings

Settled by `Q-008` and not negotiable at runtime:

| Limit | Ceiling |
| --- | --- |
| Inline redacted excerpt per Check attempt | 32 KiB |
| Retained output blob per attempt | 4 MiB |
| Retained output blobs per evaluation | 32 MiB |

A project may configure lower limits through `evaluation_gate.evidence`
(`inline_bytes`, `blob_bytes`, `evaluation_blob_bytes`). A configured higher
limit never takes effect and is recorded in `retention.violations` rather than
silently ignored.

Truncation is never silent. The retained excerpt preserves the beginning and the
end of the output, states inside the excerpt how many bytes were omitted, and
the envelope records `capturedBytes`, `retainedBytes`, and `omittedBytes`, which
always account for the whole redacted output. An attempt whose output exceeds
the per-blob ceiling still keeps its bounded excerpt; its blob is `omitted` with
`blob-limit-exceeded`. An attempt that would push the evaluation past the
per-evaluation ceiling is `omitted` with `evaluation-blob-limit-exceeded`.

Capturing output at all is opt-in at the executor: a check is graded by its exit
code, and only Evidence wants what it said. Capture is itself bounded to the
per-blob ceiling so a runaway writer cannot exhaust memory before the store
bounds and redacts it again.

## Redaction at the persistence boundary

Redaction runs before bounding, before content addressing, and before anything
reaches the filesystem. Declared Sensitive runtime inputs are redacted in their
raw, base64, base64url, hex, and percent-encoded forms; built-in patterns also
cover authorization headers, credential assignments, URL user info, and private
key blocks.

Only the name and the source of a Sensitive runtime input are recorded. Its
value never is.

Before anything is committed to disk the store rescans exactly what it is about
to write. If a declared value survives in any recognized form, nothing is
persisted, the append returns `unsafe-capture`, and the decision becomes
`unverified` with the `sensitive-capture-unsafe` reason code. Safe handling that
cannot be proved never produces a pass (`SG-SECRET-001`, `RISK-006`).

## Pruning

V1 never deletes evidence automatically. There is no retention job, no age
sweep, and no size trigger. Pruning is manual, preview-first, and blob-only.

1. **Preview.** `previewPrune` selects by evaluation (`evaluationIds`), by age
   (`appendedBefore`), or by desired reclaimed size (`reclaimBytes`), oldest
   first. It returns the exact blobs, their byte counts, their referencing
   evaluations, the total bytes, and a `confirmationToken` that is the content
   identity of that exact selection. A preview removes nothing.
2. **Confirm.** `confirmPrune` removes only what the preview identified, and
   only when the confirmation reproduces the token. A mismatch removes nothing,
   records a pruning record with `pruned: false` and `preview-mismatch`, and
   records a refused pruning Lifecycle event. It never records a successful
   deletion.

A confirmed prune removes output blobs and nothing else. Envelopes, decisions,
bypass records, Lifecycle events, pruning records, and tombstones are all
preserved. Every removed referenced blob leaves a tombstone naming its identity,
byte count, referencing evaluations, and owning pruning record, and the pruning
itself is recorded as its own Lifecycle event (`SG-EVID-001`).

Blobs are content-addressed, so one stored blob may be referenced by several
evaluations. Selection and byte accounting are per stored blob, and the tombstone
names every evaluation the removal touched.

## Lifecycle events

Configuration approval, activation, update, repair, removal, trust, evaluation,
bypass, pruning, stale-lock recovery, and detected drift each create exactly one
immutable local record (`FR-EVID-005`). Every event records:

| Field | Meaning |
| --- | --- |
| `eventVersion` | `change-evaluation-gate/lifecycle/v1` |
| `eventId` | Content identity of the event |
| `type` | One governed action |
| `occurredAt` | UTC instant |
| `actor` | Best-effort `name` and `source`; `authenticated` is always `false` |
| `client` | Acting client identity, surface, and version |
| `gate` | Gate identity, version, and protocol version |
| `repository` | Repository identity and resolved Git common directory |
| `before`, `after` | Relevant before and after hashes, or `null` |
| `outcome` | `succeeded`, `refused`, `failed`, or `detected` |
| `reason` | Why the record exists |
| `redaction` | Redaction version, applied rule counts, and rules |

Actor attribution is a local convenience, never an authentication claim, and
`authenticated: true` is not expressible. An event that fails the audit schema is
refused rather than stored. Later slices emit their own event types through this
same contract.

## The one-shot bypass ledger

A bypass is one-shot only if its consumption outlives the process that applied
it, so the ledger is durable here rather than in per-session memory. Consumption
appends to `bypass-ledger.ndjson` and records a `bypass` Lifecycle event. Policy
resolves a grant synchronously, so ledger reads and appends are synchronous.

## Decision binding

A decision reports its own evidence:

- `evidence.id` — stable identity of the decision, independent of every
  run-local value: the host-local execution root and the attempt durations;
- `evidence.persisted` — whether the envelope was appended;
- `evidence.reference` — the appended `evidenceId`, store root, append instant,
  and retained blob identities; or, when persistence did not happen, the reason
  code. It is `null` when no store is bound.

A gate with no Evidence store bound still returns a complete decision with a
stable evidence identity and `persisted: false`. Persistence never invents a
pass and never rewrites a check; the single way it changes a decision is making
it `unverified` when a capture cannot be proved safe.

## Prohibited

No background retention job, no automatic deletion, no envelope removal, no
raising the fixed ceilings, no silent truncation, and no claim of tamper-proof
storage.
