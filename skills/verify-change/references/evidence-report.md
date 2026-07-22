# Verification evidence report

```markdown
## Verification evidence

**Profile:** <configured profile>
**Changed surfaces:** <backend/frontend/user-facing>

| Stage | Acceptance IDs | Exact command | Outcome | Result summary |
| --- | --- | --- | --- | --- |
| focused | AC-AREA-001 | `<command>` | passed/failed/skipped | <observable result or skip reason> |

## Capability gaps

- <Required missing capability, or None.>

## Pre-existing failures

- <Exact command and evidence that the failure predates this change, or None.>
```

Every required planner step needs one row with the exact command. Optional
skips require a concrete reason. Record the final successful rerun after the
last relevant code change rather than an earlier stale pass.
