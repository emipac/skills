import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  createEvaluationCoordinator,
  openCoordinationLock,
} from '../skills/change-evaluation-gate/scripts/lib/coordination.mjs';
import { evaluate } from '../skills/change-evaluation-gate/scripts/lib/evaluate.mjs';
import { validateDecision } from '../skills/change-evaluation-gate/scripts/lib/evaluation-contract.mjs';
import {
  openEvidenceStore,
  resolveGitCommonDirectory,
} from '../skills/change-evaluation-gate/scripts/lib/evidence-store.mjs';
import { validateLifecycleEvent } from '../skills/change-evaluation-gate/scripts/lib/lifecycle-event.mjs';

const runFile = promisify(execFile);

const git = (cwd, args) => runFile('git', args, { cwd });

/**
 * A throwaway repository with one commit and one linked worktree. This
 * repository's own Git state is never read or written.
 */
const fixtureClone = async (t, label) => {
  // The canonical path: on macOS the OS temp directory is itself a symlink, and
  // a lock keyed on a non-canonical path would split one clone in two.
  const root = await realpath(await mkdtemp(path.join(tmpdir(), `gate-coordination-${label}-`)));

  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ['init', '--quiet']);
  await git(root, [
    '-c', 'user.email=fixture@example.invalid',
    '-c', 'user.name=Fixture',
    'commit', '--allow-empty', '--quiet', '-m', 'base',
  ]);

  const linked = path.join(root, '..', `${path.basename(root)}-linked`);

  await git(root, ['worktree', 'add', '--quiet', '--detach', linked]);
  t.after(() => rm(linked, { recursive: true, force: true }));

  return { root, linked: await realpath(linked) };
};

/**
 * Concurrency is proved with explicit barriers, never with sleeps. Every test
 * here forces the interleaving it asserts, so a pass means the ordering held
 * rather than that a timer happened to win.
 */
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });

  return { promise, resolve, reject };
};

/** A complete evaluation binding: only an exact match may share execution. */
const bindingFixture = (overrides = {}) => ({
  snapshotId: 'sha256:snapshot-a',
  configurationId: 'sha256:configuration-a',
  planId: 'sha256:plan-a',
  environmentId: 'sha256:environment-a',
  taskId: 'sha256:task-a',
  ...overrides,
});

const decisionFixture = (overrides = {}) => ({
  protocolVersion: '1.0',
  evaluationId: 'sha256:evaluation-a',
  outcome: 'passed',
  authorization: 'not-authoritative',
  checks: [],
  diagnostics: [],
  ...overrides,
});

/** A lock seam that always grants; the real file lock is exercised separately. */
const grantingLock = () => ({
  acquire: async () => ({
    acquired: true,
    reasonCode: null,
    detail: null,
    record: null,
    heartbeat: async () => {},
    release: async () => {},
  }),
});

test('FR-COORD-004 / SG-COORD-001: cancelling one identical subscriber never cancels execution the other still requires', async () => {
  const started = deferred();
  const finish = deferred();
  const observed = [];
  const coordinator = createEvaluationCoordinator({ lock: grantingLock() });

  const run = async ({ signal }) => {
    observed.push('started');
    started.resolve();
    await finish.promise;
    observed.push(signal?.aborted === true ? 'aborted' : 'completed');

    return decisionFixture();
  };

  const first = coordinator.submit({
    binding: bindingFixture(),
    role: 'preflight',
    trigger: 'work-complete',
    run,
  });
  const second = coordinator.submit({
    binding: bindingFixture(),
    role: 'preflight',
    trigger: 'work-complete',
    run,
  });

  // Both subscribers named the same binding, so exactly one execution exists.
  assert.equal(first.bindingKey, second.bindingKey);
  await started.promise;
  assert.deepEqual(observed, ['started']);

  const cancelled = await first.cancel('the first client went away');

  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.decision, null);
  assert.equal(await Promise.resolve(first.promise).then((result) => result.status), 'cancelled');

  // The second subscriber still requires this execution, so nothing was
  // cancelled and no second execution was started.
  finish.resolve();

  const result = await second.promise;

  assert.equal(result.status, 'decided');
  assert.equal(result.decision.outcome, 'passed');
  assert.deepEqual(observed, ['started', 'completed']);
  assert.equal(coordinator.startedExecutions(), 1);
});

test('FR-COORD-002 / SG-COORD-001: only a matching in-flight binding is shared, and a completed pass is never replayed', async () => {
  const coordinator = createEvaluationCoordinator({ lock: grantingLock() });
  const started = new Map();
  const finished = new Map();
  const runFor = (label) => {
    started.set(label, deferred());
    finished.set(label, deferred());

    return async () => {
      started.get(label).resolve();
      await finished.get(label).promise;

      return decisionFixture({ evaluationId: `sha256:${label}` });
    };
  };

  const first = coordinator.submit({ binding: bindingFixture(), role: 'preflight', run: runFor('a') });
  const second = coordinator.submit({ binding: bindingFixture(), role: 'preflight', run: runFor('b') });
  // A different snapshot is different work: it never joins and never shares a
  // mutable root with the first execution.
  const other = coordinator.submit({
    binding: bindingFixture({ snapshotId: 'sha256:snapshot-b' }),
    role: 'preflight',
    run: runFor('c'),
  });

  assert.equal(first.bindingKey, second.bindingKey);
  assert.notEqual(first.bindingKey, other.bindingKey);
  assert.equal(first.shared, false);
  assert.equal(second.shared, true);
  assert.equal(other.shared, false);
  // Two subscribers, one execution; the different binding queues behind it
  // rather than sharing it.
  assert.equal(coordinator.startedExecutions(), 1);
  assert.deepEqual(coordinator.queuedExecutions(), [other.executionId]);

  // Sharing is reported, not silent: each subscriber can see it joined work it
  // did not lead and how many subscribers that execution served.
  await started.get('a').promise;
  finished.get('a').resolve();
  await started.get('c').promise;
  finished.get('c').resolve();

  const [firstResult, secondResult, otherResult] = await Promise.all([
    first.promise,
    second.promise,
    other.promise,
  ]);

  assert.equal(firstResult.decision.evaluationId, 'sha256:a');
  assert.equal(secondResult.decision.evaluationId, 'sha256:a');
  assert.equal(otherResult.decision.evaluationId, 'sha256:c');
  assert.equal(firstResult.coordination.leader, true);
  assert.equal(secondResult.coordination.leader, false);
  assert.equal(firstResult.coordination.sharedSubscribers, 2);
  assert.equal(otherResult.coordination.sharedSubscribers, 1);

  // There is no persistent pass cache in v1. An identical binding submitted
  // after the first one completed runs its own execution.
  assert.deepEqual(coordinator.inFlightBindings(), []);

  const later = coordinator.submit({ binding: bindingFixture(), role: 'preflight', run: runFor('d') });

  await started.get('d').promise;
  finished.get('d').resolve();

  assert.equal((await later.promise).decision.evaluationId, 'sha256:d');
  assert.equal(coordinator.startedExecutions(), 3);
});

test('FR-COORD-002 / SG-COORD-001: subscribers sharing one execution each receive their own role authorization', async () => {
  const coordinator = createEvaluationCoordinator({ lock: grantingLock() });

  const share = async (outcome) => {
    const started = deferred();
    const finished = deferred();
    const run = async () => {
      started.resolve();
      await finished.promise;

      // The leader's own authorization travels with the decision; it must never
      // become another subscriber's authorization.
      return decisionFixture({ outcome, authorization: 'deny' });
    };
    const preflight = coordinator.submit({
      binding: bindingFixture({ snapshotId: `sha256:${outcome}` }),
      role: 'preflight',
      trigger: 'work-complete',
      run,
    });
    const authoritative = coordinator.submit({
      binding: bindingFixture({ snapshotId: `sha256:${outcome}` }),
      role: 'authoritative',
      trigger: 'commit-attempt',
      run,
    });

    await started.promise;
    finished.resolve();

    return {
      preflight: await preflight.promise,
      authoritative: await authoritative.promise,
    };
  };

  const passed = await share('passed');

  // One execution, two authorizations. Sharing changed neither.
  assert.equal(passed.preflight.coordination.executionId, passed.authoritative.coordination.executionId);
  assert.equal(passed.preflight.decision.outcome, 'passed');
  assert.equal(passed.authoritative.decision.outcome, 'passed');
  assert.equal(passed.preflight.decision.authorization, 'not-authoritative');
  assert.equal(passed.authoritative.decision.authorization, 'allow');

  const failed = await share('failed');

  assert.equal(failed.preflight.decision.authorization, 'not-authoritative');
  assert.equal(failed.authoritative.decision.authorization, 'deny');
});

test('FR-COORD-003: authoritative Git advances ahead of queued preflights and never preempts a running one', async () => {
  const coordinator = createEvaluationCoordinator({ lock: grantingLock() });
  const order = [];
  const started = new Map();
  const finished = new Map();
  const runFor = (label) => {
    started.set(label, deferred());
    finished.set(label, deferred());

    return async () => {
      order.push(label);
      started.get(label).resolve();
      await finished.get(label).promise;

      return decisionFixture();
    };
  };
  const submit = (label, role, trigger) => coordinator.submit({
    binding: bindingFixture({ snapshotId: `sha256:${label}` }),
    role,
    trigger,
    run: runFor(label),
  });

  const first = submit('preflight-running', 'preflight', 'work-complete');

  await started.get('preflight-running').promise;

  // Everything submitted now is queued behind the running preflight.
  const queued = submit('preflight-queued', 'preflight', 'work-complete');
  const git = submit('git-commit', 'authoritative', 'commit-attempt');

  assert.equal(coordinator.startedExecutions(), 1);
  assert.deepEqual(
    coordinator.queuedExecutions(),
    [queued.executionId, git.executionId],
  );
  assert.deepEqual(order, ['preflight-running']);

  // The running preflight is never preempted; early-feedback traffic is not
  // interrupted mid-flight.
  finished.get('preflight-running').resolve();
  await first.promise;
  await started.get('git-commit').promise;

  // Authoritative Git advanced ahead of the preflight queued before it, so
  // early-feedback traffic cannot indefinitely delay a commit.
  assert.deepEqual(order, ['preflight-running', 'git-commit']);

  finished.get('git-commit').resolve();
  await git.promise;
  await started.get('preflight-queued').promise;

  assert.deepEqual(order, ['preflight-running', 'git-commit', 'preflight-queued']);

  finished.get('preflight-queued').resolve();
  await queued.promise;
  assert.equal(coordinator.startedExecutions(), 3);
});

test('FR-COORD-002: an incomplete binding can never be proved identical, so it is never shared', async () => {
  const coordinator = createEvaluationCoordinator({ lock: grantingLock() });
  const gate = deferred();
  const run = async () => {
    await gate.promise;

    return decisionFixture();
  };
  const incomplete = bindingFixture({ planId: null });

  const first = coordinator.submit({ binding: incomplete, role: 'preflight', run });
  const second = coordinator.submit({ binding: incomplete, role: 'preflight', run });

  assert.equal(first.bindingKey, null);
  assert.equal(second.bindingKey, null);
  assert.equal(second.shared, false);
  // Two separate executions, serialized rather than merged.
  assert.equal(coordinator.startedExecutions(), 1);
  assert.deepEqual(coordinator.queuedExecutions(), [second.executionId]);
  assert.notEqual(first.executionId, second.executionId);

  gate.resolve();
  await Promise.all([first.promise, second.promise]);
  assert.equal(coordinator.startedExecutions(), 2);
});

test('FR-COORD-001: one lock serializes a clone across linked worktrees, and never across repositories', async (t) => {
  const clone = await fixtureClone(t, 'primary');
  const unrelated = await fixtureClone(t, 'unrelated');

  const primaryCommon = await resolveGitCommonDirectory({ repositoryRoot: clone.root });
  const linkedCommon = await resolveGitCommonDirectory({ repositoryRoot: clone.linked });

  // One clone, one common directory: the linked worktree is not a second repo.
  assert.equal(primaryCommon, linkedCommon);

  const primary = await openCoordinationLock({ repositoryRoot: clone.root });
  const linked = await openCoordinationLock({ repositoryRoot: clone.linked });
  const other = await openCoordinationLock({ repositoryRoot: unrelated.root });

  assert.equal(primary.lockPath, linked.lockPath);
  assert.equal(path.dirname(path.dirname(primary.lockPath)), path.join(primaryCommon, 'change-evaluation-gate'));
  assert.notEqual(other.lockPath, primary.lockPath);

  const held = await primary.acquire({ bindingKey: 'sha256:binding', executionId: 'execution-1' });

  assert.equal(held.acquired, true);

  // The lock records who holds it, where, since when, and its last heartbeat.
  const record = JSON.parse(await readFile(primary.lockPath, 'utf8'));

  assert.equal(record.pid, process.pid);
  assert.equal(typeof record.host, 'string');
  assert.match(record.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(record.heartbeatAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(record.bindingKey, 'sha256:binding');

  // A second client in a linked worktree of the same clone is refused.
  const refused = await linked.acquire({ bindingKey: 'sha256:other', executionId: 'execution-2' });

  assert.equal(refused.acquired, false);
  assert.equal(refused.reasonCode, 'lock-held');

  // A different repository is never blocked: the lock is per clone, never global.
  const elsewhere = await other.acquire({ bindingKey: 'sha256:elsewhere', executionId: 'execution-3' });

  assert.equal(elsewhere.acquired, true);
  await elsewhere.release();

  // Refusal never removes the holder's lock.
  assert.equal(JSON.parse(await readFile(primary.lockPath, 'utf8')).lockId, record.lockId);

  await held.release();

  const acquired = await linked.acquire({ bindingKey: 'sha256:other', executionId: 'execution-2' });

  assert.equal(acquired.acquired, true);
  await acquired.release();
});

/** A real process that has genuinely exited; its PID is not mocked. */
const exitedProcessPid = async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  const pid = child.pid;

  await once(child, 'exit');

  return pid;
};

const storeIdentity = {
  actor: { name: 'fixture', source: 'test' },
  client: { id: 'claude-code', surface: 'cli', version: '1.0.0' },
  gate: { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' },
  repository: { identity: 'sha256:repository' },
};

test('FR-COORD-005 / NFR-AUD-001: a stale lock is recovered only explicitly, and the recovery is audited', async (t) => {
  const clone = await fixtureClone(t, 'stale');
  const store = await openEvidenceStore({ repositoryRoot: clone.root, identity: storeIdentity });
  const dead = await exitedProcessPid();

  // A holder that has genuinely exited, written by that dead process's identity.
  const abandoned = await openCoordinationLock({ repositoryRoot: clone.root, pid: dead, store });
  const held = await abandoned.acquire({ bindingKey: 'sha256:abandoned', executionId: 'execution-1' });

  assert.equal(held.acquired, true);

  const survivor = await openCoordinationLock({ repositoryRoot: clone.root, store });
  const refused = await survivor.acquire({ bindingKey: 'sha256:next', executionId: 'execution-2' });

  // A stale lock is reported as stale and still refuses. Acquisition never
  // deletes it: recovery is a separate, explicit, audited act.
  assert.equal(refused.acquired, false);
  assert.equal(refused.reasonCode, 'lock-stale');

  const inspection = await survivor.inspect();

  assert.equal(inspection.held, true);
  assert.equal(inspection.stale, true);
  assert.deepEqual(inspection.staleReasons, ['process-not-running']);
  assert.equal(inspection.record.pid, dead);
  assert.match(inspection.recoveryToken, /^sha256:[0-9a-f]{64}$/);
  assert.equal(JSON.parse(await readFile(survivor.lockPath, 'utf8')).pid, dead);

  // A confirmation that does not reproduce the inspection recovers nothing.
  const mismatched = await survivor.recoverStale({ confirmation: 'sha256:not-the-token' });

  assert.equal(mismatched.recovered, false);
  assert.equal(mismatched.reasonCode, 'recovery-mismatch');
  assert.equal(JSON.parse(await readFile(survivor.lockPath, 'utf8')).pid, dead);

  const recovered = await survivor.recoverStale({ confirmation: inspection.recoveryToken });

  assert.equal(recovered.recovered, true);
  assert.equal(recovered.reasonCode, null);

  // The recovered lock record is preserved as evidence, never simply deleted.
  assert.equal(JSON.parse(await readFile(recovered.recoveredPath, 'utf8')).pid, dead);

  const events = (await store.readEvents()).filter((event) => event.type === 'stale-lock-recovery');

  assert.deepEqual(events.map((event) => event.outcome), ['refused', 'succeeded']);
  assert.equal(events[1].before, inspection.recoveryToken);
  events.forEach((event) => assert.deepEqual(validateLifecycleEvent(event), []));

  const acquired = await survivor.acquire({ bindingKey: 'sha256:next', executionId: 'execution-2' });

  assert.equal(acquired.acquired, true);
  await acquired.release();
});

test('FR-COORD-005: a live holder is never stale, and an expired heartbeat is', async (t) => {
  const clone = await fixtureClone(t, 'heartbeat');
  let now = Date.parse('2026-08-10T00:00:00.000Z');
  const clock = () => new Date(now);
  const lock = await openCoordinationLock({ repositoryRoot: clone.root, clock, staleAfterMs: 60_000 });
  const held = await lock.acquire({ bindingKey: 'sha256:live', executionId: 'execution-1' });

  assert.equal(held.acquired, true);

  const live = await lock.inspect();

  assert.equal(live.stale, false);
  assert.deepEqual(live.staleReasons, []);

  // A live holder is never recovered, however long an operator insists.
  const refused = await lock.recoverStale({ confirmation: live.recoveryToken });

  assert.equal(refused.recovered, false);
  assert.equal(refused.reasonCode, 'lock-not-stale');

  now += 30_000;
  await held.heartbeat();
  now += 45_000;

  // The heartbeat moved, so 45s later the lock is still fresh.
  assert.equal((await lock.inspect()).stale, false);

  now += 30_000;

  const expired = await lock.inspect();

  assert.equal(expired.stale, true);
  assert.deepEqual(expired.staleReasons, ['heartbeat-expired']);
});

/**
 * Every file AND every directory under one root, by relative path.
 *
 * Directories are included deliberately. `SG-LIFE-001`'s existing proofs are
 * file-only and structurally cannot observe a command that creates an empty
 * directory, which is exactly the residue this test exists to forbid.
 */
const treeSnapshot = async (root) => {
  const entries = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        entries.push([path.relative(root, absolute), '<directory>']);
        await walk(absolute);
      } else if (entry.isFile()) {
        entries.push([
          path.relative(root, absolute),
          await readFile(absolute, 'base64').catch(() => null),
        ]);
      }
    }
  };

  await walk(root);

  return JSON.stringify(entries.sort(([left], [right]) => left.localeCompare(right)));
};

/**
 * TB-041: opening the lock to READ it creates nothing.
 *
 * `openCoordinationLock` used to ensure its own directory existed before it had
 * been asked to write anything, so `inspect()` — and therefore `gate locks` —
 * gave a clone that had never taken a lock an empty
 * `change-evaluation-gate/coordination/` directory. Inspection is observation,
 * and observation writes nothing (`FR-LIFE-019`, `SG-LIFE-001`).
 */
test('TB-041 SG-LIFE-001: opening and inspecting the lock creates no directory, and acquiring one does', async (t) => {
  const clone = await fixtureClone(t, 'read-only');
  const before = await treeSnapshot(clone.root);

  const lock = await openCoordinationLock({ repositoryRoot: clone.root });

  // Merely opening the seam is not a write.
  assert.equal(await treeSnapshot(clone.root), before);

  const inspection = await lock.inspect();

  assert.equal(inspection.held, false);
  assert.equal(inspection.recoveryToken, null);
  assert.equal(await lock.readRecord(), null);

  // Reading, judging, and reporting are all still not writes — not one file,
  // and not one directory.
  assert.equal(await treeSnapshot(clone.root), before);

  // Recovering a lock that is not there writes nothing either.
  const nothing = await lock.recoverStale({ confirmation: 'sha256:whatever' });

  assert.equal(nothing.recovered, false);
  assert.equal(nothing.reasonCode, 'lock-absent');
  assert.equal(await treeSnapshot(clone.root), before);

  // Acquisition is the path that needs the directory, and it makes it.
  const held = await lock.acquire({ bindingKey: 'sha256:binding', executionId: 'execution-1' });

  assert.equal(held.acquired, true);
  assert.equal(JSON.parse(await readFile(lock.lockPath, 'utf8')).lockId, held.record.lockId);
  assert.notEqual(await treeSnapshot(clone.root), before);

  // And a heartbeat on a held lock still writes through the same directory.
  assert.equal((await held.heartbeat()).beat, true);
  assert.equal((await held.release()).released, true);
});

const evaluationRequest = (root, role) => ({
  protocolVersion: '1.0',
  operation: 'evaluate',
  repository: { root },
  change: { kind: 'worktree', baseRevision: 'HEAD' },
  evaluation: { purpose: 'regression-only', contractRef: null },
  invocation: {
    role,
    trigger: role === 'authoritative' ? 'commit-attempt' : 'work-complete',
    adapter: {
      id: 'claude',
      surface: 'claude-code-desktop',
      version: '1.0.0',
      capabilities: { nativeBlocking: false },
    },
    sessionId: 'session-coordination',
  },
});

test('FR-COORD-005: a coordinator never runs unserialized when the lock is refused', async () => {
  const refusing = {
    acquire: async () => ({
      acquired: false,
      reasonCode: 'lock-held',
      detail: 'another client holds the evaluation lock',
      record: null,
    }),
  };
  // This client is not willing to wait; it must still never run unserialized.
  const coordinator = createEvaluationCoordinator({ lock: refusing, retry: async () => false });
  let ran = false;

  const handle = coordinator.submit({
    binding: bindingFixture(),
    role: 'authoritative',
    trigger: 'commit-attempt',
    run: async () => {
      ran = true;

      return decisionFixture();
    },
  });
  const result = await handle.promise;

  // No silent fallback: work that could not be serialized is not run at all.
  assert.equal(ran, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.decision, null);
  assert.equal(result.diagnostic.reasonCode, 'coordination-failure');
  assert.match(result.diagnostic.detail, /lock-held/);
  assert.equal(result.coordination.reasonCode, 'coordination-failure');

  // A run that throws is a harness failure the coordinator reports, never an
  // unhandled rejection and never a pass.
  const failing = createEvaluationCoordinator({ lock: grantingLock() });
  const thrown = await failing.submit({
    binding: bindingFixture(),
    role: 'preflight',
    run: async () => {
      throw new Error('the executor died');
    },
  }).promise;

  assert.equal(thrown.status, 'failed');
  assert.equal(thrown.decision, null);
  assert.equal(thrown.diagnostic.reasonCode, 'coordination-failure');
  assert.match(thrown.diagnostic.detail, /the executor died/);
});

test('FR-COORD-005 / NFR-REL-003 / SG-COORD-001: a coordination failure is unverified and never an authorization', async (t) => {
  const clone = await fixtureClone(t, 'failure');
  const unavailable = {
    acquire: async () => ({
      acquired: false,
      reasonCode: 'lock-stale',
      detail: 'the evaluation lock looks stale and was not recovered',
      record: null,
    }),
  };
  let executed = 0;
  const dependencies = {
    checks: [],
    execute: async () => {
      executed += 1;

      return { executed: true, exitCode: 0, durationMs: 1 };
    },
    coordination: unavailable,
  };

  const authoritative = await evaluate(evaluationRequest(clone.root, 'authoritative'), dependencies);

  assert.deepEqual(validateDecision(authoritative), []);
  assert.equal(authoritative.outcome, 'unverified');
  assert.equal(authoritative.authorization, 'deny');
  assert.deepEqual(authoritative.diagnostics.map((entry) => entry.reasonCode), ['coordination-failure']);

  // Nothing was materialized and nothing was executed: an evaluation that could
  // not be coordinated never graded anything.
  assert.equal(authoritative.snapshot.id, null);
  assert.equal(executed, 0);

  const preflight = await evaluate(evaluationRequest(clone.root, 'preflight'), dependencies);

  assert.equal(preflight.outcome, 'unverified');
  assert.equal(preflight.authorization, 'not-authoritative');
});

test('FR-COORD-001 / FR-COORD-003: a second client in a linked worktree waits for the lock instead of running unserialized', async (t) => {
  const clone = await fixtureClone(t, 'serialize');
  const order = [];
  let inside = 0;
  let peak = 0;
  const runFor = (label, gate, entered) => async () => {
    inside += 1;
    peak = Math.max(peak, inside);
    order.push(`${label}:start`);
    entered.resolve();
    await gate.promise;
    order.push(`${label}:end`);
    inside -= 1;

    return decisionFixture();
  };

  const primary = createEvaluationCoordinator({
    lock: await openCoordinationLock({ repositoryRoot: clone.root }),
  });
  const waited = deferred();
  const allowRetry = deferred();
  const linked = createEvaluationCoordinator({
    lock: await openCoordinationLock({ repositoryRoot: clone.linked }),
    retry: async ({ attempt, reasonCode }) => {
      waited.resolve({ attempt, reasonCode });
      await allowRetry.promise;

      return true;
    },
  });

  const primaryGate = deferred();
  const primaryEntered = deferred();
  const linkedGate = deferred();
  const linkedEntered = deferred();
  const first = primary.submit({
    binding: bindingFixture(),
    role: 'preflight',
    trigger: 'work-complete',
    run: runFor('primary', primaryGate, primaryEntered),
  });

  // The first client is provably inside its execution, so it provably holds the
  // clone-wide lock before the second client asks for it.
  await primaryEntered.promise;

  const second = linked.submit({
    binding: bindingFixture({ snapshotId: 'sha256:linked' }),
    role: 'authoritative',
    trigger: 'commit-attempt',
    run: runFor('linked', linkedGate, linkedEntered),
  });

  // The second client is a different process's coordinator; it is refused the
  // clone-wide lock and waits rather than grading anything.
  assert.deepEqual(await waited.promise, { attempt: 1, reasonCode: 'lock-held' });
  assert.deepEqual(order, ['primary:start']);

  primaryGate.resolve();
  await first.promise;

  // Only once the holder released does the waiting client proceed.
  assert.deepEqual(order, ['primary:start', 'primary:end']);
  allowRetry.resolve();
  await linkedEntered.promise;
  linkedGate.resolve();

  const result = await second.promise;

  assert.equal(result.status, 'decided');
  assert.deepEqual(order, ['primary:start', 'primary:end', 'linked:start', 'linked:end']);
  assert.equal(peak, 1);
});

test('FR-COORD-005: a client that gives up waiting is a coordination failure, never an unserialized run', async (t) => {
  const clone = await fixtureClone(t, 'exhausted');
  const holder = await openCoordinationLock({ repositoryRoot: clone.root });
  const held = await holder.acquire({ bindingKey: 'sha256:holder', executionId: 'execution-holder' });

  assert.equal(held.acquired, true);

  const attempts = [];
  const coordinator = createEvaluationCoordinator({
    lock: await openCoordinationLock({ repositoryRoot: clone.linked }),
    retry: async ({ attempt }) => {
      attempts.push(attempt);

      return attempt < 3;
    },
  });
  let ran = false;

  const result = await coordinator.submit({
    binding: bindingFixture(),
    role: 'authoritative',
    trigger: 'commit-attempt',
    run: async () => {
      ran = true;

      return decisionFixture();
    },
  }).promise;

  assert.deepEqual(attempts, [1, 2, 3]);
  assert.equal(ran, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.diagnostic.reasonCode, 'coordination-failure');
  await held.release();
});
