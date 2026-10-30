---
"ai-skills-framework": minor
---

Give every Change Evaluation Gate execution root a scratch directory of its own
and hand it to each check as `TMPDIR`, `TMP`, and `TEMP`. Checks used to share
the machine's temporary directory, so a tool that cached there (PHPStan, Rector)
kept absolute paths into an earlier root that had since been deleted, and the
next evaluation crashed on a file that no longer existed. The scratch directory
sits beside the root, is removed with it (also on SIGINT/SIGTERM), and is
reclaimed by the orphan sweep. A descriptor that declares one of those names in
`allowed_environment` keeps its declared value. Tool caches are now cold on
every evaluation.
