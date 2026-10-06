import { createHash } from 'node:crypto';
import path from 'node:path';
import { envelopeIdentity } from '../../evidence-identity.mjs';
import { resolveGitCommonDirectory, STORE_DIRECTORY } from '../../evidence-store.mjs';
import { assertOwnedRoot, readOwnedFile } from './files.mjs';

export const HISTORY_ID = /^sha256:[0-9a-f]{64}$/;
const INPUT_BYTES = 1024 * 1024;
const LOG_BYTES = 64 * 1024;
const textValue = (value) => typeof value === 'string' ? value.slice(0, 10000) : null;
const stringList = (value) => Array.isArray(value) ? value.filter((entry) => typeof entry === 'string').slice(0, 100).map(textValue) : [];
const selectedDetails = (envelope) => ({
  diagnostics: Array.isArray(envelope.decision?.diagnostics)
    ? envelope.decision.diagnostics.slice(0, 100).map((entry) => ({ reasonCode: textValue(entry?.reasonCode), detail: textValue(entry?.detail) }))
    : [],
  dependencies: {
    provided: stringList(envelope.decision?.environment?.dependencies?.provided),
    missing: stringList(envelope.decision?.environment?.dependencies?.missing),
    refused: stringList(envelope.decision?.environment?.dependencies?.refused),
  },
  redaction: {
    applied: Number.isFinite(envelope.redaction?.applied) ? envelope.redaction.applied : null,
    redactedBytes: Number.isFinite(envelope.redaction?.redactedBytes) ? envelope.redaction.redactedBytes : null,
    unresolvedInputs: Array.isArray(envelope.redaction?.unresolved) ? envelope.redaction.unresolved.length : 0,
  },
});
const addressedPath = (root, directory, id, suffix = '') => {
  const hex = id.slice(7);
  return path.join(root, directory, hex.slice(0, 2), `${hex}${suffix}`);
};
const summary = (envelope) => ({
  evidenceId: envelope.evidenceId ?? envelopeIdentity(envelope),
  evaluationId: envelope.evaluationId ?? null,
  outcome: envelope.decision?.outcome ?? null,
  snapshot: {
    kind: envelope.decision?.snapshot?.kind ?? null,
    id: envelope.decision?.snapshot?.id ?? null,
    baseRevision: envelope.decision?.snapshot?.baseRevision ?? null,
  },
  checks: (envelope.decision?.checks ?? []).map(({ id, policy, outcome, reasonCode, summary: text }) => ({ id, policy, outcome, reasonCode, summary: text })),
  logs: (envelope.blobs ?? []).map(({ blobId, checkId, attempt, bytes }) => ({ blobId, checkId, attempt, bytes })),
});

/** Observation only: opening this reader never creates an Evidence store. */
export const readHistory = async ({ repositoryRoot, limit = 30, evidenceId = null, blobId = null }) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100
    || (evidenceId !== null && !HISTORY_ID.test(evidenceId))
    || (blobId !== null && (!HISTORY_ID.test(blobId) || evidenceId === null))) {
    throw Object.assign(new Error('invalid-history-selector'), { code: 'INVALID_SELECTOR' });
  }
  const common = await resolveGitCommonDirectory({ repositoryRoot });
  const root = path.join(common, STORE_DIRECTORY);
  let owner = null;
  const history = { scope: 'clone', entries: [], warnings: [], truncated: false, selected: null };
  const warn = (code) => { if (!history.warnings.includes(code)) history.warnings.push(code); };
  const envelopeFor = async (id) => {
    const loaded = await readOwnedFile(owner, addressedPath(root, 'envelopes', id, '.json'), { maxBytes: INPUT_BYTES * 4 });
    const envelope = JSON.parse(loaded.bytes.toString('utf8'));
    if (!['change-evaluation-gate/evidence/v1', 'change-evaluation-gate/evidence/v2'].includes(envelope.storeVersion)
      || envelopeIdentity(envelope) !== id
      || (envelope.evidenceId !== undefined && envelope.evidenceId !== id)) throw Object.assign(new Error('invalid-evidence'), { code: 'INTEGRITY' });
    return envelope;
  };
  try {
    owner = await assertOwnedRoot(common, root);
  } catch (error) {
    if (error.code !== 'ENOENT') warn('history-unavailable');
    if (evidenceId !== null) warn('selected-evidence-unavailable-or-invalid');
    return history;
  }
  try {
    const loaded = await readOwnedFile(owner, path.join(root, 'log.ndjson'), { maxBytes: INPUT_BYTES, tail: true });
    const lines = loaded.bytes.toString('utf8').split('\n');
    if (loaded.truncated) lines.shift();
    history.truncated = loaded.truncated;
    if (lines.at(-1)?.trim()) { lines.pop(); warn('incomplete-log-line'); }
    const records = [];
    const seen = new Set();
    for (const line of lines.reverse()) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (!HISTORY_ID.test(entry.evidenceId)) throw new Error('invalid-id');
        if (seen.has(entry.evidenceId)) continue;
        seen.add(entry.evidenceId);
        records.push(entry);
      } catch { warn('malformed-log-record'); }
      if (records.length > limit) { history.truncated = true; break; }
    }
    for (const entry of records.slice(0, limit)) {
      try {
        history.entries.push({ ...summary(await envelopeFor(entry.evidenceId)), appendedAt: entry.appendedAt ?? null });
      } catch { warn('evidence-unavailable-or-invalid'); }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') warn('log-unavailable');
  }
  if (evidenceId !== null) {
    try {
      const envelope = await envelopeFor(evidenceId);
      history.selected = { ...summary(envelope), ...selectedDetails(envelope) };
      if (blobId !== null) {
        if (!(envelope.blobs ?? []).some((blob) => blob.blobId === blobId)) {
          warn('log-not-authorized');
        } else {
          try {
            const loaded = await readOwnedFile(owner, addressedPath(root, 'blobs', blobId), { maxBytes: INPUT_BYTES * 4 });
            if (`sha256:${createHash('sha256').update(loaded.bytes).digest('hex')}` !== blobId) throw new Error('integrity');
            history.selected.log = { blobId, availability: 'retained', text: loaded.bytes.subarray(0, LOG_BYTES).toString('utf8'), truncated: loaded.bytes.length > LOG_BYTES };
          } catch (error) {
            history.selected.log = { blobId, availability: error.code === 'ENOENT' ? 'missing' : 'unavailable', text: null, truncated: false };
            if (error.code !== 'ENOENT') warn('log-unavailable-or-invalid');
          }
        }
      }
    } catch { warn('selected-evidence-unavailable-or-invalid'); }
  }
  return history;
};
