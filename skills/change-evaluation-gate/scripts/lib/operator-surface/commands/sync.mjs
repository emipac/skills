import { cloneShortcut, createTrustEstablishment, selfTestAdapterSurface, selfTestEvaluationDenial } from '../../activation-seams.mjs';
import { previewSync, syncActivation } from '../../activation.mjs';
import { CONFIGURATION_FILE, gateChecksFromConfiguration, parseConfigurationDocument } from '../../configuration.mjs';
import { resolveConfiguration, resolveReceipt } from '../../hook-runner.mjs';
import { resolveClone } from '../clone.mjs';
import { runGit } from '../git.mjs';
import { instructionSelectors, mismatchExplanation } from '../instructions.mjs';
import { failure, mutation, recordSurfaceRefusal } from '../outcomes.mjs';
import { PACKAGED_HOOK_PROGRAM } from '../runtime.mjs';
import { declaredSensitiveInputs } from '../../policy.mjs';
import { remedyInstruction } from '../../remedies.mjs';

/**
 * The Trusted configuration as this clone's history holds it.
 *
 * An Activation receipt pins the configuration's identity and not the policy,
 * so a sync that must judge a transition against the Trusted policy has to
 * recover the document. The committed `.agent-framework.yaml` at `HEAD` is the
 * one place it ordinarily still is — a drifted clone denies every commit, so
 * the edit being synced is normally not committed yet. What is read here is
 * only a candidate: `previewSync` accepts it only if it reproduces the
 * identity the receipt pinned (`FR-CFG-005`, `TB-062`).
 */
export const committedConfiguration = async (repositoryRoot) => {
  const contents = await runGit(repositoryRoot, ['show', `HEAD:${CONFIGURATION_FILE}`]).catch(() => null);
  const parsed = contents === null ? null : parseConfigurationDocument(contents);

  if (parsed?.ok !== true) {
    return null;
  }

  return {
    schemaVersion: parsed.value?.schema_version ?? null,
    policy: parsed.value?.evaluation_gate ?? null,
    source: 'committed-configuration',
  };
};

/**
 * Why a sync preview offers no token, and what to do instead.
 *
 * A refusal the clone recovers from names its `remedy` from the one remedy
 * table, never a sentence of its own (`TB-065`). The rest are not recoveries:
 * there is nothing to do, a flag to add, or a registration to go and look at.
 */
const SYNC_REFUSALS = Object.freeze({
  'nothing-to-sync': Object.freeze({
    detail: 'the configuration and the commands it resolves to are exactly what the receipt pins',
    next: 'nothing to sync',
  }),
  'weakening-unacknowledged': Object.freeze({
    detail: 'the candidate is weaker than the trusted policy that authorized this clone, and a weaker candidate is pinned only when the invocation acknowledges the weakening by name',
    next: 'gate sync --acknowledge-weakening',
  }),
  'receipt-drifted': Object.freeze({
    detail: 'the Activation receipt no longer reproduces its own identity, and a sync never re-pins on top of a receipt that changed',
    remedy: 'activation-transaction',
  }),
  'adapter-set-changed': Object.freeze({
    detail: 'the installed gate no longer declares the adapter set the receipt pins; a sync keeps that set and never changes it',
    remedy: 'activation-transaction',
  }),
  'hook-registration-drifted': Object.freeze({
    detail: 'the gate-owned Git registration is not the one the receipt pins, and a sync keeps registrations rather than rewriting them',
    remedy: 'repair',
  }),
  'hook-registration-not-reproducible': Object.freeze({
    detail: 'the registered hook program is not the one this installed gate would register, so keeping the registration would pin a program this sync did not preview',
    remedy: 'activation-transaction',
  }),
  'adapter-registration-changed': Object.freeze({
    detail: 'a client registration the receipt pins is not the entry this sync would keep, and a sync never rewrites one',
    next: 'gate status',
  }),
  'trusted-configuration-unrecoverable': Object.freeze({
    detail: `no document reproduces the configuration identity the receipt pins — not the receipt, not ${CONFIGURATION_FILE} at HEAD — so the transition cannot be judged against the trusted policy`,
    remedy: 'activation-transaction',
  }),
  'candidate-policy-invalid': Object.freeze({
    detail: 'the candidate policy does not validate on its own terms',
    remedy: 'correct-configuration',
  }),
});

/** What to do instead of a refused sync, through the clone's own shortcut where it is a recovery. */
const syncRefusalNext = async (reasonCode, repositoryRoot) => {
  const entry = SYNC_REFUSALS[reasonCode] ?? null;

  if (entry === null) {
    return `nothing to confirm (${reasonCode})`;
  }

  if (entry.remedy === undefined) {
    return entry.next;
  }

  const shortcut = await cloneShortcut({ repositoryRoot, runGit: (args) => runGit(repositoryRoot, args) });

  return remedyInstruction(entry.remedy, shortcut ?? 'gate');
};

/** Everything one sync of THIS clone would be, resolved from the clone itself. */
const syncRequestFor = async ({ repositoryRoot, receipt, selector }) => {
  const configuration = await resolveConfiguration(repositoryRoot);

  if (!configuration.ok) {
    return {
      failed: failure({
        command: 'sync',
        reasonCode: configuration.reasonCode,
        detail: `${configuration.detail} Sync pins the configuration this clone declares, and there is none it could pin; correct ${CONFIGURATION_FILE} first.`,
      }),
    };
  }

  const { checks, errors } = gateChecksFromConfiguration(configuration.configuration);

  if (errors.length > 0) {
    return {
      failed: failure({
        command: 'sync',
        reasonCode: 'check-descriptors-invalid',
        detail: `this clone's configured verification commands cannot be resolved into checks: ${errors.map((error) => `${error.path}: ${error.message}`).join(' ')}`,
      }),
    };
  }

  return {
    request: {
      scope: 'repository',
      trigger: 'explicit',
      repository: { root: repositoryRoot },
      configuration: {
        schemaVersion: configuration.configuration?.schema_version ?? null,
        policy: configuration.policy,
      },
      runtime: {
        // The program activation registers, and so the one whose registration
        // a sync can prove it is keeping.
        hookProgram: {
          interpreter: process.execPath,
          script: PACKAGED_HOOK_PROGRAM,
          args: [],
        },
      },
      checks,
      runtimeInputs: declaredSensitiveInputs(configuration.policy),
      prior: receipt,
      trusted: await committedConfiguration(repositoryRoot),
      acknowledgeWeakening: selector.acknowledgeWeakening === true,
    },
  };
};

/**
 * `gate sync` — re-pin a changed configuration in one consented step, keeping
 * the adapters this clone already has (`TB-062`).
 *
 * It is `gate activate` with the adapter set read from the receipt instead of a
 * `--client` selector, one more section in the preview, and no registration
 * written. The preview names the Trusted and candidate identities and every
 * weakening `evaluatePolicyTransition` finds between them; a weaker candidate
 * offers no token unless the invocation acknowledges the weakening, and the
 * token then binds the candidate and the acknowledgement together — the
 * candidate-hash approval `FR-CFG-005` requires. Confirming it runs
 * `syncActivation`, which re-derives all of it and refuses anything that moved.
 *
 * Adding or removing an adapter is still `activate` and `deactivate`, and the
 * preview says so rather than guessing a set (`FR-LIFE-019`, `SG-LIFE-001`).
 */
export const operateSync = async ({ repositoryRoot, environment, selector, confirmation }) => {
  const existing = await resolveReceipt(repositoryRoot);

  if (!existing.ok) {
    return failure({
      command: 'sync',
      reasonCode: existing.reasonCode,
      detail: existing.reasonCode === 'activation-receipt-missing'
        ? `${existing.detail} A sync re-pins an activated clone; run \`gate activate\` instead.`
        : existing.detail,
    });
  }

  const resolved = await syncRequestFor({ repositoryRoot, receipt: existing.receipt, selector });

  if (resolved.failed) {
    return resolved.failed;
  }

  const { request } = resolved;
  const dependencies = { runGit, environment };
  let preview;

  try {
    preview = await previewSync(request, dependencies);
  } catch (error) {
    return failure({
      command: 'sync',
      reasonCode: 'sync-unpreviewable',
      detail: `this clone cannot be previewed for a sync (${error.message}); nothing was written.`,
    });
  }

  const refusal = preview.refusal === null ? null : {
    reasonCode: preview.refusal.reasonCode,
    detail: SYNC_REFUSALS[preview.refusal.reasonCode]?.detail ?? null,
    next: await syncRefusalNext(preview.refusal.reasonCode, repositoryRoot),
    errors: preview.refusal.errors,
  };
  const observation = {
    state: 'activated',
    receiptId: preview.receiptId,
    release: preview.release,
    repositoryIdentity: preview.repository.identity,
    trusted: preview.trusted,
    candidate: preview.candidate,
    transition: preview.transition,
    acknowledgedWeakening: preview.acknowledgedWeakening,
    adapters: preview.adapters,
    hook: preview.hook,
    adapterRegistrations: preview.adapterRegistrations,
    commands: preview.commands,
    unresolved: preview.unresolved,
    dependencyRoots: preview.dependencyRoots,
    dependencyProvisioning: preview.dependencyProvisioning,
    runtimeInputs: preview.runtimeInputs,
    refusal,
    confirmationToken: refusal === null ? preview.previewId : null,
  };
  const nothingToDo = refusal?.reasonCode === 'nothing-to-sync';

  if (confirmation === null) {
    return { command: 'sync', healthy: refusal === null || nothingToDo, observation, mutation: null };
  }

  const clone = await resolveClone({
    repositoryRoot,
    environment,
    command: 'sync',
    consentChannel: selector.consentChannel,
  });

  if (clone.failed) {
    return clone.failed;
  }

  const refuse = async (reasonCode, summary) => {
    await recordSurfaceRefusal({
      evidenceStore: clone.store,
      type: 'activation',
      before: confirmation,
      reason: `${reasonCode}: ${summary}`,
    });

    return {
      command: 'sync',
      healthy: false,
      observation,
      mutation: mutation({ confirmation, performed: false, reasonCode, summary }),
    };
  };

  if (refusal !== null) {
    return refuse(
      refusal.reasonCode,
      `Nothing was re-pinned (${refusal.reasonCode}): ${refusal.detail ?? 'this clone refuses the sync this invocation asked for'}, and a confirmation cannot change that.`,
    );
  }

  if (confirmation !== preview.previewId) {
    return refuse(
      'preview-mismatch',
      `Nothing was re-pinned (preview-mismatch): ${mismatchExplanation('sync', instructionSelectors('sync', selector))}`,
    );
  }

  const consent = {
    previewId: preview.previewId,
    repositoryIdentity: preview.repository.identity,
    configurationIdentity: preview.candidate.identity,
    actor: null,
    grantedAt: new Date().toISOString(),
  };
  const result = await syncActivation({ ...request, consent }, {
    ...dependencies,
    evidenceStore: clone.store,
    // The same three seams `gate activate` binds, bound the same way and
    // replaceable from nothing on the argument vector.
    establishTrust: createTrustEstablishment({ consent, actor: null }),
    selfTestEvaluation: () => selfTestEvaluationDenial({
      runnerVersion: existing.receipt.runtime?.runnerVersion ?? null,
    }),
    selfTestAdapter: selfTestAdapterSurface,
  });
  const synced = result.activated === true;

  return {
    command: 'sync',
    healthy: synced,
    observation,
    mutation: mutation({
      confirmation,
      performed: synced,
      reasonCode: result.reasonCode,
      step: result.step,
      order: result.order,
      state: result.state,
      priorReceiptId: preview.receiptId,
      receiptId: result.receipt?.receiptId ?? null,
      transition: result.transition ?? null,
      rollback: result.rollback,
      errors: result.errors ?? [],
      summary: synced
        ? `The configuration ${preview.candidate.identity} is pinned: the receipt ${result.receipt.receiptId} replaced ${preview.receiptId} by one atomic write, every registration was kept byte for byte, and the next evaluation is graded under it.${result.transition?.weakened ? ` It is weaker than the policy it replaced, and that weakening was acknowledged by the token confirmed here: ${result.transition.weakenings.map((weakening) => `${weakening.code} ${weakening.checkId}`).join(', ')}.` : ''}`
        : (result.state === 'recovery-required'
          ? `The sync failed at ${result.step} (${result.reasonCode}) and could not be fully rolled back; this clone requires recovery: ${result.rollback.remains.join(' ')}`
          : `Nothing was re-pinned (${result.reasonCode}): the sync failed at ${result.step}, and the receipt ${preview.receiptId} and every registration are exactly as they were.`),
    }),
  };
};
