---
"ai-skills-framework": minor
---

Persist and prune bounded immutable Change Evaluation Gate Evidence: every
evaluation appends one canonical, content-addressed, redacted envelope atomically
to a clone-local store under the resolved Git common directory, enforcing the
fixed v1 ceilings of 32 KiB inline per Check attempt, 4 MiB per output blob, and
32 MiB of blobs per evaluation, which a project may lower but never raise.
Truncation preserves the beginning and the end of the output and reports its
redacted and omitted byte counts. Sensitive values are redacted before anything
is written and a capture that cannot be proved safe persists nothing and returns
`unverified`. Nothing is ever deleted automatically: pruning is manual,
preview-first, and blob-only, a mismatched confirmation removes nothing and
records no successful deletion, and a matching one preserves envelopes,
decisions, bypass records, Lifecycle events, pruning records, and a tombstone for
every removed blob. Adds the immutable Lifecycle event record for all eleven
governed actions, a durable one-shot bypass ledger, opt-in bounded output capture
in the executor, and the `gate-evidence-prune-smoke` capability.
