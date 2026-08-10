/**
 * The clone-local Evidence store.
 *
 * One append-only store lives under the resolved Git common directory, so every
 * linked worktree of one clone shares exactly one local history and nothing is
 * ever written into tracked source (FR-EVID-002).
 *
 * The store only ever appends. Envelopes, decisions, bypass records, Lifecycle
 * events, pruning records, and tombstones are never removed, never rewritten,
 * and never automatically deleted. The single removal path is explicit,
 * preview-bound, confirmation-matched blob pruning (FR-EVID-004, SG-EVID-001).
 *
 * The store is cooperative local state, not tamper-proof: a machine owner can
 * always edit these files. Nothing here claims otherwise (SG-TRUST-001).
 *
 * Per-common-directory serialization is a separate concern. Every mutating
 * operation here is a single atomic rename or a single append, so a lock can be
 * layered above without changing this contract.
 */

import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { boundOutput, resolveEvidenceLimits } from './evidence-bounds.mjs';
import { createLifecycleEvent, validateLifecycleEvent } from './lifecycle-event.mjs';
import { createRedactor, residualFindings } from './redaction.mjs';

const runFile = promisify(execFile);

/** The versioned on-disk shape of this store. */
export const EVIDENCE_STORE_VERSION = 'change-evaluation-gate/evidence/v1';

/** Runtime-owned directory name under the Git common directory. */
export const STORE_DIRECTORY = path.join('change-evaluation-gate', 'evidence');

const DIRECTORY_MODE = 0o700;

const FILE_MODE = 0o600;

const defaultRunGit = async (repositoryRoot, args) => {
  const { stdout } = await runFile('git', args, { cwd: repositoryRoot });

  return stdout;
};

const canonical = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value ?? null);
};

const digestOf = (value) => createHash('sha256').update(value).digest('hex');

/** Content identity over a canonical serialization; never over host paths. */
export const contentIdentity = (value) => `sha256:${digestOf(canonical(value))}`;

/**
 * Blobs are content-addressed, so one stored blob can be referenced by several
 * evaluations. Selection and byte accounting are per stored blob; the
 * references travel with it so a preview and its tombstone name every
 * evaluation the removal touches.
 */
const groupByBlob = (records) => {
  const grouped = new Map();

  for (const record of records) {
    const existing = grouped.get(record.blobId) ?? {
      blobId: record.blobId,
      bytes: record.bytes,
      appendedAt: record.appendedAt,
      references: [],
    };

    existing.references.push({
      evaluationId: record.evaluationId ?? null,
      checkId: record.checkId ?? null,
      attempt: record.attempt ?? null,
    });
    // The oldest reference decides the blob's age for age-based selection.
    existing.appendedAt = existing.appendedAt <= record.appendedAt
      ? existing.appendedAt
      : record.appendedAt;
    grouped.set(record.blobId, existing);
  }

  return [...grouped.values()];
};

/**
 * Resolve the Git common directory. All linked worktrees of one clone answer
 * with the same absolute path, which is exactly why the store lives there.
 */
export const resolveGitCommonDirectory = async ({ repositoryRoot, runGit = defaultRunGit }) => {
  const stdout = await runGit(repositoryRoot, ['rev-parse', '--git-common-dir']);
  const resolved = path.resolve(repositoryRoot, stdout.trim());

  // Git answers a linked worktree with an absolute path and the primary
  // worktree with a relative one, so the two can name the same directory
  // through different strings. The canonical path is the store identity every
  // worktree must agree on, and it is what a later coordination lock keys on.
  return realpath(resolved).catch(() => resolved);
};

const readLines = async (file) => {
  const contents = await readFile(file, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return '';
    }

    throw error;
  });

  return parseLines(contents);
};

const parseLines = (contents) => contents
  .split('\n')
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line));

const readLinesSync = (file) => {
  try {
    return parseLines(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
};

/**
 * Open, creating when absent, the Evidence store for one repository.
 *
 * @param {object} options repository root, optional resolved common directory,
 *   injected Git runner, and injected clock
 */
export const openEvidenceStore = async ({
  repositoryRoot,
  gitCommonDirectory = null,
  evidencePolicy = null,
  redactor = createRedactor(),
  identity = {},
  runGit = defaultRunGit,
  clock = () => new Date(),
} = {}) => {
  const { limits, violations } = resolveEvidenceLimits(evidencePolicy);
  const common = gitCommonDirectory
    ?? await resolveGitCommonDirectory({ repositoryRoot, runGit });
  const root = path.join(common, STORE_DIRECTORY);
  const paths = {
    root,
    envelopes: path.join(root, 'envelopes'),
    blobs: path.join(root, 'blobs'),
    staging: path.join(root, 'staging'),
    log: path.join(root, 'log.ndjson'),
    events: path.join(root, 'events.ndjson'),
    blobIndex: path.join(root, 'blobs.ndjson'),
    bypassLedger: path.join(root, 'bypass-ledger.ndjson'),
    tombstones: path.join(root, 'tombstones.ndjson'),
    prunings: path.join(root, 'prunings.ndjson'),
  };

  for (const directory of [paths.root, paths.envelopes, paths.blobs, paths.staging]) {
    await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
  }

  /** Write through a staging file and one rename, so a reader never sees a partial record. */
  const writeAtomic = async (destination, contents) => {
    const staged = path.join(paths.staging, `${randomUUID()}.part`);

    await mkdir(path.dirname(destination), { recursive: true, mode: DIRECTORY_MODE });
    await writeFile(staged, contents, { mode: FILE_MODE });
    await rename(staged, destination);
  };

  const appendLine = (file, record) => appendFile(
    file,
    `${JSON.stringify(record)}\n`,
    { encoding: 'utf8', mode: FILE_MODE },
  );

  // Policy resolves a one-shot bypass synchronously, so its ledger reads and
  // appends synchronously too.
  const appendLineSync = (file, record) => appendFileSync(
    file,
    `${JSON.stringify(record)}\n`,
    { encoding: 'utf8', mode: FILE_MODE },
  );

  const blobPath = (identity) => {
    const hex = identity.replace(/^sha256:/, '');

    return path.join(paths.blobs, hex.slice(0, 2), hex);
  };

  const readEvents = () => readLines(paths.events);

  /**
   * Append one immutable Lifecycle event. Records are redacted before they are
   * written and audited against the event schema; an event that fails the audit
   * is refused rather than stored (FR-EVID-005, NFR-AUD-001, SG-SECRET-001).
   */
  const appendLifecycleEvent = async (input) => {
    const redacted = redactor.redactValue(input ?? {});
    const event = createLifecycleEvent({
      actor: identity.actor,
      client: identity.client,
      gate: identity.gate,
      repository: { gitCommonDirectory: common, ...identity.repository },
      ...redacted.value,
      redaction: {
        version: redactor.version ?? null,
        applied: redacted.applied,
        rules: redacted.rules,
      },
    }, { clock });
    const errors = validateLifecycleEvent(event);

    if (errors.length > 0) {
      return { appended: false, reasonCode: 'lifecycle-event-invalid', errors, event: null };
    }

    const findings = residualFindings(JSON.stringify(event), redactor.secrets ?? []);

    if (findings.length > 0) {
      return { appended: false, reasonCode: 'unsafe-capture', errors: findings, event: null };
    }

    await appendLine(paths.events, event);

    return { appended: true, reasonCode: null, errors: [], event };
  };

  const readBypassLedger = () => readLines(paths.bypassLedger);

  /**
   * The durable home of the one-shot bypass ledger.
   *
   * A bypass is one-shot only if its consumption outlives the process that
   * applied it, so the ledger belongs in the same append-only clone-local store
   * as the evidence it explains — not in per-session memory (FR-POL-007,
   * FR-POL-008, SG-BYP-001).
   *
   * Policy consults the ledger synchronously while it resolves one grant, so
   * both operations are synchronous appends and reads. Serializing concurrent
   * consumers is a separate concern; a lock layers above this seam.
   */
  const bypassLedger = () => ({
    isConsumed: (id) => readLinesSync(paths.bypassLedger).some((record) => record.bypassId === id),
    consume: (applied) => {
      const redacted = redactor.redactValue({
        bypassId: applied?.id ?? null,
        snapshotId: applied?.snapshotId ?? null,
        actor: applied?.actor ?? null,
        reason: applied?.reason ?? null,
        reference: applied?.reference ?? null,
        requestedAt: applied?.requestedAt ?? null,
        marker: applied?.marker ?? null,
        preservedFailures: applied?.preservedFailures ?? [],
        preservedUnverified: applied?.preservedUnverified ?? [],
        bypassedOutcome: applied?.bypassedOutcome ?? null,
      });

      appendLineSync(paths.bypassLedger, {
        ...redacted.value,
        consumedAt: clock().toISOString(),
      });

      const event = createLifecycleEvent({
        actor: identity.actor,
        client: identity.client,
        gate: identity.gate,
        repository: { gitCommonDirectory: common, ...identity.repository },
        type: 'bypass',
        before: applied?.snapshotId ?? null,
        after: applied?.id ?? null,
        outcome: 'succeeded',
        reason: `A one-shot bypass was consumed; ${(applied?.preservedFailures ?? []).length} failed and ${(applied?.preservedUnverified ?? []).length} unverified check(s) are preserved.`,
        redaction: {
          version: redactor.version ?? null,
          applied: redacted.applied,
          rules: redacted.rules,
        },
      }, { clock });

      if (validateLifecycleEvent(event).length === 0) {
        appendLineSync(paths.events, event);
      }
    },
  });

  const readTombstones = () => readLines(paths.tombstones);

  const readPrunings = () => readLines(paths.prunings);

  const readLog = () => readLines(paths.log);

  const readBlobIndex = () => readLines(paths.blobIndex);

  /** Every blob record that has not been pruned away. */
  const listBlobs = async () => {
    const removed = new Set((await readTombstones()).map((tombstone) => tombstone.blobId));

    return (await readBlobIndex()).filter((record) => !removed.has(record.blobId));
  };

  /** Read one retained blob, or `null` once it has been pruned away. */
  const readBlob = async (blobId) => readFile(blobPath(blobId)).catch((error) => {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  });

  const readEnvelope = async (evidenceId) => {
    const hex = evidenceId.replace(/^sha256:/, '');
    const contents = await readFile(
      path.join(paths.envelopes, hex.slice(0, 2), `${hex}.json`),
      'utf8',
    ).catch((error) => {
      if (error.code === 'ENOENT') {
        return null;
      }

      throw error;
    });

    return contents === null ? null : JSON.parse(contents);
  };

  const putBlob = async (bytes, descriptor) => {
    const blobId = `sha256:${digestOf(bytes)}`;
    const destination = blobPath(blobId);

    await writeAtomic(destination, bytes);

    const record = {
      blobId,
      bytes: bytes.length,
      appendedAt: clock().toISOString(),
      ...descriptor,
    };

    await appendLine(paths.blobIndex, record);

    return record;
  };

  /**
   * Append one Evidence envelope and its bounded, redacted output blobs.
   *
   * The envelope is content-addressed and written atomically; the append-only
   * log then names it. Re-appending identical evidence rewrites nothing.
   */
  const appendEvidence = async ({ decision, outputs = [] } = {}) => {
    const evaluationId = decision?.evaluationId ?? null;
    const pending = [];
    const attempts = [];
    const redactedDecision = redactor.redactValue(decision ?? null);
    const redactionRules = [...redactedDecision.rules];
    let redactedBytes = redactedDecision.redactedBytes;
    let evaluationBlobBytes = 0;

    for (const output of outputs) {
      // Redaction runs before bounding, before content addressing, and before
      // anything reaches the filesystem. Every retained byte count therefore
      // describes redacted output (FR-EVID-003, SG-SECRET-001).
      const raw = Buffer.isBuffer(output?.bytes)
        ? output.bytes.toString('utf8')
        : String(output?.text ?? '');
      const redactedOutput = redactor.redactText(raw);
      const captured = Buffer.from(redactedOutput.text, 'utf8');
      const checkId = output?.checkId ?? null;

      redactionRules.push(...redactedOutput.rules);
      redactedBytes += redactedOutput.redactedBytes;
      const attempt = Number.isInteger(output?.attempt) ? output.attempt : null;
      const bounded = boundOutput(captured, { inlineLimitBytes: limits.inlineBytes });
      let blobOutcome = 'omitted';
      let blobReasonCode = null;
      let blobId = null;
      let blobBytes = 0;

      if (captured.length > limits.blobBytes) {
        // A single attempt may never exceed the per-blob ceiling. The inline
        // excerpt still records what was seen and how much was left out.
        blobReasonCode = 'blob-limit-exceeded';
      } else if (evaluationBlobBytes + captured.length > limits.evaluationBlobBytes) {
        blobReasonCode = 'evaluation-blob-limit-exceeded';
      } else {
        blobOutcome = 'retained';
        blobId = `sha256:${digestOf(captured)}`;
        blobBytes = captured.length;
        evaluationBlobBytes += captured.length;
        pending.push({ bytes: captured, descriptor: { evaluationId, checkId, attempt } });
      }

      attempts.push({
        checkId,
        attempt,
        inline: bounded.inline,
        capturedBytes: bounded.capturedBytes,
        retainedBytes: bounded.retainedBytes,
        omittedBytes: bounded.omittedBytes,
        truncated: bounded.truncated,
        boundary: bounded.boundary,
        blobId,
        blobBytes,
        blobOutcome,
        blobReasonCode,
        redaction: {
          version: redactor.version ?? null,
          rules: redactedOutput.rules,
          applied: redactedOutput.applied,
          redactedBytes: redactedOutput.redactedBytes,
        },
      });
    }

    const envelope = {
      storeVersion: EVIDENCE_STORE_VERSION,
      evaluationId,
      decision: redactedDecision.value,
      redaction: {
        version: redactor.version ?? null,
        // Identity and source only; a Sensitive value never travels.
        secrets: (redactor.secrets ?? []).map(({ name, source }) => ({ name, source })),
        rules: redactionRules,
        applied: redactionRules.reduce((total, entry) => total + entry.count, 0),
        redactedBytes,
      },
      retention: {
        limits,
        violations,
        attempts,
        totals: {
          attempts: attempts.length,
          blobBytes: evaluationBlobBytes,
        },
      },
      blobs: pending.map(({ bytes, descriptor }) => ({
        blobId: `sha256:${digestOf(bytes)}`,
        bytes: bytes.length,
        checkId: descriptor.checkId,
        attempt: descriptor.attempt,
      })),
    };

    // Nothing is written until safe handling is proved over exactly what would
    // be written. An unsafe capture persists nothing and is `unverified`
    // (SG-SECRET-001, RISK-006).
    const findings = residualFindings(
      [JSON.stringify(envelope), ...pending.map(({ bytes }) => bytes.toString('utf8'))].join('\n'),
      redactor.secrets ?? [],
    );

    if (findings.length > 0) {
      // The refusal is itself a governed action, so it is recorded — carrying
      // only the identity of what survived, never the value.
      await appendLifecycleEvent({
        type: 'evaluation',
        before: null,
        after: null,
        outcome: 'refused',
        reason: `unsafe-capture: a declared Sensitive value survived redaction (${findings.length} finding(s)); no evidence was persisted.`,
      });

      return {
        appended: false,
        outcome: 'unverified',
        reasonCode: 'unsafe-capture',
        findings,
        evidenceId: null,
        evaluationId,
        envelopePath: null,
        blobs: [],
        entry: null,
      };
    }

    const blobs = [];

    for (const { bytes, descriptor } of pending) {
      blobs.push(await putBlob(bytes, descriptor));
    }

    const evidenceId = contentIdentity(envelope);
    const hex = evidenceId.replace(/^sha256:/, '');
    const envelopePath = path.join(paths.envelopes, hex.slice(0, 2), `${hex}.json`);

    await writeAtomic(envelopePath, `${JSON.stringify({ ...envelope, evidenceId }, null, 2)}\n`);

    const entry = {
      evidenceId,
      evaluationId,
      appendedAt: clock().toISOString(),
      envelopePath: path.relative(root, envelopePath),
      blobIds: blobs.map((blob) => blob.blobId),
    };

    await appendLine(paths.log, entry);
    await appendLifecycleEvent({
      type: 'evaluation',
      before: null,
      after: evidenceId,
      outcome: 'succeeded',
      reason: `Appended one Evidence envelope for evaluation ${evaluationId} with ${blobs.length} retained output blob(s).`,
    });

    return {
      appended: true,
      evidenceId,
      evaluationId,
      envelopePath,
      blobs,
      entry,
    };
  };

  /**
   * Identify the exact blobs and bytes a prune would remove. A preview removes
   * nothing and carries the confirmation token a later removal must match.
   */
  const previewPrune = async (selector = {}) => {
    const evaluationIds = Array.isArray(selector.evaluationIds) ? selector.evaluationIds : null;
    const appendedBefore = typeof selector.appendedBefore === 'string'
      ? selector.appendedBefore
      : null;
    const reclaimBytes = Number.isFinite(selector.reclaimBytes) ? selector.reclaimBytes : null;
    // Oldest first, so age and reclaimed-size selection are both deterministic
    // and reclaim the least useful evidence first.
    const candidates = groupByBlob(await listBlobs())
      .sort((left, right) => (left.appendedAt === right.appendedAt
        ? left.blobId.localeCompare(right.blobId)
        : left.appendedAt.localeCompare(right.appendedAt)))
      .filter((blob) => evaluationIds === null
        || blob.references.some((reference) => evaluationIds.includes(reference.evaluationId)))
      .filter((blob) => appendedBefore === null || blob.appendedAt < appendedBefore);
    const selected = [];
    let running = 0;

    for (const blob of candidates) {
      // A reclaimed-size selector stops as soon as the request is covered; it
      // never removes more than the operator asked to reclaim plus the one
      // blob that crosses the target.
      if (reclaimBytes !== null && running >= reclaimBytes) {
        break;
      }

      selected.push(blob);
      running += blob.bytes;
    }

    const preview = {
      previewedAt: clock().toISOString(),
      selector: { evaluationIds, appendedBefore, reclaimBytes },
      blobs: selected.map(({ blobId, bytes, appendedAt, references }) => ({
        blobId,
        bytes,
        appendedAt,
        references,
      })),
      totalBytes: selected.reduce((total, blob) => total + blob.bytes, 0),
    };

    return {
      ...preview,
      // The token is the identity of the exact selection. A confirmation that
      // does not reproduce it cannot have been shown this preview.
      confirmationToken: contentIdentity({
        blobs: preview.blobs.map(({ blobId, bytes }) => ({ blobId, bytes })),
        totalBytes: preview.totalBytes,
      }),
    };
  };

  /**
   * Remove exactly what one preview identified, and only after its confirmation
   * token matches. A mismatch removes nothing and records a refusal — never a
   * successful deletion (AC-EVID-002).
   */
  const confirmPrune = async ({ preview = null, confirmation = null } = {}) => {
    const expected = preview?.confirmationToken ?? null;
    const matched = typeof expected === 'string'
      && typeof confirmation === 'string'
      && expected === confirmation;

    if (!matched) {
      const refusal = {
        pruningId: randomUUID(),
        prunedAt: clock().toISOString(),
        pruned: false,
        outcome: 'refused',
        reasonCode: 'preview-mismatch',
        selector: preview?.selector ?? null,
        previewedBlobIds: (preview?.blobs ?? []).map((blob) => blob.blobId),
        expectedConfirmation: expected,
        removed: [],
        reclaimedBytes: 0,
      };

      await appendLine(paths.prunings, refusal);
      await appendLifecycleEvent({
        type: 'pruning',
        before: expected,
        after: null,
        outcome: 'refused',
        reason: 'preview-mismatch: the confirmation did not reproduce the preview, so nothing was removed.',
      });

      return { ...refusal };
    }

    const pruningId = randomUUID();
    const prunedAt = clock().toISOString();
    const removed = [];
    let reclaimedBytes = 0;

    for (const blob of preview.blobs) {
      // The blob file goes; nothing else does. The tombstone is appended first
      // so an interrupted prune can never leave an unrecorded removal.
      const tombstone = {
        blobId: blob.blobId,
        bytes: blob.bytes,
        pruningId,
        prunedAt,
        references: blob.references ?? [],
        reason: 'explicit-preview-confirmed-pruning',
      };

      await appendLine(paths.tombstones, tombstone);
      await rm(blobPath(blob.blobId), { force: true });

      removed.push(blob.blobId);
      reclaimedBytes += blob.bytes;
    }

    const record = {
      pruningId,
      prunedAt,
      pruned: true,
      outcome: 'removed',
      reasonCode: null,
      selector: preview.selector ?? null,
      previewedBlobIds: preview.blobs.map((blob) => blob.blobId),
      expectedConfirmation: expected,
      removed,
      reclaimedBytes,
    };

    await appendLine(paths.prunings, record);
    await appendLifecycleEvent({
      type: 'pruning',
      before: expected,
      after: pruningId,
      outcome: 'succeeded',
      reason: `Removed ${removed.length} blob(s) and reclaimed ${reclaimedBytes} bytes; envelopes, decisions, events, pruning records, and tombstones were preserved.`,
    });

    return { ...record };
  };

  return {
    root,
    gitCommonDirectory: common,
    paths,
    limits,
    violations,
    appendEvidence,
    appendLifecycleEvent,
    bypassLedger,
    readBypassLedger,
    listBlobs,
    readBlob,
    readEnvelope,
    previewPrune,
    confirmPrune,
    readLog,
    readEvents,
    readTombstones,
    readPrunings,
  };
};
