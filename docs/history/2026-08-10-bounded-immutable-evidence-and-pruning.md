# Bounded immutable Evidence and preview-bound pruning

Delivered TB-008 as the Gate's local memory: every evaluation now leaves a
bounded, redacted, content-addressed record that is never automatically deleted,
and an operator can reclaim disk without losing the audit trail.

- Added the clone-local Evidence store under the resolved Git common directory,
  at `<git-common-dir>/change-evaluation-gate/evidence`. Every linked worktree of
  one clone shares exactly one append-only history, and nothing is written into
  tracked source. The common directory is canonicalized, because Git answers a
  linked worktree with an absolute path and the primary worktree with a relative
  one — two strings for one directory, which would have split the store and
  later defeated a lock keyed on it.
- Made envelopes canonical and content-addressed and every write atomic.
  Envelopes and blobs land through a staging file and one rename; index, event,
  ledger, pruning, and tombstone records are single-line appends. Key order never
  changes an identity, identical evidence addresses one envelope, and the
  append-only log still records each append.
- Fixed the three v1 retention ceilings settled by `Q-008` — 32 KiB inline per
  Check attempt, 4 MiB per output blob, 32 MiB of blobs per evaluation. A project
  may configure lower limits; a configured higher limit never takes effect and is
  recorded as a violation rather than silently ignored.
- Made truncation loud. A retained excerpt preserves the beginning and the end of
  the output and states inside itself how many bytes were omitted, and the
  envelope records captured, retained, and omitted byte counts that always
  account for the whole redacted output.
- Put redaction before persistence, not after. Declared Sensitive runtime inputs
  are redacted in raw, base64, base64url, hex, and percent-encoded form; built-in
  patterns cover authorization headers, credential assignments, URL user info,
  and private key blocks. Only a Sensitive input's name and source are ever
  recorded.
- Made unsafe capture refuse rather than hope. The store rescans exactly what it
  is about to write; if a declared value survives in any recognized form nothing
  is persisted and the decision becomes `unverified` through the new
  `sensitive-capture-unsafe` reason code. Evidence that might carry a secret is
  not evidence.
- Made pruning manual, preview-first, and blob-only. A preview selects by
  evaluation, age, or desired reclaimed size and returns the exact blobs, bytes,
  and a confirmation token that is the identity of that selection. A confirmation
  that does not reproduce the token removes nothing and records a refusal — never
  a successful deletion. A match removes only previewed blobs and preserves
  envelopes, decisions, bypass records, Lifecycle events, pruning records, and a
  tombstone for every removed blob.
- Added the immutable Lifecycle event record for all eleven governed actions,
  each carrying UTC time, a best-effort actor that is explicitly unauthenticated,
  client and gate identity, repository identity, before and after hashes,
  outcome, reason, and redaction metadata. `authenticated: true` is not
  expressible, and an event that fails the audit schema is refused rather than
  stored. Later slices emit their own event types through this contract.
- Gave the one-shot bypass ledger a durable home here rather than leaving it in
  per-session memory. A bypass is one-shot only if its consumption outlives the
  process that applied it, so consumption appends to the same clone-local store
  and records its own `bypass` event.
- Filled in `evidence.persisted` in place and added `evidence.reference`. An
  unbound gate still returns a complete decision with a stable evidence identity
  and `persisted: false`; persistence never invents a pass and never rewrites a
  check.
- Made captured output reachable at all. The bounded executor ran every check
  with `stdio: 'ignore'`, so no production path could ever have produced retained
  output. Capture is now opt-in, interleaves stdout and stderr into the one story
  a check tells, settles on `close` so pipes are drained, and is itself bounded
  to the per-blob ceiling.
- Added the `gate-evidence-prune-smoke` capability, which proves all of this
  against real spawned check processes, a real materialized snapshot, and a real
  on-disk store, with a secret canary planted in captured output. Its first run
  found a fixture calling `process.exit()` and dropping the buffered output the
  canary lived in — the assertion that the redaction count was non-zero is what
  caught it.

The store is cooperative local state and says so. It is not tamper-proof, there
is no background retention job, nothing is ever deleted automatically, and no
envelope is ever removed.
