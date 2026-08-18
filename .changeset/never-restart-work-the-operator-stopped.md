---
"ai-skills-framework": patch
---

Stop the desktop preflight runner from answering a turn the operator
interrupted. A client `stop` event fires whether the turn finished or was
stopped, and the runner read neither the status nor the iteration counter, so
an aborted turn produced a follow-up message the client submitted as the next
user message — restarting the work that had just been stopped, and looping
until the hook was disabled.

Adapters now declare the field carrying the turn status, the values that mean
completed and interrupted, the field carrying the client's iteration counter,
and the maximum number of times one unchanged preflight result may be returned.
An interrupted turn is answered with nothing at all, an undeclared status is
`unverified` rather than assumed complete, and repetition is bounded by the
gate's own append-only record so a client counter that never advances cannot
produce an unbounded loop. Every deliberate silence — including a hook
registered without `--adapter`, which previously looked exactly like a clean
turn — writes its reason to stderr, where the client surfaces it to the
maintainer.
