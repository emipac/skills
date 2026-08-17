---
"ai-skills-framework": patch
---

Resolve every logical runner through one exported rule, and run the executables
the Activation receipt pinned. A `composer-bin` check now resolves to the
absolute vendor binary its descriptor names, under the descriptor's own working
directory, instead of the `composer` front end on `PATH` — which ran with the
descriptor's arguments discarded and could report a passed check for a program
the policy never named. A binary name carrying a path separator is refused
rather than joined, and a missing vendor binary is `runner-unresolved`.

The Git hook no longer re-resolves runners: it runs what the receipt pinned, and
a pin whose executable is absent, or that no longer matches its runner, denies
with a drift reason pointing at `gate repair` rather than substituting another
program. Activation now ships a default resolver, so an integrator injecting its
own `resolveExecutable` can drop it.
