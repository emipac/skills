import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  LIFECYCLE_EVENT_TYPES,
  LIFECYCLE_OUTCOMES,
  createLifecycleEvent,
  validateLifecycleEvent,
} from '../skills/change-evaluation-gate/scripts/lib/lifecycle-event.mjs';
import { openEvidenceStore } from '../skills/change-evaluation-gate/scripts/lib/evidence-store.mjs';

const runFile = promisify(execFile);

const fixtureRepository = async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-lifecycle-')));

  t.after(() => rm(root, { recursive: true, force: true }));
  await runFile('git', ['init', '--quiet'], { cwd: root });

  return root;
};

const decisionFixture = (evaluationId) => ({
  protocolVersion: '1.0',
  evaluationId,
  outcome: 'failed',
  checks: [],
  evidence: { id: 'sha256:decision', format: 'change-evaluation-gate/v1', persisted: false },
});

const eventInput = (overrides = {}) => ({
  type: 'activation',
  actor: { name: 'maintainer', source: 'git-config' },
  client: { id: 'claude-code', surface: 'cli', version: '1.2.3' },
  gate: { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' },
  repository: { identity: 'sha256:repository', gitCommonDirectory: '/tmp/repo/.git' },
  before: null,
  after: 'sha256:after',
  outcome: 'succeeded',
  reason: 'operator activated the gate',
  ...overrides,
});

test('every governed lifecycle action has an event type and a validated schema', () => {
  assert.deepEqual([...LIFECYCLE_EVENT_TYPES].sort(), [
    'activation',
    'bypass',
    'configuration-approval',
    'drift-detected',
    'evaluation',
    'pruning',
    'removal',
    'repair',
    'stale-lock-recovery',
    'trust',
    'update',
  ]);
  assert.deepEqual([...LIFECYCLE_OUTCOMES].sort(), ['detected', 'failed', 'refused', 'succeeded']);

  const event = createLifecycleEvent(eventInput(), { clock: () => new Date('2026-02-03T04:05:06.000Z') });

  assert.deepEqual(validateLifecycleEvent(event), []);
  assert.equal(event.occurredAt, '2026-02-03T04:05:06.000Z');
  assert.match(event.eventId, /^sha256:[0-9a-f]{64}$/);

  // Actor attribution is best effort and explicitly unauthenticated.
  assert.equal(event.actor.authenticated, false);

  // A claim of authenticated attribution is not expressible.
  const forged = createLifecycleEvent(
    eventInput({ actor: { name: 'root', source: 'claimed', authenticated: true } }),
  );

  assert.equal(forged.actor.authenticated, false);

  // The schema audit names every missing audit field.
  const invalid = validateLifecycleEvent({ type: 'not-a-type', actor: {}, outcome: 'ok' });

  assert.equal(invalid.length > 0, true);
  assert.equal(invalid.some((error) => error.path === 'event.type'), true);
  assert.equal(invalid.some((error) => error.path === 'event.occurredAt'), true);
  assert.equal(invalid.some((error) => error.path === 'event.outcome'), true);
  assert.equal(invalid.some((error) => error.path === 'event.repository'), true);
});

test('lifecycle events are appended immutably and never rewritten', async (t) => {
  const root = await fixtureRepository(t);
  const store = await openEvidenceStore({ repositoryRoot: root });

  const first = await store.appendLifecycleEvent(eventInput({ type: 'configuration-approval' }));
  const second = await store.appendLifecycleEvent(eventInput({ type: 'trust', outcome: 'refused' }));

  assert.equal(first.appended, true);
  assert.equal(second.appended, true);

  const events = await store.readEvents();

  assert.deepEqual(
    events.map((event) => event.type),
    ['configuration-approval', 'trust'],
  );

  // Appending the identical event again keeps both records; nothing is replaced.
  await store.appendLifecycleEvent(eventInput({ type: 'configuration-approval' }));

  assert.equal((await store.readEvents()).length, 3);

  // An event that fails the audit schema is refused rather than stored.
  const refused = await store.appendLifecycleEvent({ type: 'nonsense' });

  assert.equal(refused.appended, false);
  assert.equal(refused.reasonCode, 'lifecycle-event-invalid');
  assert.equal(refused.errors.length > 0, true);
  assert.equal((await store.readEvents()).length, 3);
});

test('evaluation and pruning each create their own lifecycle event', async (t) => {
  const root = await fixtureRepository(t);
  const store = await openEvidenceStore({
    repositoryRoot: root,
    identity: {
      actor: { name: 'maintainer', source: 'git-config' },
      client: { id: 'claude-code', surface: 'cli', version: '1.2.3' },
      gate: { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' },
      repository: { identity: 'sha256:repository' },
    },
  });

  const appended = await store.appendEvidence({
    decision: decisionFixture('evaluation-one'),
    outputs: [{ checkId: 'check.one', attempt: 1, text: 'output' }],
  });

  const afterEvaluation = await store.readEvents();

  assert.deepEqual(afterEvaluation.map((event) => event.type), ['evaluation']);
  assert.equal(afterEvaluation[0].after, appended.evidenceId);
  assert.equal(afterEvaluation[0].outcome, 'succeeded');
  assert.deepEqual(validateLifecycleEvent(afterEvaluation[0]), []);

  const preview = await store.previewPrune({ evaluationIds: ['evaluation-one'] });

  // A preview alone changes nothing and records no pruning.
  assert.equal((await store.readEvents()).length, 1);

  await store.confirmPrune({ preview, confirmation: 'sha256:wrong' });

  const afterRefusal = await store.readEvents();

  assert.deepEqual(afterRefusal.map((event) => event.type), ['evaluation', 'pruning']);
  assert.equal(afterRefusal[1].outcome, 'refused');
  assert.equal(afterRefusal[1].reason.includes('preview-mismatch'), true);

  await store.confirmPrune({ preview, confirmation: preview.confirmationToken });

  const afterPrune = await store.readEvents();

  assert.equal(afterPrune.length, 3);
  assert.equal(afterPrune[2].type, 'pruning');
  assert.equal(afterPrune[2].outcome, 'succeeded');
  // Pruning is never silent: the retained event binds the exact confirmed
  // selection to the pruning record that says what left the store.
  assert.equal(afterPrune[2].before, preview.confirmationToken);
  assert.match(afterPrune[2].reason, /1 blob/);
  assert.equal(
    (await store.readPrunings()).some((record) => `sha256:${record.pruningId}` === afterPrune[2].after
      || record.pruningId === afterPrune[2].after),
    true,
  );
});
