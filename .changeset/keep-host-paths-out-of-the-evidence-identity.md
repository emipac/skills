---
"ai-skills-framework": patch
---

Address a stored Evidence envelope by what was evaluated, and let it state that
it was stored. The store addressed envelopes by hashing the whole decision,
which embeds the per-run `mkdtemp` execution root — so the exclusion
`buildDecision` already applied to `decision.evidence.id` was undone one layer
down, and five byte-identical evaluations in recorded real-world evidence
produced five envelopes differing only in run-local values. Every stored
envelope also recorded `"evidence": { "persisted": false, "reference": null }`,
because the store fills those fields on the copy it returns, after the bytes
are written.

Values that describe one run on one machine are now replaced by the stated
constant `<run-local>` before anything is hashed or written: the execution root
wherever it appears — including inside a check's captured output and its inline
excerpt — each attempt's wall-clock duration, and the store root and append
instant inside the envelope's own reference. Two evaluations of identical
content therefore append one envelope and two log entries. The elided values are
recorded on the per-append log entry under `execution`, which is not
content-addressed, and the decision a runner reports is unchanged, so
diagnostics and stderr still name the real path and the real durations.

A stored envelope now states `persisted: true` and names its own evidence
identity. That self-reference is hashed with the placeholder
`<evidence-identity>` and substituted afterwards, the same technique
`HOOK_RECEIPT_PLACEHOLDER` already uses for the Activation receipt;
`envelopeIdentity` recomputes an envelope's identity from its own bytes.

`storeVersion` is now `change-evaluation-gate/evidence/v2`. The store layout is
unchanged and envelopes written before this change stay readable, prunable, and
auditable exactly as written; nothing is rewritten or removed.
