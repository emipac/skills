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
import {
  contentIdentity,
  hostPathVariants,
  storedDecision,
  withEvidenceIdentity,
  withoutHostPaths,
} from './evidence-identity.mjs';
import { createLifecycleEvent, validateLifecycleEvent } from './lifecycle-event.mjs';
import { createRedactor, residualFindings } from './redaction.mjs';

const runFile = promisify(execFile);

/**
 * The versioned on-disk shape of this store.
 *
 * `v2` states what changed in the envelope: run-local values are elided from
 * the addressed bytes and the record states its own persistence. The store
 * layout is unchanged and `v1` envelopes stay readable, prunable, and
 * auditable beside `v2` ones — which is what versioning an append-only store
 * is for (`SG-EVID-001`, `FR-EVID-004`).
 */
export const EVIDENCE_STORE_VERSION = 'change-evaluation-gate/evidence/v2';

/** Runtime-owned directory name under the Git common directory. */
export const STORE_DIRECTORY = path.join('change-evaluation-gate', 'evidence');

const DIRECTORY_MODE = 0o700;

const FILE_MODE = 0o600;

const defaultRunGit = async (repositoryRoot, args) => {
  const { stdout } = await runFile('git', args, { cwd: repositoryRoot });

  return stdout;
};

const digestOf = (value) => createHash('sha256').update(value).digest('hex');

// One scheme, stated once. Re-exported here because this store is where every
// caller already reaches for it.
export { contentIdentity };

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
 * Is `candidate` a path the directory `owner` actually contains?
 *
 * Destructive operations answer this again at the moment of the write. A
 * containment established when a preview was built proves nothing about the
 * string a removal is about to hand the filesystem, and the id a blob path is
 * derived from is only ever as trustworthy as whatever produced it.
 */
export const containedWithin = (owner, candidate) => {
  const root = path.resolve(owner);
  const target = path.resolve(candidate);
  const relative = path.relative(root, target);

  return relative !== ''
    && !relative.startsWith('..')
    && !path.isAbsolute(relative);
};

/**
 * The load-bearing identity of one prune preview.
 *
 * Everything a removal acts on and nothing that merely describes when it was
 * taken: the selector that chose the blobs, every blob's id, size, age, and the
 * evaluations referencing it, and the total. Two previews with this identity
 * describe the same removal against the same store; two that differ do not, and
 * a confirmation granted against one of them cannot be spent on the other.
 */
const prunePreviewIdentity = (preview) => contentIdentity({
  selector: {
    evaluationIds: preview?.selector?.evaluationIds ?? null,
    appendedBefore: preview?.selector?.appendedBefore ?? null,
    reclaimBytes: preview?.selector?.reclaimBytes ?? null,
  },
  blobs: (preview?.blobs ?? []).map((blob) => ({
    blobId: blob?.blobId ?? null,
    bytes: blob?.bytes ?? null,
    appendedAt: blob?.appendedAt ?? null,
    references: (blob?.references ?? []).map((reference) => ({
      evaluationId: reference?.evaluationId ?? null,
      checkId: reference?.checkId ?? null,
      attempt: reference?.attempt ?? null,
    })),
  })),
  totalBytes: preview?.totalBytes ?? null,
});

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
    activation: path.join(root, 'activation'),
    activationReceipt: path.join(root, 'activation', 'receipt.json'),
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

  /**
   * The clone-local Activation receipt.
   *
   * The receipt is the only piece of this store that is not append-only, and
   * deliberately so: it is current activation state, not history. It is
   * published by a single atomic rename and withdrawn by a single removal, so
   * an interrupted Activation transaction leaves either a whole receipt or no
   * receipt at all — never a partial one (NFR-REL-002).
   *
   * These two operations move bytes and nothing else. The Lifecycle event that
   * makes the change auditable is appended by the lifecycle command performing
   * it — activation, update, deactivation, repair — because only that caller
   * knows which governed action this write belongs to and what its outcome was.
   * That is what keeps one governed action to exactly one event rather than a
   * generic store record beside a specific caller record.
   *
   * A new caller that writes or removes the receipt directly therefore owes the
   * audit trail its own `appendLifecycleEvent`; nothing here appends one for it
   * (FR-EVID-005, SG-LIFE-001).
   */
  const activationReceipt = () => ({
    path: paths.activationReceipt,
    read: async () => {
      const contents = await readFile(paths.activationReceipt, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') {
          return null;
        }

        throw error;
      });

      return contents === null ? null : JSON.parse(contents);
    },
    write: async (receipt) => {
      await writeAtomic(paths.activationReceipt, `${JSON.stringify(receipt, null, 2)}\n`);

      return receipt;
    },
    remove: async () => {
      await rm(paths.activationReceipt, { force: true });
    },
  });

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
    // The one run-local path everything written here is normalized against. A
    // check reports where it ran; the record of what it decided must not
    // (NFR-REL-001).
    const executionRoot = redactedDecision.value?.snapshot?.executionRoot ?? null;
    const executionRootVariants = hostPathVariants(executionRoot);
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
      // Elision of the run-local path follows redaction and precedes bounding
      // and addressing, so identical output from two runs of one evaluation is
      // one stored blob rather than two that differ by a temporary directory
      // name (NFR-REL-001, SG-SECRET-001).
      const captured = Buffer.from(
        withoutHostPaths(redactedOutput.text, executionRootVariants),
        'utf8',
      );
      const checkId = output?.checkId ?? null;

      redactionRules.push(...redactedOutput.rules);
      redactedBytes += redactedOutput.redactedBytes;
      const attempt = Number.isInteger(output?.attempt) ? output.attempt : null;
      const bounded = boundOutput(captured, { inlineLimitBytes: limits.inlineBytes });
      let blobOutcome = 'omitted';
      let blobReasonCode = null;
      let blobId = null;
      let blobBytes = 0;

      // Blobs are content-addressed, so identical output from several checks is
      // one stored file. The per-evaluation ceiling bounds what is written, so
      // it counts distinct content once rather than charging every reference.
      const candidateId = `sha256:${digestOf(captured)}`;
      const alreadyPending = pending.some((entry) => entry.blobId === candidateId);

      if (captured.length > limits.blobBytes) {
        // A single attempt may never exceed the per-blob ceiling. The inline
        // excerpt still records what was seen and how much was left out.
        blobReasonCode = 'blob-limit-exceeded';
      } else if (
        !alreadyPending
        && evaluationBlobBytes + captured.length > limits.evaluationBlobBytes
      ) {
        blobReasonCode = 'evaluation-blob-limit-exceeded';
      } else {
        blobOutcome = 'retained';
        blobId = candidateId;
        blobBytes = captured.length;

        if (!alreadyPending) {
          evaluationBlobBytes += captured.length;
          pending.push({ blobId, bytes: captured, descriptor: { evaluationId, checkId, attempt } });
        }
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

    const blobIds = pending.map(({ bytes }) => `sha256:${digestOf(bytes)}`);
    const envelope = {
      storeVersion: EVIDENCE_STORE_VERSION,
      evaluationId,
      // The stored decision is the decision with its run-local values elided
      // and its own persistence stated. The decision the caller received is
      // untouched (NFR-REL-001, NFR-AUD-001).
      decision: storedDecision(redactedDecision.value, { blobIds }),
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
      blobs: pending.map(({ bytes, descriptor }, index) => ({
        blobId: blobIds[index],
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
    // Identical evidence addresses one envelope, and an envelope that already
    // exists is left exactly as it was written. Nothing is rewritten, which is
    // what append-only means here (SG-EVID-001, AC-EVID-001).
    const existing = await readFile(envelopePath, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') {
        return null;
      }

      throw error;
    });

    if (existing === null) {
      await writeAtomic(
        envelopePath,
        `${JSON.stringify(withEvidenceIdentity(envelope, evidenceId), null, 2)}\n`,
      );
    }

    const entry = {
      evidenceId,
      evaluationId,
      appendedAt: clock().toISOString(),
      envelopePath: path.relative(root, envelopePath),
      blobIds: blobs.map((blob) => blob.blobId),
      // The run-local facts of this one append. They are elided from the
      // addressed envelope because they say nothing about what was evaluated,
      // and they are kept here, per append and never content-addressed,
      // because every diagnosis of a real run has needed them (NFR-REL-001,
      // NFR-OPER-001).
      execution: {
        executionRoot,
        attempts: (redactedDecision.value?.checks ?? []).flatMap((check) => (
          (check?.attempts ?? []).map((attempt) => ({
            checkId: check?.id ?? null,
            attempt: attempt?.attempt ?? null,
            durationMs: attempt?.durationMs ?? null,
          }))
        )),
      },
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
      // Whether these bytes were already on disk. The append still happened —
      // it is in the log and it left its Lifecycle event — and one evaluation
      // still occupies one envelope (AC-EVID-001).
      deduplicated: existing !== null,
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
   * Remove exactly what a preview recomputed against the store right now
   * identifies, and only after the maintainer's confirmation reproduces it.
   *
   * The confirmation names what the maintainer approved. It does not authorize
   * the object it arrived beside: that object is a claim about the store, and
   * the claim is re-established here by re-deriving the preview from the files
   * as they are at the moment of removal. Nothing the caller holds decides what
   * is deleted, which is what makes an altered preview — or a preview the
   * caller wrote outright — remove nothing (AC-EVID-002, SG-EVID-001).
   */
  const confirmPrune = async ({ preview = null, confirmation = null } = {}) => {
    const expected = preview?.confirmationToken ?? null;
    const refuse = async (reasonCode, reason, detail = null) => {
      const refusal = {
        pruningId: randomUUID(),
        prunedAt: clock().toISOString(),
        pruned: false,
        outcome: 'refused',
        reasonCode,
        reason,
        ...(detail === null ? {} : { detail }),
        selector: preview?.selector ?? null,
        previewedBlobIds: (preview?.blobs ?? []).map((blob) => blob.blobId),
        expectedConfirmation: expected,
        removed: [],
        retained: [],
        reclaimedBytes: 0,
      };

      await appendLine(paths.prunings, refusal);
      await appendLifecycleEvent({
        type: 'pruning',
        before: expected,
        after: null,
        outcome: 'refused',
        reason: `${reasonCode}: ${reason}`,
      });

      return { ...refusal };
    };

    const matched = typeof expected === 'string'
      && typeof confirmation === 'string'
      && expected === confirmation;

    if (!matched) {
      return refuse(
        'preview-mismatch',
        'the confirmation did not reproduce the preview, so nothing was removed.',
      );
    }

    // The one step that removes the caller's object from the trust path. The
    // same selector is re-run against the store as it is now, and the removal
    // proceeds only when that fresh preview is the very thing the maintainer
    // confirmed. A store that changed — for any reason, forged object or
    // ordinary concurrent append — stops here.
    const recomputed = await previewPrune(preview.selector ?? {});

    if (recomputed.confirmationToken !== confirmation
      || prunePreviewIdentity(recomputed) !== prunePreviewIdentity(preview)) {
      return refuse(
        'preview-stale',
        'the store no longer matches the preview this confirmation was granted against, so nothing was removed; preview again and confirm the new preview.',
        {
          expected: prunePreviewIdentity(preview),
          actual: prunePreviewIdentity(recomputed),
          recomputedConfirmationToken: recomputed.confirmationToken,
        },
      );
    }

    // Every path this removal will touch, re-established as living under the
    // blob directory this store owns — at the moment of the write, not when the
    // preview was built. A blob id that resolves anywhere else is not this
    // store's to delete, whatever produced it (SG-EVID-001).
    const escaping = recomputed.blobs.filter((blob) => !containedWithin(paths.blobs, blobPath(blob.blobId)));

    if (escaping.length > 0) {
      return refuse(
        'path-escapes-store',
        'a previewed blob resolves outside the Evidence store, so nothing was removed; preview again and confirm the new preview.',
        { blobIds: escaping.map((blob) => blob.blobId) },
      );
    }

    const pruningId = randomUUID();
    const prunedAt = clock().toISOString();
    const removed = [];
    // Kept in the record shape because pruning records are append-only history
    // that existing readers parse. Nothing reaches it any more: a blob another
    // evaluation referenced since the preview now changes the recomputed
    // preview, so that case is a stated refusal above rather than a silent
    // partial prune.
    const retained = [];
    let reclaimedBytes = 0;

    for (const blob of recomputed.blobs) {
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
      reason: null,
      selector: recomputed.selector ?? null,
      previewedBlobIds: recomputed.blobs.map((blob) => blob.blobId),
      expectedConfirmation: expected,
      removed,
      retained,
      reclaimedBytes,
    };

    await appendLine(paths.prunings, record);
    await appendLifecycleEvent({
      type: 'pruning',
      before: expected,
      after: pruningId,
      outcome: 'succeeded',
      reason: `Removed ${removed.length} blob(s) and reclaimed ${reclaimedBytes} bytes, exactly as the preview recomputed at confirmation identified; envelopes, decisions, events, pruning records, and tombstones were preserved.`,
    });

    return { ...record };
  };

  return {
    root,
    gitCommonDirectory: common,
    paths,
    limits,
    violations,
    activationReceipt,
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
