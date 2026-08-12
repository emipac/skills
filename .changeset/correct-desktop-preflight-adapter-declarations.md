---
"ai-skills-framework": minor
---

Correct the Change Evaluation Gate desktop preflight adapter declarations
against real captured client payloads: each surface declares the field names,
event value, and field shape its client actually sends, a repository root is
resolved upward from the path a client sends rather than assumed and is
`unverified` when none resolves, Cursor's array of workspace roots has an
explicit rule that reports `unverified` for a multi-root workspace instead of
selecting one, no desktop surface declares a `commit-attempt` event any longer
while Cursor records its unobserved one as unverified rather than claimed, and a
compatibility baseline records whether real client invocations or injected
payloads drove it so no surface can be called supported on fixture evidence
alone.
