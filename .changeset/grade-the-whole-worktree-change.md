---
"ai-skills-framework": patch
---

Grade the whole worktree change in a Change Evaluation Gate preflight,
including the files that are new. A `worktree` snapshot was materialized from
`git ls-files`, which lists index entries: a file the agent had just created was
in no execution root the gate ever built and no check read it, while an ordinary
deletion left an index entry pointing at a file that was gone, failed the
capture, and made the whole preflight `unverified` before a single check ran. A
rename was both at once.

The worktree content set is now the tracked paths, plus the
untracked-and-not-ignored ones, minus the ones the worktree no longer holds,
derived from the `git status --porcelain` parse that was already there. A
created file is graded and reported as a changed path so applicability rules can
match it; a deletion is materialized by absence and is no longer an error; both
sides of a rename are reported, while a copy names only its destination. Ignored
content still never enters a snapshot, and a declared dependency root remains the
one way git-ignored content reaches an execution root and stays outside the
identity. A path Git still reports that cannot be read is `snapshot-mismatch` as
before.

The `git-index` path is untouched: a commit is graded on the same tree, under the
same snapshot identity, as it was before, proved by a fixture pinned to the
identity the previous implementation produced.

File modes, symlink targets, and submodules are stated as known limitations in
the evaluation process contract: a snapshot carries file content only, so a
change consisting solely of one of those is not something this gate can grade.
