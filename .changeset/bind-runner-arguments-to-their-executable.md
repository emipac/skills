---
"ai-skills-framework": patch
---

Bind each logical runner's stored arguments to its resolved executable through
one composition rule owned by the runner, so a previewed invocation is
byte-identical to the one execution runs. A `composer-bin` descriptor no longer
repeats its binary name and a `package-script` descriptor reaches its script
through `run`. Stored schema v4 descriptors are unchanged and a descriptor its
runner cannot compose is reported rather than silently adjusted.
