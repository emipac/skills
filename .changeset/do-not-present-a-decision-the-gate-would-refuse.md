---
"ai-skills-framework": patch
---

Judge a preflight decision by the same contract the authoritative runner judges
by. The wrapper around `validateDecision` is now shared by both runners, so
neither carries its own definition of a complete decision, and a decision the
contract rejects is presented as `unverified` through the declared feedback
channel — naming that it could not be read and how many contract findings there
were, rather than reproducing them in a message an agent is prompted with.
Preflight remains not-authoritative and non-blocking, and still always exits 0.
