# Graded the whole worktree change, including the files that are new

Delivered TB-034, a defect slice raised by an external audit and confirmed
against the shipped code. A worktree preflight was materialized from
`git ls-files`, so it graded the index — and the index does not contain the file
the agent just wrote.

- Named the two halves of the mechanism. `captureSnapshot` enumerated a
  `worktree` snapshot with `git ls-files`, so a newly created file was in no
  execution root the gate ever built and no check ever read it; and a deleted
  file was still an index entry, so `readBlobs` opened a path that was gone,
  capture returned `snapshot-mismatch`, and an ordinary `rm` made the whole
  preflight `unverified` before a single check ran. A rename was both at once.
- Asked Git what changed instead of what it already tracked. The worktree
  content set is the tracked paths, plus the untracked-and-not-ignored ones,
  minus the ones the worktree no longer holds. `git status --porcelain` reports
  every one of those and `listChangedPaths` already parsed it, so this is one
  parse shared by both questions rather than a new mechanism.
- Asked it with `-uall`, which is a correction to the ticket. Default untracked
  reporting collapses a wholly new directory into a single `dir/` entry, and a
  snapshot materializes files: the collapsed entry would have been enumerated as
  a path that is not a file and capture would have failed on precisely the case
  this slice exists for. The recorded session in `real-project-evidence/` had
  that shape — an untracked `tests/Feature/MazeTest.php` in a directory that did
  not previously exist.
- Made a new file a changed path, which is the other correction. The ticket
  states the content set, but `listChangedPaths` skipped every `??` entry, so a
  created file was reported as no change at all and no applicability rule could
  match it. Grading a file no rule considers applicable is half a fix. An
  untracked path is still nothing to a `git-index` change.
- Named both sides of a rename and only one side of a copy. A rename's source is
  gone and its destination is new, so a rule matching either sees the whole move.
  A copy leaves its source byte-identical, and naming it would report a change to
  a file nobody touched. The source field is now read when either status column
  reports `R` or `C`; the previous parser checked the index column alone, and a
  worktree-column rename would have desynchronized the parse.
- Kept a deletion out of the failure family. A file the worktree no longer has is
  neither listed nor written, so the identity still names exactly the tree the
  checks ran on. Only that expected absence stopped being an error: a path Git
  still reports and the filesystem cannot read is `snapshot-mismatch` as before,
  proved by a fixture that injects a phantom tracked path.
- Left ignored content ignored. `git status` is asked without `--ignored`, so the
  ignore rules stay where Git owns them. A declared dependency root is still the
  one way git-ignored content reaches an execution root, and a fixture proves a
  provided root leaves the worktree snapshot identity byte-identical.
- Proved the commit path did not move, rather than assuming it. The `git-index`
  regression captures a clone carrying a staged addition, a staged deletion, an
  untracked file, a worktree deletion, and git-ignored content all at once, and
  asserts a literal snapshot identity recorded by running the same fixture
  against the pre-TB-034 module. A commit is graded on the same tree, under the
  same identity, as before.
- Reached the defect through the real runner. The
  `packaged-preflight-answers-client` scenario now drives the packaged preflight
  program as a child process against a clone whose only change is a new untracked
  failing file, and against one whose only change is a deletion. Without the fix
  the first reported clean and the second answered `unverified`; the required
  check in that scenario now grades the directory it is pointed at, because a
  check that can only fail on a path named in advance could never have noticed a
  path the snapshot silently omitted.
- Checked the interaction with TB-027 rather than discovering it. The preflight
  repetition budget counts prior Evidence entries carrying the same
  `evaluationId`, and that identity is derived from the snapshot identity — so an
  agent that answers feedback by adding a file gets a new identity and is told
  again, instead of being silenced for unchanged content.

Scope held: `git-index` capture is untouched; no snapshot kind was added; the
preflight is still `not-authoritative` and blocks nothing; no authoritative
evaluation reads the worktree; nothing git-ignored enters a snapshot; and file
modes, symlink targets, and submodules were stated as known limitations in the
evaluation process contract rather than partly modelled.

A residual worth stating: a snapshot carries file content only. A change that
consists solely of a permission bit, a retargeted symlink, or a moved submodule
commit is a change this gate cannot grade, and the contract now says so.

Verification: `npm run test:unit` (384 passing, 7 of them new), `npm run
validate` (29 skills, 258 Markdown files), `npm run test:install`, and runs of
all nine capabilities — `gate-runtime-binding-smoke`, `gate-fix-smoke`,
`gate-evidence-prune-smoke`, `gate-activation-smoke`,
`gate-hook-conformance-smoke`, `gate-lifecycle-smoke`,
`gate-adapter-conformance`, `gate-security-control-smoke`, and
`gate-runtime-portability`. Red before green was observed twice: the first unit
fixture failed with `ENOENT … app/Legacy.php` from `captureSnapshot`, and
`packaged-preflight-answers-client` reported `a clone whose only change is a new
untracked failing file reported clean: ""` against the unmodified module.

For an already-activated clone: nothing to reconfigure. Worktree preflights now
report on the whole change from the next turn, which for most sessions means
reporting on files that were previously invisible.
