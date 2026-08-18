---
"ai-skills-framework": patch
---

Provide the installed dependencies a project's checks need inside the
materialized Evaluation snapshot. The snapshot is built from `git ls-files`, so
git-ignored `vendor/` and `node_modules/` were absent from every execution root
the gate ever built and a tool started inside it could not find the autoloader
or module tree it needs to read any code at all.

A project now declares those directories in
`evaluation_gate.execution.dependency_roots`, and `--draft-policy` derives them
from two proved facts: some configured check runs through a runner that reaches
into that directory, and the manifest governing it exists. Declared roots are
linked beside the snapshot and graded by nothing — they stay outside the
snapshot identity, outside `changedPaths`, and outside the immutability
re-check, so a tool writing into its own cache never produces
`snapshot-mismatch`. A root that is absolute or that would climb out of the
repository is refused, and a declared root the clone has not installed is
`dependency-root-unavailable` and denies rather than becoming a fatal error
from inside somebody's tool. Nothing is ever installed by the gate.

A clone configured before this change declares no dependency roots and behaves
exactly as it did; re-drafting the policy adds them.
