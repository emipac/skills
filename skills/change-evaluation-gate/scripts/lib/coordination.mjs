/**
 * Evaluation coordination.
 *
 * Gate execution is serialized per resolved Git common directory, so every
 * client and every linked worktree of one clone answers to one lock. Exactly
 * matching in-flight bindings share one execution while each subscriber still
 * receives a decision appropriate to its own Enforcement role.
 *
 * There is no persistent pass cache in v1: a completed evaluation is never
 * replayed to a later subscriber. Only work that is still running may be
 * shared (FR-COORD-001, FR-COORD-002, SG-COORD-001).
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';

import { resolveGitCommonDirectory } from './evidence-store.mjs';
import { authorizationFor } from './policy.mjs';

/** The versioned on-disk shape of one coordination lock. */
export const COORDINATION_LOCK_VERSION = 'change-evaluation-gate/coordination/v1';

/** Runtime-owned directory name under the resolved Git common directory. */
export const COORDINATION_DIRECTORY = path.join('change-evaluation-gate', 'coordination');

const DIRECTORY_MODE = 0o700;

const FILE_MODE = 0o600;

/** How long a holder may go without a heartbeat before it looks abandoned. */
export const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;

/** How long a client waits its turn for the clone-wide lock before failing. */
export const DEFAULT_RETRY_LIMIT = 120;

export const DEFAULT_RETRY_DELAY_MS = 250;

/**
 * Best-effort local liveness. A signal-zero probe answers for this host only;
 * `EPERM` means the process exists under another user, which is alive.
 */
const defaultIsProcessAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

/** Every identity that must match before two subscribers may share execution. */
export const BINDING_IDENTITIES = Object.freeze([
  'snapshotId',
  'configurationId',
  'planId',
  'environmentId',
  'taskId',
]);

const canonical = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value ?? null);
};

const identityOf = (value) => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

/** The single contract reason code every coordination failure carries. */
export const COORDINATION_FAILURE = 'coordination-failure';

/**
 * One evaluation-level diagnostic for coordination that cannot be trusted.
 *
 * `coordination-failure` normalizes to `unverified`, so a gate that could not
 * serialize, could not hold its lock, or lost its execution states that nothing
 * was proved. It never becomes an authorization (NFR-REL-003, SG-COORD-001).
 */
export const coordinationFailureDiagnostic = (detail) => ({
  reasonCode: COORDINATION_FAILURE,
  detail: isNonEmptyString(detail)
    ? detail
    : 'Evaluation coordination could not be trusted, so nothing was evaluated.',
});

/**
 * The sharing key of one complete evaluation binding.
 *
 * An incomplete binding has no key. That is deliberate: work whose identities
 * are not fully known can never be proved identical to other work, so it is
 * never shared rather than optimistically matched (SG-COORD-001).
 */
export const coordinationBindingKey = (binding) => {
  const identities = {};

  for (const field of BINDING_IDENTITIES) {
    if (!isNonEmptyString(binding?.[field])) {
      return null;
    }

    identities[field] = binding[field];
  }

  return identityOf(identities);
};

/**
 * Bind one shared decision to one subscriber's Enforcement role.
 *
 * Sharing an execution never shares an authorization. The graded outcome is
 * exactly the same evidence for every subscriber, but only the subscriber's own
 * role decides whether that outcome may allow or deny anything (FR-COORD-002,
 * SG-COORD-001).
 */
export const decisionForRole = (decision, role) => {
  if (decision === null || typeof decision !== 'object') {
    return decision;
  }

  return { ...decision, authorization: authorizationFor(role, decision.outcome) };
};

const deferred = () => {
  let resolve;
  const promise = new Promise((resolveFn) => {
    resolve = resolveFn;
  });

  return { promise, resolve };
};

/**
 * Open the coordination lock for one clone.
 *
 * The lock lives under the *canonical* resolved Git common directory, which is
 * the one path every linked worktree of one clone agrees on. Keying on a
 * repository root instead would give one clone as many locks as it has
 * worktrees, and keying on anything broader would block unrelated repositories
 * (FR-COORD-001).
 *
 * @param {object} options repository root or resolved common directory, plus
 *   injected host, process, and clock seams
 */
export const openCoordinationLock = async ({
  repositoryRoot = null,
  gitCommonDirectory = null,
  host = hostname(),
  pid = process.pid,
  clock = () => new Date(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  isProcessAlive = defaultIsProcessAlive,
  store = null,
  runGit = undefined,
} = {}) => {
  const common = gitCommonDirectory
    ?? await resolveGitCommonDirectory(
      runGit === undefined ? { repositoryRoot } : { repositoryRoot, runGit },
    );
  const root = path.join(common, COORDINATION_DIRECTORY);
  const lockPath = path.join(root, 'lock.json');

  await mkdir(root, { recursive: true, mode: DIRECTORY_MODE });

  const readRecord = async () => {
    const contents = await readFile(lockPath, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') {
        return null;
      }

      throw error;
    });

    if (contents === null) {
      return null;
    }

    try {
      return JSON.parse(contents);
    } catch {
      // A lock nobody can read is a coordination failure, never a free pass.
      return { lockVersion: null, malformed: true };
    }
  };

  /** Rewrite the held record atomically: a reader never sees a partial lock. */
  const writeRecord = async (record) => {
    const staged = path.join(root, `${randomUUID()}.part`);

    await writeFile(staged, `${JSON.stringify(record)}\n`, { mode: FILE_MODE });
    await rename(staged, lockPath);
  };

  /**
   * Report what the lock file says and whether its holder still looks alive.
   *
   * Inspection reads and judges; it never removes anything. A holder on another
   * host cannot be probed from here, so its liveness stays `unknown` and only an
   * expired heartbeat can make it look stale (FR-COORD-005).
   */
  const inspect = async () => {
    const record = await readRecord();

    if (record === null) {
      return {
        held: false,
        record: null,
        liveness: 'absent',
        stale: false,
        staleReasons: [],
        recoveryToken: null,
      };
    }

    const staleReasons = [];
    const liveness = record.malformed === true || record.host !== host
      ? 'unknown'
      : (isProcessAlive(record.pid) ? 'running' : 'not-running');

    if (liveness === 'not-running') {
      staleReasons.push('process-not-running');
    }

    const heartbeatAt = Date.parse(record.heartbeatAt ?? '');

    if (!Number.isFinite(heartbeatAt) || clock().getTime() - heartbeatAt > staleAfterMs) {
      staleReasons.push('heartbeat-expired');
    }

    return {
      held: true,
      record,
      liveness,
      stale: staleReasons.length > 0,
      staleReasons,
      // The token is the identity of exactly what was observed. A recovery that
      // cannot reproduce it was never shown this lock.
      recoveryToken: identityOf(record),
    };
  };

  const audit = async (event) => {
    if (typeof store?.appendLifecycleEvent !== 'function') {
      return null;
    }

    return store.appendLifecycleEvent({ type: 'stale-lock-recovery', ...event });
  };

  /**
   * Recover one stale lock explicitly.
   *
   * Nothing here ever happens implicitly: acquisition never clears a stale
   * lock, a live holder is never recovered, a confirmation that does not
   * reproduce the inspection recovers nothing, and the recovered record is
   * preserved rather than deleted. Every attempt — refused or succeeded — is
   * audited (FR-COORD-005, NFR-AUD-001).
   */
  const recoverStale = async ({ confirmation = null, reason = null } = {}) => {
    const inspection = await inspect();

    const refuse = async (reasonCode, detail) => {
      await audit({
        before: inspection.recoveryToken,
        after: null,
        outcome: 'refused',
        reason: `${reasonCode}: ${detail}`,
      });

      return { recovered: false, reasonCode, detail, inspection, recoveredPath: null };
    };

    if (!inspection.held) {
      return refuse('lock-absent', 'There is no lock to recover.');
    }

    if (!inspection.stale) {
      return refuse('lock-not-stale', 'The lock holder is still alive, so nothing may be taken from it.');
    }

    if (confirmation !== inspection.recoveryToken) {
      return refuse('recovery-mismatch', 'The confirmation did not reproduce the inspected lock, so nothing was recovered.');
    }

    const recoveredAt = clock().toISOString();
    const lockId = inspection.record.lockId ?? randomUUID();
    const recoveredPath = path.join(root, 'recovered', `${lockId}.json`);

    await mkdir(path.dirname(recoveredPath), { recursive: true, mode: DIRECTORY_MODE });
    // A rename, never a delete: the abandoned holder's evidence outlives the
    // recovery that took its turn.
    await rename(lockPath, recoveredPath);

    const after = identityOf({ lockId, recoveredAt, recoveredBy: { pid, host } });

    await audit({
      before: inspection.recoveryToken,
      after,
      outcome: 'succeeded',
      reason: reason ?? `Recovered a stale lock held by process ${inspection.record.pid} on host ${inspection.record.host} (${inspection.staleReasons.join(', ')}); the lock record was preserved.`,
    });

    return {
      recovered: true,
      reasonCode: null,
      detail: null,
      inspection,
      recoveredPath,
      recoveredAt,
      recoveryId: after,
    };
  };

  const acquire = async ({ bindingKey = null, executionId = null, role = null } = {}) => {
    const now = clock().toISOString();
    const record = {
      lockVersion: COORDINATION_LOCK_VERSION,
      lockId: randomUUID(),
      // Process, host, start, and heartbeat evidence: everything a later
      // operator needs to judge whether this holder is still alive
      // (FR-COORD-005).
      pid,
      host,
      startedAt: now,
      heartbeatAt: now,
      bindingKey,
      executionId,
      role,
    };

    try {
      // Exclusive creation is the whole mutual exclusion: whoever creates the
      // file holds the lock, and nobody else may write it.
      const handle = await open(lockPath, 'wx', FILE_MODE);

      await handle.writeFile(`${JSON.stringify(record)}\n`, { encoding: 'utf8' });
      await handle.close();
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }

      const inspection = await inspect();
      const holder = inspection.record;

      return {
        acquired: false,
        // A stale lock is named as stale and still refuses. Acquisition never
        // clears it: recovery is explicit and audited (FR-COORD-005).
        reasonCode: inspection.stale ? 'lock-stale' : 'lock-held',
        detail: `The evaluation lock is held by process ${holder?.pid ?? 'unknown'} on host ${holder?.host ?? 'unknown'} since ${holder?.startedAt ?? 'unknown'}${inspection.stale ? ` and looks stale (${inspection.staleReasons.join(', ')})` : ''}.`,
        record: holder,
        inspection,
        // A refused caller holds nothing, so its release and heartbeat do
        // nothing. Removing another holder's lock is never implicit.
        heartbeat: async () => ({ beat: false, reasonCode: 'lock-not-held' }),
        release: async () => ({ released: false, reasonCode: 'lock-not-held' }),
      };
    }

    const heldBy = async () => {
      const current = await readRecord();

      return current?.lockId === record.lockId ? current : null;
    };

    return {
      acquired: true,
      reasonCode: null,
      detail: null,
      record,
      heartbeat: async () => {
        const current = await heldBy();

        if (current === null) {
          return { beat: false, reasonCode: 'lock-not-held' };
        }

        const beatAt = clock().toISOString();

        await writeRecord({ ...current, heartbeatAt: beatAt });

        return { beat: true, reasonCode: null, heartbeatAt: beatAt };
      },
      release: async () => {
        // Only the holder's own lock is ever removed.
        if (await heldBy() === null) {
          return { released: false, reasonCode: 'lock-not-held' };
        }

        await rm(lockPath, { force: true });

        return { released: true, reasonCode: null };
      },
    };
  };

  return {
    gitCommonDirectory: common,
    root,
    lockPath,
    host,
    pid,
    staleAfterMs,
    acquire,
    inspect,
    recoverStale,
    readRecord,
  };
};

/**
 * Create one coordinator over one Git common directory.
 *
 * @param {object} options the per-common-directory lock seam
 */
export const createEvaluationCoordinator = ({
  lock,
  retry = null,
  retryLimit = DEFAULT_RETRY_LIMIT,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
} = {}) => {
  if (typeof lock?.acquire !== 'function') {
    // Coordination never silently falls back to running unserialized.
    throw new TypeError('An evaluation coordinator requires a per-common-directory lock seam.');
  }

  /**
   * Decide whether to keep waiting for the clone-wide lock.
   *
   * Another client holding the lock is a queue, not a failure: this coordinator
   * waits its turn. The wait is bounded, and exhausting it is a coordination
   * failure rather than an unserialized run (FR-COORD-001, FR-COORD-003).
   */
  const waitForTurn = retry ?? (async ({ attempt }) => {
    if (attempt > retryLimit) {
      return false;
    }

    await new Promise((resolve) => {
      // A pending wait never keeps a host process alive on its own.
      setTimeout(resolve, retryDelayMs).unref?.();
    });

    return true;
  });

  const inFlight = new Map();
  const queue = [];
  let running = null;
  let started = 0;
  let subscriberSequence = 0;
  let executionSequence = 0;

  const createExecution = (bindingKey, binding, run) => ({
    id: `execution-${executionSequence += 1}`,
    bindingKey,
    binding,
    run,
    subscribers: new Map(),
    controller: new AbortController(),
    started: false,
    settled: false,
    sequence: executionSequence,
  });

  /**
   * Queue rank of one subscriber. Authoritative Git enforcement outranks
   * everything, so early-feedback traffic can never indefinitely delay a commit
   * (FR-COORD-003).
   */
  const rankOf = (subscriber) => {
    if (subscriber.role !== 'authoritative') {
      return 2;
    }

    return subscriber.trigger === 'commit-attempt' ? 0 : 1;
  };

  /** An execution ranks as high as its most authoritative waiting subscriber. */
  const priorityOf = (execution) => [...execution.subscribers.values()]
    .reduce((best, subscriber) => Math.min(best, rankOf(subscriber)), 2);

  const settle = (subscriber, result) => {
    if (subscriber.settled) {
      return subscriber.result;
    }

    subscriber.settled = true;
    subscriber.result = result;
    subscriber.gate.resolve(result);

    return result;
  };

  const coordinationOf = (execution, subscriber, extra = {}) => ({
    bindingKey: execution.bindingKey,
    executionId: execution.id,
    subscriberId: subscriber.id,
    role: subscriber.role,
    leader: subscriber.leader,
    shared: subscriber.shared,
    // Sharing is reported, never silent: a decision produced by shared work
    // states how many subscribers that one execution served.
    sharedSubscribers: execution.subscribers.size,
    reasonCode: null,
    ...extra,
  });

  const finish = (execution, deliver) => {
    execution.settled = true;

    if (inFlight.get(execution.bindingKey) === execution) {
      // A completed execution leaves the in-flight table immediately: v1 has no
      // persistent pass cache, so a later subscriber always runs its own work.
      inFlight.delete(execution.bindingKey);
    }

    for (const subscriber of execution.subscribers.values()) {
      settle(subscriber, deliver(subscriber));
    }
  };

  /**
   * Select and start the next execution.
   *
   * Selection happens only while nothing is running: a started execution is
   * never preempted, so an authoritative Git evaluation advances ahead of
   * queued-but-not-running preflights and never interrupts one mid-flight.
   */
  const drain = () => {
    if (running !== null || queue.length === 0) {
      return;
    }

    let selected = 0;

    for (let index = 1; index < queue.length; index += 1) {
      // Equal rank keeps submission order, so nothing at one rank starves.
      if (priorityOf(queue[index]) < priorityOf(queue[selected])) {
        selected = index;
      }
    }

    const [execution] = queue.splice(selected, 1);

    running = execution;
    execution.started = true;

    start(execution).finally(() => {
      running = null;
      drain();
    });
  };

  const enqueue = (execution) => {
    queue.push(execution);
    drain();
  };

  const fail = (execution, detail) => finish(execution, (subscriber) => ({
    status: 'failed',
    // Coordination never answers with a decision it did not obtain. The reason
    // travels instead, and every reason here normalizes to `unverified`
    // (FR-COORD-005, NFR-REL-003).
    decision: null,
    diagnostic: coordinationFailureDiagnostic(detail),
    coordination: coordinationOf(execution, subscriber, {
      reasonCode: COORDINATION_FAILURE,
    }),
  }));

  const start = async (execution) => {
    const run = execution.run;

    started += 1;

    const request = {
      bindingKey: execution.bindingKey,
      executionId: execution.id,
      role: [...execution.subscribers.values()][0]?.role ?? null,
    };
    let lease = await lock.acquire(request);
    let attempt = 0;

    while (lease?.acquired !== true) {
      attempt += 1;

      const again = execution.subscribers.size > 0 && await waitForTurn({
        attempt,
        reasonCode: lease?.reasonCode ?? null,
        detail: lease?.detail ?? null,
        record: lease?.record ?? null,
      }) === true;

      if (!again) {
        // Work that could not be serialized is not run. There is no
        // unserialized fallback and no quiet degradation.
        fail(execution, `${lease?.reasonCode ?? 'lock-unavailable'}: ${lease?.detail ?? 'the evaluation lock could not be acquired.'}`);

        return;
      }

      lease = await lock.acquire(request);
    }

    try {
      const decision = await run({
        signal: execution.controller.signal,
        binding: execution.binding,
        bindingKey: execution.bindingKey,
        executionId: execution.id,
        lease,
      });

      finish(execution, (subscriber) => ({
        status: 'decided',
        decision: decisionForRole(decision, subscriber.role),
        diagnostic: null,
        coordination: coordinationOf(execution, subscriber),
      }));
    } catch (error) {
      // A coordinated execution that throws is reported, never left as an
      // unhandled rejection and never reported as a pass.
      fail(execution, `execution-failed: ${error.message}`);
    } finally {
      await lease.release();
    }
  };

  /**
   * Register one subscriber's interest in one evaluation binding.
   *
   * Registration is synchronous so a second identical subscriber can always see
   * the first one's in-flight execution; only the execution itself is
   * asynchronous.
   */
  const submit = ({ binding, role, trigger = null, run } = {}) => {
    const bindingKey = coordinationBindingKey(binding);
    const existing = bindingKey === null ? null : inFlight.get(bindingKey);
    const execution = existing ?? createExecution(bindingKey, binding, run);
    const subscriber = {
      id: `subscriber-${subscriberSequence += 1}`,
      role: role ?? null,
      trigger,
      leader: existing === undefined || existing === null,
      shared: Boolean(existing),
      settled: false,
      result: null,
      gate: deferred(),
    };

    execution.subscribers.set(subscriber.id, subscriber);

    if (!existing) {
      if (bindingKey !== null) {
        inFlight.set(bindingKey, execution);
      }

      enqueue(execution);
    }

    const cancel = async () => {
      if (subscriber.settled) {
        return subscriber.result;
      }

      execution.subscribers.delete(subscriber.id);

      const result = settle(subscriber, {
        status: 'cancelled',
        decision: null,
        diagnostic: null,
        coordination: coordinationOf(execution, subscriber),
      });

      // Cancellation detaches exactly one subscriber's interest. Execution stops
      // only once nobody requires it any more (FR-COORD-004, SG-COORD-001).
      if (execution.subscribers.size === 0 && !execution.settled) {
        execution.controller.abort();

        if (inFlight.get(execution.bindingKey) === execution) {
          inFlight.delete(execution.bindingKey);
        }

        const queued = queue.indexOf(execution);

        // Work nobody requires any more leaves the queue rather than occupying
        // a turn that belongs to a subscriber who is still waiting.
        if (queued !== -1) {
          queue.splice(queued, 1);
        }
      }

      return result;
    };

    return {
      subscriberId: subscriber.id,
      role: subscriber.role,
      bindingKey,
      executionId: execution.id,
      shared: subscriber.shared,
      promise: subscriber.gate.promise,
      cancel,
    };
  };

  return {
    submit,
    startedExecutions: () => started,
    queuedExecutions: () => queue.map((execution) => execution.id),
    runningExecution: () => running?.id ?? null,
    inFlightBindings: () => [...inFlight.keys()],
  };
};
