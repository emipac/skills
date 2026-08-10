# Evaluation coordination contract

Gate execution is serialized per clone, shares only work that is provably
identical and still running, and answers `unverified` whenever coordination
cannot be trusted.

## What the lock is keyed on

One lock per **resolved, canonical Git common directory**, at
`<git-common-dir>/change-evaluation-gate/coordination/lock.json`.

Every linked worktree of one clone answers with the same common directory, so
one clone has exactly one lock however many worktrees or clients it has. Git
answers a linked worktree with an absolute path and the primary worktree with a
relative one, so the path is canonicalized before it is used — the same
canonicalization the Evidence store performs. A lock keyed on a repository root
would give one clone as many locks as it has worktrees.

The lock is never keyed on anything broader: unrelated repositories never block
each other, and there is no machine-wide or cross-repository lock.

## What the lock records

| Field | Meaning |
| --- | --- |
| `lockVersion` | Versioned on-disk shape |
| `lockId` | Identity of this holder's turn |
| `pid` | Holding process |
| `host` | Holding host |
| `startedAt` | When the turn began |
| `heartbeatAt` | When the holder last proved it was alive |
| `bindingKey`, `executionId`, `role` | What the holder is evaluating |

Exclusive file creation is the mutual exclusion. A holder rewrites its record
through a staging file and one rename, so a reader never sees a partial lock, and
a holder only ever removes its own lock.

## Sharing

Two subscribers may share one execution only when every identity of the full
evaluation binding matches and that execution is **still running**:
`snapshotId`, `configurationId`, `planId`, `environmentId`, and `taskId`. A
binding missing any of them has no sharing key and is never shared, because work
whose identity is not fully known cannot be proved identical.

There is **no persistent pass cache in v1**. A completed execution leaves the
in-flight table immediately; a later identical binding runs its own evaluation.

Sharing an execution never shares an authorization. Each subscriber's decision
carries the authorization derived from that subscriber's own Enforcement role, so
a `preflight` subscriber of an authoritative execution still receives
`not-authoritative`, and an `authoritative` subscriber of a preflight-initiated
execution receives its own `allow` or `deny`. The graded outcome is the same
evidence for everyone; only the authorization is role-specific.

## Queueing and Git priority

Different evaluations queue. Selection happens only while nothing is running, so
a started execution is never preempted; an authoritative `commit-attempt`
evaluation advances ahead of queued-but-not-running preflights, and equal ranks
keep submission order. Early-feedback traffic therefore cannot indefinitely delay
a commit, and a running preflight is never interrupted mid-flight.

A client refused the clone-wide lock waits its turn. The wait is bounded; a
client that gives up fails as coordination rather than running unserialized.

## Cancellation

Cancellation is subscriber-local. It detaches exactly one subscriber's interest
and settles that subscriber as `cancelled`; work another subscriber still
requires keeps running. Execution is only signalled to stop once no subscriber
requires it any more.

## Stale-lock recovery

A holder looks stale when its process is provably not running on this host, or
when its heartbeat has expired. A holder on another host cannot be probed from
here, so its liveness stays `unknown` and only an expired heartbeat can make it
look stale.

Recovery is **explicit and audited, never implicit**:

- acquisition never clears a stale lock — it reports `lock-stale` and still
  refuses;
- an inspection returns a recovery token that is the identity of exactly what was
  observed, and a confirmation that does not reproduce it recovers nothing;
- a live holder is never recovered, however insistent the operator;
- the recovered lock record is preserved by rename under `recovered/`, never
  deleted;
- every attempt, refused or succeeded, appends a `stale-lock-recovery` Lifecycle
  event through the Evidence store.

## Failure

Coordination that cannot be trusted is the `coordination-failure` reason code,
which normalizes to `unverified` — never to an authorization. A bound gate that
cannot obtain its lease materializes nothing and executes nothing, and an
authoritative role can only ever turn that into `deny`.

There is no silent fallback: work that could not be serialized is not run.

A gate with no coordination bound is a single-client gate and never claims to
have serialized anything.
