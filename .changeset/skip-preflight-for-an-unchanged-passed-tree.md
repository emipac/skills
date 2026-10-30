---
"ai-skills-framework": minor
---

Stop the Change Evaluation Gate end-of-turn preflight from repeating its checks
for a worktree it already passed. Every turn used to run a full evaluation
whenever the worktree was dirty at all, even when nothing had changed since the
last passing run. The preflight now derives the snapshot identity of the live
files without copying them, predicts the configuration identity, and, when a
recorded `passed` decision (no diagnostic, no changed or unversioned Grader surface) already
covers that exact tree and configuration, answers like an idle turn: nothing is
materialized or appended, drift is still reported, and the decision says
`unchanged-since-passed`. Failed, `unverified`, and `bypassed` decisions are
never reused, and `gate check` and the commit hook always run. Files outside the
snapshot (an ignored `.env`, dependencies changed without a lock file) are not
covered by the reuse.
