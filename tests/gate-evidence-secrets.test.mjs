import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  REDACTION_PLACEHOLDER,
  createRedactor,
} from '../skills/change-evaluation-gate/scripts/lib/redaction.mjs';
import { openEvidenceStore } from '../skills/change-evaluation-gate/scripts/lib/evidence-store.mjs';

const runFile = promisify(execFile);

const CANARY = 'canary-secret-9c1f4b7e2d6a';

const fixtureRepository = async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-evidence-secret-')));

  t.after(() => rm(root, { recursive: true, force: true }));
  await runFile('git', ['init', '--quiet'], { cwd: root });

  return root;
};

/** Every byte the store persisted, so a canary cannot hide in one file. */
const storeContents = async (root) => {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const contents = [];

  for (const entry of entries) {
    if (entry.isFile()) {
      contents.push(await readFile(path.join(entry.parentPath ?? entry.path, entry.name), 'utf8'));
    }
  }

  return contents.join('\n');
};

const decisionFixture = (evaluationId, summary) => ({
  protocolVersion: '1.0',
  evaluationId,
  outcome: 'failed',
  checks: [{ id: 'check.one', outcome: 'failed', summary }],
  evidence: { id: 'sha256:decision', format: 'change-evaluation-gate/v1', persisted: false },
});

test('a declared sensitive value is redacted before it can reach the store', async (t) => {
  const root = await fixtureRepository(t);
  const store = await openEvidenceStore({
    repositoryRoot: root,
    redactor: createRedactor({
      secrets: [{ name: 'APP_TOKEN', source: 'approved-environment-file', value: CANARY }],
    }),
  });

  const appended = await store.appendEvidence({
    // The canary is planted in captured output, in an encoded form of that
    // output, and inside the decision itself.
    decision: decisionFixture('evaluation-one', `check failed while using ${CANARY}`),
    outputs: [{
      checkId: 'check.one',
      attempt: 1,
      text: [
        `connecting with token ${CANARY}`,
        `encoded ${Buffer.from(CANARY, 'utf8').toString('base64')}`,
        `escaped ${encodeURIComponent(CANARY)}`,
      ].join('\n'),
    }],
  });

  assert.equal(appended.appended, true);

  const persisted = await storeContents(store.root);

  assert.equal(persisted.includes(CANARY), false);
  assert.equal(persisted.includes(Buffer.from(CANARY, 'utf8').toString('base64')), false);
  assert.equal(persisted.includes(encodeURIComponent(CANARY)), false);
  assert.equal(persisted.includes(REDACTION_PLACEHOLDER), true);

  // The name and source of a Sensitive runtime input may be recorded; its value may not.
  const envelope = await store.readEnvelope(appended.evidenceId);

  assert.equal(envelope.redaction.applied > 0, true);
  assert.deepEqual(envelope.redaction.secrets, [
    { name: 'APP_TOKEN', source: 'approved-environment-file' },
  ]);
  assert.equal(envelope.retention.attempts[0].redaction.applied > 0, true);
  assert.equal(envelope.decision.checks[0].summary.includes(CANARY), false);
});

test('built-in patterns redact common secret shapes with nothing declared', () => {
  const redactor = createRedactor();
  const result = redactor.redactText([
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789',
    'DATABASE_PASSWORD=hunter2hunter2hunter2',
    'https://user:s3cr3tp4ssw0rd@example.test/repo.git',
    '-----BEGIN RSA PRIVATE KEY-----',
  ].join('\n'));

  assert.equal(result.text.includes('abcdefghijklmnopqrstuvwxyz0123456789'), false);
  assert.equal(result.text.includes('hunter2hunter2hunter2'), false);
  assert.equal(result.text.includes('s3cr3tp4ssw0rd'), false);
  assert.equal(result.applied >= 3, true);
  assert.equal(result.rules.length >= 3, true);
});

test('evidence that cannot be proved safe is never persisted and is unverified', async (t) => {
  const root = await fixtureRepository(t);
  // A redactor that removes nothing stands in for redaction that cannot prove
  // safe handling of a declared Sensitive value.
  const store = await openEvidenceStore({
    repositoryRoot: root,
    redactor: {
      secrets: [{ name: 'APP_TOKEN', source: 'approved-environment-file', value: CANARY }],
      redactText: (text) => ({ text, applied: 0, rules: [], redactedBytes: 0 }),
      redactValue: (value) => ({ value, applied: 0, rules: [], redactedBytes: 0 }),
    },
  });

  const refused = await store.appendEvidence({
    decision: decisionFixture('evaluation-one', 'clean summary'),
    outputs: [{ checkId: 'check.one', attempt: 1, text: `token ${CANARY}` }],
  });

  assert.equal(refused.appended, false);
  assert.equal(refused.outcome, 'unverified');
  assert.equal(refused.reasonCode, 'unsafe-capture');
  assert.equal(refused.findings.length > 0, true);

  // Nothing at all was written: no envelope, no blob, no log entry.
  assert.deepEqual(await store.readLog(), []);
  assert.deepEqual(await store.listBlobs(), []);
  assert.equal((await storeContents(store.root)).includes(CANARY), false);
});
