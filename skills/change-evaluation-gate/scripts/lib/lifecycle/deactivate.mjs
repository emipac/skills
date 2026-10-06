import { AUTHORITATIVE_HOOK, withdrawHookRegistration } from '../activation.mjs';
import { withdrawAdapterRegistration } from '../adapter-registration.mjs';
import { authorizedReceiptIds } from './receipts.mjs';

/**
 * Run one `gate deactivate`.
 *
 * Deactivation removes exactly two things: the gate-owned registrations this
 * clone's receipt pins, and the receipt itself. Configuration, project-installed
 * assets, global assets, and every byte of historical Evidence are none of its
 * business and are left alone.
 *
 * It is also all-or-nothing. Every registration is proved removable *before*
 * the first one is removed, so a clone is never left with its receipt gone and
 * an authoritative hook still armed, or with one surface withdrawn and another
 * still registered. A registration that drifted is reported and left exactly
 * where it is: deactivation never repairs and never forces (FR-LIFE-010,
 * SG-LIFE-001, NFR-REL-002, AC-LIFE-005).
 */
export const deactivateGate = async ({
  evidenceStore = null,
  repositoryRoot = null,
} = {}, dependencies = {}) => {
  const {
    withdrawRegistration = withdrawHookRegistration,
    withdrawAdapterSurface = withdrawAdapterRegistration,
  } = dependencies;

  const receipt = await evidenceStore?.activationReceipt().read() ?? null;

  const record = async (result) => {
    if (evidenceStore) {
      await evidenceStore.appendLifecycleEvent({
        type: 'removal',
        before: receipt?.receiptId ?? null,
        after: null,
        outcome: result.deactivated ? 'succeeded' : 'refused',
        reason: result.deactivated
          ? `Deactivation withdrew ${result.removed.length} gate-owned item(s); configuration, project assets, global assets, and all historical Evidence were preserved.`
          : `Deactivation refused (${result.reasonCode}); nothing was removed and nothing was repaired.`,
      }).catch(() => null);
    }

    return result;
  };

  const preserved = [
    'shared-configuration',
    'project-installed-assets',
    'global-assets',
    'historical-evidence',
  ];

  if (receipt === null) {
    return {
      deactivated: false,
      state: 'configured',
      reasonCode: 'activation-absent',
      errors: [{ message: 'There is no Activation receipt, so there is nothing gate-owned to withdraw.' }],
      removed: [],
      preserved,
    };
  }

  const pinned = receipt.hookChain ?? {};
  const targets = (receipt.hooks ?? []).map((hook) => ({
    hook: hook.hook ?? AUTHORITATIVE_HOOK,
    path: hook.path,
    ownership: hook.ownership,
    blockIdentity: pinned.blockIdentity ?? null,
    receiptId: receipt.receiptId,
    // A registration written before an update still names the receipt that
    // authorized it, and a receipt written before block identities were pinned
    // has this marker as its only ownership proof.
    acceptedReceiptIds: authorizedReceiptIds(receipt),
    priorIdentity: pinned.priorIdentity ?? null,
  }));

  // The desktop registrations this receipt pins, each withdrawn through its own
  // adapter's declaration rather than through anything this module knows about a
  // client (FR-ADAPT-008, SG-OWNER-001).
  const root = repositoryRoot ?? receipt.repository?.root ?? null;
  const adapterTargets = (receipt.adapters ?? [])
    .filter((adapter) => adapter.registration?.kind === 'client-configuration-file')
    .map((adapter) => ({
      adapterId: adapter.id,
      repositoryRoot: root,
      registration: adapter.registration,
    }));

  /**
   * Reasons a registration is already in the desired state.
   *
   * None of them is a safety condition, so none may refuse the operation the way
   * a drifted entry does: an entry that is gone, a surface whose file the client
   * itself removed, and a receipt that pinned nothing all leave nothing to take.
   */
  const satisfied = new Set([
    'registration-absent',
    'surface-unverified',
    'unknown-registration',
    'no-registration-surface',
  ]);

  // Prove first, remove second. Nothing below this point may discover a reason
  // to stop half way through.
  const blocked = [];

  for (const target of targets) {
    const check = await withdrawRegistration({ ...target, dryRun: true });

    if (!check.removable && check.reason !== 'already-absent') {
      blocked.push({ path: target.path, hook: target.hook, reason: check.reason });
    }
  }

  for (const target of adapterTargets) {
    const check = await withdrawAdapterSurface({ ...target, dryRun: true });

    if (!check.removable && !satisfied.has(check.reason)) {
      blocked.push({
        path: target.registration.path,
        adapter: target.adapterId,
        reason: check.reason,
      });
    }
  }

  if (blocked.length > 0) {
    return record({
      deactivated: false,
      state: 'activated',
      reasonCode: 'registration-drifted',
      errors: blocked,
      removed: [],
      preserved,
    });
  }

  const removed = [];

  for (const target of targets) {
    const result = await withdrawRegistration(target);

    if (result.removed) {
      removed.push({ kind: 'hook-registration', hook: target.hook, path: target.path });
    }
  }

  for (const target of adapterTargets) {
    const result = await withdrawAdapterSurface(target);

    if (result.removed) {
      removed.push({
        kind: 'adapter-registration',
        adapter: target.adapterId,
        path: target.registration.path,
      });
    }
  }

  await evidenceStore.activationReceipt().remove();
  removed.push({ kind: 'activation-receipt', path: evidenceStore.paths.activationReceipt });

  return record({
    deactivated: true,
    state: 'configured',
    reasonCode: null,
    errors: [],
    removed,
    preserved,
  });
};
