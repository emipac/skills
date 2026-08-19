# Kept host paths out of the Evidence identity, and let a stored record state that it is stored

Delivered TB-032, a defect slice found by reading the evidence real `gms` runs
left behind: eight stored envelopes for four logically distinct evaluations,
each one carrying a per-run `mkdtemp` path, and every one of them recording
`"evidence": { "persisted": false, "reference": null }` inside the store that
had just written it.

- Confirmed the leak and measured it before touching anything. `buildDecision`
  deliberately excludes the host-local execution root from `decision.evidence.id`
  (`NFR-REL-001`), but the store addresses the envelope by
  `contentIdentity(envelope)` and the envelope embeds the whole decision —
  including `decision.snapshot.executionRoot`. The exclusion was undone one
  layer down.
- Found the ticket's account of the duplication incomplete, by diffing the
  preserved envelopes rather than trusting it. The five preflight envelopes
  that share one `evaluationId` do not differ only by a temporary directory
  name: they also differ in each attempt's `durationMs`, and in captured output
  that quotes the execution root (a PHP warning naming
  `/private/var/.../gate-preflight-exec-uB9ozI/vendor/autoload.php`). Their
  `decision.evidence.id` values differ too, which means the decision's own
  "stable" identity was never stable either. Only the two hook-runner envelopes
  differed by the path alone, and those two do share one `evidence.id` — which
  is why the exclusion looked like it worked.
- Stated one rule instead of patching one field. `evidence-identity.mjs` now
  owns the single content-identity scheme and the single normalization it is
  computed over: values describing *this run on this machine* are replaced by
  the stated constant `<run-local>` before anything is hashed or written — the
  execution root wherever it appears, each attempt's wall-clock duration, and
  the store root and append instant inside the envelope's own reference. Both
  `evaluate` and the store compute over that same projection, so the identity a
  decision computes and the identity the store assigns describe the same thing.
- Elided the path in captured output too, because the envelope was not the only
  place it reached. A check reports where it ran, and its inline excerpt is
  inside the addressed bytes. Elision runs after redaction and before bounding
  and addressing, so ordering under `SG-SECRET-001` is unchanged and identical
  output from two runs is one content-addressed blob rather than two.
- Handled both spellings of one host path. macOS resolves a temporary directory
  as `/var/...` and a child process prints `/private/var/...`; a rule that
  elided only the spelling the runner held would have left the other in the
  stored bytes.
- Broke the persistence self-reference the way this codebase already breaks
  one. The stored envelope states `persisted: true` and names its own
  `evidenceId`; the identity is computed with `<evidence-identity>` in that one
  position and the real value substituted into the bytes written — exactly
  `HOOK_RECEIPT_PLACEHOLDER`'s technique. `envelopeIdentity` puts the two
  unhashed values back, and answers correctly for envelopes of either version.
  No second identity scheme was introduced; `contentIdentity` moved module and
  is re-exported from `evidence-store.mjs`, so every existing caller is
  unchanged.
- Recorded the run-local facts on the append rather than deleting them. Every
  diagnosis in this investigation used the execution root, so it stays — on the
  append-only log entry, under `execution`, beside each attempt's real
  `durationMs`. The ticket offered "the Lifecycle event or a per-append
  retention field"; the retention block is inside the envelope and therefore
  content-addressed, so it cannot hold a per-append value, and the Lifecycle
  event is schema-audited and states a governed action rather than a runner's
  scaffolding. The log entry is the per-append record that is neither. The
  decision the caller receives is untouched: a runner's diagnostics and stderr
  still carry the real path and the real durations.
- Stopped rewriting bytes that are already on disk. An append whose envelope
  already exists writes nothing and reports `deduplicated: true`; the log entry
  and the Lifecycle event are still appended, so one governed action still
  leaves exactly one event and the preflight repetition budget (`TB-027`),
  which counts log entries matching an `evaluationId`, counts exactly what it
  counted before.
- Versioned the change where the store says it. `storeVersion` is now
  `change-evaluation-gate/evidence/v2`. The layout is unchanged and `v1`
  envelopes are read, pruned, and audited beside `v2` ones; all eight preserved
  real-world envelopes still recompute their own identity under the new reader.
- Proved deduplication through a real runner, not only through
  `appendEvidence`. This codebase's recurring defect is a component proved in
  isolation that the runtime never reaches (`TB-023`, `TB-024`, `TB-026`,
  `TB-031`, `TB-033`), so the first red test drives `runHook` twice over
  identical staged content in one clone. It failed on two distinct
  `evidenceId`s, which is the defect exactly.

Scope held: no change to the retention ceilings, the redaction rules, blob
addressing, or the pruning contract; nothing deleted or rewritten; no second
content-identity scheme; no change to the Activation receipt, which is current
state rather than history; no change to the `TB-027` repetition budget.

Verification: `npm run test:unit` (392 passing, up from 388), `npm run validate`
(29 skills, 260 Markdown files), `npm run test:install`, and all nine
capabilities — `gate-runtime-binding-smoke`, `gate-fix-smoke`,
`gate-evidence-prune-smoke` (extended with
`identical-content-appends-one-envelope`), `gate-activation-smoke`,
`gate-hook-conformance-smoke`, `gate-lifecycle-smoke`,
`gate-adapter-conformance`, `gate-security-control-smoke`, and
`gate-runtime-portability`. Backward readability is proved against the
preserved `real-project-evidence` store itself: a `v1` envelope and its blobs
are copied into a fresh store, read back, identity-recomputed, previewed, and
pruned, with the envelope preserved and a tombstone per removed blob.
