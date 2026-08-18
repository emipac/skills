---
"ai-skills-framework": patch
---

Give every check the environment its own pinned program needs in order to
start. Checks ran with only the environment names their descriptor declared,
built from nothing, and migration defaults that declaration to empty — so a
check ran with no PATH at all and any executable that is a script exited `127`
before reading a line of the code it was asked to grade. Most real tool
binaries are scripts: `vendor/bin/pint` and `vendor/bin/phpstan` begin
`#!/usr/bin/env php`, `npm` begins `#!/usr/bin/env node`.

Resolution now reads the first line of a resolved executable and pins the
interpreter it names beside it, so an interpreter that cannot be found leaves
the runner `runner-unresolved` and refuses activation instead of failing as a
mystery check at commit time. Execution supplies a runtime-owned search path
built from the pinned executables, their interpreters, and the platform's own
utility directories — never the invoking shell, so no version manager or
package-manager prefix can change which program a pinned command reaches. A
descriptor declaring `PATH` has its ambient value appended after those entries.

The Activation receipt now pins each runner's interpreter. A clone activated
before this change still runs, but a shebang binary whose interpreter lives
outside the pinned directories needs `gate repair` to be re-pinned.
