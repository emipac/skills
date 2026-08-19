# TB-034 — Grade the whole worktree change, including the files that are new

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: done, defect
Blocked by:
Tracker ID: 34-grade-the-whole-worktree-change
Draft key: TB-034

**Status:** done

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A worktree preflight grades the work that is actually in front of the agent: a
file it just created, a file it deleted, and both sides of a file it renamed.
The snapshot the preflight materializes is the change a maintainer would see,
not the subset of it that Git already tracked.

## SRS Traceability

- `FR-EVAL-001`, `FR-EVAL-004`, `FR-ADAPT-002`
- `AC-EVAL-001`, `AC-ADAPT-001`
- `SG-EVAL-001`
- `NFR-REL-003`
- `RISK-001`

## Defect this contract fixes

Raised by an external audit of `HEAD` `9569362` as *"worktree snapshots are
incomplete: untracked files are omitted, rename sources are ignored, deletions
can fail capture."* Confirmed against the shipped code, with one correction to
its scope that changes how urgent it is.

`captureSnapshot` materializes a `worktree` snapshot from
`listTrackedPaths`, which is `git ls-files` — index entries only:

```js
const relatives = await listTrackedPaths(repositoryRoot, runGit);
…
await materializeBlobs(executionRoot, await readBlobs(repositoryRoot, relatives));
```

So, for a worktree evaluation:

- **A newly created file is not in the snapshot.** It is untracked, `ls-files`
  does not list it, and no check ever sees it. The preflight reports on
  everything *except* the file the agent just wrote.
- **A deleted file breaks the whole evaluation.** It is still an index entry,
  so `readBlobs` tries to read a file that is gone, `captureSnapshot` catches
  the error and returns `snapshot-mismatch`, and the entire preflight is
  `unverified` — for an ordinary deletion.
- **A rename is seen as a deletion plus an invisible creation**, which is both
  of the above at once.

**The correction to the audit's scope: the authoritative commit path is not
affected.** A `git-index` snapshot is materialized with
`git checkout-index --all`, which reads the index — so a staged new file *is*
graded, a staged deletion is correctly absent, and `ls-files` agrees with both.
A commit is therefore judged on the right content today. This is a preflight
defect, and preflight is `not-authoritative` by construction.

That is not a reason to leave it. The preflight exists to tell an agent what is
wrong with the work it just finished, in an AI-assisted workflow where *new
files are the most common kind of work*. The recorded session in
`real-project-evidence/` had exactly that shape: an untracked
`tests/Feature/MazeTest.php` sitting beside the modified files, which no
preflight snapshot would have contained. A preflight that reports clean while
never having read the new test is telling the agent something untrue.

## Domain Concepts

Evaluation snapshot, Snapshot target kind, Tracked path, Changed path,
Preflight role, Enforcement authority.

## Approach and Tradeoffs

**Ask Git what changed, not what it already tracked.** The worktree content set
is the tracked paths *plus* the untracked, not-ignored paths, *minus* the
deleted ones. `git status --porcelain` already reports every one of those, and
`listChangedPaths` already parses it — including the rename entries whose
source path it currently steps over. Nothing here needs a new mechanism, only
the right question.

**Ignored files stay ignored.** Untracked means untracked-and-not-ignored. A
project's git-ignored content reaches a snapshot exactly one way, and it is the
declared dependency roots `TB-030` provides — never by being swept up here.

**A deletion is materialized by absence.** A file the worktree no longer has is
simply not written, and not listed in the snapshot's paths, so the identity
covers what the tree actually contains. It must not be an error.

**Both sides of a rename are the change.** The source is gone and the
destination is new; the snapshot shows exactly that, and `changedPaths` names
both so applicability rules see the whole move.

**The identity keeps its meaning.** It is still a digest over the enumerated
paths and their content, so it still names the tree the checks ran against, and
`verifySnapshot` still re-derives it. A snapshot containing more of the truth
does not weaken `SG-EVAL-001`; a snapshot missing half the change was the thing
that weakened it.

**Deliberately out of scope: file modes, symlink targets, and submodules.**
The audit lists them and they are real, but a chmod-only change is not what
this gate exists to catch and modelling them properly is a larger contract than
this slice. State the limitation rather than half-implementing it.

## Architecture Boundary and Public Seam

The boundary is worktree snapshot materialization: which paths make up "the
change in front of the agent". The public seam is the content set
`captureSnapshot` materializes for `kind: 'worktree'` and the `changedPaths` it
reports alongside.

First red test: a clone with one modified file, one newly created untracked
file, and one deleted file captures a worktree snapshot that contains the new
file, omits the deleted one, and does not report `snapshot-mismatch` — where
today it fails to capture at all.

## Safeguards and Invariants

- `SG-EVAL-001`: checks still run against a materialized snapshot, never the
  live worktree, and the identity still names exactly the tree they ran on.
- `FR-EVAL-004`: the identity stays a function of enumerated paths and their
  content, independent of filesystem order and host paths.
- Ignored content never enters a snapshot through this path. Declared
  dependency roots remain the only way untracked content is provided, and they
  remain outside the identity.
- `NFR-REL-003`: a path that genuinely cannot be read is still a stated
  failure. Only the *expected* absence of a deleted file stops being one.
- The `git-index` path is untouched: it is correct today and this slice must
  not change what a commit is graded on.

## Prohibited Behavior and Non-goals

Do not change `git-index` capture. Do not include git-ignored content. Do not
model file modes, symlink targets, or submodules — state them as known
limitations instead. Do not make the preflight authoritative or blocking. Do
not add a second snapshot kind. Do not read the worktree during an
authoritative evaluation.

## Risk and Decision Impacts

- `RISK-001`: the accepted mitigation is that a maintainer sees exact evidence
  about the change. Preflight evidence that silently excludes the new files is
  that mitigation quietly not applying to the most common kind of work.
- No disposition changes; no new capability is claimed and authority is
  unchanged.

## Acceptance Criteria

- [x] `FR-EVAL-001`, `AC-EVAL-001`: a worktree snapshot of a clone with a
  modified file, a new untracked file, and a deleted file contains the modified
  and new files, omits the deleted one, and captures successfully.
- [x] `FR-EVAL-001`: both sides of a rename appear in `changedPaths`, and the
  snapshot contains the destination and not the source.
- [x] `SG-EVAL-001`: a git-ignored file is absent from the snapshot unless a
  declared dependency root provides it, and a provided dependency root is still
  outside the identity.
- [x] `AC-ADAPT-001`: a preflight in a clone whose only change is a new
  untracked file that fails a required check reports that failure through the
  declared feedback channel — the case that reports clean today.
- [x] `FR-EVAL-004`: the `git-index` path produces byte-identical snapshots and
  identities to today, proved by an unchanged fixture.
- [x] The known limitations — file modes, symlink targets, submodules — are
  stated in the evaluation process contract rather than left implied.

## Decisions this slice recorded

- **`git status` is asked with `-uall`, which the ticket did not name.** Default
  untracked reporting collapses a wholly new directory into one `dir/` entry. A
  snapshot materializes files, so the collapsed entry would have been enumerated
  as a path that is not a file and capture would have failed on exactly the case
  the ticket exists for — the recorded `tests/Feature/MazeTest.php` sits inside a
  directory that did not previously exist. Ignored content stays out because
  `--ignored` is still not asked for, so the safeguard is unchanged.
- **Untracked paths are now changed paths for a `worktree` change.** The ticket
  states the content set and states that both sides of a rename reach
  `changedPaths`, but `listChangedPaths` skipped every `??` entry outright, so a
  newly created file was reported as no change at all and no applicability rule
  could ever match it. Grading a file that no rule considers applicable is half
  the fix. An untracked path remains absent from a `git-index` change, because
  it is nothing to the index.
- **A rename names both sides; a copy names only its destination.** The ticket
  says "both sides of a rename are the change". A copy record carries a source
  field in the same position, but a copy leaves its source byte-identical, so
  naming it would report a change to a file nobody touched.
- **The rename source field is read when either status column reports `R` or
  `C`.** The existing parser stepped over the second field only when the *index*
  column did. Git documents `R` and `C` in both columns; a worktree-column
  rename would have desynchronized the parse and made the source path look like
  a status record.
- **The `git-index` regression is pinned to a literal identity, not to a
  self-comparison.** The fixture's expected identity
  (`sha256:cdeecced…`) was recorded by running the fixture against the
  pre-TB-034 module, so it proves byte-identity with what a commit was graded on
  before rather than with whatever this build happens to produce.
- **The smoke check now grades the directory it is pointed at.** The existing
  `packaged-preflight-answers-client` check read one named file, so it could
  never have failed on a file that did not exist when it was written — the
  defect would have stayed invisible through the real runner. The check is
  otherwise the same check, with the same identity and the same runner.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `FR-EVAL-001`, `FR-EVAL-004`, `SG-EVAL-001`: worktree capture fixtures for new, deleted, renamed, modified, and ignored paths, plus a `git-index` regression | `npm run test:unit` | Yes — the unit suite owns snapshot materialization |
| smoke | both | `AC-ADAPT-001`: the packaged preflight program, launched as a child process against a clone whose only change is a new untracked failing file, answers through the declared channel naming that check | `gate-adapter-conformance`, extending `packaged-preflight-answers-client` | Yes — the defect is only visible through the real runner against a real clone |

Frontend build and browser evidence are inapplicable; this slice changes local
snapshot materialization.

## Blocked By

None. `TB-030` established that content outside the tracked path list can sit
in an execution root without touching the identity, which is the property this
relies on for dependency roots to stay excluded.

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

Every snapshot fixture in the repository modifies files that already exist and
then captures. `gate-runtime-portability` proves materialization is faithful,
`gate-activation-smoke` proves real commits are graded — both by editing a
tracked `app/Order.php`. No fixture has ever created a file and asked whether
the snapshot contained it, or deleted one and asked whether capture survived,
which is why a preflight that cannot see new work has looked correct
throughout.
