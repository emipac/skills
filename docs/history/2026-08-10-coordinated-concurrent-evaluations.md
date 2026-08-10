# Coordinated concurrent evaluations

Delivered TB-009 as the Gate's answer to more than one client at a time: two
editors, a commit hook, and a linked worktree can now ask the same clone to grade
something at the same moment without racing, without sharing work that is not
identical, and without any of them changing what another is allowed to do.

- Added the per-clone coordination lock at
  `<git-common-dir>/change-evaluation-gate/coordination/lock.json`, keyed on the
  *canonical* resolved Git common directory. Every linked worktree of one clone
  answers with that same directory, so one clone has exactly one lock however
  many worktrees or clients it has. This reuses the canonicalization TB-008 added
  after discovering that a linked worktree resolved `/private/var/...` while the
  primary resolved `/var/...`; a lock keyed on the raw path would have
  reintroduced that split as a silent loss of mutual exclusion. Unrelated
  repositories never block each other — there is no cross-repository lock.
- Made the lock evidence-bearing. Every holder records its process, host, start
  instant, last heartbeat, and what it is evaluating. Exclusive file creation is
  the mutual exclusion; a holder rewrites its record through a staging file and
  one rename, and only ever removes its own lock.
- Made sharing require proof rather than resemblance. Two subscribers share one
  execution only when `snapshotId`, `configurationId`, `planId`, `environmentId`,
  and `taskId` all match and that execution is still running. A binding missing
  any identity has no sharing key at all, because work whose identity is not
  fully known cannot be proved identical to other work.
- Kept the promise that there is no persistent pass cache in v1. A completed
  execution leaves the in-flight table immediately; an identical binding
  submitted afterwards runs its own evaluation. Sharing is an optimization over
  work in flight, never a memory of work that finished.
- Made sharing role-blind and authorization role-specific. Subscribers of one
  shared execution receive the same graded outcome and each receive the
  authorization derived from their own Enforcement role, so a preflight
  subscriber of an authoritative execution still receives `not-authoritative` and
  never inherits an `allow`. Sharing changes what is executed, never who may
  enforce.
- Gave authoritative Git priority over queued preflights. Selection happens only
  while nothing is running, so a started execution is never preempted, an
  authoritative `commit-attempt` advances ahead of queued-but-not-running
  preflights, and equal ranks keep submission order. Early-feedback traffic
  cannot indefinitely delay a commit, and a running preflight is never
  interrupted mid-flight.
- Made cancellation subscriber-local, which is the ticket's named first red test.
  Cancelling one of two identical subscribers detaches that subscriber and
  settles it as `cancelled`; the execution the other subscriber still requires
  keeps running and is never restarted. Execution is only signalled to stop once
  nobody requires it.
- Made a client refused the lock wait its turn rather than fail immediately.
  The wait is bounded and injectable; a client that gives up is a coordination
  failure, never an unserialized run.
- Made stale-lock recovery explicit and audited, never implicit. A holder is
  stale when its process is provably not running on this host or its heartbeat
  expired; a holder on another host stays `unknown` rather than being presumed
  dead. Acquisition reports `lock-stale` and still refuses. Recovery requires a
  confirmation reproducing the identity of exactly the inspected record, refuses
  a live holder outright, preserves the recovered record by rename instead of
  deleting it, and appends a `stale-lock-recovery` Lifecycle event — for the
  refusals as well as the success — through TB-008's existing store.
- Filled in `coordination-failure` in place rather than adding a parallel
  decision shape. `evaluate` now accepts a coordination seam; a lease it cannot
  obtain ends the evaluation before anything is materialized or executed, and the
  decision is `unverified` with one `coordination-failure` diagnostic. An
  authoritative role can only ever turn that into `deny`. A gate with no
  coordination bound is a single-client gate and never claims to have serialized
  anything.

The concurrency fixtures force every interleaving they assert through injected
clocks, explicit barriers, and controllable executors — no sleeps, no polling for
a hoped-for ordering. Stale-lock recovery is proved against a genuinely spawned
and exited process rather than a mocked PID. The first version of the
linked-worktree serialization fixture was itself racy — it asserted that the
first client had entered its execution when all that was proved was that the
first client had written the lock file — and it was fixed by making that barrier
explicit rather than by loosening the assertion.
