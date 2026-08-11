# Release qualification contract

What a Gate-capable release candidate must be able to show before any of its
claims may stand, and what a maintainer has to do to widen those claims later.

Implemented by `scripts/lib/release-qualification.mjs`. Verified by
`tests/gate-release-qualification.test.mjs` and the
`gate-runtime-portability` capability.

Traces `NFR-COMP-001`, `NFR-PORT-001`, `NFR-PORT-002`, `AC-ADAPT-002`,
`AC-PORT-001`, `SG-CMD-001`, `SG-SUPPORT-001`, `SG-TRUST-001`, `RISK-003`,
`RISK-007`, `Q-004`, `Q-005`, `Q-006`.

## 1. The manifest is a record, and qualification is the reader

The compatibility manifest carries observed evidence: the release version read
from the package, the environments the portability matrix was executed on, the
per-surface baseline outcomes, and the risks that stayed open.

`qualifyRelease(manifest)` does not run anything. It reads the manifest and
refuses every claim that outruns the evidence beside it. Nothing in the manifest
is trusted because it was written down — a support tier is derived again from
the same baseline, and a version is compared against the package on disk.

## 2. The release version is read, never written

`readReleaseVersion(repositoryRoot)` reads `package.json`. That is the only
accepted source, and `qualifyRelease(manifest, { expectedVersion })` fails a
manifest whose version disagrees with it.

This repository moves to its next version through the release pull request's
`changeset version` step. A version literal written into a manifest, a script,
or a document could therefore disagree with the package it describes from the
moment it was written, so the generator carries none.

## 3. The environment matrix is a function of what is claimed

Every environment is `claimed` or `unverified`. There is no third value, and in
particular there is no `denied`: evidence proves what was tested, and it cannot
refuse what was not.

A **claimed** environment owes an outcome for all eleven runtime portability
fixtures `AC-PORT-001` names. Missing one fails qualification, recording an
outcome the contract does not name fails qualification, and reporting a real
failure honestly and claiming the environment anyway fails qualification. The
required set is the contract's, never the set a manifest happens to carry.

| Fixture | What is executed |
| --- | --- |
| `executable` | A runner resolves to an executable identity and is launched directly; shell text and an unresolved runner are refused before execution, and complex behaviour is reachable only through a declared `repository-script` Grader surface (`SG-CMD-001`). |
| `stream` | Both standard streams of a real check are captured, and exit status is what grades it. |
| `json` | A structured result crosses a real process boundary and parses, including non-ASCII content. |
| `timeout` | A check that outruns its confirmed timeout is stopped and reported as timed out with no exit code. |
| `process-tree` | A stopped check leaves no descendant still running: background work cannot complete later and authorize the current commit. |
| `git-index` | Staged content is read from a real Git index in a real repository, distinct from the worktree. |
| `linked-worktree` | A primary worktree and a `git worktree add` linked worktree resolve to one canonical Git common directory, and therefore to one Evidence store. |
| `path-with-spaces` | A repository root containing spaces and non-ASCII characters works end to end, with no operating-system-labelled path logic. |
| `materialized-root-declared-write` | A check writes inside the materialized execution root it was given, and the source repository is untouched. |
| `source-immutability` | The source repository's Git state and tracked content are byte-identical before and after an evaluation. |
| `non-interactive-shell` | A check runs with no controlling terminal, reads end-of-file from standard input immediately, and sees only the environment names its descriptor declared. |

An **unverified** environment must say why it was not tested. It is not a
refusal and not a defect; it is an environment this run had no access to. The
only way to acquire a claim for one is to execute this matrix there.

`Q-004` is explicit that the recorded versions are an evidence snapshot. The
manifest states `evidencePolicy: evidence-snapshot`, and a manifest presenting
its snapshot as a standing allowlist fails qualification.

## 4. A support tier is derived, never declared

Each surface record carries its adapter, variant, capabilities, and the shared
baseline result that ran. Qualification derives the tier again through
`classifySupport` in `adapters.mjs` and refuses any disagreement — in either
direction. Overstating a tier and understating one are the same defect: a
recorded tier that its own evidence does not produce.

A surface must also carry an outcome for **every** shared baseline check and the
exact Gate, Git, Node.js, client, and operating-system versions the baseline ran
under. Without those there is no recorded baseline to agree or disagree with
(`NFR-COMP-001`).

`classifySupport` will not return `supported` for a baseline whose
`evidence.payloadSource` is not `captured-client-invocation`. That is the rule
this feature learned the hard way: payloads built from the declaration under
test cannot show that the declaration matches the client, because the fixture
and the thing being tested came from the same source. Real captures later
refuted every declared desktop mapping precisely because injected fixtures could
not.

## 5. Promoting a surface out of `experimental`

`experimental` is a state with a stated exit. `promotionProcedure(surface)`
returns the requirements for a surface held back by
`client-invocation-not-observed`, and returns none for a surface that cannot
reach the repository at all — that surface is not one capture away from support.

A maintainer promoting a desktop surface must record all of the following from a
run a real client actually drove:

1. **`captured-payload-shape`** — the client's own payload, captured from an
   invocation the client initiated, with every top-level key it actually sent.
   Record the key names only. The captured values must never be committed: real
   payloads carry conversation text and personal data, and any fixture derived
   from one must use synthetic values with the real shape.
2. **`captured-event-name`** — the exact event value that arrived, including its
   casing. Casing is per client and is not incidental: Cursor sends `stop` where
   Claude Code and Codex send `Stop`, in the same `hook_event_name` key. Trigger
   matching is an exact-string compare per adapter, and a blanket
   case-insensitive compare would erase a real distinction.
3. **`registration-file-and-schema`** — where that client registers a hook and
   in what shape. All three observed surfaces differ at both levels: Claude Code
   nests hooks inside a general settings file, Codex uses a dedicated hooks file
   with a byte-identical block shape, and Cursor uses a dedicated,
   independently versioned file with a flat block, no matcher, no type
   discriminator, and a top-level schema version of its own.
4. **`exact-client-version`** — the version the capture came from, self-reported
   by the client where it offers one. Cursor reports `cursor_version` in every
   payload, so its exact version is available with no probing of the
   application.
5. **`shared-baseline-outcomes`** — every shared baseline check re-run against
   that captured shape, each with its own recorded outcome.
6. **`repository-root-resolution`** — how a repository root was resolved from
   the path the client sent. This is behaviour, not a field name: the same field
   was observed to be a repository root for one client and not for another, and
   one client sends an array of workspace roots. A multi-root workspace has no
   single repository root and must stay `unverified` rather than have one
   picked.
7. **`re-run-qualification`** — run `gate-runtime-portability` again so the
   manifest carrying the promotion is the manifest the new evidence produced.

Each adapter keeps its own declaration. Two clients converging on a key name
today is an observation, not a guarantee, and one shared normalization would let
one client's change silently redefine another's (`FR-ADAPT-004`).

## 6. What this release does not claim

- **No server-side and no continuous-integration authority.** Authorization is
  one local `pre-commit` hook in one clone. The manifest states
  `authority.model: authoritative-local-git` with `serverSide` and `ci` both
  false, and a manifest claiming otherwise fails qualification.
- **No resistance to the machine owner.** The manifest carries the trust
  boundary statement from `security-control.mjs` verbatim rather than restating
  it, and a rewritten boundary fails qualification. This is a cooperative local
  process running with the owner's own permissions; it reports what changed and
  it does not defend against the person running it (`SG-TRUST-001`).
- **No closure of `RISK-003` or `RISK-007`.** Both stay open, and qualification
  requires each to be present with the evidence it was accepted against:
  measured timing for `RISK-003`, recorded attempt outcomes for `RISK-007`. A
  manifest that closes either, or quietly drops it, fails qualification.
- **No fourth client.** `Q-003` closed that question for v1.
