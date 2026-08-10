---
"ai-skills-framework": minor
---

Coordinate concurrent Change Evaluation Gate evaluations safely. Execution now
serializes per resolved, canonical Git common directory, so every client and
every linked worktree of one clone answers to exactly one lock while unrelated
repositories never block each other. The lock records the holding process, host,
start instant, and heartbeat. Only an exactly matching in-flight evaluation
binding — snapshot, configuration, plan, environment, and task identities — may
share one execution, there is still no persistent pass cache, and each subscriber
of a shared execution receives the authorization of its own Enforcement role, so
sharing never changes who may enforce. Different evaluations queue, an
authoritative `commit-attempt` advances ahead of queued-but-not-running
preflights without ever preempting a running one, and a client refused the lock
waits a bounded turn instead of running unserialized. Cancellation is
subscriber-local and never cancels work another subscriber still requires.
Stale-lock recovery is explicit, confirmation-matched, and audited through a
`stale-lock-recovery` Lifecycle event, preserving the recovered record rather
than deleting it; acquisition never clears a stale lock. Coordination that cannot
be trusted fills in the existing `coordination-failure` reason code in place and
returns `unverified` — never an authorization.
