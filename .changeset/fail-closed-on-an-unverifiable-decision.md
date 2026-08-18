---
"ai-skills-framework": patch
---

Fail closed in the authoritative Git hook on any decision the runner cannot
verify. Completeness is now judged by `validateDecision`, the evaluation
contract's own rule, so a decision missing its checks, evidence, evaluation
identity, or snapshot denies with the contract findings stated rather than
exiting `0`. An `allow` is authorized only by evidence that was positively
persisted and carries its reference, so absent, `false`, and malformed evidence
take one path. `validateDecision` is total: every malformed input returns
findings and none of them throws. At attempt level, a check whose program could
not be launched is `unverified` with a new `launch-failed` reason reported by
bounded execution, never `failed` / `grader-negative`, and a tool that really
runs is still classified by its own exit status.
