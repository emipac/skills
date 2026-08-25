---
"ai-skills-framework": patch
---

Stop reporting a check that could not run as a verdict about the code. Both
production runners passed `resolvePrerequisite: () => true`, so every
requirement a check declared was asserted proved without anything being
established — and a real run reported three environment faults as
`failed` / `grader-negative`, the outcome that means the graded code did not
satisfy the check. The maintainer's agent read them as defects and began
degrading a working project to satisfy them.

Both runners now bind a real resolver, and the `prerequisite-missing` path that
already existed and already failed closed does the rest: an unproved
requirement makes the check `unverified` before its command is started, and the
decision, the `git commit` output, and the desktop preflight channel all name
what was not proved instead of leaving it to be inferred from a tool's error
text. An `executable` is proved on the search path the checks themselves run
with; a `configuration` path against the tree the evaluation materialized and
the dependency roots it provided; an `environment` name against the facts the
evaluation can state about itself or the variables the check will actually be
given; a `service` is never proved, because nothing here probes one. Nothing is
inferred from an exit code or an error string, and Gate core learns no tool
name, flag, or stack: the clone declares what its check needs, beside the
command, in its own configuration — which the configuration reader previously
dropped on the floor.

Authorization is unchanged. A required check that is `unverified` denies
exactly as it denied before; only the reason a maintainer is given changes. A
check that declares no prerequisites behaves exactly as it did.
