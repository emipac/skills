---
"ai-skills-framework": patch
---

Let a project say how its dependency roots are provided, so a check that
resolves a path finds the snapshot it is grading rather than the repository the
snapshot was taken from.

Every declared dependency root was provided into the execution root by a
symbolic link. A link is reachable, which is all any fixture ever asked of it,
and it is reachable at an address outside the snapshot — so any tool that
resolves a path to its realpath concludes that the project it is grading is the
maintainer's own clone. That is not a quirk of one tool: it is the default
behaviour of PHP's `__DIR__`, of Node's module resolver, and of anything calling
`realpath()`. On a real project it produced thirty-three `import/order` errors
from a TypeScript import resolver and an `InvalidTestClassName` that stopped a
test suite from booting at all, and all of it was reported to the maintainer as
faults in code that was not faulty.

A project now declares `evaluation_gate.execution.dependency_provisioning` as
`link` or `copy`. It defaults to `link`, so every existing clone behaves exactly
as it did and no configuration identity churns. `copy` provides each root as a
real directory, asking for a copy-on-write clone and falling back to a full byte
copy wherever that request is declined — one code path, correct everywhere, with
only speed and disk varying. It is not free: a dependency tree of about
thirty-four thousand files was measured at roughly ten seconds to provide, two
to reclaim, and 373 MiB per evaluation. The strategy is declared, never
detected: nothing reads the operating system or the filesystem and chooses.

A `copy` that cannot be performed is reported as `dependency-root-unavailable`
and never quietly served as a link, and the partial tree the attempt created is
removed with it. A provided root stays outside the snapshot path list, the
snapshot identity, and the immutability re-check under both strategies, so the
identity of an unchanged tree does not depend on how its dependencies were
provided. What was provided, what was missing, what was refused, and which
strategy provided them now reach the decision at `environment.dependencies`, and
the activation preview states the strategy before consent is granted.

Linking also now uses a junction rather than a directory symbolic link, which
needs no elevated privilege on Windows; every other platform ignores the
distinction.
