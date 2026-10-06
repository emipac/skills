import { restoreHookRegistration } from '../activation.mjs';
import { contentIdentity } from '../evidence-store.mjs';
import { statusGate } from './status.mjs';

/**
 * Preview one `gate repair`.
 *
 * The preview reconciles through `gate status` — so it, too, writes nothing —
 * and states exactly which gate-owned registrations it would restore and what
 * it would restore them to. The confirmation token identifies that exact set
 * against that exact receipt (FR-LIFE-019, AC-LIFE-010).
 *
 * A `controlSurface` observation, when the caller has one, is reconciled
 * exactly as status reconciles it, so drift repair cannot restore is reported
 * among `unrepairable` rather than going unmentioned. It adds nothing to what
 * is repaired (`TB-065`).
 */
export const previewRepair = async ({
  evidenceStore = null,
  repositoryRoot = null,
  runtime = null,
  adapters = null,
  controlSurface = null,
} = {}, dependencies = {}) => {
  const status = await statusGate({ evidenceStore, adapters, controlSurface }, dependencies);
  const receipt = status.receipt;
  const pinned = receipt?.hookChain ?? {};
  const repairable = new Set(['hook-absent', 'hook-block-tampered', 'hook-receipt-mismatch']);
  const hooks = receipt?.hooks ?? [];
  const actions = status.findings
    .filter((finding) => repairable.has(finding.code))
    .map((finding) => {
      // Repair the registration that actually drifted. Each finding names its
      // own hook, so a receipt listing several never has one of them repaired
      // in place of another.
      const hook = hooks.find((entry) => entry.path === finding.path) ?? null;

      return {
        kind: 'hook-registration',
        code: finding.code,
        hook: finding.hook ?? hook?.hook ?? null,
        path: finding.path ?? hook?.path ?? pinned.path ?? hooks[0]?.path ?? null,
        ownership: finding.ownership ?? hook?.ownership ?? hooks[0]?.ownership ?? null,
        blockIdentity: pinned.blockIdentity ?? null,
        priorIdentity: pinned.priorIdentity ?? null,
        receiptId: receipt?.receiptId ?? null,
      };
    });
  const body = {
    status: status.status,
    receiptId: receipt?.receiptId ?? null,
    actions,
  };

  return {
    ...body,
    repositoryRoot,
    runtime,
    // Adapter loss is a reinstall, not a repair: nothing here pretends to
    // reinstate a client the machine no longer has (RISK-004). The one
    // control surface a repair does restore is the managed hook block's own
    // identity, which is the block these actions put back; reported beside
    // them it would call the repair's own work unrepairable (`TB-065`).
    unrepairable: status.findings.filter((finding) => !repairable.has(finding.code)
      && !(actions.length > 0 && finding.code === 'control-surface-drift' && finding.surface === 'managed-hooks')),
    confirmationToken: contentIdentity(body),
  };
};

/**
 * Run one confirmed `gate repair`.
 *
 * This is the only path in the module that writes a registration back, and it
 * runs only when the operator reproduces the token of the preview they were
 * shown. Everything else — status, an ordinary update, a distribution bump —
 * leaves drift exactly where it found it (FR-LIFE-019, SG-LIFE-001,
 * AC-LIFE-010).
 */
export const confirmRepair = async ({
  evidenceStore = null,
  repositoryRoot = null,
  runtime = null,
  preview = null,
  confirmation = null,
} = {}, dependencies = {}) => {
  const { restoreRegistration = restoreHookRegistration } = dependencies;

  const record = async (result) => {
    if (evidenceStore) {
      await evidenceStore.appendLifecycleEvent({
        type: 'repair',
        before: preview?.confirmationToken ?? null,
        after: preview?.receiptId ?? null,
        outcome: result.repaired ? 'succeeded' : 'refused',
        reason: result.repaired
          ? `Repair restored ${result.actions.length} gate-owned registration(s) to exactly what the Activation receipt authorizes.`
          : `Repair refused (${result.reasonCode}); the observed drift was left exactly as it was found.`,
      }).catch(() => null);
    }

    return result;
  };

  const refuse = (reasonCode, errors = []) => record({
    repaired: false,
    reasonCode,
    errors,
    actions: [],
  });

  const expected = preview?.confirmationToken ?? null;

  if (expected === null || confirmation !== expected) {
    return refuse('preview-mismatch', [{ expected, actual: confirmation }]);
  }

  if ((preview.actions ?? []).length === 0) {
    return refuse('nothing-previewed');
  }

  const program = runtime?.hookProgram ?? preview.runtime?.hookProgram ?? null;
  const root = repositoryRoot ?? preview.repositoryRoot ?? null;
  const blocked = [];

  // Prove first, write second: a repair never leaves one registration restored
  // and another still drifted.
  for (const action of preview.actions) {
    const check = await restoreRegistration({ ...action, program, repositoryRoot: root, dryRun: true });

    if (!check.restorable) {
      blocked.push({ path: action.path, reason: check.reason });
    }
  }

  if (blocked.length > 0) {
    return refuse('repair-refused', blocked);
  }

  const actions = [];

  for (const action of preview.actions) {
    const result = await restoreRegistration({ ...action, program, repositoryRoot: root });

    if (result.restored) {
      actions.push({ kind: action.kind, path: action.path, code: action.code });
    }
  }

  return record({ repaired: true, reasonCode: null, errors: [], actions });
};
