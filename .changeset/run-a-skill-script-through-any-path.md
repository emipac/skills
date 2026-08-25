---
"ai-skills-framework": patch
---

Run a released skill script through whatever path a client installed it at. A
script decided whether it was the command being run by comparing its own
resolved module URL against an unresolved `process.argv[1]`, so a client that
installs by linking — `.claude/skills/<skill>` pointing at `.agents/skills/<skill>`
— produced two different paths for one file: the command never ran, nothing was
printed, and the process exited `0`, which is indistinguishable from success.
Both sides now resolve to their real path before being compared, a
`process.argv[1]` that names a path which does not exist falls back to the
normalized path rather than throwing, and importing a script still runs no CLI.
The rule is one definition vendored byte-for-byte into each skill that ships a
command, since skills install independently and must not import one another;
`npm run validate` fails if a copy diverges.
