import { AUTHORITATIVE_HOOK, readHookRegistration } from '../activation.mjs';
import { reconcileAdapterRegistration } from '../adapter-registration.mjs';
// The one reader of "does this clone hold a Gate policy", imported rather than
// reimplemented: `gate status` must answer that question exactly the way the
// authoritative runner and `gate activate` already answer it (`AC-CFG-001`).
import { resolveConfiguration } from '../hook-runner.mjs';
import { authorizedReceiptIds } from './receipts.mjs';
import { activeRelease } from './release.mjs';
import { reconcileControlSurface } from '../security-control.mjs';

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
  unversionedGraderSurfaces = null,
  repositoryRoot = null,
} = {}, dependencies = {}) => {
  const {
    probeAdapter = async () => ({ ok: true }),
    // NOT a configuration reader of this module's own. It is the same
    // `resolveConfiguration` the authoritative runner, the preflight runner and
    // `gate activate` already answer "does this clone hold a Gate policy" with,
    // reached through the same export, so there is one definition of
    // `configured` rather than a second one waiting to disagree with it
    // (`AC-CFG-001`, `TB-047`). It is a seam only so a test can observe the
    // question being asked.
    resolveConfiguration: resolveCloneConfiguration = resolveConfiguration,
  } = dependencies;

  const receipt = await evidenceStore?.activationReceipt().read() ?? null;
  const findings = [];

  if (receipt === null) {
    // Reading a configuration is not the same act as reading a receipt: the
    // lifecycle has three states, and which of the first two this clone is in
    // is not knowable from the receipt's absence alone.
    const configuration = typeof repositoryRoot === 'string' && repositoryRoot.length > 0
      ? await resolveCloneConfiguration(repositoryRoot)
      : {
        ok: false,
        reasonCode: 'repository-unresolved',
        detail: 'No repository root was given, so no configuration could be read.',
      };
    // A clone HOLDS a policy when the shared reader found an `evaluation_gate`
    // section — including one the policy contract then rejects. An invalid
    // policy is a configured clone with a policy to fix; a missing one is a
    // clone that was never configured, and only the second is `installed`.
    const holdsPolicy = configuration.ok || configuration.reasonCode === 'gate-policy-invalid';

    if (!holdsPolicy) {
      return {
        state: 'installed',
        // Nothing is registered, nothing is enforced, and nothing has drifted.
        // An unconfigured clone is a correct and untroubled condition, not a
        // broken one, and `broken` goes on meaning what FR-LIFE-009 says it
        // means for a clone that IS enforcing something.
        status: 'healthy',
        receipt: null,
        release: null,
        // What is missing is the policy, not the receipt, in the same words and
        // under the same reason code `gate activate` refuses this clone with.
        findings: [{
          area: 'configuration',
          severity: 'informational',
          code: configuration.reasonCode,
          detail: `${configuration.detail} The clone is installed but not configured; there is nothing to enforce and nothing to reconcile.`,
        }],
        repaired: false,
        mutations: [],
      };
    }

    return {
      state: 'configured',
      status: 'healthy',
      receipt: null,
      release: null,
      findings: [
        {
          area: 'activation',
          severity: 'informational',
          code: 'activation-absent',
          detail: 'The clone is configured but not activated; there is nothing to enforce and nothing to reconcile.',
        },
        // A policy the contract rejects is still a policy this clone holds, and
        // saying so here is what keeps `status` and `activate` telling one
        // story about it.
        ...(configuration.ok ? [] : [{
          area: 'configuration',
          severity: 'informational',
          code: configuration.reasonCode,
          detail: configuration.detail,
        }]),
      ],
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

  // A declared Grader surface Git does not track: the standing statement of a
  // fact every evaluation records, made here where durable facts live rather
  // than on every agent turn. It is informational, so it never moves health:
  // a clone may run this way indefinitely, and nothing here is a fault or an
  // accusation (`FR-EVAL-009`, `SG-TRUST-001`, `AC-SEC-001`, `TB-066`).
  for (const surface of unversionedGraderSurfaces ?? []) {
    findings.push({
      area: 'grader-surface',
      severity: 'informational',
      code: 'grader-surface-unversioned',
      path: surface.path,
      detail: `${surface.path} is a declared Grader surface (${surface.kind}) that Git does not track, so it has no history, no review, and nothing to diff an edit against. Every evaluation records it as unversioned and none reports it as changed.`,
    });
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
