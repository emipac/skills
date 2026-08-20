# TB-039 — Do no work for a turn that changed nothing

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 39-do-no-work-for-a-turn-that-changed-nothing
Draft key: TB-039

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A desktop turn that changed nothing costs nothing: no snapshot is copied, no
Evidence envelope is appended, and the maintainer's agent is answered with the
same silence it receives today. The authoritative Git path is untouched.

## SRS Traceability

- `FR-EVAL-004`, `FR-EVID-001`, `FR-ADAPT-005`
- `AC-EVAL-004`, `AC-EVID-002`
- `SG-EVAL-001`, `SG-SUPPORT-001`, `SG-EVID-001`
- `NFR-PERF-001`, `NFR-REL-001`
- `RISK-010`

## Defect this contract fixes

The Cursor adapter is registered on `stop`, so the preflight runs at the end of
**every** turn — including a turn where the maintainer only asked a question and
nothing in the worktree moved. For that turn the gate does a full materialization
and a full Evidence append in order to produce guaranteed silence.

Verified, by reading the executed path:

- The preflight builds `change: { kind: 'worktree', baseRevision: 'HEAD' }`
  (`preflight-runner.mjs:303`) and `evaluate` calls `captureSnapshot`
  unconditionally (`evaluate.mjs:399`). The only paths that return earlier are
  failures: unreadable configuration, missing receipt, unresolvable runner,
  unopenable store, and a check declared as mutating.
- Inside `captureSnapshot`, the files are written **before** anything asks what
  changed: materialize, then `identifyExecutionRoot`, then `listChangedPaths`.
  So "nothing changed" is discovered only after the copy exists.
- With no changed paths, `isApplicable` (`verification-seam.mjs`) matches no
  `changed_path_globs`, so every check is `not-applicable`; `decisionOutcome`
  (`policy.mjs:415`) filters to `required` checks, finds none, and returns
  `passed`; `formatFeedback` (`adapters.mjs`) sees `passed` with no failure and
  returns the declared silence form. The agent is told nothing, correctly.
- `persistEvidence` (`evaluate.mjs:709`) appends whenever a store is open. It is
  not conditioned on the outcome, so an idle turn appends an envelope and a
  lifecycle event like any other.

Verified, by measurement on this repository: 495 tracked files, 4.4 MB, 143 ms
to materialize. A project's own tree will differ; declared dependency roots are
symlinked rather than copied, so they are not part of that cost.

So the per-idle-turn price is a full copy of the worktree, its hashing, its
removal, and one permanent Evidence append — to reach an outcome that was
determined before any of it began.

An earlier framing of this ticket claimed the materialization was load-bearing
because skipping it would mean trusting Git's file list where the gate otherwise
re-establishes it. **That claim is false and is recorded here so it is not
re-derived.** `identifyExecutionRoot` hashes exactly the paths Git named. It
re-establishes the *contents* at those paths and their immutability across the
run; it never looks for a file it was not told about, so it does not check that
Git's list was complete. The gate trusts that list whether or not it copies.

## Domain Concepts

Preflight turn, Snapshot materialization, Changed paths, Applicability,
Evidence envelope, Repetition budget, Silence.

## Approach and Tradeoffs

Verified: `listChangedPaths(repositoryRoot, kind, runGit)` is already exported
from `snapshot.mjs` and needs no execution root — it asks Git and returns a list
of repository-relative paths. Nothing about it depends on the copy existing.

Proposed — ask before copying, on the preflight path only. When the preflight's
changed-path list is empty, answer without capturing: every configured check
`not-applicable`, decision `passed`, `authorization: 'not-authoritative'`,
`snapshot: null`. The implementer confirms `buildDecision` already tolerates a
null snapshot — it is passed `snapshot: null` on several existing refusal paths —
and that the contract check added by `TB-037` accepts the resulting decision.

Proposed — the authoritative runner does not change. On a commit, the snapshot
is what the checks actually run against and what the decision must name, so it
keeps materializing unconditionally. This slice must not touch `hook-runner.mjs`
beyond what it shares.

Proposed — append no Evidence for a turn that did nothing. An envelope per idle
chat turn is permanent store growth carrying no verdict about any change, and
`RISK-010` accepts growth on the basis that what is stored is worth keeping.
The implementer must check this against the repetition budget first: the
preflight bounds the Cursor follow-up loop by counting its **own** appended
records for an `evaluationId` (`preflight-runner.mjs:112` and `:333`). Establish
whether an unchanged worktree can ever reach that counter through this new path,
and if suppressing the append would weaken the loop bound, say so and append
anyway — the loop bound is the more important property.

Deliberately not a cache. No memoized decision, no reuse of a previous snapshot
identity, no "unchanged since last turn" shortcut. The only question asked is
whether this turn has any changed path at all, and it is asked fresh every time.

## Architecture Boundary and Public Seam

The boundary is between deciding *whether* an evaluation has any subject and
performing one. Today the gate performs first and discovers the subject was
empty afterwards. The public seam is the preflight's pre-capture changed-path
question and the no-subject decision it returns.

First red test: a preflight turn against a clean worktree creates no directory
matching the preflight execution-root prefix, where today it creates and removes
a full copy.

## Safeguards and Invariants

- `SG-EVAL-001`: nothing here changes what a snapshot is or how its identity is
  derived. A decision that names no snapshot also authorizes nothing — it is
  `not-authoritative` by role, as every preflight decision already is.
- `SG-SUPPORT-001`: the preflight still blocks nothing and still warns rather
  than denies.
- `SG-EVID-001`: no existing Evidence is removed, rewritten, or made harder to
  read. This changes only whether a new record is appended for an empty turn.
- `NFR-REL-001`: the authoritative Git decision for the same worktree is
  byte-for-byte what it is today.
- `AC-EVAL-004`: a worktree with any change at all still materializes, still
  grades, and still re-verifies the execution root exactly as now.

## Prohibited Behavior and Non-goals

Do not change the authoritative runner's capture. Do not cache or reuse a
decision, a snapshot, or an identity across turns. Do not add a configuration
key, flag, or policy field for this — an empty change set is not a preference.
Do not change what `listChangedPaths` returns, what `isApplicable` matches, or
how `decisionOutcome` rolls up. Do not extend this to the `git-index` snapshot
kind, and do not let a clean worktree produce a *different* feedback string than
it produces today.

## Risk and Decision Impacts

- `RISK-010`: Evidence growth is accepted for records that document a verdict
  about a change. A record documenting that there was no change is the case the
  disposition did not consider.
- No disposition changes. The preflight's authority, its silence behavior, and
  the authoritative path are all unchanged.

## Acceptance Criteria

- [ ] `AC-EVAL-004`, `NFR-PERF-001`: a preflight turn against a clean worktree
  materializes no execution root, proved by observing that no directory matching
  the prefix is created during the turn.
- [ ] `FR-ADAPT-005`: that turn's feedback is byte-for-byte identical to what the
  same turn produces today, so the agent's experience does not change at all.
- [ ] A worktree with one changed file still captures, grades, and reports
  exactly as it does today — the skip triggers only on a genuinely empty change
  set, including one where the only difference is an untracked file.
- [ ] `RISK-010`, `AC-EVID-002`: whatever the implementer decides about the
  Evidence append is stated in the decision itself, so a reader can tell an
  unrecorded idle turn from a lost one.
- [ ] `NFR-REL-001`: the authoritative Git path is untouched — same decision,
  same evidence, same snapshot, proved against the existing commit fixtures.
- [ ] The repetition budget still bounds the Cursor follow-up loop, proved by
  the fixture that already exercises it.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-EVAL-004`, `FR-ADAPT-005`: clean-worktree, one-changed-file, untracked-only, and repetition-budget fixtures against the real preflight runner, and `AC-EVID-002`: whatever the slice decides about the Evidence append is legible in the decision itself | `npm run test:unit` | Yes — the unit suite owns the preflight runner |
| smoke | both | `NFR-REL-001`: a real clean clone driven through a real preflight turn leaves no execution root and answers with the same silence, while a commit on the same clone decides identically | `gate-hook-conformance-smoke`, extended by this slice | Yes — that capability already drives real desktop payloads through the packaged path |

Frontend build and browser evidence are inapplicable; this slice changes local
preflight evaluation.

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

Every preflight fixture evaluates a worktree that has something in it, because a
fixture with no change proves nothing about grading. The empty change set is
therefore a shape the suite has never constructed, and the cost of reaching
silence has never been observed because silence looked correct from the outside —
which it is. Nothing was wrong with the answer, only with what was spent
producing it.
