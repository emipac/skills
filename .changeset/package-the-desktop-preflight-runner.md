---
"ai-skills-framework": minor
---

Ship the packaged Change Evaluation Gate preflight runner a desktop client hook
can register: it reads the native payload on stdin, evaluates the working tree
as `not-authoritative` preflight, answers through the adapter's declared
feedback channel, and exits `0` regardless of outcome — a failing required
check names the check on that channel, a passing turn writes nothing, and
unreadable payloads, unmatched events, missing roots, and internal failures
present as `unverified` rather than as silence or a clean pass.
