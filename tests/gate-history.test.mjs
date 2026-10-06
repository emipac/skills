import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { runOperatorCommand } from '../skills/change-evaluation-gate/scripts/lib/operator-surface.mjs';
import { readHistory } from '../skills/change-evaluation-gate/scripts/lib/operator-surface/history/reader.mjs';
import { envelopeIdentity, withEvidenceIdentity } from '../skills/change-evaluation-gate/scripts/lib/evidence-identity.mjs';
import { openCoordinationLock } from '../skills/change-evaluation-gate/scripts/lib/coordination.mjs';

const runFile = promisify(execFile);
const clone = async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'gate-history-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await runFile('git', ['init', '-q', root]);
  return root;
};
const put = async (root, version = 'v2', text = 'redacted output') => {
  const owner = path.join(root, '.git', 'change-evaluation-gate', 'evidence');
  const blobId = `sha256:${createHash('sha256').update(text).digest('hex')}`;
  const body = {
    storeVersion: `change-evaluation-gate/evidence/${version}`, evaluationId: 'evaluation',
    decision: { outcome: 'failed', snapshot: { kind: 'worktree', id: 'snapshot', baseRevision: 'HEAD', executionRoot: '<run-local>' }, checks: [{ id: 'test', policy: 'required', outcome: 'failed', summary: 'Test failed' }] },
    blobs: [{ blobId, checkId: 'test', attempt: 1, bytes: Buffer.byteLength(text) }],
  };
  const evidenceId = envelopeIdentity(body);
  const envelope = withEvidenceIdentity(body, evidenceId);
  const envelopePath = path.join(owner, 'envelopes', evidenceId.slice(7, 9), `${evidenceId.slice(7)}.json`);
  const blobPath = path.join(owner, 'blobs', blobId.slice(7, 9), blobId.slice(7));
  await mkdir(path.dirname(envelopePath), { recursive: true });
  await mkdir(path.dirname(blobPath), { recursive: true });
  await writeFile(envelopePath, JSON.stringify(envelope));
  await writeFile(blobPath, text);
  await appendFile(path.join(owner, 'log.ndjson'), `${JSON.stringify({ evidenceId, evaluationId: 'evaluation', appendedAt: '2026-10-06T00:00:00Z', execution: { executionRoot: '/private/secret/run' } })}\n`);
  return { owner, evidenceId, blobId, envelopePath, blobPath };
};

test('history on a fresh clone observes without creating evidence or coordination state', async (t) => {
  const root = await clone(t);
  const before = await readdir(path.join(root, '.git'));
  const result = await runOperatorCommand({ cwd: root, argv: ['history', '--json'] });
  assert.equal(result.exitCode, 0);
  assert.equal(result.document.document, 'change-evaluation-gate/observation/1');
  assert.equal(result.document.mutation, null);
  assert.deepEqual(result.document.observation.history.entries, []);
  assert.equal(result.document.observation.coordination.held, false);
  assert.deepEqual(await readdir(path.join(root, '.git')), before);
});

for (const version of ['v1', 'v2']) {
  test(`history verifies ${version} evidence and reads only its authorized redacted blob`, async (t) => {
    const root = await clone(t);
    const { evidenceId, blobId } = await put(root, version);
    const result = await runOperatorCommand({ cwd: root, argv: ['history', '--json', '--evidence', evidenceId, '--blob', blobId] });
    assert.equal(result.exitCode, 0);
    assert.equal(result.document.observation.history.selected.log.text, 'redacted output');
    assert.equal(result.document.observation.history.entries[0].snapshot.id, 'snapshot');
    assert.ok(!result.stdout.includes('/private/secret/run'));
    assert.ok(!result.stdout.includes('executionRoot'));
    assert.deepEqual(result.document.invocation.selectors, ['--evidence', evidenceId, '--blob', blobId]);
  });
}

test('history bounds newest rows, tolerates malformed and incomplete tails, and refuses altered evidence', async (t) => {
  const root = await clone(t);
  const fixture = await put(root);
  await appendFile(path.join(fixture.owner, 'log.ndjson'), `${JSON.stringify({ evidenceId: fixture.evidenceId, appendedAt: 'newer' })}\ninvalid\npartial`);
  const history = await readHistory({ repositoryRoot: root, limit: 1 });
  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].appendedAt, 'newer');
  assert.equal(history.truncated, false);
  assert.ok(history.warnings.includes('incomplete-log-line'));
  assert.ok(history.warnings.includes('malformed-log-record'));
  await writeFile(fixture.envelopePath, '{}');
  assert.ok((await readHistory({ repositoryRoot: root, evidenceId: fixture.evidenceId })).warnings.includes('selected-evidence-unavailable-or-invalid'));
});

test('history rejects traversal, invalid limits, unpaired blobs and confirmations at its CLI boundary', async (t) => {
  const root = await clone(t);
  for (const flags of [['--evidence', '../secret'], ['--limit', '0'], ['--limit', '101'], ['--limit', '1e2'], ['--blob', `sha256:${'a'.repeat(64)}`], ['--confirm', `sha256:${'a'.repeat(64)}`]]) {
    const result = await runOperatorCommand({ cwd: root, argv: ['history', '--json', ...flags] });
    assert.equal(result.exitCode, 2);
  }
});

test('history never reads unauthorized blobs or escaping symlinks', async (t) => {
  const root = await clone(t);
  const fixture = await put(root);
  const unauthorized = await readHistory({ repositoryRoot: root, evidenceId: fixture.evidenceId, blobId: `sha256:${'a'.repeat(64)}` });
  assert.ok(unauthorized.warnings.includes('log-not-authorized'));
  await rm(fixture.blobPath);
  const secret = path.join(root, 'secret');
  await writeFile(secret, 'never expose');
  await symlink(secret, fixture.blobPath);
  const escaped = await readHistory({ repositoryRoot: root, evidenceId: fixture.evidenceId, blobId: fixture.blobId });
  assert.equal(escaped.selected.log.text, null);
  assert.ok(!JSON.stringify(escaped).includes('never expose'));
  await rm(fixture.owner, { recursive: true });
  await symlink(root, fixture.owner);
  assert.ok((await readHistory({ repositoryRoot: root })).warnings.includes('history-unavailable'));
});

test('history bounds log output and exposes clone-owned coordination without recovery', async (t) => {
  const root = await clone(t);
  const fixture = await put(root, 'v2', 'x'.repeat(70000));
  const lock = await openCoordinationLock({ repositoryRoot: root });
  const lease = await lock.acquire({ role: 'preflight', executionId: 'execution' });
  t.after(() => lease.release());
  const result = await runOperatorCommand({ cwd: root, argv: ['history', '--json', '--evidence', fixture.evidenceId, '--blob', fixture.blobId] });
  assert.equal(result.document.observation.history.selected.log.text.length, 65536);
  assert.equal(result.document.observation.history.selected.log.truncated, true);
  assert.equal(result.document.observation.coordination.held, true);
  assert.equal(result.document.observation.coordination.holder.executionId, 'execution');
  assert.equal((await lock.inspect()).held, true);
});

test('history shares evidence and coordination across linked worktrees', async (t) => {
  const root = await clone(t);
  await runFile('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'initial']);
  const fixture = await put(root);
  const linked = path.join(root, 'linked');
  await runFile('git', ['-C', root, 'worktree', 'add', '-q', '-b', 'linked', linked]);
  const lock = await openCoordinationLock({ repositoryRoot: root });
  const lease = await lock.acquire({ role: 'preflight', executionId: 'shared' });
  t.after(() => lease.release());
  const result = await runOperatorCommand({ cwd: linked, argv: ['history', '--json'] });
  assert.equal(result.document.observation.history.entries[0].evidenceId, fixture.evidenceId);
  assert.equal(result.document.observation.coordination.holder.executionId, 'shared');
});

test('history names missing logs and refuses corrupted blob bytes', async (t) => {
  const root = await clone(t);
  const fixture = await put(root);
  await writeFile(fixture.blobPath, 'unredacted tampering');
  const corrupted = await readHistory({ repositoryRoot: root, evidenceId: fixture.evidenceId, blobId: fixture.blobId });
  assert.equal(corrupted.selected.log.availability, 'unavailable');
  assert.equal(corrupted.selected.log.text, null);
  await rm(fixture.blobPath);
  const missing = await readHistory({ repositoryRoot: root, evidenceId: fixture.evidenceId, blobId: fixture.blobId });
  assert.equal(missing.selected.log.availability, 'missing');
});

test('history reads only a bounded NDJSON tail and preserves newest complete entries', async (t) => {
  const root = await clone(t);
  const fixture = await put(root);
  await writeFile(path.join(fixture.owner, 'log.ndjson'), `${'x'.repeat(1100000)}\n${JSON.stringify({ evidenceId: fixture.evidenceId, appendedAt: 'latest' })}\n`);
  const history = await readHistory({ repositoryRoot: root });
  assert.equal(history.truncated, true);
  assert.equal(history.entries[0].appendedAt, 'latest');
});

test('history deduplicates append identities before limiting distinct evidence', async (t) => {
  const root = await clone(t);
  const first = await put(root, 'v2', 'first');
  const second = await put(root, 'v2', 'second');
  await appendFile(path.join(first.owner, 'log.ndjson'), `${JSON.stringify({ evidenceId: second.evidenceId, appendedAt: 'latest duplicate' })}\n`);
  const history = await readHistory({ repositoryRoot: root, limit: 2 });
  assert.deepEqual(history.entries.map((entry) => entry.evidenceId), [second.evidenceId, first.evidenceId]);
  assert.equal(history.entries[0].appendedAt, 'latest duplicate');
  assert.equal(history.truncated, false);
  const limited = await readHistory({ repositoryRoot: root, limit: 1 });
  assert.equal(limited.entries.length, 1);
  assert.equal(limited.truncated, true);
});

test('selecting evidence in an absent store names its unavailable selection without writing state', async (t) => {
  const root = await clone(t);
  const before = await readdir(path.join(root, '.git'));
  const history = await readHistory({ repositoryRoot: root, evidenceId: `sha256:${'a'.repeat(64)}` });
  assert.equal(history.selected, null);
  assert.ok(history.warnings.includes('selected-evidence-unavailable-or-invalid'));
  assert.deepEqual(await readdir(path.join(root, '.git')), before);
});

test('selected history projects diagnostics, dependency names and redaction counts without sensitive metadata', async (t) => {
  const root = await clone(t);
  const fixture = await put(root);
  const { readFile } = await import('node:fs/promises');
  const envelope = JSON.parse(await readFile(fixture.envelopePath, 'utf8'));
  delete envelope.evidenceId;
  envelope.decision.diagnostics = [{ reasonCode: 'missing', detail: 'Dependency unavailable', ignored: 'never expose' }];
  envelope.decision.environment = { dependencies: { provided: ['node_modules'], missing: ['vendor'], refused: [], ignored: 'never expose' } };
  envelope.redaction = { applied: 2, redactedBytes: 18, unresolved: [{ value: 'never expose' }], secrets: [{ value: 'never expose' }] };
  const evidenceId = envelopeIdentity(envelope);
  const destination = path.join(fixture.owner, 'envelopes', evidenceId.slice(7, 9), `${evidenceId.slice(7)}.json`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(withEvidenceIdentity(envelope, evidenceId)));
  const selected = (await readHistory({ repositoryRoot: root, evidenceId })).selected;
  assert.deepEqual(selected.diagnostics, [{ reasonCode: 'missing', detail: 'Dependency unavailable' }]);
  assert.deepEqual(selected.dependencies, { provided: ['node_modules'], missing: ['vendor'], refused: [] });
  assert.deepEqual(selected.redaction, { applied: 2, redactedBytes: 18, unresolvedInputs: 1 });
  assert.ok(!JSON.stringify(selected).includes('never expose'));
});
