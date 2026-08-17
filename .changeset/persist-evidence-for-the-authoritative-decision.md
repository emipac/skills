---
"ai-skills-framework": patch
---

Bind the authoritative Git hook to the clone-local Evidence store its
Activation receipt already identifies, so every commit-time evaluation now
appends its Evidence envelope and Lifecycle event instead of persisting
nothing. Check output is captured and bounded into the envelope, declared
runtime input values are redacted from it, and the clone's own configured
Evidence ceilings apply. A store that cannot be opened or written to denies
the commit with a distinct stated reason rather than ever authorizing a
commit whose evidence could not be recorded.
