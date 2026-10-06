import { readHookRegistration } from '../../activation.mjs';
import { contentIdentity } from '../../evidence-store.mjs';
import { deactivateGate } from '../../lifecycle.mjs';
import { resolveClone } from '../clone.mjs';
import { DEACTIVATION_PRESERVES } from '../constants.mjs';
import { mismatchExplanation } from '../instructions.mjs';
import { mutation, recordSurfaceRefusal } from '../outcomes.mjs';

/**
 * What one deactivation would withdraw, re-derived from this clone right now.
 *
 * `deactivateGate` takes no preview, so this describes what it would act on
 * rather than deciding anything about it: the registrations the receipt pins,
 * as they are ON DISK. A registration edited between the preview and the
 * confirmation changes its own identity here, so the token stops reproducing
 * and the operator is sent back to look again — which is the same reason
 * `TB-036` re-derives a cleanup from the file instead of trusting the caller.
 */
const deactivationPreview = async (receipt) => {
  const registrations = [];

  for (const hook of receipt?.hooks ?? []) {
    const registration = await readHookRegistration(hook.path, hook.ownership);

    registrations.push({
      kind: 'hook-registration',
      hook: hook.hook ?? null,
      path: hook.path,
      ownership: hook.ownership,
      present: registration.present === true,
      blockIdentity: registration.blockIdentity ?? null,
      receiptId: registration.receiptId ?? null,
    });
  }

  const body = {
    receiptId: receipt?.receiptId ?? null,
    registrations,
    adapterRegistrations: (receipt?.adapters ?? [])
      .filter((adapter) => adapter.registration?.kind === 'client-configuration-file')
      .map((adapter) => ({
        kind: 'adapter-registration',
        adapter: adapter.id,
        path: adapter.registration.path ?? null,
        entryIdentity: adapter.registration.entryIdentity ?? null,
      })),
    preserved: [...DEACTIVATION_PRESERVES],
  };

  return { ...body, confirmationToken: contentIdentity(body) };
};

/** `gate deactivate` — withdraw exactly the gate-owned registrations and the receipt. */
export const operateDeactivate = async ({ repositoryRoot, environment, selector, confirmation }) => {
  const clone = await resolveClone({
    repositoryRoot,
    environment,
    command: 'deactivate',
    consentChannel: confirmation === null ? null : selector.consentChannel,
  });

  if (clone.failed) {
    return clone.failed;
  }

  const observation = await deactivationPreview(clone.receipt);

  if (confirmation === null) {
    return { command: 'deactivate', healthy: true, observation, mutation: null };
  }

  if (confirmation !== observation.confirmationToken) {
    await recordSurfaceRefusal({
      evidenceStore: clone.store,
      type: 'removal',
      before: confirmation,
      reason: 'preview-mismatch: the confirmation did not reproduce the deactivation preview its token names; nothing was removed and nothing was repaired.',
    });

    return {
      command: 'deactivate',
      healthy: false,
      observation,
      mutation: mutation({
        confirmation,
        performed: false,
        reasonCode: 'preview-mismatch',
        expected: observation.confirmationToken,
        summary: `Nothing was removed (preview-mismatch): ${mismatchExplanation('deactivate', [])}`,
      }),
    };
  }

  const result = await deactivateGate({ evidenceStore: clone.store, repositoryRoot });

  return {
    command: 'deactivate',
    healthy: result.deactivated === true,
    observation,
    mutation: mutation({
      confirmation,
      performed: result.deactivated === true,
      reasonCode: result.reasonCode,
      removed: result.removed,
      preserved: result.preserved,
      errors: result.errors ?? [],
      summary: result.deactivated === true
        ? `${result.removed.length} gate-owned item(s) were withdrawn; ${result.preserved.join(', ')} were preserved.`
        : `Nothing was removed (${result.reasonCode}); deactivation refuses as a whole rather than half-performing, and repairs nothing it found.`,
    }),
  };
};
