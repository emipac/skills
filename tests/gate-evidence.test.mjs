import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFile, copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { evaluate } from '../skills/change-evaluation-gate/scripts/lib/evaluate.mjs';
import { validateDecision } from '../skills/change-evaluation-gate/scripts/lib/evaluation-contract.mjs';
import {
  RUN_LOCAL_PLACEHOLDER,
  envelopeIdentity,
} from '../skills/change-evaluation-gate/scripts/lib/evidence-identity.mjs';
import { openEvidenceStore } from '../skills/change-evaluation-gate/scripts/lib/evidence-store.mjs';
import { validateLifecycleEvent } from '../skills/change-evaluation-gate/scripts/lib/lifecycle-event.mjs';
import { resolveBypass } from '../skills/change-evaluation-gate/scripts/lib/policy.mjs';

/** One required broad-test check, resolved the way a provider would emit it. */
const descriptorFixture = () => ({
  id: 'node-package.test.broad',
  provider: 'node-package',
  stage: 'broad-tests',
  capability: 'test',
  scope: 'both',
  applicability: { changed_path_globs: ['**'], required_facts: [] },
  prerequisites: [],
  policy: 'required',
  evaluate: {
    runner: 'package-script',
    args: ['run', 'test'],
    working_directory: '.',
    timeout_seconds: 60,
    allowed_environment: ['PATH'],
    evidence_category: 'test',
    source_scope: 'both',
  },
  fix: null,
  timeout_seconds: 120,
  declared_writes: [],
  evidence: { claims: ['test:broad'], success_exit_codes: [0], report: null },
  order: 10,
  selection: null,
});

const evaluationRequest = (root) => ({
  protocolVersion: '1.0',
  operation: 'evaluate',
  repository: { root },
  change: { kind: 'worktree', baseRevision: 'HEAD' },
  evaluation: { purpose: 'regression-only', contractRef: null },
  invocation: {
    role: 'preflight',
    trigger: 'work-complete',
    adapter: {
      id: 'claude',
      surface: 'claude-code-desktop',
      version: '1.0.0',
      capabilities: { nativeBlocking: false },
    },
    sessionId: 'session-evidence',
  },
});

const runFile = promisify(execFile);

const git = (cwd, args) => runFile('git', args, { cwd });

/** A throwaway repository; this repository's own Git state is never touched. */
const fixtureRepository = async (t) => {
  // The canonical path; the OS temp directory is itself a symlink on macOS.
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-evidence-')));

  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ['init', '--quiet']);

  return root;
};

const decisionFixture = (evaluationId, overrides = {}) => ({
  protocolVersion: '1.0',
  evaluationId,
  outcome: 'failed',
  authorization: 'deny',
  task: { id: 'sha256:task', purpose: 'regression-only', contractId: null, contractStatus: null },
  snapshot: { kind: 'worktree', id: 'sha256:snapshot', baseRevision: 'HEAD', executionRoot: null },
  checks: [{
    id: 'check.one',
    stage: 'test',
    policy: 'required',
    outcome: 'failed',
    reasonCode: 'grader-negative',
    attempts: [{ attempt: 1, outcome: 'failed', reasonCode: 'grader-negative', exitCode: 1, durationMs: 4 }],
  }],
  bypass: null,
  evidence: { id: `sha256:${evaluationId}`, format: 'change-evaluation-gate/v1', persisted: false },
  ...overrides,
});

test('a mismatched prune confirmation removes nothing and records no successful deletion', async (t) => {
  const root = await fixtureRepository(t);
  const store = await openEvidenceStore({ repositoryRoot: root });

  const appended = await store.appendEvidence({
    decision: decisionFixture('evaluation-one'),
    outputs: [{ checkId: 'check.one', attempt: 1, text: 'x'.repeat(64) }],
  });

  assert.equal(appended.appended, true);
  assert.equal(appended.blobs.length, 1);

  const preview = await store.previewPrune({ evaluationIds: [appended.evaluationId] });

  assert.equal(preview.blobs.length, 1);
  assert.ok(preview.confirmationToken.startsWith('sha256:'));

  const refused = await store.confirmPrune({
    preview,
    confirmation: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  });

  assert.equal(refused.pruned, false);
  assert.equal(refused.reasonCode, 'preview-mismatch');
  assert.deepEqual(refused.removed, []);
  assert.equal(refused.reclaimedBytes, 0);

  // Nothing left the store, and nothing claims otherwise.
  assert.equal((await store.listBlobs()).length, 1);
  assert.deepEqual(await store.readTombstones(), []);

  const prunings = await store.readPrunings();

  assert.equal(prunings.length, 1);
  assert.equal(prunings[0].pruned, false);
  assert.equal(prunings[0].outcome, 'refused');
  assert.deepEqual(prunings[0].removed, []);
  assert.equal(prunings.some((record) => record.pruned === true), false);
});

test('a matching confirmation removes only the previewed blobs and keeps the audit trail', async (t) => {
  const root = await fixtureRepository(t);
  const store = await openEvidenceStore({ repositoryRoot: root });

  const first = await store.appendEvidence({
    decision: decisionFixture('evaluation-one'),
    outputs: [{ checkId: 'check.one', attempt: 1, text: 'first output'.repeat(8) }],
  });
  const second = await store.appendEvidence({
    decision: decisionFixture('evaluation-two'),
    outputs: [{ checkId: 'check.two', attempt: 1, text: 'second output'.repeat(8) }],
  });

  const preview = await store.previewPrune({ evaluationIds: [first.evaluationId] });

  assert.equal(preview.blobs.length, 1);
  assert.equal(preview.blobs[0].blobId, first.blobs[0].blobId);

  const result = await store.confirmPrune({
    preview,
    confirmation: preview.confirmationToken,
  });

  assert.equal(result.pruned, true);
  assert.equal(result.outcome, 'removed');
  assert.deepEqual(result.removed, [first.blobs[0].blobId]);
  assert.equal(result.reclaimedBytes, preview.totalBytes);

  // Only the selected blob left; the unselected one is untouched and readable.
  const remaining = await store.listBlobs();

  assert.deepEqual(remaining.map((blob) => blob.blobId), [second.blobs[0].blobId]);
  assert.equal(await store.readBlob(second.blobs[0].blobId) !== null, true);
  assert.equal(await store.readBlob(first.blobs[0].blobId), null);

  // Every removed referenced blob leaves a tombstone.
  const tombstones = await store.readTombstones();

  assert.deepEqual(tombstones.map((tombstone) => tombstone.blobId), [first.blobs[0].blobId]);
  assert.equal(tombstones[0].bytes, first.blobs[0].bytes);
  assert.equal(tombstones[0].pruningId, result.pruningId);

  // Envelopes and their decisions survive pruning intact.
  const log = await store.readLog();

  assert.deepEqual(
    log.map((entry) => entry.evidenceId),
    [first.evidenceId, second.evidenceId],
  );

  const envelope = await store.readEnvelope(first.evidenceId);

  assert.equal(envelope.evaluationId, 'evaluation-one');
  assert.equal(envelope.decision.outcome, 'failed');
  assert.deepEqual(envelope.blobs.map((blob) => blob.blobId), [first.blobs[0].blobId]);

  // The pruning record itself is retained.
  const prunings = await store.readPrunings();

  assert.equal(prunings.length, 1);
  assert.equal(prunings[0].pruningId, result.pruningId);
  assert.equal(prunings[0].pruned, true);
});

test('pruning selects by evaluation, age, or reclaimed size and never deletes automatically', async (t) => {
  const root = await fixtureRepository(t);
  let now = Date.parse('2026-01-01T00:00:00.000Z');
  const store = await openEvidenceStore({
    repositoryRoot: root,
    clock: () => new Date(now),
  });

  const appended = [];

  for (const day of [1, 2, 3]) {
    now = Date.parse(`2026-01-0${day}T00:00:00.000Z`);
    appended.push(await store.appendEvidence({
      decision: decisionFixture(`evaluation-${day}`),
      // Distinct sizes so reclaimed-size selection is observable.
      outputs: [{ checkId: 'check.one', attempt: 1, text: 'z'.repeat(day * 1000) }],
    }));
  }

  now = Date.parse('2026-01-04T00:00:00.000Z');

  // Appending evidence never removes anything: three evaluations, three blobs.
  assert.equal((await store.listBlobs()).length, 3);
  assert.deepEqual(await store.readTombstones(), []);
  assert.deepEqual(await store.readPrunings(), []);

  // Age: only blobs appended strictly before the boundary are selected.
  const byAge = await store.previewPrune({ appendedBefore: '2026-01-03T00:00:00.000Z' });

  assert.deepEqual(
    byAge.blobs.map((blob) => blob.blobId),
    [appended[0].blobs[0].blobId, appended[1].blobs[0].blobId],
  );
  assert.equal(byAge.totalBytes, 3000);

  // Reclaimed size: oldest blobs first, stopping once the target is covered.
  const bySize = await store.previewPrune({ reclaimBytes: 1500 });

  assert.deepEqual(
    bySize.blobs.map((blob) => blob.blobId),
    [appended[0].blobs[0].blobId, appended[1].blobs[0].blobId],
  );
  assert.equal(bySize.totalBytes, 3000);
  assert.equal(bySize.selector.reclaimBytes, 1500);

  // Evaluation: exactly the named evaluation.
  const byEvaluation = await store.previewPrune({ evaluationIds: ['evaluation-3'] });

  assert.deepEqual(byEvaluation.blobs.map((blob) => blob.blobId), [appended[2].blobs[0].blobId]);

  // A preview on its own removes nothing.
  assert.equal((await store.listBlobs()).length, 3);

  const result = await store.confirmPrune({
    preview: bySize,
    confirmation: bySize.confirmationToken,
  });

  assert.equal(result.pruned, true);
  assert.equal(result.reclaimedBytes, 3000);
  assert.deepEqual(
    (await store.listBlobs()).map((blob) => blob.blobId),
    [appended[2].blobs[0].blobId],
  );
  // The envelopes of the pruned evaluations are still there in full.
  assert.equal((await store.readLog()).length, 3);
  assert.notEqual(await store.readEnvelope(appended[0].evidenceId), null);
});

test('repeated evaluations append canonical content-addressed envelopes at the Git-common location', async (t) => {
  const root = await fixtureRepository(t);
  const store = await openEvidenceStore({ repositoryRoot: root });

  // The store lives under the Git common directory, never inside tracked source.
  assert.equal(store.gitCommonDirectory, path.join(root, '.git'));
  assert.equal(store.root, path.join(root, '.git', 'change-evaluation-gate', 'evidence'));
  assert.equal(store.root.startsWith(path.join(root, '.git') + path.sep), true);

  const first = await store.appendEvidence({ decision: decisionFixture('evaluation-one') });
  const second = await store.appendEvidence({ decision: decisionFixture('evaluation-two') });

  assert.notEqual(first.evidenceId, second.evidenceId);
  assert.match(first.evidenceId, /^sha256:[0-9a-f]{64}$/);

  // Identical evidence is content-addressed to one envelope; the append-only
  // log still records that it was appended again.
  const repeat = await store.appendEvidence({ decision: decisionFixture('evaluation-one') });

  assert.equal(repeat.evidenceId, first.evidenceId);
  assert.equal((await store.readLog()).length, 3);

  // The envelope is canonical: key order in the decision does not change identity.
  const reordered = await store.appendEvidence({
    decision: {
      ...decisionFixture('evaluation-one'),
      evidence: { format: 'change-evaluation-gate/v1', persisted: false, id: 'sha256:evaluation-one' },
    },
  });

  assert.equal(reordered.evidenceId, first.evidenceId);

  // Writes land through one rename; no partial staging file survives.
  assert.deepEqual(await readdir(store.paths.staging), []);

  const envelope = await store.readEnvelope(first.evidenceId);

  assert.equal(envelope.storeVersion, 'change-evaluation-gate/evidence/v2');
  assert.equal(envelope.evidenceId, first.evidenceId);
  assert.equal(envelope.decision.evaluationId, 'evaluation-one');

  // Nothing was written into the working tree.
  const { stdout } = await git(root, ['status', '--porcelain']);

  assert.equal(stdout.trim(), '');
});

test('every linked worktree of one clone shares exactly one Evidence store', async (t) => {
  const root = await fixtureRepository(t);

  await writeFile(path.join(root, 'README.md'), 'baseline\n', 'utf8');
  await git(root, ['add', '--all']);
  await git(root, [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Evidence',
    'commit', '--quiet', '--message', 'baseline',
  ]);

  const linked = path.join(root, '..', `${path.basename(root)}-linked`);

  t.after(() => rm(linked, { recursive: true, force: true }));
  await git(root, ['worktree', 'add', '--quiet', '--detach', linked]);

  const primary = await openEvidenceStore({ repositoryRoot: root });
  const secondary = await openEvidenceStore({ repositoryRoot: linked });

  assert.equal(secondary.root, primary.root);

  await primary.appendEvidence({ decision: decisionFixture('evaluation-one') });
  await secondary.appendEvidence({ decision: decisionFixture('evaluation-two') });

  assert.equal((await primary.readLog()).length, 2);
  assert.equal((await secondary.readLog()).length, 2);
});

test('appended evidence enforces the inline, per-blob, and per-evaluation ceilings', async (t) => {
  const root = await fixtureRepository(t);
  const store = await openEvidenceStore({ repositoryRoot: root });

  const atLimit = Buffer.alloc(4 * 1024 * 1024, 'a');
  const overLimit = Buffer.alloc(4 * 1024 * 1024 + 1, 'b');
  const appended = await store.appendEvidence({
    decision: decisionFixture('evaluation-one'),
    outputs: [
      { checkId: 'check.at-limit', attempt: 1, bytes: atLimit },
      { checkId: 'check.over-limit', attempt: 1, bytes: overLimit },
    ],
  });

  const envelope = await store.readEnvelope(appended.evidenceId);
  const [retained, refused] = envelope.retention.attempts;

  // Exactly at the per-blob ceiling is retained.
  assert.equal(retained.checkId, 'check.at-limit');
  assert.equal(retained.blobOutcome, 'retained');
  assert.equal(retained.blobBytes, 4 * 1024 * 1024);

  // One byte over is not retained as a blob, and says so.
  assert.equal(refused.checkId, 'check.over-limit');
  assert.equal(refused.blobOutcome, 'omitted');
  assert.equal(refused.blobReasonCode, 'blob-limit-exceeded');
  assert.equal(refused.blobId, null);
  assert.equal(refused.capturedBytes, 4 * 1024 * 1024 + 1);

  // Both attempts still carry a bounded inline excerpt with its byte counts.
  for (const attempt of envelope.retention.attempts) {
    assert.equal(Buffer.byteLength(attempt.inline, 'utf8') <= 32 * 1024, true);
    assert.equal(attempt.truncated, true);
    assert.equal(attempt.retainedBytes + attempt.omittedBytes, attempt.capturedBytes);
  }

  assert.equal(envelope.retention.limits.inlineBytes, 32 * 1024);
  assert.equal(envelope.retention.limits.blobBytes, 4 * 1024 * 1024);
  assert.equal(envelope.retention.limits.evaluationBlobBytes, 32 * 1024 * 1024);
  assert.equal(envelope.retention.totals.blobBytes, 4 * 1024 * 1024);
  assert.equal((await store.listBlobs()).length, 1);
});

test('one evaluation never retains more than the per-evaluation blob ceiling', async (t) => {
  const root = await fixtureRepository(t);
  const store = await openEvidenceStore({ repositoryRoot: root });

  // Nine distinct 4 MiB outputs: eight fit the 32 MiB ceiling exactly, the
  // ninth cannot be retained.
  const outputs = Array.from({ length: 9 }, (unused, index) => ({
    checkId: `check.${index}`,
    attempt: 1,
    bytes: Buffer.alloc(4 * 1024 * 1024, String.fromCharCode(97 + index)),
  }));
  const appended = await store.appendEvidence({
    decision: decisionFixture('evaluation-one'),
    outputs,
  });
  const envelope = await store.readEnvelope(appended.evidenceId);

  assert.equal(envelope.retention.totals.blobBytes, 32 * 1024 * 1024);
  assert.equal(envelope.retention.attempts.filter((a) => a.blobOutcome === 'retained').length, 8);
  assert.equal(envelope.retention.attempts[8].blobOutcome, 'omitted');
  assert.equal(envelope.retention.attempts[8].blobReasonCode, 'evaluation-blob-limit-exceeded');
  assert.equal((await store.listBlobs()).length, 8);
});

test('a project may lower the retention limits but never raise them', async (t) => {
  const root = await fixtureRepository(t);
  const store = await openEvidenceStore({
    repositoryRoot: root,
    evidencePolicy: { inline_bytes: 256, blob_bytes: 1024, evaluation_blob_bytes: 64 * 1024 * 1024 },
  });

  const appended = await store.appendEvidence({
    decision: decisionFixture('evaluation-one'),
    outputs: [
      { checkId: 'check.small', attempt: 1, bytes: Buffer.alloc(1024, 'a') },
      { checkId: 'check.large', attempt: 1, bytes: Buffer.alloc(1025, 'b') },
    ],
  });
  const envelope = await store.readEnvelope(appended.evidenceId);

  assert.equal(envelope.retention.limits.inlineBytes, 256);
  assert.equal(envelope.retention.limits.blobBytes, 1024);
  // The raise is refused and reported, not silently applied.
  assert.equal(envelope.retention.limits.evaluationBlobBytes, 32 * 1024 * 1024);
  assert.deepEqual(
    envelope.retention.violations.map((violation) => violation.limit),
    ['evaluationBlobBytes'],
  );

  assert.equal(envelope.retention.attempts[0].blobOutcome, 'retained');
  assert.equal(envelope.retention.attempts[1].blobOutcome, 'omitted');
  assert.equal(envelope.retention.attempts[1].blobReasonCode, 'blob-limit-exceeded');
  assert.equal(
    Buffer.byteLength(envelope.retention.attempts[0].inline, 'utf8') <= 256,
    true,
  );
});

test('a bound Evidence store fills in evidence.persisted and its reference', async (t) => {
  const root = await fixtureRepository(t);

  await writeFile(path.join(root, 'app.mjs'), 'export const value = 1;\n', 'utf8');
  await git(root, ['add', '--all']);

  const store = await openEvidenceStore({
    repositoryRoot: root,
    identity: {
      actor: { name: 'maintainer', source: 'git-config' },
      client: { id: 'claude-code', surface: 'cli', version: '1.2.3' },
      gate: { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' },
      repository: { identity: 'sha256:repository' },
    },
  });
  const executionRoot = path.join(root, '..', `${path.basename(root)}-run`);

  t.after(() => rm(executionRoot, { recursive: true, force: true }));

  const decision = await evaluate(evaluationRequest(root), {
    executionRoot,
    checks: [descriptorFixture()],
    changedPaths: ['app.mjs'],
    evidenceStore: store,
    execute: async () => ({
      executed: true,
      exitCode: 1,
      durationMs: 3,
      output: 'broad test output\nfailing assertion\n',
    }),
  });

  assert.deepEqual(validateDecision(decision), []);
  assert.equal(decision.evidence.persisted, true);
  assert.equal(decision.evidence.reference.evidenceId, decision.evidence.id === null ? null : decision.evidence.reference.evidenceId);
  assert.match(decision.evidence.reference.evidenceId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(decision.evidence.reference.storeRoot, store.root);
  assert.equal(decision.evidence.reference.reasonCode, null);

  // The persisted envelope carries the decision and the captured attempt output.
  const envelope = await store.readEnvelope(decision.evidence.reference.evidenceId);

  assert.equal(envelope.decision.evaluationId, decision.evaluationId);
  assert.equal(envelope.retention.attempts.length, 1);
  assert.equal(envelope.retention.attempts[0].checkId, 'node-package.test.broad');
  assert.match(envelope.retention.attempts[0].inline, /failing assertion/);

  // The evaluation left exactly one lifecycle event and one appended envelope.
  assert.deepEqual((await store.readEvents()).map((event) => event.type), ['evaluation']);
  assert.equal((await store.readLog()).length, 1);
});

test('an unbound Evidence store leaves the decision unpersisted and never fails the evaluation', async (t) => {
  const root = await fixtureRepository(t);

  await writeFile(path.join(root, 'app.mjs'), 'export const value = 1;\n', 'utf8');
  await git(root, ['add', '--all']);

  const executionRoot = path.join(root, '..', `${path.basename(root)}-run-unbound`);

  t.after(() => rm(executionRoot, { recursive: true, force: true }));

  const decision = await evaluate(evaluationRequest(root), {
    executionRoot,
    checks: [descriptorFixture()],
    changedPaths: ['app.mjs'],
    execute: async () => ({ executed: true, exitCode: 0, durationMs: 3 }),
  });

  assert.deepEqual(validateDecision(decision), []);
  assert.equal(decision.evidence.persisted, false);
  assert.equal(decision.evidence.reference, null);
  assert.equal(decision.outcome, 'passed');
});

test('the one-shot bypass ledger is durable across processes', async (t) => {
  const root = await fixtureRepository(t);
  const identity = {
    actor: { name: 'maintainer', source: 'git-config' },
    client: { id: 'claude-code', surface: 'cli', version: '1.2.3' },
    gate: { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' },
    repository: { identity: 'sha256:repository' },
  };
  const store = await openEvidenceStore({ repositoryRoot: root, identity });
  const policy = { bypass: { enabled: true, marker: 'Gate-Bypass', require_reference: true } };
  const grant = {
    snapshotId: 'sha256:snapshot',
    actor: 'maintainer',
    reason: 'released under an explicit, recorded exception',
    reference: 'INC-42',
    requestedAt: '2026-01-01T00:00:00.000Z',
  };
  const resolve = (ledger) => resolveBypass({
    grant,
    policy,
    ledger,
    snapshotId: 'sha256:snapshot',
    outcome: 'failed',
    checks: [{ id: 'check.one', policy: 'required', outcome: 'failed' }],
  });

  const applied = resolve(store.bypassLedger());

  assert.equal(applied.applied, true);
  assert.equal(applied.oneShot, true);

  // A separate process opens the same clone-local store and sees it consumed.
  const reopened = await openEvidenceStore({ repositoryRoot: root, identity });
  const replayed = resolve(reopened.bypassLedger());

  assert.equal(replayed.applied, false);
  assert.equal(replayed.rejectionCode, 'bypass-already-consumed');

  // Consumption is append-only and leaves its own lifecycle event.
  const consumed = await reopened.readBypassLedger();

  assert.equal(consumed.length, 1);
  assert.equal(consumed[0].bypassId, applied.id);
  assert.equal(consumed[0].snapshotId, 'sha256:snapshot');
  assert.deepEqual(consumed[0].preservedFailures, ['check.one']);

  const events = await reopened.readEvents();

  assert.deepEqual(events.map((event) => event.type), ['bypass']);
  assert.equal(events[0].outcome, 'succeeded');
  assert.deepEqual(validateLifecycleEvent(events[0]), []);
});

/**
 * The preserved evidence of real `gms` runs, written before this rule existed.
 * It is read here and never modified: it is the reference for what an auditor
 * reading an older store actually holds (`TB-032`).
 */
const PRESERVED_STORE = fileURLToPath(new URL(
  '../real-project-evidence/change-evaluation-gate/evidence/',
  import.meta.url,
));

const preservedLines = async (file) => (await readFile(path.join(PRESERVED_STORE, file), 'utf8'))
  .split('\n')
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line));

/** One decision, evaluated twice: same content, different run. */
const runOf = (executionRoot, durationMs) => decisionFixture('evaluation-one', {
  snapshot: { kind: 'worktree', id: 'sha256:snapshot', baseRevision: 'HEAD', executionRoot },
  checks: [{
    id: 'check.one',
    stage: 'test',
    policy: 'required',
    outcome: 'failed',
    reasonCode: 'grader-negative',
    attempts: [{ attempt: 1, outcome: 'failed', reasonCode: 'grader-negative', exitCode: 1, durationMs }],
  }],
});

test('TB-032 NFR-REL-001, AC-EVID-001: identical evidence from two execution roots addresses one envelope', async (t) => {
  const root = await fixtureRepository(t);
  const store = await openEvidenceStore({ repositoryRoot: root });
  const first = '/var/folders/gg/T/gate-preflight-exec-uB9ozI';
  const second = '/var/folders/gg/T/gate-preflight-exec-OEhA53';
  // A check reports where it ran, in whichever spelling it resolved.
  const said = (executionRoot) => `require(/private${executionRoot}/vendor/autoload.php) failed\n`;
  const appendRun = (executionRoot, durationMs) => store.appendEvidence({
    decision: runOf(executionRoot, durationMs),
    outputs: [{ checkId: 'check.one', attempt: 1, text: said(executionRoot) }],
  });

  const one = await appendRun(first, 1);
  const two = await appendRun(second, 118);

  assert.equal(
    two.evidenceId,
    one.evidenceId,
    'NFR-REL-001: neither the temporary directory nor the wall clock is a fact about what was evaluated.',
  );
  assert.equal(one.deduplicated, false);
  assert.equal(two.deduplicated, true, 'SG-EVID-001: an envelope already on disk is never rewritten.');

  const files = (await readdir(store.paths.envelopes, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile());

  assert.equal(files.length, 1, 'AC-EVID-001: one evaluation, one stored envelope.');

  // Both appends are recorded, which is what the preflight repetition budget
  // counts (TB-027), and each carries its own run-local facts.
  const log = await store.readLog();

  assert.equal(log.length, 2);
  assert.equal(log.filter((entry) => entry.evaluationId === 'evaluation-one').length, 2);
  assert.equal(log[0].execution.executionRoot, first);
  assert.equal(log[1].execution.executionRoot, second);
  assert.deepEqual(log[0].execution.attempts, [{ checkId: 'check.one', attempt: 1, durationMs: 1 }]);
  assert.deepEqual(log[1].execution.attempts, [{ checkId: 'check.one', attempt: 1, durationMs: 118 }]);

  const envelope = await store.readEnvelope(one.evidenceId);
  const stored = JSON.stringify(envelope);

  assert.equal(envelope.decision.snapshot.executionRoot, RUN_LOCAL_PLACEHOLDER);
  assert.equal(envelope.decision.checks[0].attempts[0].durationMs, RUN_LOCAL_PLACEHOLDER);
  assert.equal(
    stored.includes('gate-preflight-exec-'),
    false,
    'NFR-REL-001: no host-local execution root reaches the stored envelope, including its excerpts.',
  );
  assert.match(envelope.retention.attempts[0].inline, /vendor\/autoload\.php/);
  assert.equal(
    new Set((await store.listBlobs()).map((blob) => blob.blobId)).size,
    1,
    'the same output from two runs is one content-addressed blob.',
  );
});

test('TB-032 FR-EVID-001, NFR-AUD-001: the stored envelope states its own persistence and names its own identity', async (t) => {
  const root = await fixtureRepository(t);

  await writeFile(path.join(root, 'app.mjs'), 'export const value = 1;\n', 'utf8');
  await git(root, ['add', '--all']);

  const store = await openEvidenceStore({ repositoryRoot: root });
  const executionRoot = path.join(root, '..', `${path.basename(root)}-run-self-stating`);

  t.after(() => rm(executionRoot, { recursive: true, force: true }));

  const decision = await evaluate(evaluationRequest(root), {
    executionRoot,
    checks: [descriptorFixture()],
    changedPaths: ['app.mjs'],
    evidenceStore: store,
    execute: async () => ({ executed: true, exitCode: 1, durationMs: 3, output: 'failed\n' }),
  });
  const envelope = await store.readEnvelope(decision.evidence.reference.evidenceId);

  assert.equal(envelope.decision.evidence.persisted, true);
  assert.equal(envelope.decision.evidence.reference.evidenceId, envelope.evidenceId);
  assert.equal(
    envelope.decision.evidence.reference.evidenceId,
    decision.evidence.reference.evidenceId,
    'AC-EVID-001: the stored statement and the decision the caller received agree.',
  );
  // The identity is still computable from the bytes: the self-reference is put
  // back the way `activation.mjs` puts a receipt id back.
  assert.equal(envelope.evidenceId, envelopeIdentity(envelope));
  // The run-local store root and append instant stay on the log entry.
  assert.equal(envelope.decision.evidence.reference.storeRoot, RUN_LOCAL_PLACEHOLDER);
  assert.equal(decision.evidence.reference.storeRoot, store.root);
  assert.equal(
    JSON.stringify(envelope).includes(executionRoot),
    false,
    'NFR-REL-001: the stored record names no host path.',
  );
  // The decision the runner reports still tells a maintainer where it ran.
  assert.equal(decision.snapshot.executionRoot, executionRoot);
  assert.equal(decision.checks[0].attempts[0].durationMs, 3);
  assert.deepEqual(validateDecision(decision), []);
});

test('TB-032 SG-EVID-001, FR-EVID-004: an envelope written before this change stays readable, prunable, and auditable', async (t) => {
  const root = await fixtureRepository(t);
  const store = await openEvidenceStore({ repositoryRoot: root });
  const preserved = (await preservedLines('log.ndjson')).find((entry) => entry.blobIds.length > 0);
  const index = (await preservedLines('blobs.ndjson'))
    .filter((record) => preserved.blobIds.includes(record.blobId));
  const hex = preserved.evidenceId.replace(/^sha256:/, '');

  // Exactly the bytes the older gate wrote, placed in a store this one opens.
  await mkdir(path.join(store.paths.envelopes, hex.slice(0, 2)), { recursive: true });
  await copyFile(
    path.join(PRESERVED_STORE, preserved.envelopePath),
    path.join(store.paths.envelopes, hex.slice(0, 2), `${hex}.json`),
  );

  for (const record of index) {
    const blobHex = record.blobId.replace(/^sha256:/, '');

    await mkdir(path.join(store.paths.blobs, blobHex.slice(0, 2)), { recursive: true });
    await copyFile(
      path.join(PRESERVED_STORE, 'blobs', blobHex.slice(0, 2), blobHex),
      path.join(store.paths.blobs, blobHex.slice(0, 2), blobHex),
    );
    await appendFile(store.paths.blobIndex, `${JSON.stringify(record)}\n`, 'utf8');
  }

  await appendFile(store.paths.log, `${JSON.stringify(preserved)}\n`, 'utf8');

  const envelope = await store.readEnvelope(preserved.evidenceId);

  assert.notEqual(envelope, null, 'a v1 envelope must still be readable.');
  assert.equal(envelope.storeVersion, 'change-evaluation-gate/evidence/v1');
  assert.equal(
    envelopeIdentity(envelope),
    envelope.evidenceId,
    'the identity of a v1 envelope still recomputes from its own bytes.',
  );

  // It prunes exactly as it always did, and the envelope survives the removal.
  const distinct = new Set(index.map((record) => record.blobId));
  const preview = await store.previewPrune({ evaluationIds: [preserved.evaluationId] });

  assert.equal(preview.blobs.length, distinct.size);

  const pruned = await store.confirmPrune({ preview, confirmation: preview.confirmationToken });

  assert.equal(pruned.pruned, true);
  assert.deepEqual(pruned.removed.slice().sort(), [...distinct].sort());
  assert.equal((await store.readTombstones()).length, distinct.size);
  assert.notEqual(await store.readEnvelope(preserved.evidenceId), null);
  assert.equal((await store.readBlob(preserved.blobIds[0])), null);
});

test('TB-032 FR-EVID-004: pruning behaves identically for one envelope several appends reference', async (t) => {
  const root = await fixtureRepository(t);
  const store = await openEvidenceStore({ repositoryRoot: root });
  const append = () => store.appendEvidence({
    decision: runOf('/var/folders/gg/T/gate-preflight-exec-aaaaaa', 7),
    outputs: [{ checkId: 'check.one', attempt: 1, text: 'shared output\n' }],
  });
  const kept = await store.appendEvidence({
    decision: decisionFixture('evaluation-two'),
    outputs: [{ checkId: 'check.one', attempt: 1, text: 'other output\n' }],
  });

  const one = await append();
  const two = await append();

  assert.equal(one.evidenceId, two.evidenceId);

  const preview = await store.previewPrune({ evaluationIds: ['evaluation-one'] });

  assert.equal(preview.blobs.length, 1, 'the shared blob is previewed once, not once per append.');
  assert.equal(preview.blobs[0].references.length, 2, 'the preview names every append it touches.');

  const pruned = await store.confirmPrune({ preview, confirmation: preview.confirmationToken });

  assert.equal(pruned.pruned, true);
  assert.deepEqual(pruned.removed, [preview.blobs[0].blobId]);

  const [tombstone] = await store.readTombstones();

  assert.equal(tombstone.blobId, preview.blobs[0].blobId);
  assert.equal(tombstone.references.length, 2);
  assert.equal(await store.readBlob(preview.blobs[0].blobId), null);
  // Everything else survives: the deduplicated envelope, the untouched blob,
  // and both log entries.
  assert.notEqual(await store.readEnvelope(one.evidenceId), null);
  assert.notEqual(await store.readBlob(kept.blobs[0].blobId), null);
  assert.equal((await store.readLog()).length, 3);
});
