# Declared desktop adapter registration surfaces

Delivered TB-016 as the slice that lets the Gate register in three desktop
clients that agree about almost nothing — without activation learning a single
client's name.

- Made the registration surface declared data on the adapter, on the same
  footing as its event names and identity fields. Each adapter states the client
  configuration file it registers in, whether that file is dedicated to hooks or
  shared with settings it does not own, the container the entries live under,
  the trigger the entry is keyed by, the block schema, and whether the format is
  independently versioned. `FR-ADAPT-008` is enforced rather than described: a
  declaration that omits any of that — including `schemaVersion`, because "not
  versioned" is a claim about the client — is rejected rather than defaulted.
- Modelled the observed reality rather than a convenient average. One surface
  registers inside a general settings file that also holds `permissions`; two
  use dedicated hooks files; one of those carries its own `version: 1` and a
  flat `{ command }` block with neither matcher nor type, while the other two use
  a matcher group wrapping a typed inner array. Event-key casing follows the
  client, exactly as its payloads do.
- Kept the three declarations separate. Two of them share a block shape today;
  that is an observation, not a shared contract, and `FR-ADAPT-004`'s intent is
  that one client's change cannot silently redefine another's.
- Declared the event key once. A registration names a trigger, and the key is
  that adapter's own declared native event for it, so registration and trigger
  matching cannot disagree about a client's casing.
- Added `scripts/lib/adapter-registration.mjs`, which registers, reconciles, and
  withdraws entirely through those declarations. It names no client at all, and
  neither does activation or the lifecycle module: a test asserts that every
  client name in the module set still lives only in the adapter declarations
  (`SG-OWNER-001`).
- Hung registration off activation's existing adapter handling rather than a new
  step. `ACTIVATION_STEPS` is unchanged and `git-enablement` is still last.
- Never rewrote a byte the adapter does not own. Registration merges one entry
  into the declared array; `permissions`, a client's own format version, other
  events, and other entries are written back exactly as their owners wrote them,
  with the document's own indentation preserved. What a registration had to
  create around its entry is recorded, so a removal takes the empty container
  back with it and the file returns byte for byte to what its owner wrote.
- Proved ownership by content, because JSON carries no marker comment. The
  receipt pins the entry's content identity and the exact command it names; the
  entry is located by that command, never by position, and removed only while it
  is still byte-for-byte what was written.
- Made `gate status` reconcile each pinned registration and repair nothing. A
  drifted, absent, ambiguous, or unconfirmable surface is a `degraded` finding
  the operator can act on; observation still writes nothing at all.
- Made `gate deactivate` all-or-nothing across hooks and registrations together.
  A drifted entry refuses the whole deactivation and nothing is removed
  anywhere; an entry whose command somebody edited is not the Gate's entry and is
  left exactly where it is; and every unrelated entry in the same client file
  survives.
- Reported `unverified` instead of assuming a mechanism. A declared surface that
  cannot be confirmed on disk is pinned `unverified`, is never counted as
  registered, and leaves the clone `degraded`. The Gate does not create a
  client's configuration file: it cannot know a format it has never confirmed,
  including whether that format carries its own version.
- Extended `gate-hook-conformance-smoke` with a fifth scenario,
  `desktop-registration`, which registers two differently declared surfaces into
  real client configuration files in a throwaway clone, asserts the survivors,
  reports drift without repairing it, refuses removal while that drift stands,
  and then returns both files byte for byte. No desktop client is installed or
  executed; the suite runs offline on a clean machine.

Scope held: no surface was promoted to `supported` — that still needs a
client-driven baseline run — no `0.9.0` version bump, and no change to the Git
hook composition strategy. The registration block shapes carry the same evidence
caveat as the payloads: two were read from disk on one machine and one client
version each, the third was reported rather than captured, and none is known to
be stable across client versions. That is precisely why the schema-versioning
behaviour is declared rather than assumed (`RISK-004`, `Q-004`).

Verification: `npm run test:unit` (261 passing), `npm run validate` (29 skills,
208 Markdown files), `npm run test:install`, and regression runs of all nine
capabilities — `gate-runtime-binding-smoke`, `gate-fix-smoke`,
`gate-evidence-prune-smoke`, `gate-activation-smoke`,
`gate-hook-conformance-smoke`, `gate-lifecycle-smoke`,
`gate-adapter-conformance`, `gate-security-control-smoke`, and
`gate-runtime-portability`.
