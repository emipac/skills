/**
 * The Gate lifecycle command surface.
 *
 * An activated clone can expose a candidate release, update atomically, be
 * observed without being changed, be recovered explicitly, and be deactivated,
 * uninstalled, or cleaned up without losing shared state or history.
 *
 * Three rules shape every command here:
 *
 * 1. **Ordinary distribution is not activation.** Installing a newer skill or
 *    plugin only makes a *candidate* release visible. Only an explicit,
 *    successful `gate update` advances the Active gate release (FR-LIFE-014).
 * 2. **Observation never mutates.** `gate status` reconciles desired against
 *    actual state and reports `healthy`, `degraded`, or `broken`. It repairs
 *    nothing, writes nothing, and records nothing — not even a drift event,
 *    because a write is exactly what it must not do (FR-LIFE-009, FR-LIFE-019).
 * 3. **Removal is conservative and never partial.** Every removal path touches
 *    only unchanged Gate-owned state. Anything drifted, shared, global, or
 *    historical is left alone, and a step that cannot be completed safely
 *    refuses the whole operation rather than half-doing it (SG-LIFE-001,
 *    NFR-REL-002).
 */

import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  AUTHORITATIVE_HOOK,
  readHookRegistration,
  restoreHookRegistration,
  withdrawHookRegistration,
} from './activation.mjs';
import {
  reconcileAdapterRegistration,
  withdrawAdapterRegistration,
} from './adapter-registration.mjs';
import { openCoordinationLock } from './coordination.mjs';
import { contentIdentity } from './evidence-store.mjs';
import { reconcileControlSurface } from './security-control.mjs';

/**
 * The ordered steps of one `gate update`, with the release switch always last.
 *
 * Nothing before `release-switch` touches the published receipt, so a failure
 * at any earlier step leaves the previous Active gate release in place by
 * construction rather than by compensation (FR-LIFE-008).
 */
export const UPDATE_STEPS = Object.freeze([
  'preview',
  'compatibility',
  'migration',
  'self-test',
  'release-switch',
]);

/** The health values `gate status` may report (FR-LIFE-009). */
export const GATE_HEALTH = Object.freeze(['healthy', 'degraded', 'broken']);

/**
 * What each reconciled registration state is reported as.
 *
 * `unverified` is deliberately its own code rather than a kind of absence: a
 * surface the Gate could not confirm is not a surface it knows is gone
 * (FR-ADAPT-008).
 */
const REGISTRATION_FINDING_CODES = Object.freeze({
  drifted: 'adapter-registration-drifted',
  absent: 'adapter-registration-absent',
  ambiguous: 'adapter-registration-ambiguous',
  unverified: 'adapter-registration-unverified',
});

const releaseOf = (gate) => (gate === null || gate === undefined ? null : {
  id: gate.id ?? null,
  version: gate.version ?? null,
  protocolVersion: gate.protocolVersion ?? null,
});

/** The Active gate release one receipt pins. */
export const activeRelease = (receipt) => releaseOf(receipt?.runtime?.gate ?? null);

/**
 * Every receipt id this activation has been published under, newest first.
 *
 * An update rewrites the receipt and mints a new id, but it does not rewrite the
 * registration on disk — the block goes on naming the receipt that authorized
 * it. All of them belong to this activation, so a registration naming any of
 * them is still ours, and only a registration naming something else is a
 * genuine mismatch (FR-LIFE-008, FR-LIFE-009).
 */
export const authorizedReceiptIds = (receipt) => [
  receipt?.receiptId ?? null,
  ...(receipt?.receiptLineage ?? []),
].filter((id) => typeof id === 'string' && id.length > 0);

/**
 * What an ordinary distribution makes available.
 *
 * A newer installed skill, plugin, or package is a *candidate* and nothing
 * more: this function reads a receipt and a distribution and reports the
 * difference. It writes nothing and advances nothing (FR-LIFE-014,
 * AC-LIFE-007).
 */
export const inspectRelease = ({ receipt = null, distribution = null } = {}) => {
  const active = activeRelease(receipt);
  const candidate = releaseOf(distribution);
  const available = candidate !== null
    && (active === null || candidate.version !== active.version);

  return {
    active,
    candidate,
    candidateAvailable: available,
    // Naming the command is the whole point: nothing else advances the release.
    advancesActiveRelease: false,
    action: available ? 'gate update' : null,
  };
};

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

/**
 * Reconcile desired against actual state, and report it.
 *
 * This function is deliberately pure with respect to the machine: it opens
 * nothing for writing, appends no Lifecycle event, and repairs nothing it
 * finds. A drifted clone stays drifted until an operator runs `gate repair` or
 * a new Activation transaction, which is exactly what FR-LIFE-019 requires and
 * what makes the reported health trustworthy (FR-LIFE-009, SG-LIFE-001).
 *
 * Health is graded by authority, not by count: losing a non-authoritative
 * adapter costs the clone a surface and is `degraded`; losing authoritative Git
 * or the pinned runtime means the gate is no longer enforcing anything it
 * claims to enforce, and that is `broken` (RISK-004).
 */
export const statusGate = async ({
  evidenceStore = null,
  adapters = null,
  controlSurface = null,
  repositoryRoot = null,
} = {}, dependencies = {}) => {
  const { probeAdapter = async () => ({ ok: true }) } = dependencies;

  const receipt = await evidenceStore?.activationReceipt().read() ?? null;
  const findings = [];

  if (receipt === null) {
    return {
      state: 'configured',
      status: 'healthy',
      receipt: null,
      release: null,
      findings: [{
        area: 'activation',
        severity: 'informational',
        code: 'activation-absent',
        detail: 'The clone is configured but not activated; there is nothing to enforce and nothing to reconcile.',
      }],
      repaired: false,
      mutations: [],
    };
  }

  // The authoritative registration: is the hook still there, and is it still
  // the exact block this activation wrote?
  const authorized = authorizedReceiptIds(receipt);

  for (const hook of receipt.hooks ?? []) {
    const registration = await readHookRegistration(hook.path, hook.ownership);

    if (registration.present !== true) {
      findings.push({
        area: 'git',
        severity: 'authoritative',
        code: 'hook-absent',
        // Which registration drifted, so a repair can target this one rather
        // than guessing at the first hook the receipt happens to list.
        hook: hook.hook ?? AUTHORITATIVE_HOOK,
        path: hook.path,
        ownership: hook.ownership,
        detail: `The authoritative ${hook.hook ?? AUTHORITATIVE_HOOK} registration at ${hook.path} is gone.`,
      });

      continue;
    }

    const pinned = receipt.hookChain ?? {};

    if (pinned.blockIdentity && registration.blockIdentity !== pinned.blockIdentity) {
      findings.push({
        area: 'git',
        severity: 'authoritative',
        code: 'hook-block-tampered',
        hook: hook.hook ?? AUTHORITATIVE_HOOK,
        path: hook.path,
        ownership: hook.ownership,
        detail: `The gate-owned block at ${hook.path} is no longer the block this activation wrote.`,
      });
    } else if (pinned.blockIdentity && !authorized.includes(registration.receiptId)) {
      findings.push({
        area: 'git',
        severity: 'authoritative',
        code: 'hook-receipt-mismatch',
        hook: hook.hook ?? AUTHORITATIVE_HOOK,
        path: hook.path,
        ownership: hook.ownership,
        detail: `The gate-owned block at ${hook.path} names activation receipt ${registration.receiptId ?? 'none'}, which this clone never issued.`,
      });
    }
  }

  // Adapter loss is graded by the authority the receipt pinned, never by the
  // adapter's own claim about itself.
  const observed = adapters === null
    ? null
    : new Map(adapters.map((adapter) => [adapter.id, adapter]));

  for (const adapter of receipt.adapters ?? []) {
    const authoritative = adapter.authoritative === true;
    const present = observed === null ? true : observed.has(adapter.id);
    const probe = present ? await probeAdapter(adapter) : { ok: false, detail: 'not installed' };

    if (probe?.ok === true && present) {
      continue;
    }

    findings.push({
      area: 'adapter',
      severity: authoritative ? 'authoritative' : 'supporting',
      code: authoritative ? 'authoritative-adapter-lost' : 'adapter-lost',
      adapter: adapter.id,
      detail: probe?.detail ?? `The ${adapter.id} adapter is no longer available.`,
    });
  }

  // A desktop registration is reconciled through the adapter's own declared
  // surface, never through a client-name branch, and a surface that cannot be
  // confirmed on disk is reported rather than assumed healthy. Reconciliation
  // reads; it never creates, repairs, or removes (FR-ADAPT-008, SG-LIFE-001).
  const root = repositoryRoot ?? receipt.repository?.root ?? null;

  for (const adapter of receipt.adapters ?? []) {
    const observation = await reconcileAdapterRegistration({
      adapterId: adapter.id,
      repositoryRoot: root,
      registration: adapter.registration ?? null,
    });

    if (observation === null
      || observation.state === 'registered'
      || observation.state === 'unpinned') {
      continue;
    }

    findings.push({
      area: 'adapter',
      severity: adapter.authoritative === true ? 'authoritative' : 'supporting',
      code: REGISTRATION_FINDING_CODES[observation.state],
      adapter: adapter.id,
      path: observation.path,
      detail: observation.detail,
    });
  }

  // Independent drift of a pinned Gate control surface: the clone can no longer
  // say what it is enforcing, so it is `broken` rather than merely degraded
  // (AC-SEC-001, NFR-SEC-004). A caller that observed nothing reconciles
  // nothing; this reports and repairs exactly as much as everything above it.
  if (controlSurface !== null) {
    findings.push(...reconcileControlSurface({ receipt, observed: controlSurface }).findings);
  }

  const authoritativeLoss = findings.some((finding) => finding.severity === 'authoritative');
  const supportingLoss = findings.some((finding) => finding.severity === 'supporting');

  return {
    state: 'activated',
    status: authoritativeLoss ? 'broken' : (supportingLoss ? 'degraded' : 'healthy'),
    receipt,
    release: activeRelease(receipt),
    findings,
    // Observation is not a governed action. Nothing above wrote anything.
    repaired: false,
    mutations: [],
  };
};

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

/** The name of the shared framework configuration file the Gate never owns. */
export const SHARED_CONFIGURATION_FILE = '.agent-framework.yaml';

const isInside = (parent, candidate) => candidate === parent
  || candidate.startsWith(`${parent}${path.sep}`);

/**
 * Judge one listed asset without touching it.
 *
 * Every answer other than `null` is a reason the Gate does not own that file,
 * and the reasons are exactly the four things SG-LIFE-001 forbids removing:
 * something outside this project, the shared configuration, historical
 * Evidence, or a file the maintainer has since made their own.
 */
const refuseAsset = async ({ asset, repositoryRoot, configurationPath, storeRoot }) => {
  const resolved = path.resolve(asset?.path ?? '');

  if (!isInside(path.resolve(repositoryRoot), resolved)) {
    // Global and machine-wide assets are shared with every other clone. v1 has
    // no global uninstall, and this is where that promise is kept.
    return { path: resolved, reason: 'asset-outside-project' };
  }

  if (resolved === path.resolve(configurationPath)) {
    return { path: resolved, reason: 'shared-configuration' };
  }

  if (isInside(path.resolve(storeRoot), resolved)) {
    return { path: resolved, reason: 'historical-evidence' };
  }

  const contents = await readFile(resolved, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  });

  if (contents === null) {
    // Already in the desired state. This is not a safety condition, so it must
    // not refuse the operation the way a modified asset does — otherwise an
    // interrupted uninstall could never be completed on a retry.
    return { path: resolved, reason: 'asset-absent', satisfied: true };
  }

  if (asset?.identity == null || contentIdentity(contents) !== asset.identity) {
    // The installed asset is not the asset that was installed.
    return { path: resolved, reason: 'asset-modified' };
  }

  return null;
};

/**
 * Run one `gate uninstall`.
 *
 * Uninstall is the narrowest removal the Gate has. It requires a prior
 * deactivation — an activated clone is never uninstalled out from under its own
 * authoritative hook — and then removes only project-installed assets that are
 * still byte-for-byte what was installed.
 *
 * Global assets, the shared configuration file, and historical Evidence are
 * refused by construction rather than by convention, and one refusal refuses
 * the whole uninstall: a maintainer who asked to remove five things and got
 * three has been given partial success, which is exactly what SG-LIFE-001
 * forbids (FR-LIFE-011, AC-LIFE-005).
 */
export const uninstallGate = async ({
  evidenceStore = null,
  repositoryRoot = null,
  configurationPath = null,
  assets = [],
} = {}) => {
  const receipt = await evidenceStore?.activationReceipt().read() ?? null;
  const configuration = configurationPath
    ?? path.join(repositoryRoot ?? '.', SHARED_CONFIGURATION_FILE);
  const preserved = ['shared-configuration', 'global-assets', 'historical-evidence'];

  const record = async (result) => {
    if (evidenceStore) {
      await evidenceStore.appendLifecycleEvent({
        type: 'removal',
        before: null,
        after: null,
        outcome: result.uninstalled ? 'succeeded' : 'refused',
        reason: result.uninstalled
          ? `Uninstall removed ${result.removed.length} unchanged project-installed asset(s); the shared configuration, global assets, and all historical Evidence were preserved.`
          : `Uninstall refused (${result.reasonCode}); nothing was removed.`,
      }).catch(() => null);
    }

    return result;
  };

  if (receipt !== null) {
    return record({
      uninstalled: false,
      reasonCode: 'deactivation-required',
      errors: [{
        message: 'An activated clone must be deactivated before its project assets may be removed.',
      }],
      removed: [],
      refused: [],
      preserved,
    });
  }

  const refused = [];
  const alreadyAbsent = new Set();

  for (const asset of assets) {
    const refusal = await refuseAsset({
      asset,
      repositoryRoot,
      configurationPath: configuration,
      storeRoot: evidenceStore?.root ?? path.join(repositoryRoot ?? '.', '.git'),
    });

    if (refusal === null) {
      continue;
    }

    if (refusal.satisfied === true) {
      // Nothing to remove and nothing to protect: skip it and keep going.
      alreadyAbsent.add(refusal.path);

      continue;
    }

    refused.push(refusal);
  }

  if (refused.length > 0) {
    return record({
      uninstalled: false,
      reasonCode: 'asset-refused',
      errors: refused,
      removed: [],
      refused,
      preserved,
    });
  }

  const removed = [];

  for (const asset of assets) {
    const resolved = path.resolve(asset.path);

    if (alreadyAbsent.has(resolved)) {
      continue;
    }

    await rm(resolved, { force: true });
    removed.push({ kind: 'project-asset', path: resolved });
  }

  return record({
    uninstalled: true,
    reasonCode: null,
    errors: [],
    removed,
    refused: [],
    preserved,
  });
};

/** The top-level `.agent-framework.yaml` keys the Gate owns and may clean up. */
export const GATE_CONFIGURATION_KEYS = Object.freeze(['evaluation_gate']);

/** A top-level mapping key: the only granularity cleanup ever operates at. */
const TOP_LEVEL_KEY = /^([A-Za-z_][A-Za-z0-9_-]*):/;

/**
 * Locate the Gate's own top-level blocks in a shared configuration file.
 *
 * Cleanup is deliberately line-oriented rather than a parse-and-reserialize.
 * Reserializing somebody's configuration would rewrite comments, quoting,
 * ordering, and anchors that have nothing to do with the Gate — a silent change
 * to shared state. Removing exactly the located line ranges leaves every other
 * byte of the file precisely as its owner wrote it.
 */
const locateGateKeys = (contents, keys) => {
  const lines = contents.split('\n');
  const blocks = [];
  let current = null;

  /**
   * Where the Gate's own block really ends.
   *
   * Blank lines and comments immediately above the next top-level key introduce
   * that key, not this one. Ending the block at the last line that is actually
   * part of the Gate's value leaves somebody else's comment exactly where they
   * wrote it.
   */
  const lastOwnedLine = (startLine, beforeLine) => {
    let end = startLine;

    for (let index = startLine + 1; index < beforeLine; index += 1) {
      const line = lines[index];

      if (line.trim() === '' || line.trimStart().startsWith('#')) {
        continue;
      }

      end = index;
    }

    return end;
  };

  lines.forEach((line, index) => {
    const match = TOP_LEVEL_KEY.exec(line);

    if (match === null) {
      return;
    }

    if (current !== null) {
      current.endLine = lastOwnedLine(current.startLine, index);
      blocks.push(current);
      current = null;
    }

    if (keys.includes(match[1])) {
      current = { key: match[1], startLine: index, endLine: lines.length - 1 };
    }
  });

  if (current !== null) {
    current.endLine = lastOwnedLine(current.startLine, lines.length);
    blocks.push(current);
  }

  return blocks.map((block) => ({
    ...block,
    text: `${lines.slice(block.startLine, block.endLine + 1).join('\n')}\n`,
  }));
};

/**
 * Preview one configuration cleanup.
 *
 * The preview writes nothing. It names every Gate key it would remove, quotes
 * the exact text it would remove, and carries the confirmation token a later
 * cleanup must reproduce (FR-LIFE-018, AC-LIFE-010).
 */
export const previewConfigurationCleanup = async ({
  configurationPath = null,
  keys = GATE_CONFIGURATION_KEYS,
} = {}) => {
  const contents = await readFile(configurationPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  });
  const located = contents === null ? [] : locateGateKeys(contents, [...keys]);
  const body = {
    path: configurationPath,
    keys: located.map(({ key, startLine, endLine }) => ({ key, startLine, endLine })),
    removedText: located.map((block) => block.text).join(''),
  };

  return {
    ...body,
    blocks: located,
    fileIdentity: contents === null ? null : contentIdentity(contents),
    // The token identifies the exact removal, against the exact file that was
    // read. A file edited since the preview cannot reproduce it.
    confirmationToken: contentIdentity({
      ...body,
      fileIdentity: contents === null ? null : contentIdentity(contents),
    }),
  };
};

/**
 * Remove exactly the previewed Gate keys, and only after confirmation.
 *
 * The shared configuration file is never deleted, never reordered, and never
 * reserialized: the previewed line ranges are dropped and every other byte is
 * written back unchanged. A confirmation that does not reproduce the preview —
 * including because the file changed underneath it — removes nothing
 * (FR-LIFE-018, SG-LIFE-001, AC-LIFE-010).
 */
export const confirmConfigurationCleanup = async ({
  evidenceStore = null,
  configurationPath = null,
  preview = null,
  confirmation = null,
} = {}) => {
  const record = async (result) => {
    if (evidenceStore) {
      await evidenceStore.appendLifecycleEvent({
        type: 'removal',
        before: preview?.confirmationToken ?? null,
        after: null,
        outcome: result.cleaned ? 'succeeded' : 'refused',
        reason: result.cleaned
          ? `Configuration cleanup removed the previewed Gate key(s) ${result.removedKeys.join(', ')}; the shared configuration file itself was preserved.`
          : `Configuration cleanup refused (${result.reasonCode}); the shared configuration file was not changed.`,
      }).catch(() => null);
    }

    return result;
  };

  const refuse = (reasonCode, errors = []) => record({
    cleaned: false,
    reasonCode,
    errors,
    removedKeys: [],
    // Whatever happens, the file stays.
    fileDeleted: false,
  });

  const expected = preview?.confirmationToken ?? null;

  if (expected === null || confirmation !== expected) {
    return refuse('preview-mismatch', [{ expected, actual: confirmation }]);
  }

  if ((preview.blocks ?? []).length === 0) {
    return refuse('nothing-previewed', [{
      message: 'The preview identified no Gate keys, so there is nothing to remove.',
    }]);
  }

  const contents = await readFile(configurationPath, 'utf8').catch(() => null);

  if (contents === null) {
    return refuse('configuration-absent');
  }

  if (preview.fileIdentity !== null && contentIdentity(contents) !== preview.fileIdentity) {
    return refuse('configuration-changed', [{
      expected: preview.fileIdentity,
      actual: contentIdentity(contents),
    }]);
  }

  const dropped = new Set();

  for (const block of preview.blocks) {
    for (let line = block.startLine; line <= block.endLine; line += 1) {
      dropped.add(line);
    }
  }

  const kept = contents
    .split('\n')
    .filter((_, index) => !dropped.has(index))
    .join('\n');

  await writeFile(configurationPath, kept, 'utf8');

  return record({
    cleaned: true,
    reasonCode: null,
    errors: [],
    removedKeys: preview.blocks.map((block) => block.key),
    fileDeleted: false,
  });
};

/**
 * Preview one `gate repair`.
 *
 * The preview reconciles through `gate status` — so it, too, writes nothing —
 * and states exactly which gate-owned registrations it would restore and what
 * it would restore them to. The confirmation token identifies that exact set
 * against that exact receipt (FR-LIFE-019, AC-LIFE-010).
 */
export const previewRepair = async ({
  evidenceStore = null,
  repositoryRoot = null,
  runtime = null,
  adapters = null,
} = {}, dependencies = {}) => {
  const status = await statusGate({ evidenceStore, adapters }, dependencies);
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
    // reinstate a client the machine no longer has (RISK-004).
    unrepairable: status.findings.filter((finding) => !repairable.has(finding.code)),
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

/**
 * `gate prune --preview` — the operator surface over TB-008's pruning seam.
 *
 * TB-008 built the store's preview-and-confirm removal path but deliberately
 * left the operator-facing command to the lifecycle slice, because pruning is a
 * lifecycle operation and shares this module's rules: preview first, confirm
 * against the exact preview, and never delete anything implicitly.
 *
 * This wrapper adds no removal logic of its own — it delegates to the store —
 * and states plainly that a preview removed nothing (FR-EVID-004, SG-EVID-001).
 */
export const previewEvidencePrune = async ({ evidenceStore = null, selector = {} } = {}) => {
  const preview = await evidenceStore.previewPrune(selector);

  return { ...preview, removed: false, action: preview.blobs.length > 0 ? 'gate prune --confirm' : null };
};

/**
 * `gate prune --confirm` — remove exactly what a preview identified.
 *
 * Blobs are the only thing a prune ever removes. Envelopes, decisions,
 * Lifecycle events, pruning records, and tombstones are append-only history and
 * survive every prune, so a pruned clone can still prove what it once held and
 * that it was removed on purpose (FR-EVID-004, SG-EVID-001, SG-LIFE-001).
 */
export const confirmEvidencePrune = async ({
  evidenceStore = null,
  preview = null,
  confirmation = null,
} = {}) => {
  const result = await evidenceStore.confirmPrune({ preview, confirmation });

  return {
    ...result,
    preserved: ['envelopes', 'decisions', 'lifecycle-events', 'pruning-records', 'tombstones'],
  };
};

/**
 * `gate locks` — the operator surface over TB-009's coordination lock.
 *
 * Inspection reads and judges. It never acquires the lock, never recovers a
 * stale one, and never removes another holder's record: recovery stays the
 * explicit, confirmation-bound operation TB-009 made it, and this command only
 * reports whether one is available (FR-COORD-005, SG-LIFE-001).
 */
export const inspectCoordination = async ({
  repositoryRoot = null,
  gitCommonDirectory = null,
  runGit = undefined,
  staleAfterMs = undefined,
} = {}) => {
  const lock = await openCoordinationLock({
    repositoryRoot,
    gitCommonDirectory,
    ...(runGit === undefined ? {} : { runGit }),
    ...(staleAfterMs === undefined ? {} : { staleAfterMs }),
  });
  const inspection = await lock.inspect();

  return {
    lockPath: lock.lockPath,
    gitCommonDirectory: lock.gitCommonDirectory,
    held: inspection.held,
    stale: inspection.stale,
    staleReasons: inspection.staleReasons,
    liveness: inspection.liveness,
    holder: inspection.record,
    recoveryToken: inspection.recoveryToken,
    // Observation only. Both of these are always false here, by construction.
    acquired: false,
    recovered: false,
    // A live holder is nobody's to take. Only a stale one may be recovered, and
    // only by an operator who reproduces the token above.
    action: inspection.held && inspection.stale ? 'gate locks --recover' : null,
  };
};
