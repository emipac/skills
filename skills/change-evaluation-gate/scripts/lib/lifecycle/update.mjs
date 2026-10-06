import { contentIdentity } from '../evidence-store.mjs';
import { authorizedReceiptIds } from './receipts.mjs';
import { activeRelease, releaseOf } from './release.mjs';

/**
 * Preview one update.
 *
 * The preview writes nothing. It states the release the clone is on, the
 * candidate it would move to, and every migration that would run, and carries
 * the confirmation token a later update must reproduce (FR-LIFE-008).
 */
export const previewUpdate = ({ receipt = null, candidate = null, migrations = [] } = {}) => {
  const body = {
    from: activeRelease(receipt),
    to: releaseOf(candidate),
    migrations: migrations.map((migration) => ({
      id: migration?.id ?? null,
      description: migration?.description ?? null,
      reversible: migration?.reversible === true,
    })),
  };

  return { ...body, previewId: contentIdentity(body) };
};

/**
 * Whether a candidate may replace the Active gate release at all.
 *
 * A protocol change is not something an in-place update can absorb, and an
 * irreversible migration cannot be offered as an atomic switch, because a
 * later failure could no longer return the clone to the release it was on.
 */
const validateUpdateCompatibility = ({ from, to, migrations }) => {
  const errors = [];

  if (to === null || to.version === null) {
    errors.push({ field: 'candidate.version', message: 'An update must name the candidate release version.' });
  }

  if (from !== null && to !== null && from.id !== to.id) {
    errors.push({ field: 'candidate.id', message: `A candidate release must be the same gate: ${from.id}.` });
  }

  if (from !== null && to !== null && from.protocolVersion !== to.protocolVersion) {
    errors.push({
      field: 'candidate.protocolVersion',
      message: `A candidate release must speak the activated protocol ${from.protocolVersion}.`,
    });
  }

  for (const migration of migrations) {
    if (migration.reversible !== true) {
      errors.push({
        field: `migration.${migration.id}`,
        message: 'An update may only run migrations it can undo if a later step fails.',
      });
    }
  }

  return errors;
};

/**
 * Run one `gate update`.
 *
 * The update previews, validates compatibility, runs the previewed migrations,
 * reruns the activation self-tests, and only then switches the Active gate
 * release by one atomic receipt write. A failure at any step unwinds whatever
 * this update applied and leaves the previous release exactly as it was — the
 * clone is never left between two releases (FR-LIFE-008, NFR-REL-002,
 * SG-LIFE-001, AC-LIFE-004).
 */
export const updateGate = async ({
  evidenceStore = null,
  candidate = null,
  migrations = [],
  confirmation = null,
  runtime = null,
} = {}, dependencies = {}) => {
  const {
    selfTestEvaluation = async () => ({ ok: true }),
    selfTestAdapter = async () => ({ ok: true }),
    applyMigration = async () => ({ ok: true }),
    revertMigration = async () => ({ ok: true }),
    clock = () => new Date(),
  } = dependencies;

  const order = [];
  const applied = [];
  const receipt = await evidenceStore?.activationReceipt().read() ?? null;
  const previous = activeRelease(receipt);

  const record = async (result) => {
    if (evidenceStore) {
      await evidenceStore.appendLifecycleEvent({
        type: 'update',
        before: receipt?.receiptId ?? null,
        after: result.updated ? result.receipt?.receiptId ?? null : null,
        outcome: result.updated ? 'succeeded' : 'failed',
        reason: result.updated
          ? `The Active gate release advanced from ${previous?.version ?? 'none'} to ${result.release?.to?.version ?? 'none'} by one atomic receipt write.`
          : `The update failed at ${result.step} (${result.reasonCode}); the previous Active gate release ${previous?.version ?? 'none'} is preserved unchanged.`,
      }).catch(() => null);
    }

    return result;
  };

  /** Undo exactly what this update applied, last applied first. */
  const unwind = async () => {
    const actions = [];
    const failures = [];

    for (const migration of [...applied].reverse()) {
      actions.push(migration.id);

      try {
        await revertMigration(migration, { receipt });
      } catch (error) {
        failures.push({ migration: migration.id, message: error.message });
      }
    }

    return { performed: applied.length > 0, actions, failures };
  };

  const fail = async (step, reasonCode, errors = []) => record({
    updated: false,
    // The clone is on the release it was on before this update was attempted.
    state: 'preserved',
    step,
    reasonCode,
    errors,
    order,
    release: { from: previous, to: releaseOf(candidate) },
    receipt,
    rollback: await unwind(),
  });

  // 1. Preview: exactly what would change, restated before anything does.
  order.push('preview');

  if (receipt === null) {
    return fail('preview', 'activation-absent', [{
      message: 'Only an activated clone has an Active gate release to update.',
    }]);
  }

  const preview = previewUpdate({ receipt, candidate, migrations });

  if (confirmation !== null && confirmation !== preview.previewId) {
    return fail('preview', 'update-preview-mismatch', [{
      expected: preview.previewId,
      actual: confirmation,
    }]);
  }

  // 2. Compatibility: a candidate that cannot replace this release never runs.
  order.push('compatibility');

  const incompatible = validateUpdateCompatibility({
    from: preview.from,
    to: preview.to,
    migrations: preview.migrations,
  });

  if (incompatible.length > 0) {
    return fail('compatibility', 'update-incompatible', incompatible);
  }

  // 3. Migrations: exactly the previewed set, each one undoable.
  order.push('migration');

  for (const migration of migrations) {
    let outcome = null;

    try {
      outcome = await applyMigration(migration, { receipt, candidate });
    } catch (error) {
      return fail('migration', 'update-migration-failed', [{
        migration: migration?.id ?? null,
        message: error.message,
      }]);
    }

    if (outcome?.ok !== true) {
      return fail('migration', 'update-migration-failed', [{
        migration: migration?.id ?? null,
        detail: outcome?.detail ?? null,
      }]);
    }

    applied.push({ id: migration?.id ?? null, ...migration });
  }

  // 4. Self-test: the same proof activation required, rerun on the candidate.
  order.push('self-test');

  const evaluation = await selfTestEvaluation({
    repository: receipt.repository,
    release: preview.to,
  });
  const selfTests = [{
    name: 'evaluation-process',
    ok: evaluation?.ok === true,
    detail: evaluation?.detail ?? null,
  }];

  if (!selfTests[0].ok) {
    return fail('self-test', 'update-self-test-failed', [selfTests[0]]);
  }

  for (const adapter of receipt.adapters ?? []) {
    const result = await selfTestAdapter(adapter, {
      repository: receipt.repository,
      release: preview.to,
    });
    const selfTest = { name: `adapter:${adapter.id}`, ok: result?.ok === true, detail: result?.detail ?? null };

    selfTests.push(selfTest);

    if (!selfTest.ok) {
      return fail('self-test', 'update-adapter-self-test-failed', [selfTest]);
    }
  }

  // 5. Release switch, last, and by one atomic write.
  order.push('release-switch');

  const body = {
    ...receipt,
    receiptId: undefined,
    activatedAt: receipt.activatedAt,
    updatedAt: clock().toISOString(),
    runtime: {
      ...receipt.runtime,
      gate: preview.to,
      runnerVersion: runtime?.runnerVersion ?? receipt.runtime?.runnerVersion ?? null,
    },
    supersedes: {
      receiptId: receipt.receiptId,
      release: previous,
      previewId: preview.previewId,
      migrations: preview.migrations.map((migration) => migration.id),
    },
    // The whole lineage, not just the previous id: the registration on disk
    // still names whichever receipt authorized it, however many updates ago.
    receiptLineage: authorizedReceiptIds(receipt),
    selfTests,
  };

  delete body.receiptId;

  const updated = { ...body, receiptId: contentIdentity(body) };

  try {
    await evidenceStore.activationReceipt().write(updated);
  } catch (error) {
    return fail('release-switch', 'update-receipt-write-failed', [{ message: error.message }]);
  }

  return record({
    updated: true,
    state: 'updated',
    step: 'release-switch',
    reasonCode: null,
    errors: [],
    order,
    release: { from: previous, to: preview.to },
    receipt: updated,
    rollback: { performed: false, actions: [], failures: [] },
  });
};
