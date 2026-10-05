# Let a maintainer and an agent observe the Gate

Delivered TB-040. A maintainer can ask an activated clone how it is, and so can
an agent, by running the same command. Observation reports health,
coordination, and what a prune would remove, and it writes nothing at all.

- Added the packaged `change-evaluation-gate` command (`gate.mjs`, declared as a
  bin in `package.json`) with its first read-only operations.
- `gate status` reports `healthy`, `degraded`, or `broken` against fixtures that
  produce each, and every run leaves the clone and the Evidence store
  byte-for-byte unchanged (`FR-LIFE-009`, `AC-LIFE-004`).
- `--json` returns a parseable document naming the same findings the human
  rendering shows, from the same run (`NFR-OPER-001`).
- `gate locks` reports a free lock, a live holder, and a stale holder, and
  recovers nothing in any of them (`AC-COORD-001`, `FR-COORD-005`).
- The prune preview names the exact blobs and bytes a prune would remove,
  returns its confirmation token, and removes and appends nothing
  (`AC-EVID-002`, `SG-EVID-001`).
- An unhealthy clone and a failed invocation are distinguishable by exit
  status.

Evidence added: `tests/gate-operator-surface.test.mjs`, with
`gate-lifecycle-smoke` extended. `SKILL.md` and the lifecycle command contract
document the surface.
